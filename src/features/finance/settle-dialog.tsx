"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { ChoiceCards, MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { validateSettlement } from "@/lib/domain/accounts";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { accountView, firstName, installmentLabel } from "@/state/selectors";
import { useId, useState } from "react";

export function SettleDialog({
  onClose,
  accountId,
  accountKind,
}: DialogProps & { accountId?: string; accountKind: "receber" | "pagar" }) {
  const { data, me, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clear } = useAction();
  const [selected, setSelected] = useState(accountId ?? "");
  const [mode, setMode] = useState<"tudo" | "parte">("tudo");
  const [amountText, setAmountText] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [requestId] = useState(() => crypto.randomUUID());
  const formId = useId();
  const isIn = accountKind === "receber";

  const options = data.accounts
    .filter((a) => a.kind === accountKind)
    .map((a) => accountView(data, a, today))
    .filter((v) => v.balance > 0)
    .sort((a, b) => a.account.dueDate.localeCompare(b.account.dueDate));
  const acc = data.accounts.find((a) => a.id === selected);
  const view = acc ? accountView(data, acc, today) : null;

  const amountCents = mode === "tudo" ? (view?.balance ?? null) : parseBRLToCents(amountText);
  const remaining =
    view && amountCents !== null && amountCents > 0 && amountCents <= view.balance ? view.balance - amountCents : null;
  const title = isIn ? "Registrar recebimento" : "Registrar pagamento";
  const verb = isIn ? "recebimento" : "pagamento";
  const amountError = localError ?? fieldErrors.amount ?? fieldErrors.amountCents ?? null;
  const dirty = mode === "parte" && amountText !== "";

  function changeAmount(v: string) {
    setAmountText(v);
    // ao corrigir o valor, qualquer erro anterior deixa de valer
    setLocalError(null);
    clear();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!acc) return setLocalError("Escolha qual conta está sendo " + (isIn ? "recebida." : "paga."));
    const err = validateSettlement(acc, data.movements, amountCents);
    if (err) return setLocalError(err);
    setLocalError(null);
    const r = await exec({
      type: "movement.register",
      accountId: acc.id,
      amountCents: amountCents!,
      paidOn,
      method,
      requestId,
    });
    if (r.ok) {
      setLocalError(null);
      clear();
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      title={title}
      description={isIn ? "Dinheiro que entrou na empresa." : "Dinheiro que saiu da empresa."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant={isIn ? "money" : "primary"} loading={pending} disabled={!acc}>
            {amountCents && amountCents > 0 ? `Confirmar ${verb} de ${formatBRL(amountCents)}` : `Confirmar ${verb}`}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {!accountId &&
          (options.length === 0 ? (
            <InlineAlert tone="blue">Não há {isIn ? "parcelas a receber" : "contas a pagar"} em aberto.</InlineAlert>
          ) : (
            <SelectField
              label={isIn ? "Qual parcela foi paga?" : "Qual conta foi paga?"}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setLocalError(null);
                clear();
              }}
              data-autofocus
            >
              <option value="">Escolha…</option>
              {options.map((v) => (
                <option key={v.account.id} value={v.account.id}>
                  {v.partyName} — {installmentLabel(v.account)} — falta {formatBRL(v.balance)} — vence{" "}
                  {formatShortDateBR(v.account.dueDate)}
                </option>
              ))}
            </SelectField>
          ))}

        {view && acc && (
          <>
            <div className="rounded-lg border border-line bg-canvas p-3">
              <p className="font-display text-lg font-bold">
                {isIn ? `Quanto ${firstName(view.partyName)} pagou?` : `Quanto foi pago para ${view.partyName}?`}
              </p>
              <p className="text-[15px]">
                {acc.installmentCount > 1 ? `Parcela ${acc.installmentNumber} de ${acc.installmentCount}` : "Conta"} de{" "}
                <strong>{formatBRL(acc.amountCents)}</strong> — vencimento em {formatShortDateBR(acc.dueDate)}
              </p>
              <p className="text-sm text-muted">
                {view.partyName}
                {view.saleTitle ? ` · Venda: ${view.saleTitle}` : ` · ${acc.description}`}
              </p>
              {view.settled > 0 && (
                <p className="mt-1 text-sm tabular">
                  Já {isIn ? "recebido" : "pago"}: {formatBRL(view.settled)} · Falta:{" "}
                  <strong>{formatBRL(view.balance)}</strong>
                </p>
              )}
            </div>

            <ChoiceCards
              legend={isIn ? "Quanto entrou?" : "Quanto saiu?"}
              name="quanto"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setLocalError(null);
                clear();
              }}
              options={[
                { value: "tudo", label: isIn ? "Recebi tudo" : "Paguei tudo", description: formatBRL(view.balance) },
                {
                  value: "parte",
                  label: isIn ? "Recebi uma parte" : "Paguei uma parte",
                  description: "Digite o valor",
                },
              ]}
            />

            {mode === "parte" && (
              <div>
                <MoneyField
                  label={isIn ? "Valor recebido" : "Valor pago"}
                  value={amountText}
                  onChange={(e) => changeAmount(e.target.value)}
                  error={amountError}
                  data-autofocus
                  hint={`No máximo ${formatBRL(view.balance)}.`}
                />
                {remaining !== null && !amountError && (
                  <p className="mt-2 text-[15px] tabular" role="status">
                    Ainda faltará {isIn ? "receber" : "pagar"}: <strong>{formatBRL(remaining)}</strong>
                  </p>
                )}
              </div>
            )}
            {mode === "tudo" && amountError && <InlineAlert>{amountError}</InlineAlert>}

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={isIn ? "Data do recebimento" : "Data do pagamento"}
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                error={fieldErrors.paidOn}
              />
              <SelectField
                label="Meio de pagamento"
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {Object.entries(METHOD_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </SelectField>
            </div>
            <p className="text-sm text-muted">
              Registrado por: <strong className="text-ink">{me.name}</strong>
            </p>
          </>
        )}
        {error && !amountError && !fieldErrors.paidOn && <InlineAlert>{error}</InlineAlert>}
      </form>
    </Modal>
  );
}
