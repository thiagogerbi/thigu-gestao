"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { localParts } from "@/lib/domain/agenda";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import {
  BOARD_STAGES,
  dueLabel,
  examMessage,
  examsDue,
  isLateOrder,
  ORDER_STAGE_LABEL,
  orderRest,
} from "@/lib/domain/orders";
import { whatsappUrl } from "@/lib/domain/phone";
import type { Order } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useOrders } from "@/state/use-orders";
import Link from "next/link";

/** Quadro de pedidos com prazo: cada pedido na etapa em que está, com a data prometida à vista. */
export function OrdersScreen() {
  const { data, today } = useBackend();
  const od = useOrders();
  const nav = useNav();
  const dialogs = useDialogs();
  const search = nav.params.get("busca") ?? "";

  if (!od.enabled) {
    return (
      <>
        <PageHeader title="Pedidos" />
        <EmptyState title="Página indisponível">
          Os pedidos com prazo existem para óticas, costura, lavanderia e gráficas. O técnico vê os pedidos ligados a
          ele.
        </EmptyState>
      </>
    );
  }

  const open = data.orders.filter((o) => o.stage !== "entregue" && o.stage !== "cancelado");
  const late = open.filter((o) => isLateOrder(o, today));
  const q = search.trim().toLowerCase();
  const results = q
    ? data.orders
        .filter(
          (o) =>
            String(o.number) === q.replace(/^n?º?\s*/, "") ||
            o.title.toLowerCase().includes(q) ||
            (od.client(o)?.name ?? "").toLowerCase().includes(q),
        )
        .sort((a, b) => b.number - a.number)
    : [];
  const delivered = data.orders
    .filter((o) => o.stage === "entregue")
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""))
    .slice(0, 6);
  const exams = od.readsRx ? examsDue(data.prescriptions, today) : [];

  return (
    <>
      <PageHeader
        title="Pedidos"
        description={
          od.seesAll
            ? `${open.length} em andamento${late.length ? `, ${late.length} atrasado${late.length > 1 ? "s" : ""}` : ""}.`
            : "Os pedidos ligados a você."
        }
        actions={
          od.canEdit && (
            <Button onClick={() => dialogs.open({ kind: "orderNew" })}>
              <IconPlus className="h-5 w-5" /> Novo pedido
            </Button>
          )
        }
      />

      <div className="relative mb-5 max-w-md">
        <TextField
          label="Buscar"
          type="search"
          value={search}
          placeholder="Cliente, o que é ou nº do pedido"
          onChange={(e) => nav.setQuery({ busca: e.target.value || null })}
          className="pl-10"
        />
        <IconSearch className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-muted" />
      </div>

      {q ? (
        <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {results.length === 0 ? (
            <p className="text-muted">Nada com “{search}”.</p>
          ) : (
            results.map((o) => <OrderCard key={o.id} o={o} showStage />)
          )}
        </ul>
      ) : open.length === 0 ? (
        <EmptyState
          title="Nenhum pedido em andamento"
          action={
            od.canEdit && <Button onClick={() => dialogs.open({ kind: "orderNew" })}>Abrir o primeiro pedido</Button>
          }
        >
          Abra o pedido com o que será feito, a data prometida e o sinal, se houver.
        </EmptyState>
      ) : (
        <div
          className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0"
          aria-label="Quadro de pedidos"
        >
          {BOARD_STAGES.map((stage) => {
            const list = open.filter((o) => o.stage === stage).sort((a, b) => a.promisedOn.localeCompare(b.promisedOn));
            return (
              <section
                key={stage}
                aria-labelledby={`pedidos-${stage}`}
                className="w-[80vw] max-w-xs shrink-0 snap-start rounded-2xl bg-canvas p-2 md:w-auto md:max-w-none"
              >
                <h2 id={`pedidos-${stage}`} className="mb-2 flex items-center justify-between px-1 text-sm font-bold">
                  {ORDER_STAGE_LABEL[stage]}
                  <span className="rounded-full bg-white px-2 text-muted">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <p className="px-1 pb-2 text-sm text-muted">Nenhum.</p>
                ) : (
                  <ul className="grid gap-2">
                    {list.map((o) => (
                      <OrderCard key={o.id} o={o} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {exams.length > 0 && (
          <Card className="p-4" aria-labelledby="exames">
            <h2 id="exames" className="font-display text-lg font-bold">
              Receitas vencendo
            </h2>
            <p className="mb-3 text-sm text-muted">
              Hora do exame de vista anual. Um lembrete costuma virar óculos novos.
            </p>
            <ul className="divide-y divide-line">
              {exams.map(({ prescription: p, days }) => {
                const c = data.clients.find((x) => x.id === p.clientId);
                const wa =
                  c &&
                  whatsappUrl(
                    c.phone,
                    examMessage({ clientName: c.name, companyName: data.company.name, expired: days < 0 }),
                  );
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">{c?.name ?? "—"}</p>
                      <p className="text-sm text-muted">
                        {days < 0 ? `Venceu há ${-days} dias` : days === 0 ? "Vence hoje" : `Vence em ${days} dias`} (
                        {formatShortDateBR(p.validUntil)})
                      </p>
                    </div>
                    {wa ? (
                      <a
                        href={wa}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex min-h-11 items-center rounded-lg border border-[#bfe8d8] bg-money-50 px-3 text-sm font-semibold text-money-700 sm:min-h-9"
                      >
                        Lembrar pelo WhatsApp
                      </a>
                    ) : (
                      <span className="text-sm text-muted">Sem celular com DDD</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
        {delivered.length > 0 && (
          <Card className="p-4" aria-labelledby="entregues-pedidos">
            <h2 id="entregues-pedidos" className="mb-3 font-display text-lg font-bold">
              Entregues recentemente
            </h2>
            <ul className="divide-y divide-line">
              {delivered.map((o) => (
                <li key={o.id}>
                  <Link
                    href={nav.href(`/pedidos/${o.id}`)}
                    className="flex items-center justify-between gap-2 py-2.5 hover:bg-canvas"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold">
                        Nº {o.number} · {o.title}
                      </span>
                      <span className="block text-sm text-muted">
                        {od.client(o)?.name} · {formatShortDateBR(localParts(o.deliveredAt!).date)}
                      </span>
                    </span>
                    <span className="font-semibold tabular">{formatBRL(o.totalCents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

const TONE: Record<Order["stage"], "neutral" | "blue" | "amber" | "green" | "gray" | "red"> = {
  recebido: "neutral",
  producao: "blue",
  terceiro: "amber",
  pronto: "green",
  entregue: "gray",
  cancelado: "red",
};
export const orderTone = (s: Order["stage"]) => TONE[s];

function OrderCard({ o, showStage = false }: { o: Order; showStage?: boolean }) {
  const { today } = useBackend();
  const od = useOrders();
  const nav = useNav();
  const late = isLateOrder(o, today);
  const rest = orderRest(o);
  return (
    <li>
      <Link
        href={nav.href(`/pedidos/${o.id}`)}
        className={cx(
          "block rounded-xl border bg-white p-3 shadow-card hover:border-primary",
          late ? "border-danger/60" : "border-line",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-tight">{o.title}</p>
          <span className="shrink-0 text-sm text-muted">Nº {o.number}</span>
        </div>
        <p className="truncate text-sm text-muted">{od.client(o)?.name ?? "—"}</p>
        <p className="truncate text-sm text-muted">{od.technician(o)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showStage && <Badge tone={orderTone(o.stage)}>{ORDER_STAGE_LABEL[o.stage]}</Badge>}
          {o.stage !== "entregue" && o.stage !== "cancelado" && o.stage !== "pronto" && (
            <Badge tone={late ? "red" : "neutral"}>Entrega {dueLabel(o.promisedOn, today)}</Badge>
          )}
          {o.stage !== "entregue" && o.stage !== "cancelado" && rest > 0 && (
            <span className="ml-auto text-sm tabular">
              falta <span className="font-semibold">{formatBRL(rest)}</span>
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
