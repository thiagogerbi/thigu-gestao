import type {
  Account,
  Activity,
  Attendance,
  CashSaleItem,
  CashSession,
  ClassGroup,
  CommissionClosing,
  CommissionRule,
  Enrollment,
  Product,
  ResourceBlock,
  StockMovement,
  CounterSale,
  Order,
  OrderEvent,
  OrderItem,
  Prescription,
  WorkOrder,
  WorkOrderEvent,
  WorkOrderItem,
  WorkOrderPhoto,
  Appointment,
  ClinicalNote,
  Client,
  ClientItem,
  CompanyData,
  CompanyInvite,
  Deal,
  Member,
  Movement,
  MyInvite,
  Note,
  Package,
  Proposal,
  Resource,
  Role,
  Sale,
  Service,
  Subscription,
  Task,
} from "@/lib/domain/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import "server-only";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export interface MembershipRow {
  companyId: string;
  companyName: string;
  roles: Role[];
}

export async function loadMemberships(sb: ServerSupabase, userId: string): Promise<MembershipRow[]> {
  const { data, error } = await sb
    .from("memberships")
    .select("company_id, roles, active, companies(name)")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []).map((m: Row) => ({
    companyId: m.company_id,
    companyName: m.companies?.name ?? "Empresa",
    roles: m.roles as Role[],
  }));
}

