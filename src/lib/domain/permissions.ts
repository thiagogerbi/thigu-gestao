import type { Client, Deal, Role } from "@/lib/domain/types";

/**
 * Matriz de permissões usada pela interface (para mostrar o que faz sentido)
 * e pelo servidor (para recusar operações). Na versão real, o banco também
 * aplica as mesmas regras por RLS e dentro das funções SQL — esconder botões não basta.
 */
export type Capability =
  | "empresa.gerenciar" // membros, papéis e dados da empresa
  | "crm.ver_todos" // ver clientes e negociações de todos
  | "crm.editar_todos" // editar clientes e negociações de qualquer responsável
  | "crm.editar_proprios" // criar e editar os próprios clientes/negociações
  | "venda.fechar" // fechar venda e propor condições
  | "venda.conferir" // conferir venda e criar contas a receber
  | "financeiro.ver" // ver contas a receber/pagar e caixa
  | "financeiro.registrar" // registrar recebimentos/pagamentos, despesas, cancelar e desfazer
  | "recebiveis.ver_proprios"; // vendedor acompanha parcelas das próprias vendas (somente leitura)

const MATRIX: Record<Role, Capability[]> = {
  admin: [
    "empresa.gerenciar",
    "crm.ver_todos",
    "crm.editar_todos",
    "crm.editar_proprios",
    "venda.fechar",
    "venda.conferir",
    "financeiro.ver",
    "financeiro.registrar",
    "recebiveis.ver_proprios",
  ],
  gestor: ["crm.ver_todos", "crm.editar_todos", "crm.editar_proprios", "venda.fechar", "recebiveis.ver_proprios"],
  vendedor: ["crm.editar_proprios", "venda.fechar", "recebiveis.ver_proprios"],
  financeiro: ["crm.ver_todos", "venda.conferir", "financeiro.ver", "financeiro.registrar"],
};

export function can(roles: readonly Role[], cap: Capability): boolean {
  return roles.some((r) => MATRIX[r].includes(cap));
}

export function canEditClient(roles: readonly Role[], userId: string, client: Pick<Client, "ownerId">): boolean {
  return can(roles, "crm.editar_todos") || (can(roles, "crm.editar_proprios") && client.ownerId === userId);
}

export function canEditDeal(roles: readonly Role[], userId: string, deal: Pick<Deal, "ownerId">): boolean {
  return can(roles, "crm.editar_todos") || (can(roles, "crm.editar_proprios") && deal.ownerId === userId);
}

/** Quem pode ser escolhido como responsável ao criar/editar: vendedor só pode escolher a si mesmo. */
export function canAssignOthers(roles: readonly Role[]): boolean {
  return can(roles, "crm.editar_todos");
}

export function usesCrm(roles: readonly Role[]): boolean {
  return can(roles, "crm.editar_proprios") || can(roles, "crm.ver_todos");
}
