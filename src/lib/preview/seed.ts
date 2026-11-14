/**
 * DADOS FICTÍCIOS da prévia. Nenhuma pessoa, empresa, telefone ou e-mail aqui é real.
 * As datas são calculadas a partir de "hoje" para que a prévia pareça sempre atual.
 */
import { addDays, toISODate } from "@/lib/domain/dates";
import { buildPlan } from "@/lib/domain/installments";
import { subscriptionChargeDescription, subscriptionPeriods } from "@/lib/domain/recurring";
import {
  EMPTY_PROFILE,
  type Account,
  type Appointment,
  type Subscription,
  type CompanyData,
  type Deal,
  type Member,
  type Movement,
  type Proposal,
  type Sale,
  type Task,
} from "@/lib/domain/types";

export const PREVIEW_COMPANY_IDS = {
  aurora: "empresa-aurora",
  horizonte: "empresa-horizonte",
  clinica: "empresa-clinica",
  pet: "empresa-pet",
} as const;

export function buildPreviewSeed(now: Date = new Date()): CompanyData[] {
  const today = toISODate(now);
  const day = (n: number) => addDays(today, n);
  const at = (n: number, hour = 10) => {
    const [y, m, d] = day(n).split("-").map(Number);
    return new Date(y, m - 1, d, hour, 0, 0).toISOString();
  };
  /** Horário de atendimento: dia relativo a hoje, hora e minuto locais. */
  const slot = (n: number, hour: number, minute: number, durationMin: number) => {
    const [y, m, d] = day(n).split("-").map(Number);
    const start = new Date(y, m - 1, d, hour, minute, 0);
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + durationMin * 60_000).toISOString() };
  };
  const receivable = (
    p: Pick<Account, "id" | "clientId" | "description" | "origin" | "amountCents" | "dueDate"> & Partial<Account>,
  ): Account => ({
    kind: "receber",
    supplier: null,
    saleId: null,
    installmentNumber: 1,
    installmentCount: 1,
    category: null,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
    createdAt: at(-30),
    ...p,
  });
  const appointment = (
    p: Pick<Appointment, "id" | "clientId" | "resourceId" | "serviceId" | "priceCents"> &
      Partial<Appointment> & { startsAt: string; endsAt: string },
  ): Appointment => ({
    itemId: null,
    status: "agendado",
    notes: "",
    seriesId: null,
    accountId: null,
    remindedAt: null,
    packageId: null,
    consumesPackage: false,
    createdBy: "u-ana",
    createdAt: at(-10),
    ...p,
  });

  // ---------- Aurora Estúdio (empresa com dados) ----------
  const auroraMembers: Member[] = [
    { userId: "u-ana", name: "Ana Souza", email: "ana@aurora.exemplo", roles: ["admin"] },
    { userId: "u-bruno", name: "Bruno Lima", email: "bruno@aurora.exemplo", roles: ["vendedor"] },
    { userId: "u-carla", name: "Carla Mendes", email: "carla@aurora.exemplo", roles: ["financeiro"] },
    { userId: "u-diego", name: "Diego Rocha", email: "diego@aurora.exemplo", roles: ["gestor"] },
  ];

  const client = (
    id: string,
    name: string,
    email: string,
    phone: string,
    ownerId: string,
    created: number,
    extra: Record<string, string> = {},
  ) => ({ id, name, email, phone, ownerId, extra, createdAt: at(created) });
  const clients = [
    client("c-marina", "Marina Costa", "marina@cafe-marina.exemplo", "(11) 90000-1001", "u-bruno", -60),
    client("c-joao", "João Pereira", "joao@paoquente.exemplo", "(11) 90000-1002", "u-bruno", -45),
    client("c-luciana", "Luciana Ramos", "luciana@ramosadv.exemplo", "(11) 90000-1003", "u-diego", -40),
    client("c-pedro", "Pedro Henrique", "pedro@oficinaph.exemplo", "(11) 90000-1004", "u-bruno", -20),
    client("c-sofia", "Sofia Martins", "sofia@bemestar.exemplo", "(11) 90000-1005", "u-bruno", -30),
    client("c-rafael", "Rafael Gomes", "", "(11) 90000-1006", "u-ana", -2),
  ];

  const deal = (
    p: Partial<Deal> & Pick<Deal, "id" | "clientId" | "title" | "valueCents" | "ownerId" | "stage">,
    changed: number,
  ): Deal => ({
    expectedClose: null,
    nextAction: null,
    nextActionDate: null,
    lostReason: null,
    stageChangedAt: at(changed),
    createdAt: at(changed - 5),
    updatedAt: at(changed),
    ...p,
  });
  const deals: Deal[] = [
    deal(
      {
        id: "d-marina",
        clientId: "c-marina",
        title: "Identidade visual do Café Marina",
        valueCents: 150000,
        ownerId: "u-bruno",
        stage: "ganha",
        expectedClose: day(-35),
      },
      -35,
    ),
    deal(
      {
        id: "d-joao-cardapio",
        clientId: "c-joao",
        title: "Cardápio digital",
        valueCents: 240000,
        ownerId: "u-bruno",
        stage: "proposta",
        expectedClose: day(10),
        nextAction: "Retornar sobre a proposta nº 2",
        nextActionDate: day(-1),
      },
      -4,
    ),
    deal(
      {
        id: "d-luciana-site",
        clientId: "c-luciana",
        title: "Site institucional",
        valueCents: 480000,
        ownerId: "u-diego",
        stage: "negociacao",
        expectedClose: day(20),
        nextAction: "Enviar exemplos de sites",
        nextActionDate: day(2),
      },
      -12,
    ),
    deal(
      {
        id: "d-pedro",
        clientId: "c-pedro",
        title: "Logo e fachada da oficina",
        valueCents: 120000,
        ownerId: "u-bruno",
        stage: "qualificacao",
        expectedClose: day(25),
        nextAction: "Enviar referências de logo",
        nextActionDate: day(0),
      },
      -3,
    ),
    deal(
      {
        id: "d-sofia",
        clientId: "c-sofia",
        title: "Redes sociais — 3 meses",
        valueCents: 360000,
        ownerId: "u-bruno",
        stage: "ganha",
        expectedClose: day(-1),
      },
      -1,
    ),
    deal(
      {
        id: "d-rafael",
        clientId: "c-rafael",
        title: "Campanha de inauguração",
        valueCents: 200000,
        ownerId: "u-ana",
        stage: "novo_contato",
        expectedClose: day(30),
      },
      -2,
    ),
    deal(
      {
        id: "d-luciana-cartoes",
        clientId: "c-luciana",
        title: "Cartões de visita",
        valueCents: 30000,
        ownerId: "u-diego",
        stage: "perdida",
        lostReason: "Escolheu outro fornecedor pelo preço",
      },
      -25,
    ),
    deal(
      {
        id: "d-joao-fotos",
        clientId: "c-joao",
        title: "Fotos de produtos",
        valueCents: 80000,
        ownerId: "u-bruno",
        stage: "ganha",
        expectedClose: day(-28),
      },
      -28,
    ),
  ];

  const proposals: Proposal[] = [
    {
      id: "p-1",
      number: 1,
      clientId: "c-marina",
      dealId: "d-marina",
      status: "aceita",
      items: [
        { description: "Criação de logotipo", quantity: 1, unitCents: 90000 },
        { description: "Manual de marca simplificado", quantity: 1, unitCents: 60000 },
      ],
      discountCents: 0,
      validUntil: day(-30),
      terms: "Pagamento em 3 parcelas mensais. Inclui 2 rodadas de ajustes.",
      sentAt: at(-38),
      acceptedAt: at(-35),
      createdAt: at(-40),
      updatedAt: at(-35),
    },
    {
      id: "p-2",
      number: 2,
      clientId: "c-joao",
      dealId: "d-joao-cardapio",
      status: "enviada",
      items: [
        { description: "Design do cardápio digital", quantity: 1, unitCents: 180000 },
        { description: "Fotos dos pratos (por prato)", quantity: 8, unitCents: 10000 },
      ],
      discountCents: 20000,
      validUntil: day(11),
      terms: "50% na aprovação e 50% na entrega. Prazo de 15 dias úteis.",
      sentAt: at(-4),
      acceptedAt: null,
      createdAt: at(-5),
      updatedAt: at(-4),
    },
  ];

  const sales: Sale[] = [
    {
      id: "s-marina",
      dealId: "d-marina",
      clientId: "c-marina",
      proposalId: "p-1",
      totalCents: 150000,
      paymentMode: "parcelado",
      plan: [
        { number: 1, amountCents: 50000, dueDate: day(-4) },
        { number: 2, amountCents: 50000, dueDate: day(26) },
        { number: 3, amountCents: 50000, dueDate: day(56) },
      ],
      status: "confirmada",
      closedBy: "u-bruno",
      closedAt: at(-35),
      reviewedBy: "u-carla",
      reviewedAt: at(-34),
    },
    {
      id: "s-sofia",
      dealId: "d-sofia",
      clientId: "c-sofia",
      proposalId: null,
      totalCents: 360000,
      paymentMode: "parcelado",
      plan: [
        { number: 1, amountCents: 180000, dueDate: day(5) },
        { number: 2, amountCents: 180000, dueDate: day(35) },
      ],
      status: "aguardando_conferencia",
      closedBy: "u-bruno",
      closedAt: at(-1),
      reviewedBy: null,
      reviewedAt: null,
    },
    {
      id: "s-joao-fotos",
      dealId: "d-joao-fotos",
      clientId: "c-joao",
      proposalId: null,
      totalCents: 80000,
      paymentMode: "avista",
      plan: [{ number: 1, amountCents: 80000, dueDate: day(-21) }],
      status: "confirmada",
      closedBy: "u-bruno",
      closedAt: at(-28),
      reviewedBy: "u-carla",
      reviewedAt: at(-27),
    },
  ];

  const acc = (
    p: Partial<Account> & Pick<Account, "id" | "kind" | "description" | "amountCents" | "dueDate">,
  ): Account => ({
    clientId: null,
    supplier: null,
    origin: "venda",
    saleId: null,
    installmentNumber: 1,
    installmentCount: 1,
    category: null,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
    createdAt: at(-34),
    ...p,
  });
  const accounts: Account[] = [
    ...sales[0].plan.map((pl) =>
      acc({
        id: `a-marina-${pl.number}`,
        kind: "receber",
        clientId: "c-marina",
        saleId: "s-marina",
        description: "Identidade visual do Café Marina — Marina Costa",
        installmentNumber: pl.number,
        installmentCount: 3,
        amountCents: pl.amountCents,
        dueDate: pl.dueDate,
      }),
    ),
    acc({
      id: "a-joao-fotos",
      kind: "receber",
      clientId: "c-joao",
      saleId: "s-joao-fotos",
      description: "Fotos de produtos — João Pereira",
      amountCents: 80000,
      dueDate: day(-21),
      createdAt: at(-27),
    }),
    acc({
      id: "a-aluguel",
      kind: "pagar",
      origin: "despesa",
      supplier: "Imobiliária Exemplo",
      category: "Aluguel",
      description: "Aluguel da sala",
      amountCents: 180000,
      dueDate: day(5),
      createdAt: at(-10),
    }),
    acc({
      id: "a-software",
      kind: "pagar",
      origin: "despesa",
      supplier: "Ferramenta de design (fictícia)",
      category: "Software e internet",
      description: "Assinatura de software",
      amountCents: 18990,
      dueDate: day(-5),
      createdAt: at(-12),
    }),
    acc({
      id: "a-grafica",
      kind: "pagar",
      origin: "despesa",
      supplier: "Gráfica Exemplo",
      category: "Fornecedores",
      description: "Impressão de amostras",
      amountCents: 45000,
      dueDate: day(-2),
      createdAt: at(-9),
    }),
  ];

  const mv = (
    id: string,
    accountId: string,
    direction: Movement["direction"],
    amountCents: number,
    paidOn: string,
    method: Movement["method"],
    by: string,
  ): Movement => ({
    id,
    accountId,
    direction,
    amountCents,
    paidOn,
    method,
    registeredBy: by,
    createdAt: new Date(paidOn + "T12:00:00").toISOString(),
    undoneAt: null,
    undoneBy: null,
    undoReason: null,
  });
  const movements: Movement[] = [
    mv("m-joao", "a-joao-fotos", "entrada", 80000, day(-20), "pix", "u-carla"),
    mv("m-software", "a-software", "saida", 18990, day(-5), "cartao_credito", "u-carla"),
  ];

  const task = (
    id: string,
    title: string,
    clientId: string | null,
    dealId: string | null,
    assigneeId: string,
    due: number,
    done = false,
  ): Task => ({
    id,
    title,
    clientId,
    dealId,
    assigneeId,
    dueDate: day(due),
    status: done ? "concluida" : "aberta",
    completedAt: done ? at(due) : null,
    createdAt: at(due - 3),
  });
  const tasks: Task[] = [
    task("t-1", "Retornar para João Pereira sobre a proposta nº 2", "c-joao", "d-joao-cardapio", "u-bruno", -1),
    task("t-2", "Enviar referências de logo para Pedro", "c-pedro", "d-pedro", "u-bruno", 0),
    task("t-3", "Confirmar as parcelas da venda da Sofia Martins", "c-sofia", "d-sofia", "u-carla", 0),
    task("t-4", "Enviar exemplos de sites para Luciana", "c-luciana", "d-luciana-site", "u-diego", 2),
    task("t-5", "Cobrar a 1ª parcela da Marina", "c-marina", "d-marina", "u-carla", -1),
    task("t-6", "Primeira conversa com Rafael", "c-rafael", "d-rafael", "u-ana", 1),
    task("t-7", "Entregar fotos de produtos", "c-joao", "d-joao-fotos", "u-bruno", -22, true),
  ];

  const notes = [
    {
      id: "n-1",
      clientId: "c-marina",
      dealId: "d-marina",
      body: "Marina pediu para pagar a 1ª parcela em duas vezes: R$ 200 agora e o restante na semana que vem.",
      authorId: "u-bruno",
      createdAt: at(-3),
    },
    {
      id: "n-2",
      clientId: "c-luciana",
      dealId: "d-luciana-site",
      body: "Prefere reuniões por vídeo às terças. Quer ver exemplos de escritórios de advocacia.",
      authorId: "u-diego",
      createdAt: at(-12),
    },
    {
      id: "n-3",
      clientId: "c-joao",
      dealId: "d-joao-cardapio",
      body: "Pediu desconto de R$ 200 para fechar ainda este mês.",
      authorId: "u-bruno",
      createdAt: at(-4),
    },
  ];

  const activities = [
    {
      id: "h-1",
      clientId: "c-marina",
      dealId: "d-marina",
      kind: "venda",
      description: "Venda fechada: R$ 1.500,00 em 3 parcelas.",
      actorId: "u-bruno",
      createdAt: at(-35),
    },
    {
      id: "h-2",
      clientId: "c-marina",
      dealId: "d-marina",
      kind: "venda",
      description: "Financeiro confirmou as parcelas e criou 3 contas a receber.",
      actorId: "u-carla",
      createdAt: at(-34),
    },
    {
      id: "h-3",
      clientId: "c-joao",
      dealId: "d-joao-cardapio",
      kind: "proposta",
      description: "Envio da proposta nº 2 registrado",
      actorId: "u-bruno",
      createdAt: at(-4),
    },
    {
      id: "h-4",
      clientId: "c-sofia",
      dealId: "d-sofia",
      kind: "venda",
      description: "Venda fechada: R$ 3.600,00 em 2 parcelas. Aguardando o financeiro confirmar as parcelas.",
      actorId: "u-bruno",
      createdAt: at(-1),
    },
    {
      id: "h-5",
      clientId: "c-joao",
      dealId: "d-joao-fotos",
      kind: "financeiro",
      description: "Recebimento de R$ 800,00 registrado (parcela 1 de 1)",
      actorId: "u-carla",
      createdAt: at(-20),
    },
    {
      id: "h-6",
      clientId: "c-luciana",
      dealId: "d-luciana-cartoes",
      kind: "etapa",
      description: "Negociação marcada como perdida. Motivo: Escolheu outro fornecedor pelo preço",
      actorId: "u-diego",
      createdAt: at(-25),
    },
  ];

  const aurora: CompanyData = {
    company: {
      ...EMPTY_PROFILE,
      id: PREVIEW_COMPANY_IDS.aurora,
      name: "Aurora Estúdio",
      legalName: "Aurora Estúdio de Design Ltda.",
      // CNPJ fictício, com dígitos verificadores válidos
      document: "12345678000195",
      phone: "(11) 4002-8922",
      email: "contato@aurora.exemplo",
      address: "Rua das Flores, 123 — Vila Madalena, São Paulo/SP",
      defaultTerms: "Pagamento: 50% na aprovação e 50% na entrega.\nPrazo de entrega: 15 dias úteis.",
    },
    members: auroraMembers,
    clients,
    items: [],
    resources: [],
    services: [],
    appointments: [],
    clinicalNotes: [],
    packages: [],
    subscriptions: [],
    deals,
    tasks,
    notes,
    proposals,
    sales,
    accounts,
    movements,
    activities,
  };

  // ---------- Horizonte Serviços (empresa nova, para testar o primeiro uso) ----------
  const horizonte: CompanyData = {
    company: { ...EMPTY_PROFILE, id: PREVIEW_COMPANY_IDS.horizonte, name: "Horizonte Serviços" },
    members: [
      { userId: "u-ana", name: "Ana Souza", email: "ana@horizonte.exemplo", roles: ["admin"] },
      { userId: "u-eduardo", name: "Eduardo Pires", email: "eduardo@horizonte.exemplo", roles: ["vendedor"] },
      { userId: "u-fernanda", name: "Fernanda Alves", email: "fernanda@horizonte.exemplo", roles: ["financeiro"] },
    ],
    clients: [],
    items: [],
    resources: [],
    services: [],
    appointments: [],
    clinicalNotes: [],
    packages: [],
    subscriptions: [],
    deals: [],
    tasks: [],
    notes: [],
    proposals: [],
    sales: [],
    accounts: [],
    movements: [],
    activities: [],
  };

  // função (e não um objeto só) para que as empresas não compartilhem as mesmas listas
  const empty = () => ({
    deals: [],
    tasks: [],
    notes: [],
    proposals: [],
    sales: [],
    accounts: [],
    movements: [],
    activities: [],
  });

  // ---------- Clínica Bem Viver (ramo: consultório ou clínica) ----------
  // mensalidade que começou há uns 70 dias: uma cobrança paga, uma atrasada e a deste mês
  const beatrizPlan: Subscription = {
    id: "sub-beatriz",
    clientId: "p-beatriz",
    name: "Psicoterapia mensal (4 sessões)",
    amountCents: 80000,
    dayOfMonth: Math.min(Number(day(-2).slice(8, 10)), 28),
    startsOn: day(-70),
    endsOn: null,
    canceledAt: null,
    createdAt: at(-70),
  };
  const clinica: CompanyData = {
    company: {
      ...EMPTY_PROFILE,
      id: PREVIEW_COMPANY_IDS.clinica,
      name: "Clínica Bem Viver",
      segment: "clinica",
      phone: "(11) 4002-1010",
    },
    members: [
      { userId: "u-ana", name: "Ana Souza", email: "ana@bemviver.exemplo", roles: ["admin"] },
      { userId: "u-helena", name: "Helena Prado", email: "helena@bemviver.exemplo", roles: ["profissional"] },
      { userId: "u-igor", name: "Igor Batista", email: "igor@bemviver.exemplo", roles: ["profissional"] },
      { userId: "u-julia", name: "Júlia Campos", email: "julia@bemviver.exemplo", roles: ["recepcao"] },
    ],
    clients: [
      client("p-beatriz", "Beatriz Nunes", "beatriz@correio.exemplo", "(11) 90000-2001", "u-helena", -90, {
        nascimento: "1991-03-14",
        convenio: "Particular",
      }),
      client("p-caio", "Caio Ferraz", "", "(11) 90000-2002", "u-helena", -30, {
        nascimento: "2014-08-02",
        responsavel: "Renata Ferraz (mãe)",
      }),
      client("p-denise", "Denise Araújo", "denise@correio.exemplo", "(11) 90000-2003", "u-igor", -12, {
        nascimento: "1978-11-25",
        convenio: "Saúde Mais",
      }),
    ],
    items: [],
    ...empty(),
    resources: [
      { id: "r-helena", name: "Helena Prado", userId: "u-helena", active: true },
      { id: "r-igor", name: "Igor Batista", userId: "u-igor", active: true },
    ],
    services: [
      { id: "s-psico", name: "Sessão de psicoterapia", durationMin: 50, priceCents: 20000, active: true },
      { id: "s-nutri", name: "Consulta de nutrição", durationMin: 60, priceCents: 25000, active: true },
      { id: "s-retorno", name: "Retorno de nutrição", durationMin: 30, priceCents: 12000, active: true },
    ],
    appointments: [
      appointment({
        id: "ag-1",
        clientId: "p-beatriz",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(0, 9, 0, 50),
        status: "confirmado",
        seriesId: "serie-beatriz",
        remindedAt: at(-1, 17),
      }),
      appointment({
        id: "ag-2",
        clientId: "p-caio",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(0, 10, 0, 50),
      }),
      appointment({
        id: "ag-3",
        clientId: "p-denise",
        resourceId: "r-igor",
        serviceId: "s-nutri",
        priceCents: 25000,
        ...slot(0, 14, 0, 60),
        createdBy: "u-julia",
      }),
      appointment({
        id: "ag-4",
        clientId: "p-beatriz",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(7, 9, 0, 50),
        seriesId: "serie-beatriz",
      }),
      appointment({
        id: "ag-5",
        clientId: "p-denise",
        resourceId: "r-igor",
        serviceId: "s-retorno",
        priceCents: 12000,
        ...slot(1, 16, 0, 30),
        createdBy: "u-julia",
      }),
      appointment({
        id: "ag-6",
        clientId: "p-caio",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(1, 10, 0, 50),
        packageId: "pk-caio",
      }),
      appointment({
        id: "ag-9",
        clientId: "p-caio",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(-15, 10, 0, 50),
        status: "compareceu",
        packageId: "pk-caio",
        consumesPackage: true,
      }),
      appointment({
        id: "ag-10",
        clientId: "p-caio",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(-8, 10, 0, 50),
        status: "compareceu",
        packageId: "pk-caio",
        consumesPackage: true,
      }),
      appointment({
        id: "ag-7",
        clientId: "p-caio",
        resourceId: "r-helena",
        serviceId: "s-psico",
        priceCents: 20000,
        ...slot(-1, 10, 0, 50),
        status: "compareceu",
        accountId: "a-atend-caio",
      }),
      appointment({
        id: "ag-8",
        clientId: "p-denise",
        resourceId: "r-igor",
        serviceId: "s-nutri",
        priceCents: 25000,
        ...slot(-3, 14, 0, 60),
        status: "faltou",
      }),
    ],
    accounts: [
      receivable({
        id: "a-atend-caio",
        clientId: "p-caio",
        description: "Sessão de psicoterapia",
        origin: "atendimento",
        amountCents: 20000,
        dueDate: day(-1),
        createdAt: at(-1, 11),
      }),
      ...buildPlan(180000, 3, day(-16)).map((inst) =>
        receivable({
          id: `a-pk-caio-${inst.number}`,
          clientId: "p-caio",
          description: "Pacote: 10 sessões de psicoterapia",
          origin: "pacote",
          installmentNumber: inst.number,
          installmentCount: 3,
          amountCents: inst.amountCents,
          dueDate: inst.dueDate,
          createdAt: at(-16),
          packageId: "pk-caio",
        }),
      ),
      ...subscriptionPeriods(beatrizPlan, today).map((p) =>
        receivable({
          id: `a-mens-${p.period}`,
          clientId: "p-beatriz",
          description: subscriptionChargeDescription(beatrizPlan.name, p.period),
          origin: "mensalidade",
          amountCents: beatrizPlan.amountCents,
          dueDate: p.dueDate,
          createdAt: at(-60),
          subscriptionId: beatrizPlan.id,
          period: p.period,
        }),
      ),
    ],
    // a primeira parcela do pacote e a primeira mensalidade já foram pagas
    movements: [
      {
        id: "m-pk-caio-1",
        accountId: "a-pk-caio-1",
        direction: "entrada",
        amountCents: 60000,
        paidOn: day(-16),
        method: "pix",
        registeredBy: "u-ana",
        createdAt: at(-16, 12),
        undoneAt: null,
        undoneBy: null,
        undoReason: null,
      },
      ...subscriptionPeriods(beatrizPlan, today)
        .slice(0, 1)
        .map((p) => ({
          id: `m-mens-${p.period}`,
          accountId: `a-mens-${p.period}`,
          direction: "entrada" as const,
          amountCents: beatrizPlan.amountCents,
          paidOn: p.dueDate,
          method: "cartao_credito" as const,
          registeredBy: "u-ana",
          createdAt: at(-50),
          undoneAt: null,
          undoneBy: null,
          undoReason: null,
        })),
    ],
    packages: [
      {
        id: "pk-caio",
        clientId: "p-caio",
        serviceId: "s-psico",
        itemId: null,
        name: "10 sessões de psicoterapia",
        sessionsTotal: 10,
        priceCents: 180000,
        validUntil: day(120),
        closedAt: null,
        createdAt: at(-16),
      },
    ],
    subscriptions: [beatrizPlan],
    clinicalNotes: [
      {
        id: "cn-1",
        clientId: "p-caio",
        appointmentId: "ag-7",
        authorId: "u-helena",
        body: "Exemplo fictício: combinamos exercícios de respiração para a semana. Retomar o assunto da escola no próximo encontro.",
        correctsId: null,
        createdAt: at(-1, 11),
      },
    ],
  };

  // ---------- Amigo Fiel Pet Shop (ramo: pet shop ou veterinária) ----------
  const pet: CompanyData = {
    company: {
      ...EMPTY_PROFILE,
      id: PREVIEW_COMPANY_IDS.pet,
      name: "Amigo Fiel Pet Shop",
      segment: "pet",
      phone: "(11) 4002-2020",
    },
    members: [
      { userId: "u-ana", name: "Ana Souza", email: "ana@amigofiel.exemplo", roles: ["admin"] },
      { userId: "u-karina", name: "Karina Lopes", email: "karina@amigofiel.exemplo", roles: ["recepcao"] },
      { userId: "u-leandro", name: "Leandro Dias", email: "leandro@amigofiel.exemplo", roles: ["profissional"] },
      { userId: "u-marcos", name: "Marcos Teles", email: "marcos@amigofiel.exemplo", roles: ["caixa"] },
    ],
    clients: [
      client("t-paula", "Paula Vieira", "paula@correio.exemplo", "(11) 90000-3001", "u-karina", -70, {
        endereco: "Rua das Acácias, 45, apto 12",
      }),
      client("t-rogerio", "Rogério Sato", "", "(11) 90000-3002", "u-karina", -20),
      client("t-simone", "Simone Barros", "simone@correio.exemplo", "(11) 90000-3003", "u-leandro", -5),
    ],
    items: [
      {
        id: "i-thor",
        clientId: "t-paula",
        kind: "pet",
        name: "Thor",
        details: { especie: "Cão", raca: "Golden retriever", porte: "Grande", peso: "32", nascimento: "2021-05-10" },
        alert: "",
        active: true,
        createdAt: at(-70),
      },
      {
        id: "i-mia",
        clientId: "t-paula",
        kind: "pet",
        name: "Mia",
        details: { especie: "Gato", raca: "Siamês", porte: "Pequeno", peso: "4" },
        alert: "Assustada: não deixar perto de cães.",
        active: true,
        createdAt: at(-40),
      },
      {
        id: "i-bob",
        clientId: "t-rogerio",
        kind: "pet",
        name: "Bob",
        details: { especie: "Cão", raca: "Shih-tzu", porte: "Pequeno", peso: "6", nascimento: "2012-01-20" },
        alert: "Idoso e alérgico a perfume.",
        active: true,
        createdAt: at(-20),
      },
    ],
    ...empty(),
    resources: [
      { id: "r-leandro", name: "Leandro Dias", userId: "u-leandro", active: true },
      // agenda sem login: quem usa a mesa é a tosadora, que não acessa o sistema
      { id: "r-mesa2", name: "Mesa de tosa 2", userId: null, active: true },
    ],
    services: [
      { id: "s-banho-p", name: "Banho (porte pequeno)", durationMin: 60, priceCents: 6000, active: true },
      { id: "s-banho-g", name: "Banho (porte grande)", durationMin: 90, priceCents: 9000, active: true },
      { id: "s-tosa", name: "Banho e tosa", durationMin: 120, priceCents: 12000, active: true },
    ],
    appointments: [
      appointment({
        id: "ag-thor",
        clientId: "t-paula",
        resourceId: "r-leandro",
        serviceId: "s-banho-g",
        itemId: "i-thor",
        priceCents: 9000,
        ...slot(0, 10, 0, 90),
        createdBy: "u-karina",
      }),
      appointment({
        id: "ag-mia",
        clientId: "t-paula",
        resourceId: "r-mesa2",
        serviceId: "s-banho-p",
        itemId: "i-mia",
        priceCents: 6000,
        ...slot(0, 11, 30, 60),
        createdBy: "u-karina",
        notes: "Buscar em casa às 11h.",
      }),
      appointment({
        id: "ag-bob",
        clientId: "t-rogerio",
        resourceId: "r-leandro",
        serviceId: "s-tosa",
        itemId: "i-bob",
        priceCents: 12000,
        ...slot(1, 9, 0, 120),
        createdBy: "u-karina",
        packageId: "pk-bob",
      }),
    ],
    clinicalNotes: [],
    packages: [
      {
        id: "pk-bob",
        clientId: "t-rogerio",
        serviceId: "s-tosa",
        itemId: "i-bob",
        name: "4 banhos e tosa",
        sessionsTotal: 4,
        priceCents: 40000,
        validUntil: day(60),
        closedAt: null,
        createdAt: at(-5),
      },
    ],
    accounts: [
      receivable({
        id: "a-pk-bob",
        clientId: "t-rogerio",
        description: "Pacote: 4 banhos e tosa",
        origin: "pacote",
        amountCents: 40000,
        dueDate: day(-5),
        createdAt: at(-5),
        packageId: "pk-bob",
      }),
    ],
    subscriptions: [],
  };

  return [aurora, horizonte, clinica, pet];
}