/** Convites que a pessoa logada recebeu e ainda não respondeu (função my_invites, pelo e-mail confirmado). */
export async function loadMyInvites(sb: ServerSupabase): Promise<MyInvite[]> {
  const { data, error } = await sb.rpc("my_invites");
  if (error) {
    // o aviso de convite não pode derrubar a tela inteira
    console.error("[thigu] não foi possível carregar os convites", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((i) => ({
    id: i.id,
    companyId: i.company_id,
    companyName: i.company_name,
    roles: i.roles as Role[],
    invitedByName: i.invited_by_name,
  }));
}

/** Convites em aberto da empresa. A RLS só devolve linhas para o administrador. */
export async function loadCompanyInvites(sb: ServerSupabase, companyId: string): Promise<CompanyInvite[]> {
  const { data, error } = await sb
    .from("invites")
    .select("id, email, roles, created_at")
    .eq("company_id", companyId)
    .eq("status", "pendente")
    .order("created_at");
  if (error) {
    console.error("[thigu] não foi possível carregar os convites da empresa", error);
    return [];
  }
  return ((data ?? []) as Row[]).map((i) => ({
    id: i.id,
    email: i.email,
    roles: i.roles as Role[],
    createdAt: i.created_at,
  }));
}

/** Carrega o que o usuário pode ver da empresa. O filtro de permissão é feito pelo banco (RLS). */
export async function loadCompanyData(sb: ServerSupabase, companyId: string): Promise<CompanyData> {
  const q = (t: string, cols = "*") => sb.from(t).select(cols).eq("company_id", companyId);
  // cobranças das mensalidades que venceram desde a última visita (não depende de tarefa agendada)
  const generated = await sb.rpc("generate_subscription_charges", { cid: companyId });
  // empresa com acesso vencido não gera cobranças novas (o banco recusa): não é erro
  if (generated.error && !/acesso desta empresa venceu/.test(generated.error.message ?? ""))
    console.error("[thigu] não foi possível gerar as cobranças das mensalidades", generated.error);
  // atendimentos dos últimos 120 dias em diante (o histórico mais antigo fica no banco)
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
  const [
    company,
    members,
    clients,
    items,
    resources,
    services,
    appointments,
    clinicalNotes,
    packages,
    subscriptions,
    blocks,
    products,
    cashSessions,
    cashSaleItems,
    commissionRules,
    commissionClosings,
    classes,
    enrollments,
    attendance,
    workOrders,
    workOrderItems,
    workOrderEvents,
    workOrderPhotos,
    stockMovements,
    counterSales,
    orders,
    orderItems,
    orderEvents,
    prescriptions,
    deals,
    tasks,
    notes,
    proposals,
    sales,
    accounts,
    movements,
    activities,
  ] = await Promise.all([
    sb
      .from("companies")
      .select(
        "id, name, legal_name, document, phone, email, address, default_terms, logo_data_url, brand_color, menu_color, segment, plan, extra_modules, booking_slug, booking_enabled, booking_auto_confirm, access_until",
      )
      .eq("id", companyId)
      .single(),
    q("memberships", "user_id, roles, active, profiles(full_name, email)").eq("active", true),
    q("clients").order("name"),
    // o banco só devolve itens quando o módulo está ligado para a empresa
    q("client_items").order("created_at"),
    // agenda, serviços e ficha de atendimento: o banco filtra por módulo, papel e autoria
    q("resources").order("name"),
    q("services").order("name"),
    q("appointments").gte("starts_at", since).order("starts_at"),
    q("clinical_notes").order("created_at", { ascending: false }).limit(1000),
    q("packages").order("created_at", { ascending: false }),
    q("subscriptions").order("created_at", { ascending: false }),
    // bloqueios, caixa, comissões e turmas: o banco filtra por módulo e papel
    q("resource_blocks").gte("ends_at", since).order("starts_at"),
    q("products").order("name"),
    q("cash_sessions").order("opened_at", { ascending: false }).limit(60),
    q("cash_sale_items"),
    q("commission_rules"),
    q("commission_closings").order("month", { ascending: false }),
    q("classes").order("name"),
    q("enrollments"),
    q("attendance").gte("class_date", since.slice(0, 10)),
    // oficina: as 500 OS mais recentes (o banco devolve só as que a pessoa pode ver)
    q("work_orders").order("number", { ascending: false }).limit(500),
    q("work_order_items").order("created_at").limit(5000),
    q("work_order_events").order("created_at").limit(5000),
    q("work_order_photos").order("created_at").limit(2000),
    // estoque e vendas do balcão dos últimos 120 dias (o saldo de cada produto já vem pronto)
    q("stock_movements").gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
    q("counter_sales").gte("created_at", since).order("created_at", { ascending: false }).limit(3000),
    // pedidos: os 500 mais recentes; receitas: o banco só devolve para quem atende
    q("orders").order("number", { ascending: false }).limit(500),
    q("order_items").limit(5000),
    q("order_events").order("created_at").limit(5000),
    q("prescriptions").order("examined_on", { ascending: false }).limit(3000),
    q("deals"),
    q("tasks"),
    q("notes").order("created_at", { ascending: false }).limit(1000),
    q("proposals", "*, proposal_items(*)"),
    q("sales"),
    q("accounts"),
    q("movements"),
    q("activities").order("created_at", { ascending: false }).limit(1000),
  ]);
  for (const r of [
    company,
    members,
    clients,
    items,
    resources,
    services,
    appointments,
    clinicalNotes,
    packages,
    subscriptions,
    blocks,
    products,
    cashSessions,
    cashSaleItems,
    commissionRules,
    commissionClosings,
    classes,
    enrollments,
    attendance,
    workOrders,
    workOrderItems,
    workOrderEvents,
    workOrderPhotos,
    stockMovements,
    counterSales,
    orders,
    orderItems,
    orderEvents,
    prescriptions,
    deals,
    tasks,
    notes,
    proposals,
    sales,
    accounts,
    movements,
    activities,
  ]) {
    if (r.error) throw r.error;
  }
  const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];
  const co = company.data as Row;
  // fotos ficam num bucket privado: links temporários de 1 hora
  const photoRows = rows(workOrderPhotos);
  const signed = new Map<string, string>();
  if (photoRows.length) {
    const { data: urls, error } = await sb.storage.from("os-fotos").createSignedUrls(
      photoRows.map((p) => p.path),
      3600,
    );
    if (error) console.error("[thigu] não foi possível gerar os links das fotos", error);
    for (const u of urls ?? []) if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl);
  }

  return {
    company: {
      id: co.id,
      name: co.name,
      legalName: co.legal_name ?? "",
      document: co.document ?? "",
      phone: co.phone ?? "",
      email: co.email ?? "",
      address: co.address ?? "",
      defaultTerms: co.default_terms ?? "",
      logoDataUrl: co.logo_data_url ?? null,
      brandColor: co.brand_color ?? null,
      menuColor: co.menu_color ?? null,
      bookingSlug: co.booking_slug ?? null,
      bookingEnabled: Boolean(co.booking_enabled),
      bookingAutoConfirm: Boolean(co.booking_auto_confirm),
      segment: co.segment ?? "geral",
      plan: co.plan ?? "empresa",
      extraModules: co.extra_modules ?? [],
      accessUntil: co.access_until ?? null,
    },
    members: rows(members).map((m): Member => ({
      userId: m.user_id,
      name: m.profiles?.full_name ?? "Usuário",
      email: m.profiles?.email ?? "",
      roles: m.roles,
    })),
    clients: rows(clients).map((c): Client => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      ownerId: c.owner_id,
      extra: c.extra ?? {},
      createdAt: c.created_at,
      creditLimitCents:
        c.credit_limit_cents === null || c.credit_limit_cents === undefined ? null : Number(c.credit_limit_cents),
    })),
    items: rows(items).map((i): ClientItem => ({
      id: i.id,
      clientId: i.client_id,
      kind: i.kind,
      name: i.name,
      details: i.details ?? {},
      alert: i.alert ?? "",
      plate: i.plate ?? null,
      active: i.active,
      createdAt: i.created_at,
    })),
    resources: rows(resources).map((r): Resource => ({
      id: r.id,
      name: r.name,
      userId: r.user_id,
      workHours: r.work_hours ?? {},
      active: r.active,
    })),
    services: rows(services).map((s): Service => ({
      id: s.id,
      name: s.name,
      durationMin: s.duration_min,
      priceCents: Number(s.price_cents),
      active: s.active,
    })),
    appointments: rows(appointments).map((a): Appointment => ({
      id: a.id,
      clientId: a.client_id,
      resourceId: a.resource_id,
      serviceId: a.service_id,
      itemId: a.item_id,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      status: a.status,
      priceCents: Number(a.price_cents),
      notes: a.notes ?? "",
      seriesId: a.series_id,
      accountId: a.account_id,
      remindedAt: a.reminded_at,
      packageId: a.package_id ?? null,
      consumesPackage: Boolean(a.consumes_package),
      source: a.source ?? "equipe",
      createdBy: a.created_by,
      createdAt: a.created_at,
    })),
    clinicalNotes: rows(clinicalNotes).map((n): ClinicalNote => ({
      id: n.id,
      clientId: n.client_id,
      appointmentId: n.appointment_id,
      authorId: n.author_id,
      body: n.body,
      correctsId: n.corrects_id,
      createdAt: n.created_at,
    })),
    packages: rows(packages).map((p): Package => ({
      id: p.id,
      clientId: p.client_id,
      serviceId: p.service_id,
      itemId: p.item_id,
      name: p.name,
      sessionsTotal: p.sessions_total,
      priceCents: Number(p.price_cents),
      validUntil: p.valid_until,
      closedAt: p.closed_at,
      createdAt: p.created_at,
    })),
    blocks: rows(blocks).map((b): ResourceBlock => ({
      id: b.id,
      resourceId: b.resource_id,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      reason: b.reason ?? "",
      createdBy: b.created_by,
    })),
    products: rows(products).map((p): Product => ({
      id: p.id,
      name: p.name,
      priceCents: Number(p.price_cents),
      active: p.active,
      sku: p.sku ?? "",
      barcode: p.barcode ?? null,
      costCents: Number(p.cost_cents ?? 0),
      trackStock: Boolean(p.track_stock),
      stockQty: Number(p.stock_qty ?? 0),
      minStock: Number(p.min_stock ?? 0),
      size: p.size ?? "",
      color: p.color ?? "",
      fits: p.fits ?? "",
    })),
    stockMovements: rows(stockMovements).map((m): StockMovement => ({
      id: m.id,
      productId: m.product_id,
      kind: m.kind,
      quantity: m.quantity,
      unitCostCents: m.unit_cost_cents === null ? null : Number(m.unit_cost_cents),
      saleId: m.sale_id,
      orderId: m.order_id ?? null,
      reason: m.reason ?? "",
      createdBy: m.created_by,
      createdAt: m.created_at,
    })),
    orders: rows(orders).map((o): Order => ({
      id: o.id,
      number: o.number,
      clientId: o.client_id,
      resourceId: o.resource_id,
      prescriptionId: o.prescription_id,
      title: o.title,
      details: o.details ?? "",
      stage: o.stage,
      promisedOn: o.promised_on,
      totalCents: Number(o.total_cents),
      downCents: Number(o.down_cents),
      readyAt: o.ready_at,
      deliveredAt: o.delivered_at,
      canceledAt: o.canceled_at,
      cancelReason: o.cancel_reason,
      createdBy: o.created_by,
      createdAt: o.created_at,
    })),
    orderItems: rows(orderItems).map((i): OrderItem => ({
      id: i.id,
      orderId: i.order_id,
      productId: i.product_id,
      description: i.description,
      quantity: i.quantity,
      unitCents: Number(i.unit_cents),
    })),
    orderEvents: rows(orderEvents).map((e): OrderEvent => ({
      id: e.id,
      orderId: e.order_id,
      description: e.description,
      actorId: e.actor_id,
      createdAt: e.created_at,
    })),
    prescriptions: rows(prescriptions).map((p): Prescription => {
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return {
        id: p.id,
        clientId: p.client_id,
        examinedOn: p.examined_on,
        validUntil: p.valid_until,
        doctor: p.doctor ?? "",
        od: { sph: n(p.od_sph), cyl: n(p.od_cyl), axis: n(p.od_axis), add: n(p.od_add) },
        oe: { sph: n(p.oe_sph), cyl: n(p.oe_cyl), axis: n(p.oe_axis), add: n(p.oe_add) },
        dnpOd: n(p.dnp_od),
        dnpOe: n(p.dnp_oe),
        notes: p.notes ?? "",
        createdBy: p.created_by,
        createdAt: p.created_at,
      };
    }),
    counterSales: rows(counterSales).map((v): CounterSale => ({
      id: v.id,
      sessionId: v.session_id,
      clientId: v.client_id,
      subtotalCents: Number(v.subtotal_cents),
      discountCents: Number(v.discount_cents),
      totalCents: Number(v.total_cents),
      payment: v.payment,
      method: v.method,
      createdBy: v.created_by,
      createdAt: v.created_at,
    })),
    cashSessions: rows(cashSessions).map((c): CashSession => ({
      id: c.id,
      openedBy: c.opened_by,
      openedAt: c.opened_at,
      openingCents: Number(c.opening_cents),
      closedBy: c.closed_by,
      closedAt: c.closed_at,
      expectedCents: c.expected_cents === null ? null : Number(c.expected_cents),
      countedCents: c.counted_cents === null ? null : Number(c.counted_cents),
      notes: c.notes ?? "",
    })),
    cashSaleItems: rows(cashSaleItems).map((i): CashSaleItem => ({
      id: i.id,
      accountId: i.account_id,
      productId: i.product_id,
      serviceId: i.service_id,
      description: i.description,
      quantity: i.quantity,
      unitCents: Number(i.unit_cents),
      saleId: i.sale_id ?? null,
      returnedQty: i.returned_qty ?? 0,
    })),
    commissionRules: rows(commissionRules).map((r): CommissionRule => ({
      id: r.id,
      resourceId: r.resource_id,
      serviceId: r.service_id,
      percentBp: r.percent_bp,
      fixedCents: r.fixed_cents === null ? null : Number(r.fixed_cents),
    })),
    commissionClosings: rows(commissionClosings).map((c): CommissionClosing => ({
      id: c.id,
      resourceId: c.resource_id,
      month: c.month,
      appointments: c.appointments,
      baseCents: Number(c.base_cents),
      amountCents: Number(c.amount_cents),
      accountId: c.account_id,
      closedAt: c.closed_at,
    })),
    classes: rows(classes).map((c): ClassGroup => ({
      id: c.id,
      name: c.name,
      resourceId: c.resource_id,
      weekdays: c.weekdays ?? [],
      startTime: c.start_time,
      durationMin: c.duration_min,
      capacity: c.capacity,
      active: c.active,
    })),
    enrollments: rows(enrollments).map((e): Enrollment => ({
      id: e.id,
      classId: e.class_id,
      clientId: e.client_id,
      startedOn: e.started_on,
      endedOn: e.ended_on,
    })),
    attendance: rows(attendance).map((a): Attendance => ({
      id: a.id,
      classId: a.class_id,
      clientId: a.client_id,
      classDate: a.class_date,
      status: a.status,
    })),
    workOrders: rows(workOrders).map((w): WorkOrder => ({
      id: w.id,
      number: w.number,
      clientId: w.client_id,
      itemId: w.item_id,
      resourceId: w.resource_id,
      stage: w.stage,
      complaint: w.complaint ?? "",
      diagnosis: w.diagnosis ?? "",
      km: w.km,
      fuel: w.fuel,
      checklist: w.checklist ?? [],
      promisedOn: w.promised_on,
      discountCents: Number(w.discount_cents),
      shareToken: w.share_token,
      sentAt: w.sent_at,
      approvedAt: w.approved_at,
      approvedByName: w.approved_by_name,
      approvalChannel: w.approval_channel,
      deliveredAt: w.delivered_at,
      totalCents: w.total_cents === null ? null : Number(w.total_cents),
      canceledAt: w.canceled_at,
      cancelReason: w.cancel_reason,
      nextServiceOn: w.next_service_on,
      nextServiceNote: w.next_service_note ?? "",
      createdBy: w.created_by,
      createdAt: w.created_at,
    })),
    workOrderItems: rows(workOrderItems).map((i): WorkOrderItem => ({
      id: i.id,
      workOrderId: i.work_order_id,
      kind: i.kind,
      serviceId: i.service_id,
      description: i.description,
      quantity: i.quantity,
      unitCents: Number(i.unit_cents),
      warrantyDays: i.warranty_days,
      status: i.status,
      addedBy: i.added_by,
      createdAt: i.created_at,
    })),
    workOrderEvents: rows(workOrderEvents).map((e): WorkOrderEvent => ({
      id: e.id,
      workOrderId: e.work_order_id,
      description: e.description,
      actorId: e.actor_id,
      createdAt: e.created_at,
    })),
    workOrderPhotos: photoRows
      .filter((p) => signed.has(p.path))
      .map((p): WorkOrderPhoto => ({
        id: p.id,
        workOrderId: p.work_order_id,
        url: signed.get(p.path)!,
        caption: p.caption ?? "",
        createdBy: p.created_by,
        createdAt: p.created_at,
      })),
    subscriptions: rows(subscriptions).map((s): Subscription => ({
      id: s.id,
      clientId: s.client_id,
      name: s.name,
      amountCents: Number(s.amount_cents),
      dayOfMonth: s.day_of_month,
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      canceledAt: s.canceled_at,
      createdAt: s.created_at,
    })),
    deals: rows(deals).map((d): Deal => ({
      id: d.id,
      clientId: d.client_id,
      title: d.title,
      valueCents: Number(d.value_cents),
      ownerId: d.owner_id,
      stage: d.stage,
      expectedClose: d.expected_close,
      stageChangedAt: d.stage_changed_at,
      nextAction: d.next_action,
      nextActionDate: d.next_action_date,
      lostReason: d.lost_reason,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    })),
    tasks: rows(tasks).map((t): Task => ({
      id: t.id,
      title: t.title,
      clientId: t.client_id,
      dealId: t.deal_id,
      assigneeId: t.assignee_id,
      dueDate: t.due_date,
      status: t.status,
      completedAt: t.completed_at,
      createdAt: t.created_at,
    })),
    notes: rows(notes).map((n): Note => ({
      id: n.id,
      clientId: n.client_id,
      dealId: n.deal_id,
      body: n.body,
      authorId: n.author_id,
      createdAt: n.created_at,
    })),
    proposals: rows(proposals).map((p): Proposal => ({
      id: p.id,
      number: p.number,
      clientId: p.client_id,
      dealId: p.deal_id,
      items: ((p.proposal_items ?? []) as Row[])
        .sort((a, b) => a.position - b.position)
        .map((i) => ({ description: i.description, quantity: Number(i.quantity), unitCents: Number(i.unit_cents) })),
      discountCents: Number(p.discount_cents),
      validUntil: p.valid_until,
      terms: p.terms,
      status: p.status,
      sentAt: p.sent_at,
      acceptedAt: p.accepted_at,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    sales: rows(sales).map((s): Sale => ({
      id: s.id,
      dealId: s.deal_id,
      clientId: s.client_id,
      proposalId: s.proposal_id,
      totalCents: Number(s.total_cents),
      paymentMode: s.payment_mode,
      plan: (s.proposed_plan as Row[]).map((x) => ({
        number: x.number,
        amountCents: Number(x.amount_cents),
        dueDate: x.due_date,
      })),
      status: s.status,
      closedBy: s.closed_by,
      closedAt: s.closed_at,
      reviewedBy: s.reviewed_by,
      reviewedAt: s.reviewed_at,
    })),
    accounts: rows(accounts).map((a): Account => ({
      id: a.id,
      kind: a.kind,
      clientId: a.client_id,
      supplier: a.supplier,
      description: a.description,
      origin: a.origin,
      saleId: a.sale_id,
      installmentNumber: a.installment_number,
      installmentCount: a.installment_count,
      amountCents: Number(a.amount_cents),
      dueDate: a.due_date,
      category: a.category,
      canceledAt: a.canceled_at,
      canceledBy: a.canceled_by,
      cancelReason: a.cancel_reason,
      createdAt: a.created_at,
      packageId: a.package_id ?? null,
      subscriptionId: a.subscription_id ?? null,
      period: a.period ?? null,
      workOrderId: a.work_order_id ?? null,
      counterSaleId: a.counter_sale_id ?? null,
      orderId: a.order_id ?? null,
    })),
    movements: rows(movements).map((m): Movement => ({
      id: m.id,
      accountId: m.account_id,
      direction: m.direction,
      amountCents: Number(m.amount_cents),
      paidOn: m.paid_on,
      method: m.method,
      registeredBy: m.registered_by,
      createdAt: m.created_at,
      undoneAt: m.undone_at,
      undoneBy: m.undone_by,
      undoReason: m.undo_reason,
      cashSessionId: m.cash_session_id ?? null,
    })),
    activities: rows(activities).map((a): Activity => ({
      id: a.id,
      clientId: a.client_id,
      dealId: a.deal_id,
      kind: a.kind,
      description: a.description,
      actorId: a.actor_id,
      createdAt: a.created_at,
    })),
  };
}
