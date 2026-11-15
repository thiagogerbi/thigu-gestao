"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, InlineAlert, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconEdit, IconPlus, IconX } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { activeEnrollments, hasClassOn, seatsTaken, stoppedComing } from "@/lib/domain/classes";
import { addDays, formatShortDateBR, isISODate } from "@/lib/domain/dates";
import { WEEKDAY_SHORT } from "@/lib/domain/hours";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import type { AttendanceStatus, ClassGroup } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";

const STATUS: { value: AttendanceStatus; label: string; on: string }[] = [
  { value: "presente", label: "Veio", on: "border-money-700 bg-money-50 text-money-700" },
  { value: "falta", label: "Faltou", on: "border-danger bg-danger-50 text-danger" },
];

export const classSchedule = (c: Pick<ClassGroup, "weekdays" | "startTime" | "durationMin">) =>
  `${[...c.weekdays]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAY_SHORT[d])
    .join(", ")} · ${c.startTime} · ${c.durationMin} min`;

/** Turmas: quem está matriculado, vagas, presença do dia e quem parou de vir. */
export function ClassesScreen() {
  const { data, me, today } = useBackend();
  const dialogs = useDialogs();
  const nav = useNav();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending } = useAction();
  const myResources = data.resources.filter((r) => r.userId === me.userId).map((r) => r.id);
  const teaches = (c: ClassGroup) => c.resourceId !== null && myResources.includes(c.resourceId);
  const manage = can(me.roles, "turmas.gerenciar");
  const enroll = can(me.roles, "turmas.matricular");

  if (!moduleAvailable(data.company, "turmas") || (!manage && !enroll && !data.classes.some(teaches))) {
    return (
      <>
        <PageHeader title="Turmas" />
        <EmptyState title="Página indisponível">
          As turmas existem para escolas, academias e estúdios com aulas em grupo, e para quem matricula ou dá aula.
        </EmptyState>
      </>
    );
  }

  const param = nav.params.get("dia");
  const day = param && isISODate(param) ? param : today;
  const classes = data.classes
    .filter((c) => c.active || manage)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.startTime.localeCompare(b.startTime));
  const clientName = (id: string) => data.clients.find((c) => c.id === id)?.name ?? "—";
  const resourceName = (id: string | null) => (id ? (data.resources.find((r) => r.id === id)?.name ?? "—") : null);
  const stopped = stoppedComing({ enrollments: data.enrollments, attendance: data.attendance, today });
  const goTo = (d: string) => nav.setQuery({ dia: d === today ? null : d });

  async function mark(classId: string, clientId: string, status: AttendanceStatus | null) {
    const r = await exec({ type: "attendance.mark", classId, clientId, date: day, status });
    if (!r.ok) toast({ tone: "error", text: r.message });
  }

  return (
    <>
      <PageHeader
        title="Turmas"
        description="Matrículas, vagas e presença de cada aula."
        actions={
          manage && (
            <Button onClick={() => dialogs.open({ kind: "classGroup" })}>
              <IconPlus className="h-5 w-5" /> Nova turma
            </Button>
          )
        }
      />

      {stopped.length > 0 && (
        <div className="mb-4">
          <InlineAlert
            tone="amber"
            title={`${stopped.length === 1 ? "1 aluno parou" : `${stopped.length} alunos pararam`} de vir`}
          >
            Sem aula há mais de 3 semanas:{" "}
            {stopped
              .map(
                (e) => `${clientName(e.clientId)} (${data.classes.find((c) => c.id === e.classId)?.name ?? "turma"})`,
              )
              .join(", ")}
            . Vale mandar uma mensagem antes que cancelem.
          </InlineAlert>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex gap-1" role="group" aria-label="Mudar o dia">
          <Button variant="secondary" size="sm" onClick={() => goTo(addDays(day, -1))}>
            ‹ Dia anterior
          </Button>
          <Button variant="secondary" size="sm" disabled={day === today} onClick={() => goTo(today)}>
            Hoje
          </Button>
          <Button variant="secondary" size="sm" onClick={() => goTo(addDays(day, 1))}>
            Próximo dia ›
          </Button>
        </div>
        <TextField
          label="Presença do dia"
          type="date"
          value={day}
          max={today}
          onChange={(e) => isISODate(e.target.value) && goTo(e.target.value)}
          wrapperClassName="w-44"
          className="min-h-9"
        />
      </div>

      {classes.length === 0 ? (
        <EmptyState title="Nenhuma turma ainda">
          {manage
            ? "Crie a primeira turma com os dias, o horário e o número de vagas."
            : "O administrador ainda não criou turmas."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {classes.map((c) => {
            const list = activeEnrollments(data.enrollments, c.id, day);
            const seats = seatsTaken(data.enrollments, c.id);
            const canMark = enroll || teaches(c);
            const hasClass = hasClassOn(c, day) && day <= today;
            const enrolledIds = new Set(list.map((e) => e.clientId));
            const makeups = data.attendance.filter(
              (a) => a.classId === c.id && a.classDate === day && !enrolledIds.has(a.clientId),
            );
            const statusOf = (clientId: string) =>
              data.attendance.find((a) => a.classId === c.id && a.clientId === clientId && a.classDate === day)?.status;
            // alunos de outras turmas que podem repor nesta
            const others = [
              ...new Set(
                data.enrollments
                  .filter((e) => !e.endedOn && e.classId !== c.id && !enrolledIds.has(e.clientId))
                  .map((e) => e.clientId),
              ),
            ].filter((id) => !makeups.some((m) => m.clientId === id));
            return (
              <Card key={c.id} className={cx("p-4", !c.active && "opacity-70")} aria-labelledby={`turma-${c.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id={`turma-${c.id}`} className="font-display text-lg font-bold">
                      {c.name} {!c.active && <Badge tone="gray">encerrada</Badge>}
                    </h2>
                    <p className="text-sm text-muted">
                      {classSchedule(c)}
                      {resourceName(c.resourceId) && ` · ${resourceName(c.resourceId)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge tone={seats >= c.capacity ? "amber" : "neutral"}>
                      {seats}/{c.capacity} vagas
                    </Badge>
                    {manage && (
                      <IconButton
                        label={`Editar turma ${c.name}`}
                        onClick={() => dialogs.open({ kind: "classGroup", classId: c.id })}
                      >
                        <IconEdit />
                      </IconButton>
                    )}
                  </div>
                </div>

                <p className="mt-3 text-sm font-semibold">
                  {hasClass
                    ? `Presença de ${day === today ? "hoje" : formatShortDateBR(day)}`
                    : `Sem aula ${day === today ? "hoje" : `em ${formatShortDateBR(day)}`}`}
                </p>
                {list.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">Nenhum aluno matriculado.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-line">
                    {list.map((e) => {
                      const st = statusOf(e.clientId);
                      return (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                          <span className="min-w-0 font-medium">{clientName(e.clientId)}</span>
                          <div className="flex items-center gap-1">
                            {hasClass &&
                              canMark &&
                              STATUS.map((s) => (
                                <button
                                  key={s.value}
                                  type="button"
                                  disabled={pending}
                                  aria-pressed={st === s.value}
                                  onClick={() => mark(c.id, e.clientId, st === s.value ? null : s.value)}
                                  className={cx(
                                    "min-h-9 rounded-lg border px-3 text-sm font-semibold",
                                    st === s.value ? s.on : "border-[#c5cfdf] bg-white text-muted hover:bg-canvas",
                                  )}
                                >
                                  {s.label}
                                </button>
                              ))}
                            {hasClass && !canMark && st && <Badge>{st === "presente" ? "Veio" : "Faltou"}</Badge>}
                            {enroll && (
                              <IconButton
                                label={`Encerrar a matrícula de ${clientName(e.clientId)}`}
                                className="h-9 w-9"
                                disabled={pending}
                                onClick={async () => {
                                  if (
                                    !window.confirm(`Encerrar a matrícula de ${clientName(e.clientId)} em ${c.name}?`)
                                  )
                                    return;
                                  const r = await exec({ type: "enrollment.end", id: e.id });
                                  toast({ tone: r.ok ? "success" : "error", text: r.message });
                                }}
                              >
                                <IconX className="h-4 w-4" />
                              </IconButton>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {hasClass && (makeups.length > 0 || (canMark && others.length > 0)) && (
                  <div className="mt-2 rounded-lg bg-canvas p-2 text-sm">
                    <p className="font-semibold">Reposição</p>
                    {makeups.map((m) => (
                      <p key={m.id} className="flex items-center justify-between gap-2">
                        {clientName(m.clientId)}
                        {canMark && (
                          <button
                            type="button"
                            className="text-sm text-muted underline"
                            onClick={() => mark(c.id, m.clientId, null)}
                          >
                            tirar
                          </button>
                        )}
                      </p>
                    ))}
                    {canMark && others.length > 0 && (
                      <select
                        aria-label={`Aluno de outra turma repondo em ${c.name}`}
                        value=""
                        disabled={pending}
                        onChange={(e) => e.target.value && mark(c.id, e.target.value, "reposicao")}
                        className="mt-1 min-h-9 w-full rounded-lg border border-[#c5cfdf] bg-white px-2"
                      >
                        <option value="">Aluno de outra turma veio repor…</option>
                        {others.map((id) => (
                          <option key={id} value={id}>
                            {clientName(id)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {enroll && c.active && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 w-full"
                    disabled={seats >= c.capacity}
                    onClick={() => dialogs.open({ kind: "enroll", classId: c.id })}
                  >
                    <IconPlus className="h-4 w-4" /> {seats >= c.capacity ? "Turma cheia" : `Matricular ${t.cliente}`}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
