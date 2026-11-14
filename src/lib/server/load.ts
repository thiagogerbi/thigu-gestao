import type {
  Account,
  Activity,
  Client,
  ClientItem,
  CompanyData,
  CompanyInvite,
  Deal,
  Member,
  Movement,
  MyInvite,
  Note,
  Proposal,
  Role,
  Sale,
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
  const [company, members, clients, items, deals, tasks, notes, proposals, sales, accounts, movements, activities] =
    await Promise.all([
      sb
        .from("companies")
        .select(
          "id, name, legal_name, document, phone, email, address, default_terms, logo_data_url, brand_color, menu_color, segment, plan, extra_modules",
        )
        .eq("id", companyId)
        .single(),
      q("memberships", "user_id, roles, active, profiles(full_name, email)").eq("active", true),
      q("clients").order("name"),
      // o banco só devolve itens quando o módulo está ligado para a empresa
      q("client_items").order("created_at"),
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
      segment: co.segment ?? "geral",
      plan: co.plan ?? "empresa",
      extraModules: co.extra_modules ?? [],
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
    })),
    items: rows(items).map((i): ClientItem => ({
      id: i.id,
      clientId: i.client_id,
      kind: i.kind,
      name: i.name,
      details: i.details ?? {},
      alert: i.alert ?? "",
      active: i.active,
      createdAt: i.created_at,
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
