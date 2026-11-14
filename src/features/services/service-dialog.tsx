"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { centsToInput, parseBRLToCents } from "@/lib/domain/money";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

export function ServiceDialog({ onClose, serviceId }: DialogProps & { serviceId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = data.services.find((s) => s.id === serviceId);
  const initial = {
    name: existing?.name ?? "",
    duration: String(existing?.durationMin ?? 60),
    price: existing && existing.priceCents > 0 ? centsToInput(existing.priceCents) : "",
    active: existing?.active ?? true,
  };
  const [f, setF] = useState(initial);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const formId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const price = f.price.trim() ? parseBRLToCents(f.price) : 0;
    if (price === null || price < 0) return setPriceErr("Digite o valor, por exemplo 150,00 (ou deixe em branco).");
    const r = await exec({
      type: "service.save",
      id: serviceId,
      name: f.name,
      durationMin: Number(f.duration),
      priceCents: price,
      active: f.active,
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
      title={existing ? `Editar ${existing.name}` : "Novo serviço"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar serviço
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label="Nome do serviço"
          value={f.name}
          onChange={(e) => {
            setF((x) => ({ ...x, name: e.target.value }));
            clearField("name");
          }}
          error={fieldErrors.name}
          hint="Ex.: Consulta, Retorno, Corte feminino, Banho (porte pequeno)"
          autoComplete="off"
          data-autofocus
        />
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Duração (minutos)"
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            step={5}
            value={f.duration}
            onChange={(e) => {
              setF((x) => ({ ...x, duration: e.target.value }));
              clearField("durationMin");
            }}
            error={fieldErrors.durationMin}
          />
          <MoneyField
            label="Valor"
            optional
            value={f.price}
            onChange={(e) => {
              setF((x) => ({ ...x, price: e.target.value }));
              setPriceErr(null);
            }}
            error={priceErr ?? fieldErrors.priceCents}
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
            Serviço em uso (desmarque para tirar da lista ao marcar horários)
          </label>
        )}
      </form>
    </Modal>
  );
}
