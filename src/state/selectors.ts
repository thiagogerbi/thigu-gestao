import { accountStatus, balanceCents, settledCents, statusLabel, type AccountStatus } from "@/lib/domain/accounts";
import { formatShortDateBR } from "@/lib/domain/dates";
import type { Account, CompanyData, ISODate } from "@/lib/domain/types";

export const clientById = (d: CompanyData, id: string | null | undefined) => d.clients.find((c) => c.id === id);
export const dealById = (d: CompanyData, id: string | null | undefined) => d.deals.find((x) => x.id === id);
export const saleForDeal = (d: CompanyData, dealId: string) =>
  d.sales.find((s) => s.dealId === dealId && s.status !== "cancelada");

export const installmentLabel = (a: Account) =>
  a.installmentCount > 1
    ? `Parcela ${a.installmentNumber} de ${a.installmentCount}`
    : a.origin === "venda"
      ? "Parcela única"
      : "Conta única";

export const STATUS_TONE: Record<AccountStatus, "amber" | "blue" | "green" | "red" | "gray"> = {
  pendente: "blue",
  parcial: "amber",
  quitada: "green",
  atrasada: "red",
  cancelada: "gray",
};

export interface AccountView {
  account: Account;
  partyName: string;
  saleTitle: string | null;
  status: AccountStatus;
  statusText: string;
  settled: number;
  balance: number;
  /** "Parcela 1 de 3 · vence 06/11" */
  line: string;
}

export function accountView(d: CompanyData, a: Account, today: ISODate): AccountView {
  const client = clientById(d, a.clientId);
  const sale = a.saleId ? d.sales.find((s) => s.id === a.saleId) : undefined;
  const deal = sale ? dealById(d, sale.dealId) : undefined;
  const status = accountStatus(a, d.movements, today);
  return {
    account: a,
    partyName: client?.name ?? a.supplier ?? (a.kind === "pagar" ? "Despesa" : "Cliente"),
    saleTitle: deal?.title ?? null,
    status,
    statusText: statusLabel(status, a.kind),
    settled: settledCents(a, d.movements),
    balance: balanceCents(a, d.movements),
    line: `${installmentLabel(a)} · vence ${formatShortDateBR(a.dueDate)}`,
  };
}

export function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}
