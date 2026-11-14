"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { fromLocal, isTime } from "@/lib/domain/agenda";
import { addDays, isISODate } from "@/lib/domain/dates";
import { useAction, useBackend } from "@/state/backend-context";
import { useAgenda } from "@/state/use-agenda";
import { useId, useState } from "react";

/** Bloqueia a agenda: folga, férias, curso, consulta médica. A agenda avisa e o link online não oferece o período. */
export function BlockDialog({ onClose, resourceId, date }: DialogProps & { resourceId?: string; date?: string }) {
  const { today } = useBackend();
  const ag = useAgenda();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const [f, setF] = useState({
    resourceId: resourceId ?? ag.manageable[0]?.id ?? "",
    allDay: true,
    from: date ?? today,
    to: date ?? today,
    fromTime: "12:00",
    toTime: "14:00",
    reason: "",
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!isISODate(f.from) || (f.allDay && !isISODate(f.to))) return setLocalError("Escolha as datas.");
    if (!f.allDay && (!isTime(f.fromTime) || !isTime(f.toTime))) return setLocalError("Digite as horas, como 12:00.");
    const startsAt = fromLocal(f.from, f.allDay ? "00:00" : f.fromTime);
    // dia inteiro: até a meia-noite do último dia
    const endsAt = f.allDay ? fromLocal(addDays(f.to, 1), "00:00") : fromLocal(f.from, f.toTime);
    const r = await exec({ type: "block.create", resourceId: f.resourceId, startsAt, endsAt, reason: f.reason });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Bloquear horário"
      description="Para folga, férias, curso ou qualquer período em que não dá para atender."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Bloquear
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        {ag.manageable.length > 1 && (
          <SelectField
            label="Agenda"
            value={f.resourceId}
            onChange={(e) => setF((x) => ({ ...x, resourceId: e.target.value }))}
          >
            {ag.manageable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
        )}
        <div className="flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Quanto tempo">
          {[
            { v: true, label: "Dia inteiro" },
            { v: false, label: "Só algumas horas" },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              aria-pressed={f.allDay === o.v}
              onClick={() => setF((x) => ({ ...x, allDay: o.v }))}
              className={`min-h-10 flex-1 rounded-md px-3 text-sm font-semibold ${f.allDay === o.v ? "bg-primary text-white" : "text-muted hover:bg-canvas"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {f.allDay ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="De"
              type="date"
              value={f.from}
              min={today}
              onChange={(e) =>
                setF((x) => ({ ...x, from: e.target.value, to: x.to < e.target.value ? e.target.value : x.to }))
              }
            />
            <TextField
              label="Até (inclusive)"
              type="date"
              value={f.to}
              min={f.from}
              onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))}
              error={fieldErrors.endsAt}
              hint="Até 60 dias de cada vez."
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              label="Dia"
              type="date"
              value={f.from}
              min={today}
              onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))}
            />
            <TextField
              label="Das"
              type="time"
              value={f.fromTime}
              onChange={(e) => setF((x) => ({ ...x, fromTime: e.target.value }))}
            />
            <TextField
              label="Às"
              type="time"
              value={f.toTime}
              onChange={(e) => setF((x) => ({ ...x, toTime: e.target.value }))}
              error={fieldErrors.endsAt}
            />
          </div>
        )}
        <TextField
          label="Motivo"
          optional
          value={f.reason}
          maxLength={120}
          onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))}
          hint="Ex.: férias, curso, médico. Só a equipe vê."
          autoComplete="off"
        />
      </form>
    </Modal>
  );
}
