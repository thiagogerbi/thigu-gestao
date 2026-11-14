import { isISODate } from "@/lib/domain/dates";
import { ROLE_LABEL, type ItemKind, type ModuleId, type Plan, type Role, type Segment } from "@/lib/domain/types";

/**
 * Catálogo de ramos, módulos e planos: a única fonte do que cada tipo de empresa vê.
 * O banco tem o mesmo catálogo em supabase/migrations (funções _segment_modules e _module_min_plan);
 * tests/db.test.ts compara os dois, para que nunca fiquem diferentes.
 *
 * Toda ação passa por quatro perguntas: (1) o ramo tem o módulo? (2) o plano inclui? — respondidas
 * aqui por moduleEnabled; (3) o papel permite? (4) o registro é da pessoa? — respondidas em permissions.ts.
 */

export const SEGMENT_IDS: Segment[] = ["geral", "clinica", "beleza", "pet", "turmas", "veiculos", "balcao", "pedidos"];
export const PLAN_IDS: Plan[] = ["essencial", "equipe", "empresa"];

/** Campo extra da ficha do cliente ou do item (pet). Os valores são sempre texto. */
export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "date" | "select";
  options?: string[];
  hint?: string;
}

export interface ModuleInfo {
  label: string;
  /** Plano mínimo que libera o módulo. */
  minPlan: Plan;
  /** Já existe no sistema? Módulos ainda não construídos nunca aparecem, mesmo ligados. */
  built: boolean;
}

export const MODULES: Record<ModuleId, ModuleInfo> = {
  itens: { label: "Pets e veículos do cliente", minPlan: "essencial", built: true },
  agenda: { label: "Agenda", minPlan: "essencial", built: true },
  servicos: { label: "Lista de serviços", minPlan: "essencial", built: true },
  prontuario: { label: "Ficha de atendimento", minPlan: "essencial", built: true },
  lembretes: { label: "Lembretes pelo WhatsApp", minPlan: "essencial", built: true },
  pacotes: { label: "Pacotes de sessões", minPlan: "essencial", built: true },
  mensalidades: { label: "Mensalidades", minPlan: "essencial", built: true },
  turmas: { label: "Turmas e presença", minPlan: "essencial", built: false },
  caixa: { label: "Caixa do dia", minPlan: "essencial", built: false },
  ordem_servico: { label: "Ordem de serviço", minPlan: "essencial", built: false },
  estoque: { label: "Estoque", minPlan: "essencial", built: false },
  pedidos: { label: "Pedidos com prazo", minPlan: "essencial", built: false },
  comissoes: { label: "Comissões", minPlan: "equipe", built: false },
  agendamento_online: { label: "Agendamento online", minPlan: "equipe", built: false },
  lembrete_automatico: { label: "Lembrete automático", minPlan: "equipe", built: false },
};
export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export interface PlanInfo {
  label: string;
  /** Pessoas com acesso ao sistema (profissional sem login não conta). */
  users: number;
}
export const PLANS: Record<Plan, PlanInfo> = {
  essencial: { label: "Essencial", users: 2 },
  equipe: { label: "Equipe", users: 5 },
  empresa: { label: "Empresa", users: 10 },
};

export interface SegmentInfo {
  label: string;
  /** Exemplos mostrados na escolha do ramo. */
  examples: string;
  modules: ModuleId[];
  /** Como o ramo chama o cliente: [singular, plural], em minúsculas. */
  client: [string, string];
  /** Papéis oferecidos ao convidar alguém, na ordem em que aparecem. */
  roles: Role[];
  /** Nome que o papel recebe neste ramo (os demais usam o nome padrão). */
  roleLabels?: Partial<Record<Role, string>>;
  clientFields: FieldDef[];
  itemKind?: ItemKind;
}

const BIRTH: FieldDef = { key: "nascimento", label: "Data de nascimento", type: "date" };

