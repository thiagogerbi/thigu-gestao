"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { COUNTER_METHODS } from "@/features/cash/cash-sale-dialog";
import { localParts } from "@/lib/domain/agenda";
import { openSession } from "@/lib/domain/cash";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { refundFor } from "@/lib/domain/stock";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

/**
 * Devolução de uma venda paga na hora: o cliente escolhe o que devolve, o item volta para o estoque
 * e o dinheiro sai pelo caixa aberto (proporcional ao desconto). Para trocar, devolva e faça uma venda nova.
 */
export function ReturnDialog({ onClose, saleId }: DialogProps & { saleId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const session = openSession(data.cashSessions);
  const sales = data.counterSales
    .filter((s) => s.payment === "avista")
    .filter((s) => data.cashSaleItems.some((i) => i.saleId === s.id && i.quantity - (i.returnedQty ?? 0) > 0))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);
  const [selected, setSelected] = useState(saleId ?? sales[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>("dinheiro");
  const [requestId] = useState(() => crypto.randomUUID());
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const sale = data.counterSales.find((s) => s.id === selected);
  const items = sale ? data.cashSaleItems.filter((i) => i.saleId === sale.id) : [];
  const lines = items.reduce((s, i) => s + (qty[i.id] ?? 0) * i.unitCents, 0);
  const refund = sale ? refundFor(sale, lines) : 0;
  const clientName = (id: string | null) =>
    id ? (data.clients.find((c) => c.id === id)?.name ?? "—") : "Sem identificar";
  const describe = (s: (typeof sales)[number]) => {
    const first = data.cashSaleItems.find((i) => i.saleId === s.id)?.description ?? "Venda";
    return `${formatShortDateBR(localParts(s.createdAt).date)} ${localParts(s.createdAt).time} · ${clientName(s.clientId)} · ${first} · ${formatBRL(s.totalCents)}`;
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sale) return setLocalError("Escolha a venda.");
    const chosen = items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ itemId: i.id, quantity: qty[i.id] }));
    if (!chosen.length) return setLocalError("Marque o que está sendo devolvido.");
    setLocalError(null);
    const r = await exec({ type: "counter.return", saleId: sale.id, items: chosen, method, requestId });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Devolução"
      description="O item volta para o estoque e o dinheiro sai do caixa. Para trocar: devolva e faça uma venda nova."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!session || refund <= 0}>
            {refund > 0 ? `Devolver ${formatBRL(refund)}` : "Devolver"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {!session && <InlineAlert>Abra o caixa para devolver o dinheiro.</InlineAlert>}
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        {sales.length === 0 ? (
          <InlineAlert tone="blue">Nenhuma venda paga na hora com itens para devolver.</InlineAlert>
        ) : (
          <SelectField
            label="Venda"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setQty({});
              setLocalError(null);
            }}
            hint="Vendas no crediário: cancele as parcelas no financeiro e dê entrada do item no estoque."
          >
            {sales.map((s) => (
              <option key={s.id} value={s.id}>
                {describe(s)}
              </option>
            ))}
          </SelectField>
        )}
        {items.length > 0 && (
          <ul className="grid gap-2">
            {items.map((i) => {
              const left = i.quantity - (i.returnedQty ?? 0);
              return (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{i.description}</span>
                    <span className="text-sm text-muted">
                      {i.quantity} × {formatBRL(i.unitCents)}
                      {(i.returnedQty ?? 0) > 0 && ` · ${i.returnedQty} já devolvido(s)`}
                    </span>
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    Devolver
                    <select
                      value={qty[i.id] ?? 0}
                      disabled={left <= 0}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: Number(e.target.value) }))}
                      className="min-h-10 rounded-lg border border-[#c5cfdf] bg-white px-2"
                    >
                      {Array.from({ length: left + 1 }, (_, n) => n).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {sale && sale.discountCents > 0 && lines > 0 && (
          <p className="text-sm text-muted">
            A venda teve desconto: devolve-se o valor proporcional ({formatBRL(refund)}).
          </p>
        )}
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Como o dinheiro volta</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {COUNTER_METHODS.map((m) => (
              <label
                key={m}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30 ${method === m ? "border-primary bg-primary-50 text-primary-700" : "border-[#c5cfdf] bg-white"}`}
              >
                <input
                  type="radio"
                  name="metodo-devolucao"
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
