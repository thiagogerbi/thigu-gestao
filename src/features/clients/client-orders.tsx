"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { IconPlus } from "@/components/ui/icons";
import { ClientSection } from "@/features/clients/client-section";
import { orderTone } from "@/features/orders/orders-screen";
import { PrescriptionView } from "@/features/orders/prescription-view";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { ORDER_STAGE_LABEL } from "@/lib/domain/orders";
import { useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useOrders } from "@/state/use-orders";
import Link from "next/link";

/** Pedidos do cliente na ficha. */
export function ClientOrders({ clientId }: { clientId: string }) {
  const { data } = useBackend();
  const od = useOrders();
  const nav = useNav();
  const dialogs = useDialogs();
  const list = data.orders.filter((o) => o.clientId === clientId).sort((a, b) => b.number - a.number);
  const open = list.filter((o) => o.stage !== "entregue" && o.stage !== "cancelado").length;
  return (
    <ClientSection
      title="Pedidos"
      collapsible
      defaultOpen
      count={open}
      action={
        od.canEdit && (
          <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "orderNew", clientId })}>
            <IconPlus className="h-4 w-4" /> Novo pedido
          </Button>
        )
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">Nenhum pedido ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 8).map((o) => (
            <li key={o.id}>
              <Link
                href={nav.href(`/pedidos/${o.id}`)}
                className="flex items-center justify-between gap-2 py-2 hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    Nº {o.number} · {o.title}
                  </span>
                  <span className="text-sm text-muted">Prometido para {formatShortDateBR(o.promisedOn)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={orderTone(o.stage)} className="text-xs">
                    {ORDER_STAGE_LABEL[o.stage]}
                  </Badge>
                  <span className="text-sm tabular">{formatBRL(o.totalCents)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ClientSection>
  );
}

/** Receitas de óculos do cliente (dado de saúde: só quem atende vê). */
export function ClientPrescriptions({ clientId }: { clientId: string }) {
  const { data, today } = useBackend();
  const dialogs = useDialogs();
  const list = data.prescriptions
    .filter((p) => p.clientId === clientId)
    .sort((a, b) => b.examinedOn.localeCompare(a.examinedOn));
  return (
    <ClientSection
      title="Receitas de óculos"
      collapsible
      defaultOpen
      count={list.length}
      action={
        <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "prescription", clientId })}>
          <IconPlus className="h-4 w-4" /> Lançar receita
        </Button>
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma receita lançada.</p>
      ) : (
        <div className="grid gap-2">
          {list.slice(0, 3).map((p) => (
            <PrescriptionView key={p.id} p={p} today={today} />
          ))}
          {list.length > 3 && <p className="text-sm text-muted">e mais {list.length - 3} receitas antigas</p>}
        </div>
      )}
    </ClientSection>
  );
}
