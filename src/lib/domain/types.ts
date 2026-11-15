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
  | "receita"
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
export type ItemKind = "pet" | "veiculo";

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
  /** Endereço da página pública de agendamento (/agendar/<endereço>). */
  bookingSlug: string | null;
  bookingEnabled: boolean;
  /** Horário marcado pelo link já entra confirmado. */
  bookingAutoConfirm: boolean;
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
  segment: "geral",
  plan: "empresa",
  extraModules: [],
  bookingSlug: null,
  bookingEnabled: false,
  bookingAutoConfirm: false,
  accessUntil: null,
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
  /** Limite do crediário (null ou ausente: o cliente não compra no crediário). */
  creditLimitCents?: number | null;
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
  /** Placa do veículo, sem hífen e em maiúsculas (só veículos). */
  plate?: string | null;
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
  /** Horário de trabalho por dia da semana ("0" = domingo). Vazio = sem horário definido. */
  workHours: WorkHours;
}

/** {"1": [["09:00","12:00"],["13:00","18:00"]]}: períodos de trabalho de cada dia da semana. */
export type WorkHours = Partial<Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string][]>>;

/** Folga, férias ou compromisso: período em que a agenda não recebe horários. */
export interface ResourceBlock {
  id: string;
  resourceId: string;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  reason: string;
  createdBy: string;
}

export interface Product {
  id: string;
  name: string;
  priceCents: number;
  active: boolean;
  /** Estoque (Fase 4). Código interno, código de barras, custo e saldo. */
  sku?: string;
  barcode?: string | null;
  costCents?: number;
  trackStock?: boolean;
  /** Saldo: soma das movimentações (só o banco altera). */
  stockQty?: number;
  minStock?: number;
  /** Moda: tamanho e cor da peça (cada combinação é um produto). */
  size?: string;
  color?: string;
  /** Autopeças: em quais carros a peça serve. */
  fits?: string;
}

export type StockMovementKind = "entrada" | "venda" | "devolucao" | "ajuste" | "perda";

