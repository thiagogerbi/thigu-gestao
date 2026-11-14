/**
 * Tipos de domínio do Thigu Gestão.
 * Valores em dinheiro são SEMPRE inteiros em centavos (ex.: R$ 1.500,00 = 150000).
 * Datas de calendário usam o formato ISO "AAAA-MM-DD"; instantes usam ISO completo.
 */

export type Role = "admin" | "gestor" | "vendedor" | "financeiro";

export type Stage = "novo_contato" | "qualificacao" | "negociacao" | "proposta" | "ganha" | "perdida";

export type ISODate = string;
export type ISODateTime = string;

export interface Company {
  id: string;
  name: string;
}

/** Dados da empresa que aparecem na proposta, mais a identidade visual (logotipo e cor). */
export interface CompanyProfile extends Company {
  legalName: string;
  /** CPF ou CNPJ sem pontuação (vazio quando não informado). */
  document: string;
  phone: string;
  email: string;
  address: string;
  /** Texto que já vem preenchido em "Condições comerciais" ao criar uma proposta. */
  defaultTerms: string;
  /** data:image/png|webp|jpeg;base64,… ou null. */
  logoDataUrl: string | null;
  /** #rrggbb escolhido pela empresa, ou null para o azul Thigu. */
  brandColor: string | null;
  /** #rrggbb do menu lateral, ou null para um tom escuro automático da cor da marca. */
  menuColor: string | null;
  /**
   * Último dia de acesso pago (renovado com código de ativação). Depois disso a empresa fica
   * somente leitura. null = sem prazo (prévia).
   */
  accessUntil: ISODate | null;
}

export const EMPTY_PROFILE: Omit<CompanyProfile, "id" | "name"> = {
  legalName: "",
  document: "",
  phone: "",
  email: "",
  address: "",
  defaultTerms: "",
  logoDataUrl: null,
  brandColor: null,
  menuColor: null,
  accessUntil: null,
};

export interface Member {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  ownerId: string;
  createdAt: ISODateTime;
}

export interface Deal {
  id: string;
  clientId: string;
  title: string;
  valueCents: number;
  ownerId: string;
  stage: Stage;
  expectedClose: ISODate | null;
  stageChangedAt: ISODateTime;
  nextAction: string | null;
  nextActionDate: ISODate | null;
  lostReason: string | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type TaskStatus = "aberta" | "concluida";

export interface Task {
  id: string;
  title: string;
  clientId: string | null;
  dealId: string | null;
  assigneeId: string;
  dueDate: ISODate;
  status: TaskStatus;
  completedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

export interface Note {
  id: string;
  clientId: string;
  dealId: string | null;
  body: string;
  authorId: string;
  createdAt: ISODateTime;
}

export interface ProposalItem {
  description: string;
  quantity: number;
  unitCents: number;
}

export type ProposalStatus = "rascunho" | "enviada" | "aceita" | "recusada";

export interface Proposal {
  id: string;
  number: number;
  clientId: string;
  dealId: string;
  items: ProposalItem[];
  discountCents: number;
  validUntil: ISODate;
  terms: string;
  status: ProposalStatus;
  sentAt: ISODateTime | null;
  acceptedAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PlannedInstallment {
  number: number;
  amountCents: number;
  dueDate: ISODate;
}

export type PaymentMode = "avista" | "parcelado";
export type SaleStatus = "aguardando_conferencia" | "confirmada" | "cancelada";

export interface Sale {
  id: string;
  dealId: string;
  clientId: string;
  proposalId: string | null;
  totalCents: number;
  paymentMode: PaymentMode;
  plan: PlannedInstallment[];
  status: SaleStatus;
  closedBy: string;
  closedAt: ISODateTime;
  reviewedBy: string | null;
  reviewedAt: ISODateTime | null;
}

export type AccountKind = "receber" | "pagar";
export type AccountOrigin = "venda" | "despesa" | "avulsa";

export interface Account {
  id: string;
  kind: AccountKind;
  clientId: string | null;
  supplier: string | null;
  description: string;
  origin: AccountOrigin;
  saleId: string | null;
  installmentNumber: number;
  installmentCount: number;
  amountCents: number;
  dueDate: ISODate;
  category: string | null;
  canceledAt: ISODateTime | null;
  canceledBy: string | null;
  cancelReason: string | null;
  createdAt: ISODateTime;
}

export type PaymentMethod =
  "pix" | "dinheiro" | "cartao_credito" | "cartao_debito" | "boleto" | "transferencia" | "outro";

export interface Movement {
  id: string;
  accountId: string;
  direction: "entrada" | "saida";
  amountCents: number;
  paidOn: ISODate;
  method: PaymentMethod;
  registeredBy: string;
  createdAt: ISODateTime;
  undoneAt: ISODateTime | null;
  undoneBy: string | null;
  undoReason: string | null;
}

export interface Activity {
  id: string;
  clientId: string | null;
  dealId: string | null;
  kind: string;
  description: string;
  actorId: string;
  createdAt: ISODateTime;
}

/** Tudo o que o usuário pode ver de uma empresa (já filtrado por permissões na versão real). */
export interface CompanyData {
  company: CompanyProfile;
  members: Member[];
  clients: Client[];
  deals: Deal[];
  tasks: Task[];
  notes: Note[];
  proposals: Proposal[];
  sales: Sale[];
  accounts: Account[];
  movements: Movement[];
  activities: Activity[];
}

export const STAGES: { id: Stage; label: string; hint: string }[] = [
  { id: "novo_contato", label: "Novo contato", hint: "Primeira conversa ainda não aconteceu" },
  { id: "qualificacao", label: "Entendendo a necessidade", hint: "Descobrindo o que o cliente precisa" },
  { id: "negociacao", label: "Negociação", hint: "Conversando sobre valores e condições" },
  { id: "proposta", label: "Proposta", hint: "Proposta enviada, aguardando resposta" },
  { id: "ganha", label: "Ganha", hint: "Venda fechada" },
  { id: "perdida", label: "Perdida", hint: "Cliente não seguiu adiante" },
];

export const STAGE_LABEL: Record<Stage, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<
  Stage,
  string
>;

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador/dono",
  gestor: "Gestor comercial",
  vendedor: "Vendedor",
  financeiro: "Financeiro",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  boleto: "Boleto",
  transferencia: "Transferência",
  outro: "Outro",
};

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  rascunho: "Em preparo",
  enviada: "Enviada — aguardando resposta",
  aceita: "Aceita pelo cliente",
  recusada: "Recusada",
};

export const EXPENSE_CATEGORIES = [
  "Aluguel",
  "Fornecedores",
  "Salários",
  "Impostos",
  "Marketing",
  "Software e internet",
  "Transporte",
  "Outros",
];
