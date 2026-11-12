import { can } from "@/lib/domain/permissions";
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
  const allFin = can(roles, "financeiro.ver");

  const deals = allCrm ? data.deals : data.deals.filter((d) => d.ownerId === me);
  const dealIds = new Set(deals.map((d) => d.id));
  const clients = allCrm
    ? data.clients
    : data.clients.filter((c) => c.ownerId === me || deals.some((d) => d.clientId === c.id));
  const clientIds = new Set(clients.map((c) => c.id));

  const sales = allFin || allCrm ? data.sales : data.sales.filter((s) => dealIds.has(s.dealId));
  const saleIds = new Set(sales.map((s) => s.id));
  const accounts = data.accounts.filter((a) => {
    if (allFin) return true;
    if (a.kind === "pagar") return false;
    return can(roles, "recebiveis.ver_proprios") && a.saleId !== null && saleIds.has(a.saleId);
  });
  const accountIds = new Set(accounts.map((a) => a.id));

  return {
    company: data.company,
    members: data.members,
    clients,
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
