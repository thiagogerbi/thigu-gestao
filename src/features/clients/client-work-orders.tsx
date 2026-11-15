"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { IconPlus } from "@/components/ui/icons";
import { ClientSection } from "@/features/clients/client-section";
import { PlateBadge } from "@/features/workshop/plate-badge";
import { stageShort, stageTone } from "@/features/workshop/yard-screen";
import { localParts } from "@/lib/domain/agenda";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useWorkshop } from "@/state/use-workshop";
import Link from "next/link";

/** Serviços na oficina: todas as OS dos veículos deste cliente (o histórico fica com a placa). */
export function ClientWorkOrders({ clientId }: { clientId: string }) {
  const { data } = useBackend();
  const ws = useWorkshop();
  const nav = useNav();
  const dialogs = useDialogs();
  const vehicleIds = new Set(
    data.items.filter((i) => i.clientId === clientId && i.kind === "veiculo").map((i) => i.id),
  );
  // OS deste cliente e as dos carros dele que vieram com o dono anterior
  const list = data.workOrders
    .filter((w) => w.clientId === clientId || vehicleIds.has(w.itemId))
    .sort((a, b) => b.number - a.number);
  const open = list.filter((w) => w.stage !== "entregue" && w.stage !== "cancelada").length;

  return (
    <ClientSection
      title="Oficina"
      collapsible
      defaultOpen
      count={open}
      action={
        ws.canEdit && (
          <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "workOrderNew", clientId })}>
            <IconPlus className="h-4 w-4" /> Nova OS
          </Button>
        )
      }
    >
      {list.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma ordem de serviço ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.slice(0, 10).map((w) => (
            <li key={w.id}>
              <Link
                href={nav.href(`/oficina/${w.id}`)}
                className="flex items-center justify-between gap-2 py-2 hover:bg-canvas"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    Nº {w.number} <PlateBadge plate={ws.plate(w)} /> {ws.vehicleName(w)}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {formatShortDateBR(localParts(w.createdAt).date)} · {w.complaint || "Sem descrição"}
                    {w.clientId !== clientId && " · com o dono anterior"}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={stageTone(w.stage)} className="text-xs">
                    {stageShort(w.stage)}
                  </Badge>
                  {w.totalCents !== null && <span className="text-sm tabular">{formatBRL(w.totalCents)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ClientSection>
  );
}
