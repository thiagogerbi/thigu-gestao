"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { ExtraFields, fieldValues } from "@/features/clients/extra-fields";
import { ITEM_KINDS, itemKindFor } from "@/lib/domain/segments";
import { formatPlate, normalizePlate } from "@/lib/domain/work-orders";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useId, useState } from "react";

/** Cadastro do pet ou do veículo de um cliente (o tipo de item vem do ramo da empresa). */
export function ItemDialog({ onClose, clientId, itemId }: DialogProps & { clientId: string; itemId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const kind = itemKindFor(data.company);
  const client = clientById(data, clientId);
  const existing = data.items.find((i) => i.id === itemId);
  const info = kind ? ITEM_KINDS[kind] : null;
  const initial = {
    name: existing?.name ?? "",
    alert: existing?.alert ?? "",
    details: fieldValues(info?.fields ?? [], existing?.details),
    plate: formatPlate(existing?.plate),
  };
  const [f, setF] = useState(initial);
  const formId = useId();

  if (!kind || !info || !client) {
    return (
      <Modal open onClose={onClose} title="Cadastro indisponível" size="sm">
        <p>Este cadastro não está disponível para o ramo da empresa.</p>
      </Modal>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    const { plate, ...rest } = f;
    const r = await exec({
      type: "item.save",
      id: itemId,
      clientId,
      kind,
      ...rest,
      ...(kind === "veiculo" ? { plate: normalizePlate(plate) } : {}),
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
      title={existing ? `Editar ${existing.name}` : `Cadastrar ${info.noun[0]}`}
      description={`${info.noun[0].charAt(0).toUpperCase() + info.noun[0].slice(1)} de ${client.name}. ${kind === "veiculo" ? "Placa e modelo são obrigatórios." : "Só o nome é obrigatório."}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar {info.noun[0]}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        {kind === "veiculo" && (
          <TextField
            label="Placa"
            value={f.plate}
            maxLength={8}
            onChange={(e) => {
              setF((x) => ({ ...x, plate: e.target.value.toUpperCase() }));
              clearField("plate");
            }}
            error={fieldErrors.plate}
            hint="Ex.: ABC1D23 ou ABC-1234"
            className="font-mono uppercase tracking-wider"
            autoComplete="off"
            autoCapitalize="characters"
            data-autofocus
          />
        )}
        <TextField
          label={info.nameLabel}
          value={f.name}
          onChange={(e) => {
            setF((x) => ({ ...x, name: e.target.value }));
            clearField("name");
          }}
          error={fieldErrors.name}
          hint={info.nameHint}
          autoComplete="off"
          data-autofocus={kind !== "veiculo" || undefined}
        />
        <ExtraFields
          fields={info.fields}
          values={f.details}
          onChange={(key, value) => {
            setF((x) => ({ ...x, details: { ...x.details, [key]: value } }));
            clearField(`details.${key}`);
          }}
          errors={fieldErrors}
          prefix="details"
        />
        <TextField
          label="Aviso importante"
          optional
          value={f.alert}
          onChange={(e) => {
            setF((x) => ({ ...x, alert: e.target.value }));
            clearField("alert");
          }}
          error={fieldErrors.alert}
          hint={info.alertHint}
          autoComplete="off"
        />
      </form>
    </Modal>
  );
}
