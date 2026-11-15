import type { Client, Deal, Resource, Role } from "@/lib/domain/types";

/**
 * Matriz de permissões usada pela interface (para mostrar o que faz sentido)
 * e pelo servidor (para recusar operações). Na versão real, o banco também
 * aplica as mesmas regras por RLS e dentro das funções SQL — esconder botões não basta.
 *
 * Clientes e negociações têm permissões separadas: a recepção de uma clínica cadastra pacientes
 * de todos os profissionais, mas não negocia nem vê vendas.
 */
export type Capability =
  | "empresa.gerenciar" // membros, papéis e dados da empresa
  | "clientes.ver_todos" // ver os clientes de todos
  | "clientes.editar_todos" // cadastrar e editar clientes de qualquer responsável
  | "clientes.editar_proprios" // cadastrar e editar os próprios clientes
  | "crm.ver_todos" // ver negociações de todos
  | "crm.editar_todos" // editar negociações de qualquer responsável
  | "crm.editar_proprios" // criar e editar as próprias negociações
  | "venda.fechar" // fechar venda e propor condições
  | "venda.conferir" // conferir venda e criar contas a receber
  | "financeiro.ver" // ver contas a receber/pagar e caixa
  | "financeiro.registrar" // registrar recebimentos/pagamentos, despesas, cancelar e desfazer
  | "recebiveis.ver_proprios" // vendedor acompanha parcelas das próprias vendas (somente leitura)
  | "agenda.todas" // ver e marcar na agenda de todos
  | "agenda.propria" // ver e marcar só nas agendas ligadas à própria pessoa
  | "agenda.configurar" // cadastrar serviços e quem atende
  | "prontuario.escrever" // escrever e ler as próprias anotações de atendimento
  | "recorrentes.vender" // vender pacotes e criar ou cancelar mensalidades
  | "caixa.operar" // abrir o caixa, vender e receber no balcão
  | "caixa.fechar" // fechar e conferir o caixa
  | "produtos.gerenciar" // cadastrar produtos e preços
  | "comissoes.ver_todas" // ver a comissão de todos (cada profissional vê a própria)
  | "comissoes.configurar" // regras de comissão
  | "comissoes.fechar" // fechar o mês e gerar a conta a pagar
  | "turmas.gerenciar" // criar e editar turmas
  | "turmas.matricular" // matricular alunos e marcar presença (o instrutor marca nas próprias turmas)
  | "os.ver_todas" // ver todas as ordens de serviço (o mecânico vê as dele)
  | "os.editar" // abrir OS, orçar, enviar, registrar aprovação, mover qualquer etapa, cancelar
  | "os.desconto_livre" // desconto acima de 10% do orçamento
  | "os.entregar" // entregar o veículo e gerar a cobrança
  | "estoque.movimentar" // dar entrada de mercadoria, ajustar e registrar perdas
  | "balcao.desconto_livre" // desconto acima de 10% na venda do balcão
  | "crediario.limite"; // definir o limite de crediário de cada cliente

const ALL_CLIENTS: Capability[] = ["clientes.ver_todos", "clientes.editar_todos", "clientes.editar_proprios"];

