"use client";
import { IconButton } from "@/components/ui/button";
import { IconPlus, IconX } from "@/components/ui/icons";
import { WEEKDAY_LABEL } from "@/lib/domain/hours";
import type { WorkHours } from "@/lib/domain/types";

type Day = keyof WorkHours;
// a semana começa na segunda, como as pessoas pensam o horário de trabalho
const ORDER: Day[] = ["1", "2", "3", "4", "5", "6", "0"];
const DEFAULT: [string, string] = ["09:00", "18:00"];

const timeInput =
  "min-h-10 w-[6.5rem] rounded-lg border border-[#c5cfdf] bg-white px-2 tabular focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/20";

/** Dias e períodos em que a pessoa atende. Dia sem período = não atende. */
export function WorkHoursEditor({ value, onChange }: { value: WorkHours; onChange: (v: WorkHours) => void }) {
  const set = (day: Day, list: [string, string][]) => {
    const next = { ...value };
    if (list.length) next[day] = list;
    else delete next[day];
    onChange(next);
  };
  // copia o horário do primeiro dia preenchido para os outros dias úteis: o caso mais comum
  const first = ORDER.map((d) => value[d]).find((l) => l?.length);
  const copyToWeekdays = () => {
    if (!first) return;
    const next = { ...value };
    for (const d of ["1", "2", "3", "4", "5"] as Day[]) next[d] = first.map((p) => [...p] as [string, string]);
    onChange(next);
  };

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-semibold">Horário de trabalho</legend>
      <p className="-mt-1 mb-1 text-sm text-muted">
        Fora destes horários a agenda avisa antes de marcar, e o agendamento online não oferece o horário. Deixe tudo
        desmarcado para não usar horário.
      </p>
      {ORDER.map((day) => {
        const list = value[day] ?? [];
        const on = list.length > 0;
        const label = WEEKDAY_LABEL[Number(day)];
        return (
          <div
            key={day}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line pb-2 last:border-0"
          >
            <label className="flex min-h-10 w-28 items-center gap-2 font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={on}
                onChange={(e) => set(day, e.target.checked ? [[...DEFAULT]] : [])}
              />
              {label}
            </label>
            {on ? (
              <div className="flex flex-wrap items-center gap-2">
                {list.map(([from, to], i) => (
                  <span key={i} className="flex items-center gap-1">
                    <input
                      type="time"
                      aria-label={`${label}, início do período ${i + 1}`}
                      className={timeInput}
                      value={from}
                      onChange={(e) =>
                        set(
                          day,
                          list.map((p, j) => (j === i ? [e.target.value, p[1]] : p)),
                        )
                      }
                    />
                    <span className="text-muted">às</span>
                    <input
                      type="time"
                      aria-label={`${label}, fim do período ${i + 1}`}
                      className={timeInput}
                      value={to}
                      onChange={(e) =>
                        set(
                          day,
                          list.map((p, j) => (j === i ? [p[0], e.target.value] : p)),
                        )
                      }
                    />
                    <IconButton
                      label={`Tirar o período ${i + 1} de ${label.toLowerCase()}`}
                      className="h-9 w-9"
                      onClick={() =>
                        set(
                          day,
                          list.filter((_, j) => j !== i),
                        )
                      }
                    >
                      <IconX className="h-4 w-4" />
                    </IconButton>
                  </span>
                ))}
                {list.length < 4 && (
                  <IconButton
                    label={`Mais um período em ${label.toLowerCase()} (ex.: depois do almoço)`}
                    className="h-9 w-9"
                    onClick={() => {
                      const lastEnd = list.at(-1)?.[1] ?? "12:00";
                      set(day, [
                        ...list,
                        [lastEnd < "23:00" ? lastEnd : "13:00", lastEnd < "22:00" ? "23:00" : "23:59"],
                      ]);
                    }}
                  >
                    <IconPlus className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            ) : (
              <span className="text-sm text-muted">Não atende</span>
            )}
          </div>
        );
      })}
      {first && (
        <button
          type="button"
          onClick={copyToWeekdays}
          className="justify-self-start text-sm font-semibold text-primary-700 underline-offset-2 hover:underline"
        >
          Usar o mesmo horário de segunda a sexta
        </button>
      )}
    </fieldset>
  );
}
