"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { PlateBadge } from "@/features/workshop/plate-badge";
import { localParts } from "@/lib/domain/agenda";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { whatsappUrl } from "@/lib/domain/phone";
import type { WorkOrder } from "@/lib/domain/types";
import {
  isLate,
  normalizePlate,
  revisionMessage,
  revisionsDue,
  WO_STAGE_LABEL,
  WO_STAGES,
  YARD_STAGES,
} from "@/lib/domain/work-orders";
import { useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useWorkshop } from "@/state/use-workshop";
import Link from "next/link";

/**
 * Quadro do pátio: cada carro numa coluna da etapa em que está. O mecânico vê só as OS dele.
 * Busca por placa, cliente ou número; revisões chegando com lembrete pelo WhatsApp.
 */
export function YardScreen() {
  const { data, today } = useBackend();
  const ws = useWorkshop();
  const nav = useNav();
  const dialogs = useDialogs();
  const search = nav.params.get("busca") ?? "";

  if (!ws.enabled) {
    return (
      <>
        <PageHeader title="Oficina" />
        <EmptyState title="Página indisponível">
          A oficina existe para empresas de serviço automotivo (mecânica, funilaria, auto elétrica, lava-rápido). O
          mecânico vê as OS ligadas a ele.
        </EmptyState>
      </>
    );
  }

  const open = data.workOrders.filter((w) => w.stage !== "entregue" && w.stage !== "cancelada");
  const q = search.trim().toLowerCase();
  const qPlate = normalizePlate(search);
  const results = q
    ? data.workOrders
        .filter(
          (w) =>
            String(w.number) === q.replace(/^n?º?\s*/, "") ||
            (qPlate.length >= 3 && (ws.vehicle(w)?.plate ?? "").includes(qPlate)) ||
            (ws.client(w)?.name ?? "").toLowerCase().includes(q) ||
            ws.vehicleName(w).toLowerCase().includes(q),
        )
        .sort((a, b) => b.number - a.number)
    : [];
  const delivered = data.workOrders
    .filter((w) => w.stage === "entregue")
    .sort((a, b) => (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? ""))
    .slice(0, 8);
  const revisions = ws.seesAll ? revisionsDue(data.workOrders, today) : [];

  return (
    <>
      <PageHeader
        title="Oficina"
        description={
          ws.seesAll
            ? `${open.length} ${open.length === 1 ? "carro" : "carros"} no pátio. Toque numa OS para ver o orçamento, as fotos e mudar a etapa.`
            : "As ordens de serviço ligadas a você."
        }
        actions={
          ws.canEdit && (
            <Button onClick={() => dialogs.open({ kind: "workOrderNew" })}>
              <IconPlus className="h-5 w-5" /> Nova OS
            </Button>
          )
        }
      />

      <div className="relative mb-5 max-w-md">
        <TextField
          label="Buscar"
          type="search"
          value={search}
          placeholder="Placa, cliente, modelo ou nº da OS"
          onChange={(e) => nav.setQuery({ busca: e.target.value || null })}
          className="pl-10"
        />
        <IconSearch className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-muted" />
      </div>

      {q ? (
        <section aria-labelledby="resultado">
          <h2 id="resultado" className="mb-2 font-display text-lg font-bold">
            {results.length} {results.length === 1 ? "OS encontrada" : "OS encontradas"}
          </h2>
          {results.length === 0 ? (
            <p className="text-muted">Nada com “{search}”. Confira a placa ou procure pelo nome do cliente.</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {results.map((w) => (
                <WorkOrderCard key={w.id} w={w} showStage />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {open.length === 0 ? (
            <EmptyState
              title="Pátio vazio"
              action={
                ws.canEdit && (
                  <Button onClick={() => dialogs.open({ kind: "workOrderNew" })}>
                    <IconPlus className="h-5 w-5" /> Abrir a primeira OS
                  </Button>
                )
              }
            >
              {ws.canEdit
                ? "Quando um carro chegar, abra a OS com a reclamação do cliente, a quilometragem e as fotos."
                : "Nenhuma OS ligada a você no momento."}
            </EmptyState>
          ) : (
            <div
              className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-3 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0"
              aria-label="Quadro do pátio"
            >
              {YARD_STAGES.map((stage) => {
                const list = open.filter((w) => w.stage === stage).sort((a, b) => a.number - b.number);
                return (
                  <section
                    key={stage}
                    aria-labelledby={`etapa-${stage}`}
                    className="w-[80vw] max-w-xs shrink-0 snap-start rounded-2xl bg-canvas p-2 md:w-auto md:max-w-none"
                  >
                    <h2 id={`etapa-${stage}`} className="mb-2 flex items-center justify-between px-1 text-sm font-bold">
                      {WO_STAGE_LABEL[stage]}
                      <span className="rounded-full bg-white px-2 text-muted">{list.length}</span>
                    </h2>
                    {list.length === 0 ? (
                      <p className="px-1 pb-2 text-sm text-muted">Nenhum carro.</p>
                    ) : (
                      <ul className="grid gap-2">
                        {list.map((w) => (
                          <WorkOrderCard key={w.id} w={w} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {revisions.length > 0 && (
              <Card className="p-4" aria-labelledby="revisoes">
                <h2 id="revisoes" className="font-display text-lg font-bold">
                  Revisões chegando
                </h2>
                <p className="mb-3 text-sm text-muted">Clientes para lembrar pelo WhatsApp (próximos 30 dias).</p>
                <ul className="divide-y divide-line">
                  {revisions.map(({ workOrder: w, days }) => {
                    const c = ws.client(w);
                    const url =
                      c &&
                      whatsappUrl(
                        c.phone,
                        revisionMessage({
                          clientName: c.name,
                          companyName: data.company.name,
                          model: ws.vehicleName(w),
                          plate: ws.vehicle(w)?.plate,
                          note: w.nextServiceNote,
                        }),
                      );
                    return (
                      <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            <PlateBadge plate={ws.plate(w)} className="mr-2" />
                            {c?.name ?? "—"}
                          </p>
                          <p className="text-sm text-muted">
                            {w.nextServiceNote || "Revisão"} ·{" "}
                            {days < 0 ? `venceu há ${-days} dias` : days === 0 ? "hoje" : `em ${days} dias`} (
                            {formatShortDateBR(w.nextServiceOn!)})
                          </p>
                        </div>
                        {url ? (
                          <a
                            href={url}
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
              <Card className="p-4" aria-labelledby="entregues">
                <h2 id="entregues" className="mb-3 font-display text-lg font-bold">
                  Entregues recentemente
                </h2>
                <ul className="divide-y divide-line">
                  {delivered.map((w) => (
                    <li key={w.id}>
                      <Link
                        href={nav.href(`/oficina/${w.id}`)}
                        className="flex items-center justify-between gap-2 py-2.5 hover:bg-canvas"
                      >
                        <span className="min-w-0">
                          <span className="font-semibold">
                            Nº {w.number} · <PlateBadge plate={ws.plate(w)} /> {ws.vehicleName(w)}
                          </span>
                          <span className="block text-sm text-muted">
                            {ws.client(w)?.name} · {formatShortDateBR(localParts(w.deliveredAt!).date)}
                          </span>
                        </span>
                        <span className="font-semibold tabular">{formatBRL(w.totalCents ?? 0)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}

const STAGE_TONE: Record<WorkOrder["stage"], "neutral" | "blue" | "amber" | "green" | "gray" | "red" | "navy"> = {
  orcamento: "neutral",
  aprovacao: "amber",
  peca: "amber",
  servico: "blue",
  pronto: "green",
  entregue: "gray",
  cancelada: "red",
};

export const stageTone = (s: WorkOrder["stage"]) => STAGE_TONE[s];
export const stageShort = (s: WorkOrder["stage"]) => WO_STAGES.find((x) => x.id === s)!.short;

function WorkOrderCard({ w, showStage = false }: { w: WorkOrder; showStage?: boolean }) {
  const { today } = useBackend();
  const ws = useWorkshop();
  const nav = useNav();
  const late = isLate(w, today);
  const t = ws.totalsFor(w);
  const pending = ws.itemsFor(w).some((i) => i.status === "pendente");
  return (
    <li>
      <Link
        href={nav.href(`/oficina/${w.id}`)}
        className={cx(
          "block rounded-xl border bg-white p-3 shadow-card hover:border-primary",
          late ? "border-danger/60" : "border-line",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <PlateBadge plate={ws.plate(w)} />
          <span className="text-sm text-muted">Nº {w.number}</span>
        </div>
        <p className="mt-1.5 font-semibold leading-tight">{ws.vehicleName(w)}</p>
        <p className="truncate text-sm text-muted">{ws.client(w)?.name ?? "—"}</p>
        <p className="truncate text-sm text-muted">{ws.mechanicName(w)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showStage && <Badge tone={stageTone(w.stage)}>{stageShort(w.stage)}</Badge>}
          {late && <Badge tone="red">Atrasada</Badge>}
          {!late && w.promisedOn && w.stage !== "pronto" && (
            <span className="text-sm text-muted">
              Entrega {w.promisedOn === today ? "hoje" : formatShortDateBR(w.promisedOn)}
            </span>
          )}
          {pending && w.stage !== "orcamento" && w.stage !== "aprovacao" && (
            <Badge tone="amber">Item novo a aprovar</Badge>
          )}
          {t.total > 0 && <span className="ml-auto text-sm font-semibold tabular">{formatBRL(t.total)}</span>}
        </div>
      </Link>
    </li>
  );
}
