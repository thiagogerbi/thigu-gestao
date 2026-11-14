"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { WorkHoursEditor } from "@/features/services/work-hours-editor";
import { workHoursError } from "@/lib/domain/hours";
import type { WorkHours } from "@/lib/domain/types";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

/** Uma agenda: o nome que aparece na coluna e, se for alguém da equipe, a pessoa ligada a ela. */
export function ResourceDialog({
  onClose,
  resourceId,
  userId,
}: DialogProps & { resourceId?: string; userId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const t = useTerms();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = data.resources.find((r) => r.id === resourceId);
  const preset = data.members.find((m) => m.userId === userId);
  const initial = {
    name: existing?.name ?? preset?.name ?? "",
    userId: existing?.userId ?? userId ?? "",
    active: existing?.active ?? true,
    workHours: (existing?.workHours ?? {}) as WorkHours,
  };
  const [f, setF] = useState(initial);
  const formId = useId();
  // pessoas que ainda não têm agenda (ou a que já está ligada a esta)
  const free = data.members.filter((m) => m.userId === f.userId || !data.resources.some((r) => r.userId === m.userId));

  const hoursError = workHoursError(f.workHours);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (hoursError) return;
    const r = await exec({
      type: "resource.save",
      id: resourceId,
      name: f.name,
      userId: f.userId || null,
      active: f.active,
      workHours: f.workHours,
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
      size="lg"
      title={existing ? `Editar agenda de ${existing.name}` : "Nova agenda"}
      description="O nome aparece no topo da coluna da agenda."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar agenda
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <SelectField
          label="Pessoa da equipe"
          optional
          value={f.userId}
          onChange={(e) => {
            const m = data.members.find((x) => x.userId === e.target.value);
            setF((x) => ({ ...x, userId: e.target.value, name: x.name || m?.name || "" }));
            clearField("userId");
          }}
          error={fieldErrors.userId}
          hint="Ligada a alguém, essa pessoa vê e marca nesta agenda. Sem ligação, serve para sala, mesa ou quem não usa o sistema."
        >
          <option value="">Ninguém (só um nome)</option>
          {free.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name} — {t.roleLabels(m.roles)}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Nome da agenda"
          value={f.name}
          onChange={(e) => {
            setF((x) => ({ ...x, name: e.target.value }));
            clearField("name");
          }}
          error={fieldErrors.name}
          hint="Ex.: Dra. Helena, Sala 2, Mesa de tosa"
          autoComplete="off"
          data-autofocus
        />
        <WorkHoursEditor value={f.workHours} onChange={(workHours) => setF((x) => ({ ...x, workHours }))} />
        {hoursError && <InlineAlert>{hoursError}</InlineAlert>}
        {existing && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={f.active}
              onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))}
            />
            Agenda em uso (desmarque quando a pessoa deixar de atender; o histórico fica guardado)
          </label>
        )}
      </form>
    </Modal>
  );
}
