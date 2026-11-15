"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconEdit, IconPlus, IconSearch } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { localParts } from "@/lib/domain/agenda";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import { isLowStock, isOutOfStock, marginPercent, productLabel, searchProducts, stockOf } from "@/lib/domain/stock";
import type { Product, StockMovementKind } from "@/lib/domain/types";
import { useBackend, useMemberName } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

const KIND_LABEL: Record<StockMovementKind, string> = {
  entrada: "Entrada",
  venda: "Venda",
  devolucao: "Devolução",
  ajuste: "Ajuste",
  perda: "Perda",
};

type Filter = "todos" | "baixo" | "zerado";

/** Estoque: saldo de cada produto, avisos de estoque baixo, entrada de mercadoria, ajustes e o histórico. */
export function StockScreen() {
  const { data, me } = useBackend();
  const nav = useNav();
  const dialogs = useDialogs();
  const name = useMemberName();
  const [open, setOpen] = useState<string | null>(null);
  const q = nav.params.get("busca") ?? "";
  const filter = (nav.params.get("ver") as Filter | null) ?? "todos";
  const manage = can(me.roles, "produtos.gerenciar");
  const moves = can(me.roles, "estoque.movimentar");

  if (!moduleAvailable(data.company, "estoque") || !(manage || moves || can(me.roles, "caixa.operar"))) {
    return (
      <>
        <PageHeader title="Estoque" />
        <EmptyState title="Página indisponível">
          O estoque existe para lojas, autopeças e comércio com venda no balcão.
        </EmptyState>
      </>
    );
  }

  const active = data.products.filter((p) => p.active);
  const low = active.filter(isLowStock);
  const out = active.filter((p) => p.trackStock && isOutOfStock(p));
  const value = active.reduce((s, p) => s + Math.max(0, stockOf(p)) * (p.costCents ?? 0), 0);
  const base = q.trim()
    ? searchProducts(data.products, q, 200)
    : [...data.products].sort((a, b) => productLabel(a).localeCompare(productLabel(b)));
  const list = base.filter((p) =>
    filter === "baixo" ? isLowStock(p) : filter === "zerado" ? p.trackStock && isOutOfStock(p) : true,
  );

  return (
    <>
      <PageHeader
        title="Estoque"
        description="Quanto tem de cada produto. As vendas no caixa baixam o estoque sozinhas."
        actions={
          <>
            {moves && (
              <Button onClick={() => dialogs.open({ kind: "stockEntry" })}>
                <IconPlus className="h-5 w-5" /> Entrada de mercadoria
              </Button>
            )}
            {manage && (
              <Button variant="secondary" onClick={() => dialogs.open({ kind: "product" })}>
                Novo produto
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => nav.setQuery({ ver: filter === "baixo" ? null : "baixo" })}
          className={cx(
            "rounded-xl border bg-white p-4 text-left",
            filter === "baixo" ? "border-primary" : "border-line",
          )}
        >
          <p className="text-sm font-semibold">Abaixo do mínimo</p>
          <p className={cx("mt-1 font-display text-2xl font-extrabold", low.length ? "text-warn" : "")}>{low.length}</p>
          <p className="text-sm text-muted">Hora de comprar</p>
        </button>
        <button
          type="button"
          onClick={() => nav.setQuery({ ver: filter === "zerado" ? null : "zerado" })}
          className={cx(
            "rounded-xl border bg-white p-4 text-left",
            filter === "zerado" ? "border-primary" : "border-line",
          )}
        >
          <p className="text-sm font-semibold">Zerados</p>
          <p className={cx("mt-1 font-display text-2xl font-extrabold", out.length ? "text-danger" : "")}>
            {out.length}
          </p>
          <p className="text-sm text-muted">Não dá para vender</p>
        </button>
        {can(me.roles, "financeiro.ver") || manage ? (
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-sm font-semibold">Valor em estoque</p>
            <p className="mt-1 font-display text-2xl font-extrabold tabular">{formatBRL(value)}</p>
            <p className="text-sm text-muted">Pelo custo de compra</p>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-white p-4">
            <p className="text-sm font-semibold">Produtos</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{active.length}</p>
          </div>
        )}
      </div>

      <div className="relative mb-4 max-w-md">
        <TextField
          label="Buscar"
          type="search"
          value={q}
          placeholder="Nome, código, código de barras ou carro"
          onChange={(e) => nav.setQuery({ busca: e.target.value || null })}
          className="pl-10"
        />
        <IconSearch className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-muted" />
      </div>

      {data.products.length === 0 ? (
        <EmptyState
          title="Nenhum produto ainda"
          action={
            manage && <Button onClick={() => dialogs.open({ kind: "product" })}>Cadastrar o primeiro produto</Button>
          }
        >
          Cadastre os produtos com preço e código. Depois, registre a entrada da mercadoria.
        </EmptyState>
      ) : list.length === 0 ? (
        <p className="text-muted">Nada encontrado.</p>
      ) : (
        <Card className="divide-y divide-line">
          {list.map((p) => (
            <ProductRow
              key={p.id}
              p={p}
              expanded={open === p.id}
              onToggle={() => setOpen((x) => (x === p.id ? null : p.id))}
              manage={manage}
              moves={moves}
              showCost={can(me.roles, "financeiro.ver") || manage}
              memberName={name}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function ProductRow({
  p,
  expanded,
  onToggle,
  manage,
  moves,
  showCost,
  memberName,
}: {
  p: Product;
  expanded: boolean;
  onToggle: () => void;
  manage: boolean;
  moves: boolean;
  showCost: boolean;
  memberName: (id: string) => string;
}) {
  const { data } = useBackend();
  const dialogs = useDialogs();
  const history = data.stockMovements
    .filter((m) => m.productId === p.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);
  const margin = marginPercent(p);
  return (
    <div className={cx("p-3", !p.active && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="min-w-0 flex-1 text-left">
          <p className="font-semibold">
            {productLabel(p)} {!p.active && <Badge tone="gray">desativado</Badge>}
          </p>
          <p className="truncate text-sm text-muted">
            {[p.sku, p.barcode].filter(Boolean).join(" · ") || "Sem código"}
            {p.fits && ` · ${p.fits}`}
          </p>
          <p className="text-sm tabular text-muted">
            {formatBRL(p.priceCents)}
            {showCost && p.costCents ? ` · custo ${formatBRL(p.costCents)}` : ""}
            {showCost && margin !== null ? ` · margem ${margin}%` : ""}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {p.trackStock ? (
            <Badge tone={isOutOfStock(p) ? "red" : isLowStock(p) ? "amber" : "green"}>
              {stockOf(p)} {stockOf(p) === 1 ? "un." : "un."}
              {(p.minStock ?? 0) > 0 && ` (mín. ${p.minStock})`}
            </Badge>
          ) : (
            <Badge tone="gray">sem controle</Badge>
          )}
          {moves && (
            <>
              <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "stockEntry", productId: p.id })}>
                Entrada
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "stockAdjust", productId: p.id })}>
                Ajustar
              </Button>
            </>
          )}
          {manage && (
            <IconButton
              label={`Editar ${productLabel(p)}`}
              onClick={() => dialogs.open({ kind: "product", productId: p.id })}
            >
              <IconEdit />
            </IconButton>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-2 rounded-lg bg-canvas p-2">
          <p className="mb-1 text-sm font-semibold">Movimentações</p>
          {history.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma movimentação ainda.</p>
          ) : (
            <ul className="grid gap-0.5 text-sm">
              {history.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2">
                  <span>
                    {formatShortDateBR(localParts(m.createdAt).date)} · {KIND_LABEL[m.kind]}
                    {m.reason && ` · ${m.reason}`} · {memberName(m.createdBy)}
                  </span>
                  <span className={cx("font-semibold tabular", m.quantity > 0 ? "text-money-700" : "text-danger")}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