const MATRIX: Record<Role, Capability[]> = {
  admin: [
    "empresa.gerenciar",
    ...ALL_CLIENTS,
    "crm.ver_todos",
    "crm.editar_todos",
    "crm.editar_proprios",
    "venda.fechar",
    "venda.conferir",
    "financeiro.ver",
    "financeiro.registrar",
    "recebiveis.ver_proprios",
    "agenda.todas",
    "agenda.configurar",
    "recorrentes.vender",
    "caixa.operar",
    "caixa.fechar",
    "produtos.gerenciar",
    "comissoes.ver_todas",
    "comissoes.configurar",
    "comissoes.fechar",
    "turmas.gerenciar",
    "turmas.matricular",
    "os.ver_todas",
    "os.editar",
    "os.desconto_livre",
    "os.entregar",
    "estoque.movimentar",
    "balcao.desconto_livre",
    "crediario.limite",
  ],
  gestor: [
    ...ALL_CLIENTS,
    "crm.ver_todos",
    "crm.editar_todos",
    "crm.editar_proprios",
    "venda.fechar",
    "recebiveis.ver_proprios",
    "agenda.todas",
    "agenda.configurar",
    "recorrentes.vender",
    "produtos.gerenciar",
    "comissoes.ver_todas",
    "turmas.gerenciar",
    "turmas.matricular",
    "os.ver_todas",
    "os.editar",
    "os.desconto_livre",
    "os.entregar",
    "estoque.movimentar",
    "balcao.desconto_livre",
  ],
  vendedor: [
    "clientes.editar_proprios",
    "crm.editar_proprios",
    "venda.fechar",
    "recebiveis.ver_proprios",
    "caixa.operar",
  ],
  financeiro: [
    "clientes.ver_todos",
    "crm.ver_todos",
    "venda.conferir",
    "financeiro.ver",
    "financeiro.registrar",
    "recorrentes.vender",
    "caixa.operar",
    "caixa.fechar",
    "comissoes.ver_todas",
    "comissoes.fechar",
    "os.ver_todas",
    "os.entregar",
    "estoque.movimentar",
    "crediario.limite",
  ],
  // Papéis dos ramos com atendimento. O caixa do dia entra com o próximo módulo.
  recepcao: [
    ...ALL_CLIENTS,
    "agenda.todas",
    "recorrentes.vender",
    "caixa.operar",
    "turmas.matricular",
    "os.ver_todas",
    "os.editar",
    "os.entregar",
  ],
  // o administrador não lê o prontuário dos outros: quem atende e também é dono acumula "profissional"
  profissional: ["clientes.editar_proprios", "agenda.propria", "prontuario.escrever"],
  caixa: [...ALL_CLIENTS, "caixa.operar"],
};

export function can(roles: readonly Role[], cap: Capability): boolean {
  return roles.some((r) => MATRIX[r].includes(cap));
}

export function canEditClient(roles: readonly Role[], userId: string, client: Pick<Client, "ownerId">): boolean {
  return can(roles, "clientes.editar_todos") || (can(roles, "clientes.editar_proprios") && client.ownerId === userId);
}

export function canEditDeal(roles: readonly Role[], userId: string, deal: Pick<Deal, "ownerId">): boolean {
  return can(roles, "crm.editar_todos") || (can(roles, "crm.editar_proprios") && deal.ownerId === userId);
}

/** Quem pode escolher outro responsável para uma negociação ou tarefa: vendedor só escolhe a si mesmo. */
export function canAssignOthers(roles: readonly Role[]): boolean {
  return can(roles, "crm.editar_todos");
}

/** Quem pode escolher outro responsável para um cliente (a recepção cadastra para o profissional). */
export function canAssignClientOwner(roles: readonly Role[]): boolean {
  return can(roles, "clientes.editar_todos");
}

/** Agenda: quem marca para todos, ou o profissional nas agendas ligadas a ele. */
export function canManageResource(
  roles: readonly Role[],
  userId: string,
  resource: Pick<Resource, "userId"> | undefined,
): boolean {
  if (!resource) return false;
  return can(roles, "agenda.todas") || (can(roles, "agenda.propria") && resource.userId === userId);
}

export function usesAgenda(roles: readonly Role[]): boolean {
  return can(roles, "agenda.todas") || can(roles, "agenda.propria");
}

export function usesClients(roles: readonly Role[]): boolean {
  return can(roles, "clientes.editar_proprios") || can(roles, "clientes.ver_todos");
}

export function usesCrm(roles: readonly Role[]): boolean {
  return can(roles, "crm.editar_proprios") || can(roles, "crm.ver_todos");
}
