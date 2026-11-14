"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { ChoiceCards, MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { fromRows, PlanEditor, type PlanRow, toRows } from "@/features/sales/plan-editor";
import { SaleSteps } from "@/features/sales/sale-steps";
import { formatShortDateBR } from "@/lib/domain/dates";
import { buildPlan, checkPlan } from "@/lib/domain/installments";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { proposalTotalCents } from "@/lib/domain/proposals";
import type { PaymentMode } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById, dealById } from "@/state/selectors";
import { useState } from "react";

export function CloseSaleDialog({
  onClose,
  dealId,
  proposalId,
  open,
}: DialogProps & { dealId: string; proposalId?: string }) {
  const { data, me, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const deal = dealById(data, dealId);
  const accepted = data.proposals.find((p) =>
    proposalId ? p.id === proposalId : p.dealId === dealId && p.status === "aceita",
  );
  const suggested = accepted ? proposalTotalCents(accepted.items, accepted.discountCents) : (deal?.valueCents ?? 0);

  const [totalText, setTotalText] = useState(suggested ? centsToInput(suggested) : "");
  const [mode, setMode] = useState<PaymentMode>("parcelado");
  const [count, setCount] = useState(3);
  const [firstDue, setFirstDue] = useState(today);
  const totalCents = parseBRLToCents(totalText) ?? 0;
  const generate = (t: number, m: PaymentMode, n: number, f: string) =>
    t > 0 ? toRows(buildPlan(t, m === "avista" ? 1 : n, f)) : [];
  const [rows, setRows] = useState<PlanRow[]>(() => generate(suggested, "parcelado", 3, today));
  const [requestId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<null | { saleId: string }>(null);
  const [totalErr, setTotalErr] = useState<string | null>(null);

  const regen = (t = totalCents, m = mode, n = count, f = firstDue) => setRows(generate(t, m, n, f));
  if (!deal) return null;
  const client = clientById(data, deal.clientId);
  const reviewers = data.members.filter((m) => can(m.roles, "venda.conferir"));
  const iCanReview = can(me.roles, "venda.conferir");
  const dirty =
    !done && (totalText !== (suggested ? centsToInput(suggested) : "") || mode !== "parcelado" || count !== 3);

  async function submit() {
    if (totalCents <= 0) return setTotalErr("Digite o valor da venda, por exemplo 1.500,00.");
    const plan = fromRows(rows);
    if (!checkPlan(plan, totalCents).ok) return;
    const r = await exec({
      type: "sale.close",
      dealId,
      proposalId: accepted?.id ?? null,
      totalCents,
      paymentMode: mode,
      plan,
      requestId,
    });
    if (r.ok && r.id) {
      toast({ tone: "success", text: r.message });
      setDone({ saleId: r.id });
    }
  }

  if (done) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Venda fechada"
        footer={
          iCanReview ? (
            <>
              <Button variant="secondary" onClick={onClose}>
                Confirmar depois
              </Button>
              <Button onClick={() => open({ kind: "reviewSale", saleId: done.saleId })}>
                Confirmar parcelas agora
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Entendi</Button>
          )
        }
      >
        <SaleSteps current={1} doneUpTo={1} />
        <InlineAlert tone="green" title={`Venda de ${formatBRL(totalCents)} para ${client?.name} fechada.`}>
          Próximo passo: <strong>confirmar as parcelas</strong>. Quem faz:{" "}
          {reviewers.map((m) => m.name).join(", ") || "o financeiro"}. Até lá, o valor ainda não entra em “Falta
          receber”.
        </InlineAlert>
      </Modal>
    );
  }

  const check = checkPlan(fromRows(rows), totalCents);
  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      size="lg"
      title="Fechar venda"
      description={
        <>
          {deal.title} — {client?.name}
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="money" onClick={submit} loading={pending} disabled={!check.ok || totalCents <= 0}>
            Fechar venda de {formatBRL(totalCents)}
          </Button>
        </>
      }
    >
      <SaleSteps current={0} doneUpTo={0} />
      <p className="mb-4 text-sm">
        Você está <strong>propondo</strong> como o cliente vai pagar. Depois,{" "}
        {iCanReview ? "você (ou o financeiro)" : "o financeiro"} confere e cria as contas a receber.
      </p>
      {error && (
        <div className="mb-3">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
      <div className="grid gap-4">
        <MoneyField
          label="Valor da venda"
          value={totalText}
          onChange={(e) => {
            setTotalText(e.target.value);
            setTotalErr(null);
            const t = parseBRLToCents(e.target.value) ?? 0;
            regen(t);
          }}
          error={totalErr}
          hint={accepted ? `Valor da proposta nº ${accepted.number} aceita.` : undefined}
        />
        <ChoiceCards
          legend="Como o cliente vai pagar?"
          name="modo"
          value={mode}
          onChange={(m) => {
            setMode(m);
            regen(totalCents, m);
          }}
          options={[
            { value: "avista", label: "À vista", description: "Um único pagamento." },
            { value: "parcelado", label: "Parcelado", description: "Dividido em parcelas mensais." },
          ]}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === "parcelado" && (
            <SelectField
              label="Quantidade de parcelas"
              value={count}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCount(n);
                regen(totalCents, mode, n);
              }}
            >
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n} parcelas{totalCents > 0 ? ` de cerca de ${formatBRL(Math.floor(totalCents / n))}` : ""}
                </option>
              ))}
            </SelectField>
          )}
          <TextField
            label={mode === "avista" ? "Data do pagamento" : "Vencimento da 1ª parcela"}
            type="date"
            value={firstDue}
            onChange={(e) => {
              setFirstDue(e.target.value);
              regen(totalCents, mode, count, e.target.value);
            }}
            hint={
              mode === "parcelado"
                ? `As próximas vencem no mesmo dia dos meses seguintes (ex.: ${formatShortDateBR(firstDue)}).`
                : undefined
            }
          />
        </div>
        {rows.length > 0 && (
          <PlanEditor rows={rows} setRows={setRows} totalCents={totalCents} onRedistribute={() => regen()} />
        )}
      </div>
    </Modal>
  );
}
