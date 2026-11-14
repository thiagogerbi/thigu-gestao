"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconClock, IconPlus, IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { cx } from "@/components/ui/styles";
import { AppointmentCard } from "@/features/agenda/appointment-card";
import { RemindersPanel } from "@/features/agenda/reminders-panel";
import { fromLocal, localParts } from "@/lib/domain/agenda";
import { addDays, isISODate } from "@/lib/domain/dates";
import { blocksFor, hasHours } from "@/lib/domain/hours";
import type { Resource, ResourceBlock } from "@/lib/domain/types";
import { can } from "@/lib/domain/permissions";
import { useAction, useBackend } from "@/state/backend-context";
import { useAgenda } from "@/state/use-agenda";
import { useNav } from "@/state/use-nav";

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "sábado, 14 de novembro" */
function longDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${WEEKDAYS[dt.getDay()]}, ${d} de ${MONTHS[m - 1]}`;
}

const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

/** "Atende 08:00–12:00 e 13:00–19:00" ou "Não atende neste dia" (só quando a agenda tem horário definido). */
function hoursOfDay(r: Resource, day: string): string | null {
  if (!hasHours(r.workHours)) return null;
  const list = r.workHours[String(weekdayOf(day)) as keyof Resource["workHours"]] ?? [];
  return list.length ? `Atende ${list.map(([a, b]) => `${a}–${b}`).join(" e ")}` : "Não atende neste dia";
}

/** Bloqueios que pegam o dia, com o trecho daquele dia ("Dia todo" ou "12:00–14:00"). */
function blocksOnDay(blocks: readonly ResourceBlock[], resourceId: string, day: string) {
  const startsAt = fromLocal(day, "00:00");
  const endsAt = fromLocal(addDays(day, 1), "00:00");
  return blocksFor(blocks, { resourceId, startsAt, endsAt }).map((b) => {
    const whole = new Date(b.startsAt) <= new Date(startsAt) && new Date(b.endsAt) >= new Date(endsAt);
    const from = new Date(b.startsAt) <= new Date(startsAt) ? "00:00" : localParts(b.startsAt).time;
    const to = new Date(b.endsAt) >= new Date(endsAt) ? "00:00" : localParts(b.endsAt).time;
    return { block: b, label: whole ? "Dia todo" : `${from}–${to}` };
  });
}

/** Faixa de um bloqueio, com botão de tirar para quem cuida da agenda. */
function BlockRow({ label, block, canRemove }: { label: string; block: ResourceBlock; canRemove: boolean }) {
  const { exec, pending } = useAction();
  const toast = useToast();
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[#c5cfdf] bg-canvas px-3 py-1.5 text-sm">
      <span>
        <span className="font-semibold">Bloqueado · {label}</span>
        {block.reason && <span className="text-muted"> · {block.reason}</span>}
      </span>
      {canRemove && (
        <button
          type="button"
          disabled={pending}
          aria-label={`Tirar o bloqueio ${label}`}
          title="Tirar o bloqueio"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white hover:text-ink"
          onClick={async () => {
            const r = await exec({ type: "block.delete", id: block.id });
            toast({ tone: r.ok ? "success" : "error", text: r.message });
          }}
        >
          <IconX className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/**
 * Agenda: o dia, com uma coluna por pessoa que atende, ou os próximos 7 dias em lista.
 * Dia, visão e filtro ficam no endereço (?dia=…&ver=semana&quem=…), para voltar ao mesmo lugar.
 */
export function AgendaScreen() {
  const { data, me, today } = useBackend();
  const ag = useAgenda();
  const nav = useNav();
  const dialogs = useDialogs();
  const dayParam = nav.params.get("dia");
  const day = dayParam && isISODate(dayParam) ? dayParam : today;
  const week = nav.params.get("ver") === "semana";
  const who = nav.params.get("quem") ?? "";
  const configure = can(me.roles, "agenda.configurar");

  if (!ag.enabled) {
    return (
      <>
        <PageHeader title="Agenda" />
        <EmptyState title="A agenda não está disponível">
          A agenda existe para empresas com atendimento marcado (clínicas, salões, pet shops e aulas) e para quem atende
          ou marca horários.
        </EmptyState>
      </>
    );
  }

  // colunas: agendas que a pessoa vê (todas, ou só as dela), menos as desativadas sem horário no dia
  const visibleResources = data.resources.filter(
    (r) => (r.active || data.appointments.some((a) => a.resourceId === r.id)) && (!who || r.id === who),
  );
  const columns = visibleResources.filter(
    (r) => data.appointments.some((a) => a.resourceId === r.id) || ag.manageable.some((m) => m.id === r.id),
  );
  const shown = (resourceId: string) => columns.some((c) => c.id === resourceId);
  const dayList = ag.onDay(day).filter((a) => shown(a.resourceId));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(day, i));
  const dayBlocks = (resourceId: string) => blocksOnDay(data.blocks, resourceId, day);
  const goTo = (d: string | null) => nav.setQuery({ dia: d === today ? null : d });

  return (
    <>
      <PageHeader
        title="Agenda"
        description={
          day === today ? `Hoje, ${longDate(day)}.` : `${longDate(day).replace(/^./, (c) => c.toUpperCase())}.`
        }
        actions={
          <>
            {ag.manageable.length > 0 && (
              <Button onClick={() => dialogs.open({ kind: "appointment", date: day, resourceId: who || undefined })}>
                <IconPlus className="h-5 w-5" /> Marcar horário
              </Button>
            )}
            {configure && (
              <LinkButton href={nav.href("/servicos")} variant="secondary">
                Serviços e equipe
              </LinkButton>
            )}
          </>
        }
      />

      {data.resources.length === 0 ? (
        <EmptyState
          title="Ninguém atendendo ainda"
          action={
            configure && <LinkButton href={nav.href("/servicos")}>Cadastrar quem atende e os serviços</LinkButton>
          }
        >
          {configure
            ? "Para usar a agenda, cadastre primeiro quem atende (uma agenda por pessoa ou sala) e os serviços."
            : "O administrador ainda não cadastrou quem atende. Peça para ele abrir “Serviços e equipe”."}
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="flex gap-1" role="group" aria-label="Mudar o dia">
              <Button variant="secondary" size="sm" onClick={() => goTo(addDays(day, week ? -7 : -1))}>
                ‹ {week ? "Semana anterior" : "Dia anterior"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => goTo(today)} disabled={day === today}>
                Hoje
              </Button>
              <Button variant="secondary" size="sm" onClick={() => goTo(addDays(day, week ? 7 : 1))}>
                {week ? "Próxima semana" : "Próximo dia"} ›
              </Button>
            </div>
            <TextField
              label="Ir para o dia"
              type="date"
              value={day}
              onChange={(e) => isISODate(e.target.value) && goTo(e.target.value)}
              wrapperClassName="w-44"
              className="min-h-9"
            />
            <div className="flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Como ver">
              {[
                { id: false, label: "Dia" },
                { id: true, label: "7 dias" },
              ].map((v) => (
                <button
                  key={v.label}
                  type="button"
                  aria-pressed={week === v.id}
                  onClick={() => nav.setQuery({ ver: v.id ? "semana" : null })}
                  className={cx(
                    "min-h-9 rounded-md px-3 text-sm font-semibold",
                    week === v.id ? "bg-primary text-white" : "text-muted hover:bg-canvas",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {can(me.roles, "agenda.todas") && data.resources.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-sm font-semibold">Quem atende</span>
                <select
                  value={who}
                  onChange={(e) => nav.setQuery({ quem: e.target.value || null })}
                  className="min-h-9 rounded-lg border border-[#c5cfdf] bg-white px-2"
                >
                  <option value="">Todos</option>
                  {data.resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {!week && day === today && <RemindersPanel />}

          {week ? (
            <div className="grid gap-5">
              {weekDays.map((d) => {
                const list = ag.onDay(d).filter((a) => shown(a.resourceId));
                return (
                  <section key={d} aria-labelledby={`dia-${d}`}>
                    <h2 id={`dia-${d}`} className="mb-2 font-display text-base font-bold first-letter:uppercase">
                      {d === today ? "Hoje" : longDate(d)}
                      <span className="ml-2 text-sm font-semibold text-muted">
                        {list.filter((a) => a.status !== "cancelado").length || "nenhum"}{" "}
                        {list.filter((a) => a.status !== "cancelado").length === 1 ? "horário" : "horários"}
                      </span>
                    </h2>
                    {columns.some((r) => blocksOnDay(data.blocks, r.id, d).length > 0) && (
                      <ul className="mb-2 grid gap-1 md:grid-cols-2 xl:grid-cols-3">
                        {columns.flatMap((r) =>
                          blocksOnDay(data.blocks, r.id, d).map((b) => (
                            <BlockRow
                              key={b.block.id}
                              block={b.block}
                              label={columns.length > 1 ? `${r.name}, ${b.label.toLowerCase()}` : b.label}
                              canRemove={ag.manageable.some((m) => m.id === r.id)}
                            />
                          )),
                        )}
                      </ul>
                    )}
                    {list.length === 0 ? (
                      <p className="text-sm text-muted">Livre.</p>
                    ) : (
                      <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                        {list.map((a) => (
                          <AppointmentCard key={a.id} ap={a} showResource={columns.length > 1} />
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          ) : columns.length === 0 ? (
            <EmptyState title="Nenhuma agenda para mostrar">
              Você ainda não tem uma agenda ligada ao seu nome. O administrador cria em “Serviços e equipe”.
            </EmptyState>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${columns.length > 2 ? 260 : 300}px, 1fr))` }}
            >
              {columns.map((r) => {
                const list = dayList.filter((a) => a.resourceId === r.id);
                const active = list.filter((a) => a.status !== "cancelado").length;
                const mine = ag.manageable.some((m) => m.id === r.id);
                return (
                  <Card key={r.id} className="p-3" aria-labelledby={`agenda-${r.id}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h2 id={`agenda-${r.id}`} className="font-display text-base font-bold">
                        {r.name}
                        {!r.active && <span className="ml-2 text-sm font-normal text-muted">(desativada)</span>}
                      </h2>
                      <span className="text-sm text-muted">
                        {active} {active === 1 ? "horário" : "horários"}
                      </span>
                    </div>
                    {hoursOfDay(r, day) && (
                      <p className="mb-2 flex items-center gap-1 text-sm text-muted">
                        <IconClock className="h-3.5 w-3.5" /> {hoursOfDay(r, day)}
                      </p>
                    )}
                    {dayBlocks(r.id).length > 0 && (
                      <ul className="mb-2 grid gap-1">
                        {dayBlocks(r.id).map((b) => (
                          <BlockRow key={b.block.id} block={b.block} label={b.label} canRemove={mine} />
                        ))}
                      </ul>
                    )}
                    {list.length === 0 ? (
                      hoursOfDay(r, day) !== "Não atende neste dia" && (
                        <p className="py-4 text-center text-sm text-muted">Livre o dia todo.</p>
                      )
                    ) : (
                      <ul className="grid gap-2">
                        {list.map((a) => (
                          <AppointmentCard key={a.id} ap={a} />
                        ))}
                      </ul>
                    )}
                    {mine && r.active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 w-full"
                        onClick={() => dialogs.open({ kind: "appointment", date: day, resourceId: r.id })}
                      >
                        <IconPlus className="h-4 w-4" /> Marcar com {r.name.split(" ")[0]}
                      </Button>
                    )}
                    {mine && r.active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full text-muted"
                        onClick={() => dialogs.open({ kind: "block", date: day, resourceId: r.id })}
                      >
                        Bloquear horário
                      </Button>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
