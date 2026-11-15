"use client";
import { LinkButton } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { dayOf, localParts, STATUS_LABEL, STATUS_TONE } from "@/lib/domain/agenda";
import { addDays } from "@/lib/domain/dates";
import { useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useAgenda } from "@/state/use-agenda";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";

/** Painel inicial dos ramos com agenda: os horários de hoje, o que falta confirmar amanhã e as faltas da semana. */
export function TodayAgenda() {
  const { data, today } = useBackend();
  const ag = useAgenda();
  const t = useTerms();
  const nav = useNav();
  if (!ag.enabled) return null;
  const todayList = ag.onDay(today).filter((a) => a.status !== "cancelado");
  const done = todayList.filter((a) => a.status === "compareceu").length;
  const toConfirm = ag
    .onDay(addDays(today, 1))
    .filter((a) => a.status === "agendado" && ag.canManage(a) && !a.remindedAt).length;
  const weekAgo = addDays(today, -7);
  const absences = data.appointments.filter(
    (a) => a.status === "faltou" && dayOf(a) >= weekAgo && dayOf(a) <= today,
  ).length;
  const next = todayList.filter((a) => a.status === "agendado" || a.status === "confirmado").slice(0, 5);

  return (
    <Card className="mb-8 p-5" aria-labelledby="agenda-hoje">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="agenda-hoje" className="font-display text-lg font-bold">
            Agenda de hoje
          </h2>
          <p className="text-muted">
            {todayList.length === 0
              ? "Nenhum horário marcado para hoje."
              : `${todayList.length} ${todayList.length === 1 ? "horário" : "horários"} · ${done} ${done === 1 ? "atendido" : "atendidos"}`}
          </p>
        </div>
        <LinkButton href={nav.href("/agenda")}>Abrir agenda</LinkButton>
      </div>

      {next.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {next.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <button
                type="button"
                onClick={() => nav.openClient(a.clientId)}
                className="min-w-0 text-left hover:underline"
              >
                <span className="font-semibold tabular">{localParts(a.startsAt).time}</span>{" "}
                {clientById(data, a.clientId)?.name ?? t.Cliente}
                <span className="block text-sm text-muted">
                  {[ag.itemName(a.itemId), ag.resourceName(a.resourceId)].filter(Boolean).join(" · ")}
                </span>
              </button>
              <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
            </li>
          ))}
        </ul>
      )}

      {(toConfirm > 0 || absences > 0) && (
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {toConfirm > 0 && ag.remindersOn && (
            <LinkButton href={nav.href("/agenda")} variant="secondary" size="sm">
              {toConfirm} {toConfirm === 1 ? "horário de amanhã para lembrar" : "horários de amanhã para lembrar"}
            </LinkButton>
          )}
          {absences > 0 && (
            <span className="inline-flex min-h-9 items-center rounded-lg bg-danger-50 px-3 font-semibold text-danger">
              {absences} {absences === 1 ? "falta" : "faltas"} nos últimos 7 dias
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
