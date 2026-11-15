"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { IconPlus, IconSearch, IconX } from "@/components/ui/icons";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { MAX_SALE_ITEMS, openSession } from "@/lib/domain/cash";
import { addDays, isISODate } from "@/lib/domain/dates";
import { buildPlan } from "@/lib/domain/installments";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import {
  creditAvailable,
  creditUsed,
  findByCode,
  productLabel,
  saleDiscountError,
  searchProducts,
  stockOf,
  stockShortages,
} from "@/lib/domain/stock";
import { METHOD_LABEL, type PaymentMethod, type Product } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useId, useRef, useState } from "react";

interface Line {
  key: number;
  productId: string | null;
  serviceId: string | null;
  description: string;
  quantity: number;
  price: string;
}

export const COUNTER_METHODS: PaymentMethod[] = ["dinheiro", "pix", "cartao_debito", "cartao_credito"];
type Pay = PaymentMethod | "crediario";

/**
 * Venda rápida no balcão: leitor de código de barras ou busca, serviços ou um item digitado, desconto
 * e como o cliente pagou (à vista ou, com o estoque ligado, no crediário).
 */
export function CashSaleDialog({ onClose }: DialogProps) {
  const { data, me, today } = useBackend();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const session = openSession(data.cashSessions);
  const stockOn = moduleAvailable(data.company, "estoque");
  const [lines, setLines] = useState<Line[]>([]);
  const [clientId, setClientId] = useState("");
  const [pay, setPay] = useState<Pay>("pix");
  const [code, setCode] = useState("");
  const [discount, setDiscount] = useState("");
  const [count, setCount] = useState(1);
  const [firstDue, setFirstDue] = useState(addDays(today, 30));
  const [requestId] = useState(() => crypto.randomUUID());
  const [localError, setLocalError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const services = data.services.filter((s) => s.active);
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name));
  const results = code.trim().length >= 2 ? searchProducts(data.products, code, 8) : [];

  const cents = (l: Line) => parseBRLToCents(l.price);
  const subtotal = lines.reduce((s, l) => s + (cents(l) ?? 0) * l.quantity, 0);
  const discountCents = discount.trim() ? (parseBRLToCents(discount) ?? -1) : 0;
  const total = Math.max(0, subtotal - Math.max(0, discountCents));
  const shortages = stockOn ? stockShortages(data.products, lines) : [];
  const client = data.clients.find((c) => c.id === clientId);
  const used = client ? creditUsed(client.id, data.accounts, data.movements) : 0;
  const available = client ? creditAvailable(client, used) : null;
  const credit = pay === "crediario";
  const plan = credit && total > 0 && isISODate(firstDue) ? buildPlan(total, count, firstDue) : [];
  const nextKey = () => lines.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  function addProduct(p: Product) {
    setLocalError(null);
    setCode("");
    const same = lines.find((l) => l.productId === p.id);
    if (same) return setLines((ls) => ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)));
    if (lines.length >= MAX_SALE_ITEMS) return;
    setLines((ls) => [
      ...ls,
      {
        key: nextKey(),
        productId: p.id,
        serviceId: null,
        description: productLabel(p),
        quantity: 1,
        price: centsToInput(p.priceCents),
      },
    ]);
    codeRef.current?.focus();
  }
  function addOther(value: string) {
    setLocalError(null);
    if (!value || lines.length >= MAX_SALE_ITEMS) return;
    const s = value.startsWith("s:") ? services.find((x) => x.id === value.slice(2)) : undefined;
    if (s) {
      const same = lines.find((l) => l.serviceId === s.id);
      if (same) return setLines((ls) => ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l)));
    }
    setLines((ls) => [
      ...ls,
      {
        key: nextKey(),
        productId: null,
        serviceId: s?.id ?? null,
        description: s?.name ?? "",
        quantity: 1,
        price: s && s.priceCents > 0 ? centsToInput(s.priceCents) : "",
      },
    ]);
  }
  /** Leitor de código: digita o código e aperta Enter. */
  function onCodeKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const exact = findByCode(data.products, code);
    if (exact) return addProduct(exact);
    if (results.length === 1) return addProduct(results[0]);
    if (code.trim() && results.length === 0) setLocalError(`Nenhum produto com “${code.trim()}”.`);
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
    if (discountCents < 0) return setLocalError("Digite o desconto, por exemplo 5,00.");
    const discErr = discountCents
      ? saleDiscountError(discountCents, subtotal, can(me.roles, "balcao.desconto_livre"))
      : null;
    if (discErr) return setLocalError(discErr);
    if (shortages.length)
      return setLocalError(
        `Estoque insuficiente de ${productLabel(shortages[0].product)} (tem ${stockOf(shortages[0].product)}).`,
      );
    if (credit) {
      if (!client) return setLocalError("Escolha o cliente do crediário.");
      if (available === null) return setLocalError(`${client.name} não tem crediário liberado.`);
      if (total > available) return setLocalError(`Passa do limite do crediário (disponível ${formatBRL(available)}).`);
    }
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
      method: credit ? null : pay,
      discountCents,
      plan,
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
      description={credit ? "Vira parcelas a receber no nome do cliente." : "O valor entra direto no caixa aberto."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="money" loading={pending} disabled={!session}>
            {total > 0
              ? credit
                ? `Vender ${formatBRL(total)} no crediário`
                : `Receber ${formatBRL(total)}`
              : "Registrar venda"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {!session && <InlineAlert>O caixa está fechado. Abra o caixa antes de vender.</InlineAlert>}
        {(localError || (error && !fieldErrors.discountCents)) && <InlineAlert>{localError ?? error}</InlineAlert>}

        {data.products.length > 0 && (
          <div className="relative">
            <TextField
              ref={codeRef}
              label="Código de barras ou busca"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setLocalError(null);
              }}
              onKeyDown={onCodeKey}
              placeholder={stockOn ? "Passe o leitor ou digite nome, código ou carro" : "Digite o nome do produto"}
              className="pl-10"
              autoComplete="off"
              data-autofocus
            />
            <IconSearch className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-muted" />
            {results.length > 0 && (
              <ul
                className="mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-white shadow-card"
                role="listbox"
              >
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addProduct(p)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-canvas"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{productLabel(p)}</span>
                        <span className="block truncate text-sm text-muted">
                          {[p.sku, p.fits].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm">
                        <span className="block font-semibold tabular">{formatBRL(p.priceCents)}</span>
                        {p.trackStock && (
                          <span className={cx("block", stockOf(p) <= 0 ? "text-danger" : "text-muted")}>
                            tem {stockOf(p)}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {services.length > 0 && (
            <select
              aria-label="Adicionar serviço"
              value=""
              onChange={(e) => addOther(e.target.value)}
              className="min-h-10 rounded-lg border border-[#c5cfdf] bg-white px-2 text-sm"
            >
              <option value="">+ Serviço…</option>
              {services.map((s) => (
                <option key={s.id} value={`s:${s.id}`}>
                  {s.name}
                  {s.priceCents > 0 ? ` — ${formatBRL(s.priceCents)}` : ""}
                </option>
              ))}
            </select>
          )}
          <Button size="sm" variant="secondary" onClick={() => addOther("o:")}>
            <IconPlus className="h-4 w-4" /> Outro item (digitar)
          </Button>
        </div>

        {lines.length > 0 ? (
          <ul className="grid gap-2">
            {lines.map((l) => {
              const p = l.productId ? data.products.find((x) => x.id === l.productId) : undefined;
              const short = shortages.some((s) => s.product.id === l.productId);
              return (
                <li
                  key={l.key}
                  className={cx(
                    "grid grid-cols-[1fr_auto] gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_5rem_8rem_auto]",
                    short ? "border-danger/60" : "border-line",
                  )}
                >
                  <TextField
                    label="Item"
                    value={l.description}
                    maxLength={120}
                    onChange={(e) => update(l.key, { description: e.target.value })}
                    wrapperClassName="col-span-2 sm:col-span-1"
                    hint={
                      p?.trackStock
                        ? short
                          ? `Só tem ${stockOf(p)} no estoque`
                          : `Tem ${stockOf(p)} no estoque`
                        : undefined
                    }
                    autoComplete="off"
                  />
                  <TextField
                    label="Qtd."
                    type="number"
                    min={1}
                    max={999}
                    inputMode="numeric"
                    value={l.quantity}
                    onChange={(e) =>
                      update(l.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })
                    }
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
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Nenhum item ainda.</p>
        )}

        {lines.length > 0 && (
          <div className="grid gap-2 rounded-lg bg-canvas p-3">
            <div className="flex items-end justify-between gap-3">
              <MoneyField
                label="Desconto"
                optional
                value={discount}
                onChange={(e) => {
                  setDiscount(e.target.value);
                  setLocalError(null);
                }}
                error={fieldErrors.discountCents}
                hint={can(me.roles, "balcao.desconto_livre") ? undefined : "Até 10% da venda."}
                wrapperClassName="w-40"
              />
              <div className="text-right">
                {discountCents > 0 && <p className="text-sm text-muted line-through tabular">{formatBRL(subtotal)}</p>}
                <p className="font-display text-xl font-extrabold tabular">{formatBRL(total)}</p>
              </div>
            </div>
          </div>
        )}

        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Como pagou</legend>
          <div className={cx("grid grid-cols-2 gap-2", stockOn ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
            {[...COUNTER_METHODS, ...(stockOn ? (["crediario"] as const) : [])].map((m) => (
              <label
                key={m}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30 ${pay === m ? "border-primary bg-primary-50 text-primary-700" : "border-[#c5cfdf] bg-white"}`}
              >
                <input type="radio" name="metodo" className="sr-only" checked={pay === m} onChange={() => setPay(m)} />
                {m === "crediario" ? "Crediário" : METHOD_LABEL[m]}
              </label>
            ))}
          </div>
        </fieldset>

        <SelectField
          label={t.Cliente}
          optional={!credit}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          hint={
            credit
              ? client
                ? available === null
                  ? `${client.name} não tem crediário liberado.`
                  : `Limite ${formatBRL(client.creditLimitCents ?? 0)} · deve ${formatBRL(used)} · disponível ${formatBRL(available)}`
                : "Só aparece quem tem crediário liberado."
              : "Com o nome, a venda aparece no histórico da pessoa."
          }
        >
          <option value="">{credit ? "Escolha…" : "Sem identificar"}</option>
          {clients
            .filter((c) => !credit || (c.creditLimitCents !== null && c.creditLimitCents !== undefined))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </SelectField>
        {credit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Parcelas" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}x {total > 0 ? `de ${formatBRL(Math.floor(total / n))}` : ""}
                </option>
              ))}
            </SelectField>
            <TextField
              label="1ª parcela vence em"
              type="date"
              value={firstDue}
              min={today}
              onChange={(e) => setFirstDue(e.target.value)}
            />
          </div>
        )}
      </form>
    </Modal>
  );
}
