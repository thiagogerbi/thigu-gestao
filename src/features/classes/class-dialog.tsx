"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { classError } from "@/lib/domain/classes";
import { WEEKDAY_SHORT } from "@/lib/domain/hours";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Turma: nome, instrutor, dias da semana, horário, duração e vagas. */
export function ClassDialog({ onClose, classId }: DialogProps & { classId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = data.classes.find((c) => c.id === classId);
  const initial = {
    name: existing?.name ?? "",
    resourceId: existing?.resourceId ?? "",
    weekdays: existing?.weekdays ?? ([] as number[]),
    startTime: existing?.startTime ?? "18:00",
    durationMin: String(existing?.durationMin ?? 60),
    capacity: String(existing?.capacity ?? 8),
    active: existing?.active ?? true,
  };
  const [f, setF] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = {
      weekdays: f.weekdays,
      startTime: f.startTime,
      durationMin: Number(f.durationMin),
      capacity: Number(f.capacity),
    };
    const err = classError(values);
    if (err) return setLocalError(err);
    setLocalError(null);
    const r = await exec({
      type: "class.save",
      id: classId,
      name: f.name,
      resourceId: f.resourceId || null,
      active: f.active,
      ...values,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={!same(f, initial)}
      title={existing ? `Editar ${existing.name}` : "Nova turma"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar turma
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || (error && !Object.keys(fieldErrors).length)) && (
          <InlineAlert>{localError ?? error}</InlineAlert>
        )}
        <TextField
          label="Nome da turma"
          value={f.name}
          maxLength={80}
          onChange={(e) => {
            setF((x) => ({ ...x, name: e.target.value }));
            clearField("name");
          }}
          error={fieldErrors.name}
          hint="Ex.: Pilates iniciante, Inglês A1, Natação infantil"
          autoComplete="off"
          data-autofocus
        />
        <SelectField
          label="Instrutor"
          optional
          value={f.resourceId}
          onChange={(e) => setF((x) => ({ ...x, resourceId: e.target.value }))}
          hint="Ligado a alguém da equipe, essa pessoa vê a turma e marca a presença."
        >
          <option value="">Sem instrutor definido</option>
          {data.resources
            .filter((r) => r.active || r.id === f.resourceId)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </SelectField>
        <fieldset>
          <legend className="mb-1 text-sm font-semibold">Dias da semana</legend>
          <div className="flex flex-wrap gap-1.5">
            {ORDER.map((d) => {
              const on = f.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setF((x) => ({ ...x, weekdays: on ? x.weekdays.filter((w) => w !== d) : [...x.weekdays, d] }))
                  }
                  className={cx(
                    "min-h-10 min-w-12 rounded-lg border px-3 text-sm font-semibold",
                    on
                      ? "border-primary bg-primary text-white"
                      : "border-[#c5cfdf] bg-white text-muted hover:bg-canvas",
                  )}
                >
                  {WEEKDAY_SHORT[d]}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Horário"
            type="time"
            value={f.startTime}
            onChange={(e) => setF((x) => ({ ...x, startTime: e.target.value }))}
          />
          <TextField
            label="Duração (min)"
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            value={f.durationMin}
            onChange={(e) => setF((x) => ({ ...x, durationMin: e.target.value }))}
          />
          <TextField
            label="Vagas"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={f.capacity}
            onChange={(e) => setF((x) => ({ ...x, capacity: e.target.value }))}
            error={fieldErrors.capacity}
          />
        </div>
        {existing && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={f.active}
              onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))}
            />
            Turma em andamento (desmarque quando encerrar; a presença fica guardada)
          </label>
        )}
      </form>
    </Modal>
  );
}
