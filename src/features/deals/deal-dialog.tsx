"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { OwnerSelect } from "@/features/company/owner-select";
import { centsToInput, parseBRLToCents } from "@/lib/domain/money";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById, dealById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useId, useState } from "react";

export function DealDialog({ onClose, dealId, clientId }: DialogProps & { dealId?: string; clientId?: string }) {
  const { data, me } = useBackend();
  const toast = useToast();
  const nav = useNav();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = dealById(data, dealId);
  const initial = {
    clientId: existing?.clientId ?? clientId ?? "",
    title: existing?.title ?? "",
    value: existing ? centsToInput(existing.valueCents) : "",
    ownerId: existing?.ownerId ?? me.userId,
    expectedClose: existing?.expectedClose ?? "",
    nextAction: existing?.nextAction ?? "",
    nextActionDate: existing?.nextActionDate ?? "",
  };
  const [f, setF] = useState(initial);
  const [localErr, setLocalErr] = useState<Record<string, string>>({});
  const formId = useId();
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    clearField(k === "value" ? "valueCents" : k);
    setLocalErr((e) => ({ ...e, [k]: "" }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const cents = f.value.trim() === "" ? 0 : parseBRLToCents(f.value);
    if (cents === null || cents < 0)
      errs.value = "Digite o valor estimado, por exemplo 1.500,00. Se ainda não sabe, deixe em branco.";
    if (!f.clientId) errs.clientId = "Escolha o cliente desta negociação.";
    setLocalErr(errs);
    if (Object.keys(errs).length) return;
    const r = await exec({
      type: "deal.save",
      id: dealId,
      clientId: f.clientId,
      title: f.title,
      valueCents: cents!,
      ownerId: f.ownerId,
      expectedClose: f.expectedClose || null,
      nextAction: f.nextAction.trim() || null,
      nextActionDate: f.nextActionDate || null,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
      if (!dealId && r.id) nav.openClient(f.clientId, r.id);
    }
  }

  const clientFixed = Boolean(existing || clientId);
  const client = clientById(data, f.clientId);
  return (
    <Modal
      open
      onClose={onClose}
      dirty={!same(f, initial)}
      title={existing ? "Editar negociação" : "Nova negociação"}
      description={
        existing
          ? undefined
          : "Uma negociação é uma possível venda para um cliente. Ela começa na etapa “Novo contato”."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar negociação
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        {clientFixed ? (
          <p className="rounded-lg bg-canvas px-3 py-2 text-sm">
            Cliente: <strong>{client?.name}</strong>
          </p>
        ) : data.clients.length === 0 ? (
          <InlineAlert tone="amber">Cadastre um cliente antes de criar uma negociação.</InlineAlert>
        ) : (
          <SelectField
            label="Cliente"
            value={f.clientId}
            onChange={(e) => set("clientId")(e.target.value)}
            error={localErr.clientId || fieldErrors.clientId}
            data-autofocus
          >
            <option value="">Escolha um cliente…</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="O que está sendo negociado?"
          value={f.title}
          onChange={(e) => set("title")(e.target.value)}
          error={fieldErrors.title}
          hint="Ex.: Site institucional, Identidade visual"
          data-autofocus={clientFixed || undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Valor estimado"
            optional
            value={f.value}
            onChange={(e) => set("value")(e.target.value)}
            error={localErr.value || fieldErrors.valueCents}
            disabled={existing?.stage === "ganha"}
            hint={existing?.stage === "ganha" ? "Venda fechada: o valor não muda aqui." : undefined}
          />
          <TextField
            label="Previsão de fechamento"
            optional
            type="date"
            value={f.expectedClose}
            onChange={(e) => set("expectedClose")(e.target.value)}
            error={fieldErrors.expectedClose}
          />
        </div>
        <OwnerSelect value={f.ownerId} onChange={set("ownerId")} error={fieldErrors.ownerId} />
        <div className="grid gap-4 rounded-lg border border-line p-3 sm:grid-cols-[1fr_180px]">
          <TextField
            label="Próxima ação"
            optional
            value={f.nextAction}
            onChange={(e) => set("nextAction")(e.target.value)}
            error={fieldErrors.nextAction}
            hint="O que você vai fazer a seguir? Ex.: Ligar para tirar dúvidas"
          />
          <TextField
            label="Quando"
            optional
            type="date"
            value={f.nextActionDate}
            onChange={(e) => set("nextActionDate")(e.target.value)}
            error={fieldErrors.nextActionDate}
          />
        </div>
      </form>
    </Modal>
  );
}
