"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { ExtraFields, fieldValues } from "@/features/clients/extra-fields";
import { OwnerSelect } from "@/features/company/owner-select";
import { canAssignClientOwner } from "@/lib/domain/permissions";
import { SEGMENTS } from "@/lib/domain/segments";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

export function ClientDialog({ onClose, clientId }: DialogProps & { clientId?: string }) {
  const { data, me } = useBackend();
  const toast = useToast();
  const nav = useNav();
  const t = useTerms();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = clientById(data, clientId);
  // campos próprios do ramo (nascimento, convênio, endereço…)
  const extraFields = SEGMENTS[data.company.segment].clientFields;
  const initial = {
    name: existing?.name ?? "",
    email: existing?.email ?? "",
    phone: existing?.phone ?? "",
    ownerId: existing?.ownerId ?? me.userId,
    extra: fieldValues(extraFields, existing?.extra),
  };
  const [f, setF] = useState(initial);
  const formId = useId();
  const set = (k: "name" | "email" | "phone" | "ownerId") => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    clearField(k);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({ type: "client.save", id: clientId, ...f });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
      if (!clientId && r.id) nav.openClient(r.id);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={!same(f, initial)}
      title={existing ? `Editar ${existing.name}` : `Novo ${t.cliente}`}
      description={existing ? undefined : "Só o nome é obrigatório. Você pode completar o resto depois."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar {t.cliente}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label={`Nome do ${t.cliente}`}
          value={f.name}
          onChange={(e) => set("name")(e.target.value)}
          error={fieldErrors.name}
          autoComplete="off"
          data-autofocus
          hint={data.company.segment === "geral" ? "Pessoa ou empresa. Ex.: Marina Costa" : "Ex.: Marina Costa"}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="E-mail"
            optional
            type="email"
            value={f.email}
            onChange={(e) => set("email")(e.target.value)}
            error={fieldErrors.email}
            autoComplete="off"
          />
          <TextField
            label="Telefone ou WhatsApp"
            optional
            type="tel"
            value={f.phone}
            onChange={(e) => set("phone")(e.target.value)}
            error={fieldErrors.phone}
            placeholder="(11) 90000-0000"
          />
        </div>
        <ExtraFields
          fields={extraFields}
          values={f.extra}
          onChange={(key, value) => {
            setF((x) => ({ ...x, extra: { ...x.extra, [key]: value } }));
            clearField(`extra.${key}`);
          }}
          errors={fieldErrors}
          prefix="extra"
        />
        <OwnerSelect
          value={f.ownerId}
          onChange={set("ownerId")}
          error={fieldErrors.ownerId}
          label={`Quem cuida deste ${t.cliente}`}
          canChoose={canAssignClientOwner(me.roles)}
        />
      </form>
    </Modal>
  );
}
