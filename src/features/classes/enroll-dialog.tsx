"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { SelectField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { seatsTaken } from "@/lib/domain/classes";
import { useAction, useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

/** Matricula um cliente já cadastrado numa turma. Novo aluno: cadastre primeiro em Clientes. */
export function EnrollDialog({ onClose, open, classId }: DialogProps & { classId: string }) {
  const { data } = useBackend();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const cls = data.classes.find((c) => c.id === classId);
  const [clientId, setClientId] = useState("");
  const formId = useId();
  const inClass = new Set(data.enrollments.filter((e) => e.classId === classId && !e.endedOn).map((e) => e.clientId));
  const options = data.clients.filter((c) => !inClass.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const free = cls ? cls.capacity - seatsTaken(data.enrollments, cls.id) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    const r = await exec({ type: "enrollment.create", classId, clientId });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Matricular em ${cls?.name ?? "turma"}`}
      description={`${free} ${free === 1 ? "vaga livre" : "vagas livres"}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!clientId}>
            Matricular
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && <InlineAlert>{error}</InlineAlert>}
        <SelectField label={t.Cliente} value={clientId} onChange={(e) => setClientId(e.target.value)} data-autofocus>
          <option value="">Escolha…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <p className="text-sm text-muted">
          Ainda não tem cadastro?{" "}
          <button
            type="button"
            className="font-semibold text-primary-700 underline"
            onClick={() => open({ kind: "client" })}
          >
            Cadastrar {t.cliente}
          </button>{" "}
          e volte aqui. A mensalidade é criada em “{t.Clientes}”, na ficha.
        </p>
      </form>
    </Modal>
  );
}
