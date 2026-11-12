"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { IconPlus, IconX } from "@/components/ui/icons";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { addDays, formatDateBR } from "@/lib/domain/dates";
import { isOpenStage } from "@/lib/domain/deals";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import {
  hasProposalErrors,
  itemTotalCents,
  proposalSubtotalCents,
  proposalTotalCents,
  validateProposal,
  type ProposalErrors,
} from "@/lib/domain/proposals";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById, dealById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useId, useState } from "react";

interface Row {
  description: string;
  quantity: string;
  unit: string;
}

const toQty = (s: string) => {
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export function ProposalDialog({
  onClose,
  proposalId,
  dealId,
  clientId,
}: DialogProps & { proposalId?: string; dealId?: string; clientId?: string }) {
  const { data, today } = useBackend();
  const toast = useToast();
  const nav = useNav();
  const { exec, pending, error } = useAction();
  const existing = data.proposals.find((p) => p.id === proposalId);
  const initialDeal = existing?.dealId ?? dealId ?? "";
  const initialDealObj = dealById(data, initialDeal);
  const cId = existing?.clientId ?? initialDealObj?.clientId ?? clientId ?? "";
  const [deal, setDeal] = useState(initialDeal);
  const initialRows: Row[] = existing
    ? existing.items.map((i) => ({
        description: i.description,
        quantity: String(i.quantity).replace(".", ","),
        unit: centsToInput(i.unitCents),
      }))
    : [
        {
          description: initialDealObj?.title ?? "",
          quantity: "1",
          unit: initialDealObj?.valueCents ? centsToInput(initialDealObj.valueCents) : "",
        },
      ];
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [discount, setDiscount] = useState(existing ? centsToInput(existing.discountCents) : "");
  const [validUntil, setValidUntil] = useState(existing?.validUntil ?? addDays(today, 15));
  const [terms, setTerms] = useState(existing?.terms ?? "Pagamento: a combinar.\nPrazo de entrega: a combinar.");
  const [errs, setErrs] = useState<ProposalErrors>({ rows: {} });
  const [dealErr, setDealErr] = useState<string | null>(null);
  const formId = useId();
  const client = clientById(data, cId);
  const clientDeals = data.deals.filter((d) => d.clientId === cId && (isOpenStage(d.stage) || d.id === initialDeal));

  const items = rows.map((r) => ({
    description: r.description.trim(),
    quantity: toQty(r.quantity),
    unitCents: parseBRLToCents(r.unit) ?? -1,
  }));
  const discountCents = discount.trim() === "" ? 0 : (parseBRLToCents(discount) ?? -1);
  const validItems = items.filter((i) => i.quantity > 0 && i.unitCents >= 0);
  const subtotal = proposalSubtotalCents(validItems);
  const total = proposalTotalCents(validItems, Math.max(0, discountCents));
  const dirty = JSON.stringify(rows) !== JSON.stringify(initialRows) || (!existing && deal !== initialDeal);

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setErrs((e) => ({ ...e, rows: { ...e.rows, [i]: {} } }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!deal) return setDealErr("Escolha a negociação desta proposta.");
    const v = validateProposal(items, discountCents, validUntil);
    setErrs(v);
    if (hasProposalErrors(v)) return;
    const r = await exec({
      type: "proposal.save",
      id: proposalId,
      clientId: cId,
      dealId: deal,
      items,
      discountCents,
      validUntil,
      terms,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
      if (r.id) nav.router.push(nav.href(`/propostas/${r.id}`));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={dirty}
      size="lg"
      title={existing ? `Editar proposta nº ${existing.number}` : "Preparar proposta"}
      description={
        client ? (
          <>
            Para <strong className="text-ink">{client.name}</strong>. Nada é enviado ao cliente ao salvar.
          </>
        ) : undefined
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar proposta de {formatBRL(total)}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-5" noValidate>
        {error && <InlineAlert>{error}</InlineAlert>}
        {!existing &&
          !dealId &&
          (clientDeals.length ? (
            <SelectField
              label="Negociação"
              value={deal}
              onChange={(e) => {
                setDeal(e.target.value);
                setDealErr(null);
              }}
              error={dealErr}
              data-autofocus
            >
              <option value="">Escolha…</option>
              {clientDeals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </SelectField>
          ) : (
            <InlineAlert tone="amber">
              Este cliente ainda não tem negociação aberta. Crie uma negociação antes de preparar a proposta.
            </InlineAlert>
          ))}

        <fieldset className="grid gap-3">
          <legend className="mb-1 font-display text-base font-bold">Serviços ou itens</legend>
          {errs.items && <InlineAlert>{errs.items}</InlineAlert>}
          {rows.map((r, i) => {
            const re = errs.rows[i] ?? {};
            const it = items[i];
            const rowTotal = it.quantity > 0 && it.unitCents >= 0 ? itemTotalCents(it) : 0;
            return (
              <div
                key={i}
                className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_90px_140px_auto] sm:items-start"
              >
                <TextField
                  label={`Item ${i + 1}`}
                  value={r.description}
                  onChange={(e) => updateRow(i, { description: e.target.value })}
                  error={re.description}
                  placeholder="Ex.: Criação de logotipo"
                />
                <TextField
                  label="Qtd."
                  inputMode="decimal"
                  value={r.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                  error={re.quantity}
                />
                <MoneyField
                  label="Preço unitário"
                  value={r.unit}
                  onChange={(e) => updateRow(i, { unit: e.target.value })}
                  error={re.unit}
                />
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                  <p className="text-sm text-muted sm:mt-7">
                    Total <strong className="tabular text-ink">{formatBRL(rowTotal)}</strong>
                  </p>
                  {rows.length > 1 && (
                    <IconButton
                      label={`Remover item ${i + 1}`}
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    >
                      <IconX className="h-4 w-4" />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows((rs) => [...rs, { description: "", quantity: "1", unit: "" }])}
            >
              <IconPlus className="h-4 w-4" /> Adicionar item
            </Button>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Desconto"
            optional
            value={discount}
            onChange={(e) => {
              setDiscount(e.target.value);
              setErrs((x) => ({ ...x, discount: undefined }));
            }}
            error={errs.discount}
            hint="Valor em reais a abater do subtotal."
          />
          <TextField
            label="Válida até"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            error={errs.validUntil}
            hint={`Data em que a proposta deixa de valer (${formatDateBR(validUntil)}).`}
          />
        </div>
        <TextAreaField
          label="Condições comerciais"
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          hint="Forma de pagamento, prazo de entrega, o que está incluído."
        />

        <dl className="grid gap-1 rounded-lg bg-canvas p-4 text-sm tabular">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{formatBRL(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Desconto</dt>
            <dd>− {formatBRL(Math.max(0, discountCents))}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-base font-bold">
            <dt>Total da proposta</dt>
            <dd>{formatBRL(total)}</dd>
          </div>
        </dl>
      </form>
    </Modal>
  );
}
