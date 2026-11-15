"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { ChoiceCards, MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { centsToInput, parseBRLToCents } from "@/lib/domain/money";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

/** Regra de comissão: para quem (todos ou um profissional), em qual serviço (todos ou um) e quanto. */
export function CommissionRuleDialog({
  onClose,
  ruleId,
  resourceId,
}: DialogProps & { ruleId?: string; resourceId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const existing = data.commissionRules.find((r) => r.id === ruleId);
  const [f, setF] = useState({
    resourceId: existing?.resourceId ?? resourceId ?? "",
    serviceId: existing?.serviceId ?? "",
    kind: (existing?.fixedCents !== null && existing?.fixedCents !== undefined ? "fixo" : "porcentagem") as
      "porcentagem" | "fixo",
    percent:
      existing?.percentBp !== null && existing?.percentBp !== undefined
        ? String(existing.percentBp / 100).replace(".", ",")
        : "",
    fixed: existing?.fixedCents !== null && existing?.fixedCents !== undefined ? centsToInput(existing.fixedCents) : "",
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let percentBp: number | null = null;
    let fixedCents: number | null = null;
    if (f.kind === "porcentagem") {
      const n = Number(f.percent.replace(",", "."));
      if (!f.percent.trim() || !Number.isFinite(n) || n < 0 || n > 100)
        return setLocalError("Digite a porcentagem, de 0 a 100.");
      percentBp = Math.round(n * 100);
    } else {
      fixedCents = parseBRLToCents(f.fixed);
      if (fixedCents === null || fixedCents < 0) return setLocalError("Digite o valor por atendimento.");
    }
    setLocalError(null);
    const r = await exec({
      type: "commissionRule.save",
      id: ruleId,
      resourceId: f.resourceId || null,
      serviceId: f.serviceId || null,
      percentBp,
      fixedCents,
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
      title={existing ? "Editar regra de comissão" : "Nova regra de comissão"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar regra
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Profissional"
            value={f.resourceId}
            disabled={Boolean(existing)}
            onChange={(e) => setF((x) => ({ ...x, resourceId: e.target.value }))}
          >
            <option value="">Todos</option>
            {data.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Serviço"
            value={f.serviceId}
            disabled={Boolean(existing)}
            onChange={(e) => setF((x) => ({ ...x, serviceId: e.target.value }))}
          >
            <option value="">Todos os serviços</option>
            {data.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        </div>
        <ChoiceCards
          legend="Como calcula"
          name="tipo-comissao"
          value={f.kind}
          onChange={(kind) => setF((x) => ({ ...x, kind }))}
          options={[
            { value: "porcentagem", label: "Porcentagem", description: "Sobre o valor do atendimento" },
            { value: "fixo", label: "Valor fixo", description: "O mesmo valor por atendimento" },
          ]}
        />
        {f.kind === "porcentagem" ? (
          <TextField
            label="Porcentagem"
            inputMode="decimal"
            placeholder="40"
            value={f.percent}
            onChange={(e) => setF((x) => ({ ...x, percent: e.target.value }))}
            hint="Ex.: 40 para 40%."
            data-autofocus
          />
        ) : (
          <MoneyField
            label="Valor por atendimento"
            value={f.fixed}
            onChange={(e) => setF((x) => ({ ...x, fixed: e.target.value }))}
          />
        )}
      </form>
    </Modal>
  );
}