export const SEGMENTS: Record<Segment, SegmentInfo> = {
  geral: {
    label: "Vendas e serviços em geral",
    examples: "Agências, consultorias, prestadores de serviço, representantes",
    modules: [],
    client: ["cliente", "clientes"],
    roles: ["admin", "gestor", "vendedor", "financeiro"],
    clientFields: [],
  },
  clinica: {
    label: "Consultório ou clínica",
    examples: "Psicologia, nutrição, odontologia, fisioterapia, estética, médicos",
    modules: [
      "agenda",
      "servicos",
      "prontuario",
      "lembretes",
      "pacotes",
      "mensalidades",
      "agendamento_online",
      "lembrete_automatico",
    ],
    client: ["paciente", "pacientes"],
    roles: ["admin", "recepcao", "profissional", "financeiro"],
    roleLabels: { profissional: "Profissional de saúde" },
    clientFields: [
      BIRTH,
      { key: "convenio", label: "Convênio", type: "text", hint: "Deixe em branco se o atendimento é particular." },
      {
        key: "responsavel",
        label: "Responsável",
        type: "text",
        hint: "Para menores de idade: nome de quem acompanha.",
      },
    ],
  },
  beleza: {
    label: "Salão, barbearia ou estúdio",
    examples: "Cabeleireiro, barbearia, manicure, sobrancelha, tatuagem",
    modules: [
      "agenda",
      "servicos",
      "lembretes",
      "pacotes",
      "mensalidades",
      "caixa",
      "comissoes",
      "agendamento_online",
      "lembrete_automatico",
    ],
    client: ["cliente", "clientes"],
    roles: ["admin", "recepcao", "profissional", "caixa", "financeiro"],
    clientFields: [
      BIRTH,
      {
        key: "preferencias",
        label: "Preferências e alergias",
        type: "text",
        hint: "Ex.: alergia a amônia, prefere corte na tesoura.",
      },
    ],
  },
  pet: {
    label: "Pet shop ou veterinária",
    examples: "Banho e tosa, pet shop, clínica veterinária, creche",
    modules: [
      "itens",
      "agenda",
      "servicos",
      "lembretes",
      "pacotes",
      "caixa",
      "agendamento_online",
      "lembrete_automatico",
    ],
    client: ["tutor", "tutores"],
    roles: ["admin", "recepcao", "profissional", "caixa", "financeiro"],
    roleLabels: { recepcao: "Atendente", profissional: "Banhista, tosador ou veterinário" },
    clientFields: [{ key: "endereco", label: "Endereço", type: "text", hint: "Para busca e entrega do pet." }],
    itemKind: "pet",
  },
  turmas: {
    label: "Aulas e turmas",
    examples: "Pilates, yoga, academia, dança, cursos",
    modules: ["agenda", "servicos", "lembretes", "turmas", "mensalidades", "lembrete_automatico"],
    client: ["aluno", "alunos"],
    roles: ["admin", "recepcao", "profissional", "financeiro"],
    roleLabels: { profissional: "Instrutor(a)" },
    clientFields: [
      BIRTH,
      { key: "emergencia", label: "Contato de emergência", type: "text", hint: "Nome e telefone." },
    ],
  },
  veiculos: {
    label: "Oficina e serviços automotivos",
    examples: "Mecânica, funilaria e pintura, auto elétrica, lava-rápido",
    modules: ["ordem_servico", "servicos", "lembretes", "comissoes"],
    client: ["cliente", "clientes"],
    roles: ["admin", "recepcao", "profissional", "financeiro"],
    roleLabels: { recepcao: "Atendente", profissional: "Mecânico" },
    clientFields: [],
  },
  balcao: {
    label: "Loja e venda no balcão",
    examples: "Roupas, autopeças, presentes, comércio de bairro",
    modules: ["caixa", "estoque"],
    client: ["cliente", "clientes"],
    roles: ["admin", "vendedor", "caixa", "financeiro"],
    clientFields: [BIRTH],
  },
  pedidos: {
    label: "Pedidos com prazo de entrega",
    examples: "Ótica, costura, lavanderia, gráfica",
    modules: ["pedidos", "lembretes", "caixa", "estoque"],
    client: ["cliente", "clientes"],
    roles: ["admin", "recepcao", "profissional", "financeiro"],
    roleLabels: { recepcao: "Atendente", profissional: "Técnico" },
    clientFields: [BIRTH],
  },
};

/** O mínimo que as funções precisam saber da empresa (CompanyProfile já tem estes campos). */
export interface CompanyFlags {
  segment: Segment;
  plan: Plan;
  extraModules: readonly ModuleId[];
}

const planRank = (p: Plan) => PLAN_IDS.indexOf(p);

/** Perguntas 1 e 2: o ramo (ou um extra ligado à parte) tem o módulo, e o plano inclui? */
export function moduleEnabled(company: CompanyFlags, module: ModuleId): boolean {
  const inSegment = SEGMENTS[company.segment].modules.includes(module) || company.extraModules.includes(module);
  return inSegment && planRank(company.plan) >= planRank(MODULES[module].minPlan);
}

