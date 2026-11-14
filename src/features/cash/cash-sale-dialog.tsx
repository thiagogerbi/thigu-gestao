"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/fields";
import { IconPlus, IconX } from "@/components/ui/icons";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { MAX_SALE_ITEMS, openSession } from "@/lib/domain/cash";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

interface Line {
  key: number;
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantity: number;
  price: string;
}

export const COUNTER_METHODS: PaymentMethod[] = ["dinheiro", "pix", "cartao_debito", "cartao_credito"];

/** Venda rápida no balcão: produtos, serviços ou um item digitado, e como o cliente pagou. */
export function CashSaleDialog({ onClose }: DialogProps) {
  const { data } = useBackend();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const session = openSession(data.cashSessions);
  const [lines, setLines] = useState<Line[]>([]);
  const [clientId, setClientId] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [pick, setPick] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const products = data.products.filter((p) => p.active);
  const services = data.services.filter((s) => s.active);
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name));

  const cents = (l: Line) => parseBRLToCents(l.price);
  const total = lines.reduce((s, l) => s + (cents(l) ?? 0) * l.quantity, 0);
  let nextKey = lines.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  function add(value: string) {
    setPick("");
    setLocalError(null);
    if (!value || lines.length >= MAX_SALE_ITEMS) return;
    const [kind, id] = value.split(":");
    const p = kind === "p" ? products.find((x) => x.id === id) : undefined;
    const s = kind === "s" ? services.find((x) => x.id === id) : undefined;
    // o mesmo produto de novo soma na quantidade
    const same = lines.find((l) => (p && l.productId === p.id) || (s && l.serviceId === s.id));
    if (same) return setLines((ls) => ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)));
    setLines((ls) => [
      ...ls,
      {
        key: nextKey++,
        productId: p?.id ?? null,
        serviceId: s?.id ?? null,
        description: p?.name ?? s?.name ?? "",
        quantity: 1,
        price: p ? centsToInput(p.priceCents) : s && s.priceCents > 0 ? centsToInput(s.priceCents) : "",
      },
    ]);
  }
  const update = (key: number, patch: Partial<Line>) => {
    setLocalError(null);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!lines.length) return setLocalError("Adicione pelo menos um item.");
    const bad = lines.find((l) => !l.description.trim() || !(cents(l)! > 0) || l.quantity < 1);
    if (bad) return setLocalError("Confira os itens: cada um precisa de nome, quantidade e valor.");
    const r = await exec({
      type: "cash.sale",
      sessionId: session.id,
      clientId: clientId || null,
      items: lines.map((l) => ({
        productId: l.productId,
        serviceId: l.serviceId,
        description: l.description.trim(),
        quantity: l.quantity,
        unitCents: cents(l)!,
      })),
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
      size="lg"
      dirty={lines.length > 0}
      title="Nova venda"
      description="O valor entra direto no caixa aberto."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="money" loading={pending} disabled={!session}>
            {total > 0 ? `Receber ${formatBRL(total)}` : "Registrar venda"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {!session && <InlineAlert>O caixa está fechado. Abra o caixa antes de vender.</InlineAlert>}
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <SelectField
          label="Adicionar item"
          value={pick}
          onChange={(e) => add(e.target.value)}
          hint="Escolha da lista ou use “Outro item” para digitar."
          data-autofocus
        >
          <option value="">Escolha um produto ou serviço…</option>
          {products.length > 0 && (
            <optgroup label="Produtos">
              {products.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name} — {formatBRL(p.priceCents)}
                </option>
              ))}
            </optgroup>
          )}
          {services.length > 0 && (
            <optgroup label="Serviços">
              {services.map((s) => (
                <option key={s.id} value={`s:${s.id}`}>
                  {s.name}
                  {s.priceCents > 0 ? ` — ${formatBRL(s.priceCents)}` : ""}
                </option>
              ))}
            </optgroup>
          )}
          <option value="o:">Outro item (digitar)</option>
        </SelectField>

        {lines.length > 0 && (
          <ul className="grid gap-2">
            {lines.map((l) => (
              <li
                key={l.key}
                className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_5rem_8rem_auto]"
              >
                <TextField
                  label="Item"
                  value={l.description}
                  maxLength={120}
                  onChange={(e) => update(l.key, { description: e.target.value })}
                  wrapperClassName="col-span-2 sm:col-span-1"
                  autoComplete="off"
                />
                <TextField
                  label="Qtd."
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  value={l.quantity}
                  onChange={(e) => update(l.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
                />
                <TextField
                  label="Valor un."
                  prefix="R$"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="tabular"
                  value={l.price}
                  onChange={(e) => update(l.key, { price: e.target.value })}
                />
                <IconButton
                  label={`Tirar ${l.description || "item"}`}
                  className="self-end"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  <IconX className="h-4 w-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {lines.length === 0 && (
          <p className="flex items-center gap-1 text-sm text-muted">
            <IconPlus className="h-4 w-4" /> Nenhum item ainda.
          </p>
        )}

        <div className="flex items-baseline justify-between rounded-lg bg-canvas px-3 py-2">
          <span className="font-semibold">Total</span>
          <span className="font-display text-xl font-extrabold tabular">{formatBRL(total)}</span>
        </div>

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
                  name="metodo"
                  className="sr-only"
                  checked={method === m}
                  onChange={() => setMethod(m)}
                />
                {METHOD_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>

        <SelectField
          label={t.Cliente}
          optional
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          hint="Com o nome, a venda aparece no histórico da pessoa."
        >
          <option value="">Sem identificar</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </form>
    </Modal>
  );
}
