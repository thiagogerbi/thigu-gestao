"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/card";
import { IconClock, IconPlus } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { StageSelect } from "@/features/deals/stage-select";
import { addDays, formatShortDateBR, relativeDayLabel, toISODate } from "@/lib/domain/dates";
import { daysInStage, isOpenStage, staleReason } from "@/lib/domain/deals";
import { formatBRL } from "@/lib/domain/money";
import { canEditDeal } from "@/lib/domain/permissions";
import { STAGES, type Deal, type Stage } from "@/lib/domain/types";
import { useAction, useBackend, useCan, useMemberName } from "@/state/backend-context";
import { clientById, saleForDeal } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

const PERIODS = [
  { id: "", label: "Qualquer data" },
  { id: "30dias", label: "Fecham nos próximos 30 dias" },
  { id: "mes", label: "Fecham neste mês" },
  { id: "vencida", label: "Previsão já passou" },
];

export function DealsScreen() {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const nav = useNav();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec } = useAction();
  const [dragging, setDragging] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Stage | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileStage, setMobileStage] = useState<Stage | null>(null);

  const owner = nav.params.get("responsavel") ?? "";
  const stageF = (nav.params.get("etapa") ?? "") as Stage | "";
  const period = nav.params.get("periodo") ?? "";
  const onlyStale = nav.params.get("filtro") === "paradas";

  const monthEnd = (() => {
    const [y, m] = today.split("-").map(Number);
    return toISODate(new Date(y, m, 0));
  })();
  const deals = data.deals.filter((d) => {
    if (owner && d.ownerId !== owner) return false;
    if (stageF && d.stage !== stageF) return false;
    if (onlyStale && !staleReason(d, today)) return false;
    if (period) {
      if (!d.expectedClose) return false;
      if (period === "30dias" && !(d.expectedClose >= today && d.expectedClose <= addDays(today, 30))) return false;
      if (period === "mes" && !(d.expectedClose >= today.slice(0, 8) + "01" && d.expectedClose <= monthEnd))
        return false;
      if (period === "vencida" && !(d.expectedClose < today && isOpenStage(d.stage))) return false;
    }
    return true;
  });
  const columns = STAGES.filter((s) => !stageF || s.id === stageF);
  const activeFilters = [owner, stageF, period, onlyStale].filter(Boolean).length;
  const filtersOn = activeFilters > 0;
  const countIn = (stage: Stage) => deals.filter((d) => d.stage === stage).length;
  // no celular mostramos uma etapa por vez (sem rolar para o lado)
  const activeMobile =
    mobileStage && columns.some((c) => c.id === mobileStage)
      ? mobileStage
      : (columns.find((c) => countIn(c.id) > 0) ?? columns[0])?.id;

  async function moveTo(deal: Deal, stage: Stage) {
    if (deal.stage === stage || !canEditDeal(me.roles, me.userId, deal) || deal.stage === "ganha") return;
    if (stage === "ganha") return dialogs.open({ kind: "closeSale", dealId: deal.id });
    if (stage === "perdida") return dialogs.open({ kind: "lostDeal", dealId: deal.id });
    const r = await exec({ type: "deal.move", id: deal.id, stage, lostReason: null });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <>
      <PageHeader
        title="Negociações"
        description="Cada possível venda, da primeira conversa ao fechamento. Para mudar de etapa, use o campo “Etapa” no cartão."
        actions={
          canDo("crm.editar_proprios") && (
            <Button onClick={() => dialogs.open({ kind: "deal" })}>
              <IconPlus className="h-5 w-5" /> Nova negociação
            </Button>
          )
        }
      />

      <Button
        variant="secondary"
        className="mb-3 w-full sm:hidden"
        aria-expanded={showFilters}
        aria-controls="filtros-negociacoes"
        onClick={() => setShowFilters((s) => !s)}
      >
        {showFilters
          ? "Esconder filtros"
          : `Filtrar${activeFilters ? ` (${activeFilters} ativo${activeFilters > 1 ? "s" : ""})` : ""}`}
      </Button>
      <div
        id="filtros-negociacoes"
        className={cx(
          "mb-4 gap-3 rounded-xl border border-line bg-white p-3 sm:grid sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]",
          showFilters ? "grid" : "hidden",
        )}
      >
        {canDo("crm.ver_todos") && (
          <label className="text-sm">
            <span className="mb-1 block font-semibold">Responsável</span>
            <select
              value={owner}
              onChange={(e) => nav.setQuery({ responsavel: e.target.value || null })}
              className="min-h-10 w-full rounded-lg border border-[#c5cfdf] bg-white px-2"
            >
              <option value="">Todos</option>
              {data.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Etapa</span>
          <select
            value={stageF}
            onChange={(e) => nav.setQuery({ etapa: e.target.value || null })}
            className="min-h-10 w-full rounded-lg border border-[#c5cfdf] bg-white px-2"
          >
            <option value="">Todas</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Previsão de fechamento</span>
          <select
            value={period}
            onChange={(e) => nav.setQuery({ periodo: e.target.value || null })}
            className="min-h-10 w-full rounded-lg border border-[#c5cfdf] bg-white px-2"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={onlyStale}
              onChange={(e) => nav.setQuery({ filtro: e.target.checked ? "paradas" : null })}
              className="h-4 w-4 accent-[#3563E9]"
            />
            Somente paradas
          </label>
          {filtersOn && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => nav.setQuery({ responsavel: null, etapa: null, periodo: null, filtro: null })}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      </div>

      {data.deals.length === 0 ? (
        <EmptyState
          title="Nenhuma negociação ainda"
          action={
            canDo("crm.editar_proprios") && (
              <Button onClick={() => dialogs.open({ kind: "deal" })}>Adicionar negociação</Button>
            )
          }
        >
          Uma negociação representa uma possível venda. Ela passa pelas etapas até ser ganha ou perdida.
        </EmptyState>
      ) : (
        <>
          <div role="tablist" aria-label="Escolha a etapa" className="mb-3 flex flex-wrap gap-2 sm:hidden">
            {columns.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === activeMobile}
                onClick={() => setMobileStage(c.id)}
                className={cx(
                  "min-h-10 rounded-full border px-3 text-sm font-semibold",
                  c.id === activeMobile ? "border-primary bg-primary text-white" : "border-line bg-white text-ink",
                )}
              >
                {c.label} ({countIn(c.id)})
              </button>
            ))}
          </div>
          <div
            className="relative flex flex-col gap-3 sm:flex-row sm:snap-x sm:snap-mandatory sm:overflow-x-auto sm:pb-4"
            role="list"
            aria-label="Etapas das negociações"
          >
            {columns.map((col) => {
              const items = deals
                .filter((d) => d.stage === col.id)
                .sort((a, b) => (a.nextActionDate ?? "9").localeCompare(b.nextActionDate ?? "9"));
              const total = items.reduce((s, d) => s + d.valueCents, 0);
              return (
                <section
                  key={col.id}
                  role="listitem"
                  aria-labelledby={`col-${col.id}`}
                  onDragOver={(e) => {
                    if (dragging) {
                      e.preventDefault();
                      setOverCol(col.id);
                    }
                  }}
                  onDragLeave={() => setOverCol((c) => (c === col.id ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault();
                    setOverCol(null);
                    const d = data.deals.find((x) => x.id === dragging);
                    setDragging(null);
                    if (d) moveTo(d, col.id);
                  }}
                  className={cx(
                    "w-full flex-col rounded-xl border bg-[#eef2f8] p-2 sm:flex sm:w-72 sm:shrink-0 sm:snap-start",
                    col.id === activeMobile ? "flex" : "hidden",
                    overCol === col.id ? "border-primary bg-primary-50" : "border-transparent",
                  )}
                >
                  <header className="px-2 pb-2 pt-1">
                    <h2 id={`col-${col.id}`} className="flex items-center justify-between font-display font-bold">
                      {col.label}{" "}
                      <span className="rounded-full bg-white px-2 text-sm font-semibold text-muted">
                        {items.length}
                      </span>
                    </h2>
                    <p className="text-sm text-muted">{col.hint}</p>
                    <p className="text-sm font-semibold tabular text-ink">{formatBRL(total)}</p>
                  </header>
                  <ul className="grid gap-2">
                    {items.length === 0 && (
                      <li className="rounded-lg border border-dashed border-[#c5cfdf] p-3 text-center text-sm text-muted">
                        Nenhuma aqui
                      </li>
                    )}
                    {items.map((d) => {
                      const client = clientById(data, d.clientId);
                      const stale = staleReason(d, today);
                      const sale = saleForDeal(data, d.id);
                      const editable = canEditDeal(me.roles, me.userId, d) && d.stage !== "ganha";
                      return (
                        <li
                          key={d.id}
                          draggable={editable}
                          onDragStart={() => setDragging(d.id)}
                          onDragEnd={() => setDragging(null)}
                          className={cx(
                            "rounded-lg border bg-white p-3 shadow-sm",
                            stale ? "border-[#f5d9a8]" : "border-line",
                            dragging === d.id && "opacity-60",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => nav.openClient(d.clientId, d.id)}
                            className="block w-full text-left"
                          >
                            <span className="block font-semibold leading-snug hover:underline">{d.title}</span>
                            <span className="block text-sm text-muted">{client?.name}</span>
                          </button>
                          <p className="mt-1 flex items-center justify-between text-sm">
                            <strong className="tabular">{formatBRL(d.valueCents)}</strong>
                            <span className="text-muted">{name(d.ownerId).split(" ")[0]}</span>
                          </p>
                          {isOpenStage(d.stage) && (
                            <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                              <IconClock className="h-3.5 w-3.5" /> {daysInStage(d, today)}{" "}
                              {daysInStage(d, today) === 1 ? "dia" : "dias"} nesta etapa
                            </p>
                          )}
                          {d.nextAction && isOpenStage(d.stage) && (
                            <p
                              className={cx(
                                "mt-1 text-sm",
                                d.nextActionDate && d.nextActionDate < today ? "font-semibold text-danger" : "text-ink",
                              )}
                            >
                              Próxima ação: {d.nextAction}
                              {d.nextActionDate
                                ? ` · ${d.nextActionDate < today ? relativeDayLabel(d.nextActionDate, today) : formatShortDateBR(d.nextActionDate)}`
                                : ""}
                            </p>
                          )}
                          {stale && (
                            <div className="mt-2">
                              <Badge tone="amber">Parada: {stale.toLowerCase()}</Badge>
                            </div>
                          )}
                          {d.lostReason && <p className="mt-1 text-sm text-muted">Motivo: {d.lostReason}</p>}
                          {sale && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge tone={sale.status === "confirmada" ? "green" : "amber"}>
                                {sale.status === "confirmada" ? "Parcelas confirmadas" : "Parcelas a confirmar"}
                              </Badge>
                            </div>
                          )}
                          {editable && (
                            <div className="mt-2">
                              <StageSelect deal={d} compact />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
