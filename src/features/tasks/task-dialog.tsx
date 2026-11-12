"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { OwnerSelect } from "@/features/company/owner-select";
import { addDays } from "@/lib/domain/dates";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

export function TaskDialog({
  onClose,
  taskId,
  clientId,
  dealId,
}: DialogProps & { taskId?: string; clientId?: string; dealId?: string }) {
  const { data, me, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = data.tasks.find((t) => t.id === taskId);
  const initial = {
    title: existing?.title ?? "",
    clientId: existing?.clientId ?? clientId ?? "",
    dealId: existing?.dealId ?? dealId ?? "",
    assigneeId: existing?.assigneeId ?? me.userId,
    dueDate: existing?.dueDate ?? today,
  };
  const [f, setF] = useState(initial);
  const formId = useId();
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v, ...(k === "clientId" ? { dealId: "" } : {}) }));
    clearField(k);
  };
  const deals = data.deals.filter((d) => d.clientId === f.clientId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({
      type: "task.save",
      id: taskId,
      title: f.title,
      clientId: f.clientId || null,
      dealId: f.dealId || null,
      assigneeId: f.assigneeId,
      dueDate: f.dueDate,
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
      title={existing ? "Editar tarefa" : "Nova tarefa"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar tarefa
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label="O que precisa ser feito?"
          value={f.title}
          onChange={(e) => set("title")(e.target.value)}
          error={fieldErrors.title}
          data-autofocus
          hint="Ex.: Ligar para confirmar a reunião"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Cliente relacionado"
            optional
            value={f.clientId}
            onChange={(e) => set("clientId")(e.target.value)}
          >
            <option value="">Nenhum</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Negociação"
            optional
            value={f.dealId}
            onChange={(e) => set("dealId")(e.target.value)}
            disabled={!f.clientId || deals.length === 0}
            hint={!f.clientId ? "Escolha um cliente primeiro." : undefined}
          >
            <option value="">Nenhuma</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <OwnerSelect value={f.assigneeId} onChange={set("assigneeId")} error={fieldErrors.assigneeId} />
          <TextField
            label="Vencimento"
            type="date"
            value={f.dueDate}
            onChange={(e) => set("dueDate")(e.target.value)}
            error={fieldErrors.dueDate}
            min={existing ? undefined : addDays(today, -365)}
          />
        </div>
      </form>
    </Modal>
  );
}