/** Módulo ligado E já construído: é o que as telas usam para mostrar menus e botões. */
export function moduleAvailable(company: CompanyFlags, module: ModuleId): boolean {
  return MODULES[module].built && moduleEnabled(company, module);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Terms {
  /** "paciente" */
  cliente: string;
  /** "pacientes" */
  clientes: string;
  /** "Paciente" */
  Cliente: string;
  /** "Pacientes" */
  Clientes: string;
}

/** Nomes que as telas usam no lugar de "cliente". Todos são masculinos, então "o/novo/nenhum" servem. */
export function termsFor(segment: Segment): Terms {
  const [one, many] = SEGMENTS[segment].client;
  return { cliente: one, clientes: many, Cliente: capitalize(one), Clientes: capitalize(many) };
}

export function roleLabel(segment: Segment, role: Role): string {
  return SEGMENTS[segment].roleLabels?.[role] ?? ROLE_LABEL[role];
}

/** Papéis para escolher ao convidar ou editar alguém: os do ramo, mais os que a pessoa já tem. */
export function rolesFor(segment: Segment, alreadyHeld: readonly Role[] = []): Role[] {
  const base = SEGMENTS[segment].roles;
  return [...base, ...alreadyHeld.filter((r) => !base.includes(r))];
}

// ---------------------------------------------------------------- Itens do cliente (pets)

export interface ItemKindInfo {
  /** [singular, plural], em minúsculas. */
  noun: [string, string];
  nameLabel: string;
  nameHint: string;
  alertHint: string;
  fields: FieldDef[];
}

export const ITEM_KINDS: Record<ItemKind, ItemKindInfo> = {
  pet: {
    noun: ["pet", "pets"],
    nameLabel: "Nome do pet",
    nameHint: "Ex.: Thor",
    alertHint: "Aparece em destaque na ficha. Ex.: bravo com outros cães, alérgico, idoso.",
    fields: [
      { key: "especie", label: "Espécie", type: "select", options: ["Cão", "Gato", "Outro"] },
      { key: "raca", label: "Raça", type: "text" },
      { key: "porte", label: "Porte", type: "select", options: ["Pequeno", "Médio", "Grande"] },
      { key: "peso", label: "Peso (kg)", type: "text" },
      { key: "nascimento", label: "Data de nascimento", type: "date" },
    ],
  },
};

/** Tipo de item que o ramo usa, se o módulo estiver ligado. */
export function itemKindFor(company: CompanyFlags): ItemKind | null {
  return moduleAvailable(company, "itens") ? (SEGMENTS[company.segment].itemKind ?? null) : null;
}

// ---------------------------------------------------------------- Validação dos campos extras

const MAX_TEXT = 200;

/**
 * Confere os valores contra a lista de campos: descarta vazios, recusa campo que não existe na lista,
 * data inválida, opção fora da lista e texto longo demais. `prefix` monta a chave do erro ("extra.convenio").
 */
export function cleanFields(
  fields: readonly FieldDef[],
  raw: Record<string, string> | undefined,
  prefix: string,
): { ok: true; value: Record<string, string> } | { ok: false; fieldErrors: Record<string, string> } {
  const value: Record<string, string> = {};
  const fieldErrors: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(raw ?? {})) {
    const v = rawValue.trim();
    if (!v) continue;
    const def = fields.find((f) => f.key === key);
    if (!def) fieldErrors[`${prefix}.${key}`] = "Este campo não existe para o ramo da empresa.";
    else if (def.type === "date" && !isISODate(v)) fieldErrors[`${prefix}.${key}`] = "Data inválida.";
    else if (def.type === "select" && !def.options?.includes(v))
      fieldErrors[`${prefix}.${key}`] = "Escolha uma das opções.";
    else if (v.length > MAX_TEXT) fieldErrors[`${prefix}.${key}`] = `Use até ${MAX_TEXT} letras.`;
    else value[key] = v;
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, value };
}

/**
 * Junta os valores conferidos aos que já estavam gravados: os campos da lista são substituídos
 * (vazio remove) e os de outro ramo ficam guardados — trocar de ramo não apaga nada.
 */
export function mergeFields(
  fields: readonly FieldDef[],
  existing: Record<string, string>,
  clean: Record<string, string>,
): Record<string, string> {
  const kept = Object.fromEntries(Object.entries(existing).filter(([key]) => !fields.some((f) => f.key === key)));
  return { ...kept, ...clean };
}
