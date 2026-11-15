import { can } from "@/lib/domain/permissions";
import { moduleEnabled } from "@/lib/domain/segments";
import type { CompanyData, Member } from "@/lib/domain/types";

/**
 * Recorta os dados da empresa conforme os papéis de quem está vendo.
 * Espelha as políticas RLS de supabase/migrations (na versão real o banco já
 * entrega os dados filtrados; aplicar de novo aqui é inofensivo).
 */
export function visibleData(data: CompanyData, viewer: Member): CompanyData {
  const roles = viewer.roles;
  const me = viewer.userId;
  const allCrm = can(roles, "crm.ver_todos");
  const allClients = can(roles, "clientes.ver_todos");
  const allFin = can(roles, "financeiro.ver");
  const on = (m: Parameters<typeof moduleEnabled>[1]) => moduleEnabled(data.company, m);

  // Agenda: quem marca para todos vê tudo; o profissional, só as agendas ligadas a ele.
  const resources = on("agenda") || on("ordem_servico") ? data.resources : [];
  const myResources = new Set(resources.filter((r) => r.userId === me).map((r) => r.id));
  const appointments = !on("agenda")
    ? []
    : can(roles, "agenda.todas")
      ? data.appointments
      : can(roles, "agenda.propria")
        ? data.appointments.filter((a) => myResources.has(a.resourceId))
        : [];

  const blocks = !on("agenda")
    ? []
    : can(roles, "agenda.todas")
      ? data.blocks
      : can(roles, "agenda.propria")
        ? data.blocks.filter((b) => myResources.has(b.resourceId))
        : [];

  // Turmas: o instrutor vê as próprias turmas e os alunos delas.
  const classes = on("turmas") ? data.classes : [];
  const myClasses = new Set(classes.filter((c) => c.resourceId && myResources.has(c.resourceId)).map((c) => c.id));
  const myStudents = new Set(
    on("turmas") ? data.enrollments.filter((e) => !e.endedOn && myClasses.has(e.classId)).map((e) => e.clientId) : [],
  );

  // Oficina: atendimento e financeiro veem todas as OS; o mecânico, só as dele.
  const workOrders = !on("ordem_servico")
    ? []
    : can(roles, "os.ver_todas")
      ? data.workOrders
      : data.workOrders.filter((w) => w.resourceId !== null && myResources.has(w.resourceId));
  const woIds = new Set(workOrders.map((w) => w.id));

  const deals = allCrm ? data.deals : data.deals.filter((d) => d.ownerId === me);
  const dealIds = new Set(deals.map((d) => d.id));
  const clients = allClients
    ? data.clients
    : data.clients.filter(
        (c) =>
          c.ownerId === me ||
          deals.some((d) => d.clientId === c.id) ||
          // quem atende um paciente de um colega precisa ver o nome dele na própria agenda
          appointments.some((a) => a.clientId === c.id) ||
          myStudents.has(c.id) ||
          workOrders.some((w) => w.clientId === c.id),
      );
  const clientIds = new Set(clients.map((c) => c.id));

  const sales = allFin || allCrm ? data.sales : data.sales.filter((s) => dealIds.has(s.dealId));
  const saleIds = new Set(sales.map((s) => s.id));
  // recepção e caixa recebem no balcão o que o cliente deve (só nos ramos com caixa)
  const collects = on("caixa") && (roles.includes("recepcao") || roles.includes("caixa") || roles.includes("vendedor"));
  const accounts = data.accounts.filter((a) => {
    if (allFin) return true;
    if (a.kind === "pagar") return false;
    if (collects && ["atendimento", "pacote", "mensalidade", "caixa", "crediario"].includes(a.origin)) return true;
    return can(roles, "recebiveis.ver_proprios") && a.saleId !== null && saleIds.has(a.saleId);
  });
  const accountIds = new Set(accounts.map((a) => a.id));

  return {
    company: data.company,
    members: data.members,
    clients,
    items: on("itens") ? data.items.filter((i) => clientIds.has(i.clientId)) : [],
    resources,
    services: on("servicos") ? data.services : [],
    appointments,
    // prontuário: só quem escreveu lê, nem o administrador
    clinicalNotes: on("prontuario") ? data.clinicalNotes.filter((n) => n.authorId === me) : [],
    packages: on("pacotes") ? data.packages.filter((p) => clientIds.has(p.clientId)) : [],
    subscriptions: on("mensalidades") ? data.subscriptions.filter((s) => clientIds.has(s.clientId)) : [],
    blocks,
    products: on("caixa") ? data.products : [],
    cashSessions: on("caixa") && can(roles, "caixa.operar") ? data.cashSessions : [],
    cashSaleItems: data.cashSaleItems.filter((i) => accountIds.has(i.accountId)),
    commissionRules: !on("comissoes")
      ? []
      : can(roles, "comissoes.ver_todas")
        ? data.commissionRules
        : data.commissionRules.filter((r) => r.resourceId === null || myResources.has(r.resourceId)),
    commissionClosings: !on("comissoes")
      ? []
      : can(roles, "comissoes.ver_todas")
        ? data.commissionClosings
        : data.commissionClosings.filter((c) => myResources.has(c.resourceId)),
    classes,
    enrollments: on("turmas")
      ? data.enrollments.filter((e) => clientIds.has(e.clientId) || myClasses.has(e.classId))
      : [],
    attendance: on("turmas")
      ? data.attendance.filter((a) => clientIds.has(a.clientId) || myClasses.has(a.classId))
      : [],
    stockMovements: on("estoque") ? data.stockMovements : [],
    counterSales: can(roles, "caixa.operar") || allFin ? data.counterSales : [],
    workOrders,
    workOrderItems: data.workOrderItems.filter((i) => woIds.has(i.workOrderId)),
    workOrderEvents: data.workOrderEvents.filter((e) => woIds.has(e.workOrderId)),
    workOrderPhotos: data.workOrderPhotos.filter((p) => woIds.has(p.workOrderId)),
    deals,
    tasks: allCrm
      ? data.tasks
      : data.tasks.filter((t) => t.assigneeId === me || (t.clientId && clientIds.has(t.clientId))),
    notes: data.notes.filter((n) => clientIds.has(n.clientId)),
    proposals: data.proposals.filter((p) => dealIds.has(p.dealId)),
    sales,
    accounts,
    movements: data.movements.filter((m) => accountIds.has(m.accountId)),
    activities: data.activities.filter((a) =>
      a.clientId ? clientIds.has(a.clientId) : allFin || allCrm || a.actorId === me,
    ),
  };
}
