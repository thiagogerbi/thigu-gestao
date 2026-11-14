/**
 * Tipos de domínio do Thigu Gestão.
 * Valores em dinheiro são SEMPRE inteiros em centavos (ex.: R$ 1.500,00 = 150000).
 * Datas de calendário usam o formato ISO "AAAA-MM-DD"; instantes usam ISO completo.
 */

export type Role = "admin" | "gestor" | "vendedor" | "financeiro" | "recepcao" | "profissional" | "caixa";

/** Ramo da empresa: define módulos, nomes usados nas telas e papéis (catálogo em segments.ts). */
export type Segment = "geral" | "clinica" | "beleza" | "pet" | "turmas" | "veiculos" | "balcao" | "pedidos";

/** Plano contratado. A ordem importa: cada plano inclui o que os anteriores têm. */
export type Plan = "essencial" | "equipe" | "empresa";

/** Módulos que podem ser ligados por ramo e plano (além da base: clientes, tarefas e financeiro). */
export type ModuleId =
  | "itens"
  | "agenda"
  | "servicos"
  | "prontuario"
  | "lembretes"
  | "pacotes"
  | "mensalidades"
  | "turmas"
  | "comissoes"
  | "caixa"
  | "agendamento_online"
  | "lembrete_automatico"
  | "ordem_servico"
  | "estoque"
  | "pedidos";

/** O que o cliente traz para ser atendido. Hoje só pets; veículos entram com a ordem de serviço. */
export type ItemKind = "pet";

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
  segment: Segment;
  /** Só o Thigu altera (não há tela para isso enquanto não existe cobrança). */
  plan: Plan;
  /** Módulos ligados à parte, além dos que o ramo já traz. Só o Thigu altera. */
  extraModules: ModuleId[];
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
  segment: "geral",
  plan: "empresa",
  extraModules: [],
};

export interface Member {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
}

/** Convite aguardando resposta, como o administrador da empresa vê. */
export interface CompanyInvite {
  id: string;
  email: string;
  roles: Role[];
  createdAt: ISODateTime;
}

/** Convite que a pessoa logada recebeu e ainda não respondeu. */
export interface MyInvite {
  id: string;
  companyId: string;
  companyName: string;
  roles: Role[];
  invitedByName: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  ownerId: string;
  /** Campos próprios do ramo (data de nascimento, convênio…), definidos em segments.ts. */
  extra: Record<string, string>;
  createdAt: ISODateTime;
}

/** Pet (e, mais adiante, veículo) ligado a um cliente. Arquivar esconde sem apagar o histórico. */
export interface ClientItem {
  id: string;
  clientId: string;
  kind: ItemKind;
  name: string;
  details: Record<string, string>;
  /** Aviso que precisa saltar aos olhos: bravo, alérgico, idoso… */
  alert: string;
  active: boolean;
  createdAt: ISODateTime;
}

/** Quem atende na agenda: uma pessoa da equipe (com login) ou só um nome, como uma sala ou a manicure sem acesso. */
export interface Resource {
  id: string;
  name: string;
  /** Pessoa da equipe ligada a esta agenda. O profissional vê e marca só nas agendas ligadas a ele. */
  userId: string | null;
  active: boolean;
}

export interface Service {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  active: boolean;
}

export type AppointmentStatus = "agendado" | "confirmado" | "compareceu" | "faltou" | "cancelado";

export interface Appointment {
  id: string;
  clientId: string;
  resourceId: string;
  serviceId: string | null;
  /** Pet atendido (ramo pet shop). */
  itemId: string | null;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  status: AppointmentStatus;
  priceCents: number;
  notes: string;
  /** Atendimentos que se repetem têm o mesmo identificador de série. */
  seriesId: string | null;
  /** Conta a receber criada ao marcar "compareceu" (ou a falta cobrada). */
  accountId: string | null;
  /** Quando alguém tocou em "lembrar pelo WhatsApp". */
  remindedAt: ISODateTime | null;
  /** Pacote do cliente usado neste horário (não gera cobrança; desconta uma sessão). */
  packageId: string | null;
  /** O atendimento (ou a falta cobrada) usou uma sessão do pacote. */
  consumesPackage: boolean;
  createdBy: string;
  createdAt: ISODateTime;
}

/** Evolução escrita pelo profissional. Só quem escreveu lê. Nada é apagado: corrigir cria outra anotação. */
export interface ClinicalNote {
  id: string;
  clientId: string;
  appointmentId: string | null;
  authorId: string;
  body: string;
  /** Anotação que esta corrige. */
  correctsId: string | null;
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
export type AccountOrigin = "venda" | "despesa" | "avulsa" | "atendimento" | "pacote" | "mensalidade";

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
  /** Parcela da venda de um pacote. */
  packageId?: string | null;
  /** Cobrança de uma mensalidade, com o mês a que se refere (primeiro dia do mês). */
  subscriptionId?: string | null;
  period?: ISODate | null;
}

/** Pacote de sessões vendido a um cliente. Sessões usadas = atendimentos que consumiram o pacote. */
export interface Package {
  id: string;
  clientId: string;
  serviceId: string | null;
  itemId: string | null;
  name: string;
  sessionsTotal: number;
  priceCents: number;
  validUntil: ISODate | null;
  closedAt: ISODateTime | null;
  createdAt: ISODateTime;
}

/** Mensalidade: gera uma conta a receber por mês, no dia escolhido. */
export interface Subscription {
  id: string;
  clientId: string;
  name: string;
  amountCents: number;
  /** De 1 a 28, para existir em todos os meses. */
  dayOfMonth: number;
  startsOn: ISODate;
  endsOn: ISODate | null;
  canceledAt: ISODateTime | null;
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
  items: ClientItem[];
  resources: Resource[];
  services: Service[];
  appointments: Appointment[];
  clinicalNotes: ClinicalNote[];
  packages: Package[];
  subscriptions: Subscription[];
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
  recepcao: "Recepção",
  profissional: "Profissional",
  caixa: "Caixa",
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
