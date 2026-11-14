import { formatBRL } from "@/lib/domain/money";
import type { Account, ISODate, Movement } from "@/lib/domain/types";

export type AccountStatus = "pendente" | "parcial" | "quitada" | "atrasada" | "cancelada";

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  pendente: "Pendente",
  parcial: "Pagou uma parte",
  quitada: "Quitada",
  atrasada: "Atrasada",
  cancelada: "Cancelada",
};

export function statusLabel(status: AccountStatus, kind: Account["kind"]): string {
  if (status === "parcial") return kind === "receber" ? "Pagou uma parte" : "Paga em parte";
  if (status === "quitada") return kind === "receber" ? "Recebida" : "Paga";
  return ACCOUNT_STATUS_LABEL[status];
}

export function activeMovements(accountId: string, movements: Movement[]): Movement[] {
  return movements.filter((m) => m.accountId === accountId && !m.undoneAt);
}

export function settledCents(account: Account, movements: Movement[]): number {
  return activeMovements(account.id, movements).reduce((s, m) => s + m.amountCents, 0);
}

export function balanceCents(account: Account, movements: Movement[]): number {
  if (account.canceledAt) return 0;
  return account.amountCents - settledCents(account, movements);
}

export function accountStatus(account: Account, movements: Movement[], today: ISODate): AccountStatus {
  if (account.canceledAt) return "cancelada";
  const settled = settledCents(account, movements);
  if (settled >= account.amountCents) return "quitada";
  if (account.dueDate < today) return "atrasada";
  if (settled > 0) return "parcial";
  return "pendente";
}

/** true quando já houve algum valor registrado mas ainda há saldo. */
export function isPartial(account: Account, movements: Movement[]): boolean {
  const s = settledCents(account, movements);
  return !account.canceledAt && s > 0 && s < account.amountCents;
}

/** Valida um recebimento/pagamento. Retorna a mensagem de erro (para mostrar perto do campo) ou null. */
export function validateSettlement(account: Account, movements: Movement[], amountCents: number | null): string | null {
  if (account.canceledAt) return "Esta conta foi cancelada e não aceita novos registros.";
  const balance = balanceCents(account, movements);
  if (balance <= 0)
    return account.kind === "receber"
      ? "Esta parcela já foi recebida por completo."
      : "Esta conta já foi paga por completo.";
  if (amountCents === null) return "Digite um valor, por exemplo 200,00.";
  if (!Number.isInteger(amountCents) || amountCents <= 0) return "O valor precisa ser maior que zero.";
  if (amountCents > balance) {
    return account.kind === "receber"
      ? `O valor passa do saldo da parcela. O máximo que ainda falta receber é ${formatBRL(balance)}.`
      : `O valor passa do saldo da conta. O máximo que ainda falta pagar é ${formatBRL(balance)}.`;
  }
  return null;
}