export interface StockMovement {
  id: string;
  productId: string;
  kind: StockMovementKind;
  /** Positivo entra, negativo sai. */
  quantity: number;
  unitCostCents: number | null;
  saleId: string | null;
  /** Pedido com prazo que tirou (ou devolveu) o produto do estoque. */
  orderId?: string | null;
  reason: string;
  createdBy: string;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------- Pedidos com prazo e receita de óculos

export type OrderStage = "recebido" | "producao" | "terceiro" | "pronto" | "entregue" | "cancelado";

export interface Order {
  id: string;
  number: number;
  clientId: string;
  /** Técnico responsável (uma "agenda" de quem atende). */
  resourceId: string | null;
  prescriptionId: string | null;
  title: string;
  details: string;
  stage: OrderStage;
  promisedOn: ISODate;
  totalCents: number;
  /** Sinal pago na hora. */
  downCents: number;
  readyAt: ISODateTime | null;
  deliveredAt: ISODateTime | null;
  canceledAt: ISODateTime | null;
  cancelReason: string | null;
  createdBy: string;
  createdAt: ISODateTime;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string | null;
  description: string;
  quantity: number;
  unitCents: number;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  description: string;
  actorId: string | null;
  createdAt: ISODateTime;
}

/** Valores de um olho: esférico, cilíndrico, eixo e adição (null = não informado). */
export interface EyeValues {
  sph: number | null;
  cyl: number | null;
  axis: number | null;
  add: number | null;
}

/** Receita de óculos (dado de saúde): não se corrige, lança-se uma nova. */
export interface Prescription {
  id: string;
  clientId: string;
  examinedOn: ISODate;
  validUntil: ISODate;
  doctor: string;
  od: EyeValues;
  oe: EyeValues;
  dnpOd: number | null;
  dnpOe: number | null;
  notes: string;
  createdBy: string;
  createdAt: ISODateTime;
}

/** Venda no balcão: à vista (entra no caixa) ou no crediário (vira parcelas). */
export interface CounterSale {
  id: string;
  sessionId: string;
  clientId: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  payment: "avista" | "crediario";
  method: PaymentMethod | null;
  createdBy: string;
  createdAt: ISODateTime;
}

/** Caixa do dia: abre com o troco, recebe e vende, e fecha comparando o esperado com o contado. */
export interface CashSession {
  id: string;
  openedBy: string;
  openedAt: ISODateTime;
  openingCents: number;
  closedBy: string | null;
  closedAt: ISODateTime | null;
  expectedCents: number | null;
  countedCents: number | null;
  notes: string;
}

export interface CashSaleItem {
  id: string;
  accountId: string;
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitCents: number;
  /** Venda do balcão a que o item pertence (vendas antigas do caixa não têm). */
  saleId?: string | null;
  /** Quantas unidades já foram devolvidas. */
  returnedQty?: number;
}

/** Regra de comissão: porcentagem (centésimos: 4000 = 40%) ou valor fixo, por profissional e/ou serviço. */
export interface CommissionRule {
  id: string;
  resourceId: string | null;
  serviceId: string | null;
  percentBp: number | null;
  fixedCents: number | null;
}

export interface CommissionClosing {
  id: string;
  resourceId: string;
  /** Primeiro dia do mês. */
  month: ISODate;
  appointments: number;
  baseCents: number;
  amountCents: number;
  accountId: string | null;
  closedAt: ISODateTime;
}

/** Turma com horário fixo (pilates, yoga, aulas). */
export interface ClassGroup {
  id: string;
  name: string;
  /** Agenda do instrutor. */
  resourceId: string | null;
  /** 0 = domingo … 6 = sábado. */
  weekdays: number[];
  startTime: string;
  durationMin: number;
  capacity: number;
  active: boolean;
}

export interface Enrollment {
  id: string;
  classId: string;
  clientId: string;
  startedOn: ISODate;
  endedOn: ISODate | null;
}

export type AttendanceStatus = "presente" | "falta" | "reposicao";

export interface Attendance {
  id: string;
  classId: string;
  clientId: string;
  classDate: ISODate;
  status: AttendanceStatus;
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
  /** Quem marcou: a equipe, ou o próprio cliente pelo link. */
  source?: "equipe" | "online";
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
export type AccountOrigin =
  | "venda"
  | "despesa"
  | "avulsa"
  | "atendimento"
  | "pacote"
  | "mensalidade"
  | "caixa"
  | "comissao"
  | "os"
  | "crediario"
  | "devolucao"
  | "pedido";

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
  /** Cobrança de uma ordem de serviço entregue. */
  workOrderId?: string | null;
  /** Venda do balcão (à vista, parcela do crediário ou devolução). */
  counterSaleId?: string | null;
  /** Sinal ou restante de um pedido com prazo. */
  orderId?: string | null;
}

// ---------------------------------------------------------------- Oficina (ordem de serviço)

export type WorkOrderStage = "orcamento" | "aprovacao" | "peca" | "servico" | "pronto" | "entregue" | "cancelada";
export type FuelLevel = "reserva" | "1/4" | "1/2" | "3/4" | "cheio";
export type ApprovalChannel = "link" | "presencial" | "telefone" | "whatsapp";
export type WorkOrderItemStatus = "pendente" | "aprovado" | "recusado";

export interface WorkOrder {
  id: string;
  number: number;
  clientId: string;
  /** O veículo (item do cliente com placa). */
  itemId: string;
  /** Mecânico responsável (uma "agenda" de quem atende). */
  resourceId: string | null;
  stage: WorkOrderStage;
  complaint: string;
  diagnosis: string;
  km: number | null;
  fuel: FuelLevel | null;
  /** Itens conferidos na entrada e avarias anotadas. */
  checklist: string[];
  promisedOn: ISODate | null;
  discountCents: number;
  shareToken: string | null;
  sentAt: ISODateTime | null;
  approvedAt: ISODateTime | null;
  approvedByName: string | null;
  approvalChannel: ApprovalChannel | null;
  deliveredAt: ISODateTime | null;
  totalCents: number | null;
  canceledAt: ISODateTime | null;
  cancelReason: string | null;
  nextServiceOn: ISODate | null;
  nextServiceNote: string;
  createdBy: string;
  createdAt: ISODateTime;
}

export interface WorkOrderItem {
  id: string;
  workOrderId: string;
  kind: "peca" | "servico";
  serviceId: string | null;
  description: string;
  quantity: number;
  unitCents: number;
  warrantyDays: number | null;
  status: WorkOrderItemStatus;
  addedBy: string;
  createdAt: ISODateTime;
}

export interface WorkOrderEvent {
  id: string;
  workOrderId: string;
  description: string;
  actorId: string | null;
  createdAt: ISODateTime;
}

export interface WorkOrderPhoto {
  id: string;
  workOrderId: string;
  /** Endereço para mostrar a foto (link temporário do Storage, ou a imagem na prévia). */
  url: string;
  caption: string;
  createdBy: string;
  createdAt: ISODateTime;
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
  /** Recebido no caixa do dia. */
  cashSessionId?: string | null;
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
  blocks: ResourceBlock[];
  products: Product[];
  cashSessions: CashSession[];
  cashSaleItems: CashSaleItem[];
  commissionRules: CommissionRule[];
  commissionClosings: CommissionClosing[];
  classes: ClassGroup[];
  enrollments: Enrollment[];
  attendance: Attendance[];
  workOrders: WorkOrder[];
  workOrderItems: WorkOrderItem[];
  workOrderEvents: WorkOrderEvent[];
  workOrderPhotos: WorkOrderPhoto[];
  stockMovements: StockMovement[];
  counterSales: CounterSale[];
  orders: Order[];
  orderItems: OrderItem[];
  orderEvents: OrderEvent[];
  prescriptions: Prescription[];
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
