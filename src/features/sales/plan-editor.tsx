"use client";
import { Button } from "@/components/ui/button";
import { MoneyField, TextField } from "@/components/ui/fields";
import { cx } from "@/components/ui/styles";
import { formatDateBR } from "@/lib/domain/dates";
import { checkPlan } from "@/lib/domain/installments";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import type { PlannedInstallment } from "@/lib/domain/types";

export interface PlanRow {
  amount: string;
  dueDate: string;
}
export const toRows = (plan: PlannedInstallment[]): PlanRow[] =>
  plan.map((p) => ({ amount: centsToInput(p.amountCents), dueDate: p.dueDate }));
export const fromRows = (rows: PlanRow[]): PlannedInstallment[] =>
  rows.map((r, i) => ({ number: i + 1, amountCents: parseBRLToCents(r.amount) ?? -1, dueDate: r.dueDate }));

export function PlanEditor({
  rows,
  setRows,
  totalCents,
  readOnly,
  onRedistribute,
}: {
  rows: PlanRow[];
  setRows: (r: PlanRow[]) => void;
  totalCents: number;
  readOnly?: boolean;
  onRedistribute?: () => void;
}) {
  const plan = fromRows(rows);
  const check = checkPlan(plan, totalCents);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display font-bold">Prévia das parcelas</h3>
        {!readOnly && onRedistribute && rows.length > 1 && (
          <Button size="sm" variant="ghost" onClick={onRedistribute}>
            Dividir igualmente
          </Button>
        )}
      </div>
      <ol className="grid gap-2">
        {rows.map((r, i) => (
          <li
            key={i}
            className="grid grid-cols-[auto_1fr_1fr] items-start gap-3 rounded-lg border border-line bg-white p-3"
          >
            <span className="mt-8 text-sm font-semibold text-muted sm:mt-9">{i + 1}ª</span>
            {readOnly ? (
              <>
                <p>
                  <span className="block text-sm text-muted">Valor</span>
                  <strong className="tabular">{formatBRL(plan[i].amountCents)}</strong>
                </p>
                <p>
                  <span className="block text-sm text-muted">Vencimento</span>
                  {formatDateBR(r.dueDate)}
                </p>
              </>
            ) : (
              <>
                <MoneyField
                  label={`Valor da ${i + 1}ª parcela`}
                  value={r.amount}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  error={check.rowErrors[i]?.includes("valor") ? check.rowErrors[i] : undefined}
                />
                <TextField
                  label="Vencimento"
                  type="date"
                  value={r.dueDate}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))}
                  error={check.rowErrors[i]?.includes("data") ? check.rowErrors[i] : undefined}
                />
              </>
            )}
          </li>
        ))}
      </ol>
      <div
        className={cx(
          "mt-3 rounded-lg px-3 py-2 text-sm tabular",
          check.differenceCents === 0 ? "bg-money-50 text-money-700" : "bg-danger-50 text-danger",
        )}
        role="status"
      >
        Soma das parcelas: <strong>{formatBRL(check.sumCents)}</strong> de {formatBRL(totalCents)}.{" "}
        {check.differenceCents === 0
          ? "Confere com o valor da venda."
          : (check.errors.find((e) => e.includes("soma")) ?? "")}
      </div>
    </div>
  );
}
