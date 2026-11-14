"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { COUNTER_METHODS } from "@/features/cash/cash-sale-dialog";
import { COUNTER_ORIGINS, openSession } from "@/lib/domain/cash";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { accountView } from "@/state/selectors";
import { useId, useState } from "react";

/** Recebe no caixa uma conta que já existe: o atendimento de hoje, a parcela do pacote, a mensalidade. */
export function CashReceiveDialog({ onClose, accountId }: DialogProps & { accountId?: string }) {
  const { data, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clear } = useAction();
  const session = openSession(data.cashSessions);
  const [selected, setSelected] = useState(accountId ?? "");
  const [part, setPart] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [requestId] = useState(() => crypto.randomUUID());
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();

  const options = data.accounts
    .filter((a) => a.kind === "receber" && !a.canceledAt && (COUNTER_ORIGINS as readonly string[]).includes(a.origin))
    .map((a) => accountView(data, a, today))
    .filter((v) => v.balance > 0)
    .sort((a, b) => a.account.dueDate.localeCompare(b.account.dueDate));
  const view = options.find((v) => v.account.id === selected);
  const cents = part ? parseBRLToCents(amount) : (view?.balance ?? null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!view) return setLocalError("Escolha a conta que está sendo paga.");
    if (!cents || cents <= 0) return setLocalError("Digite o valor recebido.");
    if (cents > view.balance) return setLocalError(`O valor passa do que falta (${formatBRL(view.balance)}).`);
    setLocalError(null);
    const r = await exec({
      type: "cash.receive",
      sessionId: session.id,
      accountId: view.account.id,
      amountCents: cents,
      method,
      requestId,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Receber no caixa"
      description="O valor entra no caixa aberto e dá baixa na conta."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="money" loading={pending} disabled={!session || !view}>
            {cents && cents > 0 ? `Receber ${formatBRL(cents)}` : "Receber"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {!session && <InlineAlert>O caixa está fechado. Abra o caixa antes de receber.</InlineAlert>}
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        {options.length === 0 ? (
          <InlineAlert tone="blue">Não há atendimentos, pacotes ou mensalidades em aberto.</InlineAlert>
        ) : (
          <SelectField
            label="O que está sendo pago?"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setLocalError(null);
              clear();
            }}
            data-autofocus={!accountId || undefined}
          >
            <option value="">Escolha…</option>
            {options.map((v) => (
              <option key={v.account.id} value={v.account.id}>
                {v.partyName} — {v.account.description} — falta {formatBRL(v.balance)} —{" "}
                {formatShortDateBR(v.account.dueDate)}
              </option>
            ))}
          </SelectField>
        )}
        {view && (
          <>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={part}
                onChange={(e) => setPart(e.target.checked)}
              />
              Pagou só uma parte (falta {formatBRL(view.balance)})
            </label>
            {part && (
              <MoneyField
                label="Valor recebido"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setLocalError(null);
                }}
                error={fieldErrors.amountCents}
              />
            )}
          </>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Como pagou</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COUNTER_METHODS.map((m) => (
              <label
                key={m}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30 ${method === m ? "border-primary bg-primary-50 text-primary-700" : "border-[#c5cfdf] bg-white"}`}
              >
                <input
                  type="radio"
                  name="metodo-receber"
                  className="sr-only"
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {METHOD_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
