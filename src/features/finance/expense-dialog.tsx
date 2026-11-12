"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { parseBRLToCents } from "@/lib/domain/money";
import { EXPENSE_CATEGORIES } from "@/lib/domain/types";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

export function ExpenseDialog({ onClose }: DialogProps) {
  const { today } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const initial = { description: "", category: "", supplier: "", value: "", dueDate: today };
  const [f, setF] = useState(initial);
  const [valueErr, setValueErr] = useState<string | null>(null);
  const formId = useId();
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    clearField(k === "value" ? "amountCents" : k);
    if (k === "value") setValueErr(null);
  };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cents = parseBRLToCents(f.value);
    if (cents === null || cents <= 0) return setValueErr("Digite o valor da despesa, por exemplo 450,00.");
    const r = await exec({
      type: "expense.create",
      description: f.description,
      category: f.category,
      supplier: f.supplier,
      amountCents: cents,
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
      title="Nova despesa (conta a pagar)"
      description="Cadastre uma conta que a empresa precisa pagar. O pagamento é registrado depois, quando o dinheiro sair."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar despesa
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label="Descrição"
          value={f.description}
          onChange={(e) => set("description")(e.target.value)}
          error={fieldErrors.description}
          data-autofocus
          hint="Ex.: Aluguel de novembro"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Categoria"
            value={f.category}
            onChange={(e) => set("category")(e.target.value)}
            error={fieldErrors.category}
          >
            <option value="">Escolha…</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <TextField label="Fornecedor" optional value={f.supplier} onChange={(e) => set("supplier")(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Valor"
            value={f.value}
            onChange={(e) => set("value")(e.target.value)}
            error={valueErr || fieldErrors.amountCents}
          />
          <TextField
            label="Vencimento"
            type="date"
            value={f.dueDate}
            onChange={(e) => set("dueDate")(e.target.value)}
            error={fieldErrors.dueDate}
          />
        </div>
      </form>
    </Modal>
  );
}
