"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, InlineAlert, PageHeader } from "@/components/ui/card";
import { IconArrowLeft } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { orderTone } from "@/features/orders/orders-screen";
import { PrescriptionView } from "@/features/orders/prescription-view";
import { localParts } from "@/lib/domain/agenda";
import { formatDateBR, formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import {
  BOARD_STAGES,
  dueLabel,
  isLateOrder,
  isOpenOrder,
  ORDER_STAGE_LABEL,
  orderReadyMessage,
  orderRest,
} from "@/lib/domain/orders";
import { whatsappUrl } from "@/lib/domain/phone";
import { useAction, useBackend, useMemberName } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useOrders } from "@/state/use-orders";

/** Ficha do pedido: o que será feito, itens, valores, receita, etapa, entrega e a linha do tempo. */
export function OrderScreen({ orderId }: { orderId: string }) {
  const { data, today } = useBackend();
  const od = useOrders();
  const nav = useNav();
  const dialogs = useDialogs();
  const toast = useToast();
  const name = useMemberName();
  const { exec, pending } = useAction();
  const o = data.orders.find((x) => x.id === orderId);

  if (!od.enabled || !o) {
    return (
      <>
        <PageHeader title="Pedido" />
        <EmptyState
          title="Pedido não encontrado"
          action={<LinkButton href={nav.href("/pedidos")}>Voltar para os pedidos</LinkButton>}
        >
          Ele pode ser de outra empresa, ou não está ligado a você.
        </EmptyState>
      </>
    );
  }

  const client = od.client(o);
  const items = od.itemsOf(o);
  const open = isOpenOrder(o);
  const rest = orderRest(o);
  const rx = o.prescriptionId ? data.prescriptions.find((p) => p.id === o.prescriptionId) : undefined;
  const events = data.orderEvents
    .filter((e) => e.orderId === o.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // pedido cancelado não tem mais nada a pagar; a linha do tempo diz se o sinal voltou para o cliente
  const refunded = o.stage === "cancelado" && events.some((e) => e.description.includes("(sinal devolvido)"));
  const stages = BOARD_STAGES.filter((s) => s === o.stage || od.canMoveTo(o, s));
  const readyWa =
    client &&
    whatsappUrl(
      client.phone,
      orderReadyMessage({ clientName: client.name, companyName: data.company.name, title: o.title, number: o.number }),
    );

  return (
    <>
      <div className="mb-2">
        <LinkButton href={nav.href("/pedidos")} variant="ghost" size="sm" className="-ml-3">
          <IconArrowLeft className="h-4 w-4" /> Pedidos
        </LinkButton>
      </div>
      <PageHeader
        title={`Pedido nº ${o.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{o.title}</span>
            {client && (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => nav.openClient(client.id)}
              >
                {client.name}
              </button>
            )}
            <span>· {od.technician(o)}</span>
          </span>
        }
        actions={
          <>
            {o.stage === "pronto" && readyWa && (
              <a
                href={readyWa}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfe8d8] bg-money-50 px-4 text-[15px] font-semibold text-money-700"
              >
                Avisar que está pronto
              </a>
            )}
            {open && od.canDeliver && (
              <Button variant="money" onClick={() => dialogs.open({ kind: "orderDeliver", orderId: o.id })}>
                Entregar{rest > 0 ? " e cobrar" : ""}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={orderTone(o.stage)}>{ORDER_STAGE_LABEL[o.stage]}</Badge>
        {open && o.stage !== "pronto" && (
          <Badge tone={isLateOrder(o, today) ? "red" : "neutral"}>
            Prometido para {formatShortDateBR(o.promisedOn)} ({dueLabel(o.promisedOn, today)})
          </Badge>
        )}
        {open && stages.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
            Mudar etapa
            <select
              value={o.stage}
              disabled={pending}
              onChange={async (e) => {
                const r = await exec({
                  type: "order.move",
                  id: o.id,
                  stage: e.target.value as (typeof BOARD_STAGES)[number],
                });
                toast({ tone: r.ok ? "success" : "error", text: r.message });
              }}
              className="min-h-10 rounded-lg border border-[#c5cfdf] bg-white px-2 font-normal"
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {o.stage === "cancelado" && (
        <div className="mb-5">
          <InlineAlert title="Pedido cancelado">{o.cancelReason}</InlineAlert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <Card className="p-4" aria-labelledby="itens-pedido">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="itens-pedido" className="font-display text-lg font-bold">
                O que será feito
              </h2>
              {open && od.canEdit && (
                <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "orderEdit", orderId: o.id })}>
                  Editar
                </Button>
              )}
            </div>
            {o.details && <p className="mb-3 whitespace-pre-line text-sm">{o.details}</p>}
            <ul className="divide-y divide-line">
              {items.map((i) => (
                <li key={i.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {i.quantity > 1 && <span className="tabular">{i.quantity} × </span>}
                    {i.description}
                  </span>
                  <span className="font-semibold tabular">{formatBRL(i.quantity * i.unitCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 grid gap-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between font-bold">
                <dt>Total</dt>
                <dd className="tabular">{formatBRL(o.totalCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>{refunded ? "Sinal pago e devolvido" : "Sinal pago"}</dt>
                <dd className={cx("tabular", refunded ? "text-muted line-through" : "text-money-700")}>
                  {formatBRL(o.downCents)}
                </dd>
              </div>
              {o.stage !== "cancelado" && (
                <div className="flex justify-between">
                  <dt>{o.stage === "entregue" ? "Restante (na entrega)" : "Falta pagar"}</dt>
                  <dd className="tabular font-semibold">{formatBRL(rest)}</dd>
                </div>
              )}
            </dl>
          </Card>

          {o.prescriptionId && (
            <Card className="p-4" aria-labelledby="receita-pedido">
              <h2 id="receita-pedido" className="mb-2 font-display text-lg font-bold">
                Receita usada
              </h2>
              {od.readsRx && rx ? (
                <PrescriptionView p={rx} today={today} />
              ) : (
                <p className="text-sm text-muted">Só quem atende vê a receita (dado de saúde).</p>
              )}
            </Card>
          )}
        </div>

        <div className="grid content-start gap-6">
          <Card className="p-4" aria-labelledby="linha-pedido">
            <h2 id="linha-pedido" className="mb-2 font-display text-lg font-bold">
              Linha do tempo
            </h2>
            <ol className="grid gap-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <p>{e.description}</p>
                  <p className="text-muted">
                    {formatShortDateBR(localParts(e.createdAt).date)} {localParts(e.createdAt).time}
                    {e.actorId && ` · ${name(e.actorId)}`}
                  </p>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-sm text-muted">
              Aberto em {formatDateBR(o.createdAt)} por {name(o.createdBy)}.
            </p>
          </Card>
          {open && od.canEdit && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => dialogs.open({ kind: "orderCancel", orderId: o.id })}
            >
              Cancelar este pedido
            </Button>
          )}
          {!od.canEdit && od.isMine(o) && open && (
            <p className="text-sm text-muted">
              Você é o técnico deste pedido: mude entre em produção, no laboratório e pronto.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
