"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import {
  addMinutes,
  durationMinutes,
  fromLocal,
  isOpenStatus,
  isTime,
  localParts,
  MAX_REPEAT,
  type Repeat,
} from "@/lib/domain/agenda";
import { isISODate } from "@/lib/domain/dates";
import { centsToInput, parseBRLToCents } from "@/lib/domain/money";
import { canAssignClientOwner } from "@/lib/domain/permissions";
import { packageView } from "@/lib/domain/recurring";
import { ITEM_KINDS, itemKindFor } from "@/lib/domain/segments";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useAgenda } from "@/state/use-agenda";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

const NEW_CLIENT = "__novo__";

/** Marcar ou remarcar um horário. Na hora de marcar, dá para cadastrar o cliente ali mesmo. */
export function AppointmentDialog({
  onClose,
  appointmentId,
  clientId,
  resourceId,
  date,
}: DialogProps & { appointmentId?: string; clientId?: string; resourceId?: string; date?: string }) {
  const { data, me, today } = useBackend();
  const ag = useAgenda();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const formId = useId();
  const existing = appointmentId ? data.appointments.find((a) => a.id === appointmentId) : undefined;
  const start = existing ? localParts(existing.startsAt) : { date: date ?? today, time: "09:00" };
  const itemKind = itemKindFor(data.company);
  const initial = {
    clientId: existing?.clientId ?? clientId ?? "",
    newClientName: "",
    newClientPhone: "",
    itemId: existing?.itemId ?? "",
    resourceId: existing?.resourceId ?? resourceId ?? ag.manageable[0]?.id ?? "",
    serviceId: existing?.serviceId ?? "",
    date: start.date,
    time: start.time,
    duration: String(existing ? durationMinutes(existing) : 60),
    price: existing && existing.priceCents > 0 ? centsToInput(existing.priceCents) : "",
    notes: existing?.notes ?? "",
    repeat: "nao" as Repeat,
    times: "4",
    packageId: existing?.packageId ?? "",
  };
  const [f, setF] = useState(initial);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrs((e) => {
      const { [k]: _omit, ...rest } = e;
      return rest;
    });
    clearField(k === "duration" || k === "time" || k === "date" ? "endsAt" : k);
  };
  const err = (k: string) => errs[k] ?? fieldErrors[k];

  if (ag.manageable.length === 0) {
    return (
      <Modal open onClose={onClose} size="sm" title="Nenhuma agenda disponível">
        <p>
          Ainda não há uma agenda em que você possa marcar. O administrador cadastra quem atende em “Serviços e equipe”.
        </p>
      </Modal>
    );
  }
  if (appointmentId && (!existing || !isOpenStatus(existing.status))) {
    return (
      <Modal open onClose={onClose} size="sm" title="Não dá para remarcar">
        <p>Este horário não existe mais ou já foi encerrado. Use “Desfazer” antes de remarcar.</p>
      </Modal>
    );
  }

  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const services = data.services.filter((s) => s.active || s.id === f.serviceId);
  const items = data.items.filter((i) => i.clientId === f.clientId && (i.active || i.id === f.itemId));
  const resource = data.resources.find((r) => r.id === f.resourceId);
  // pacotes do cliente que ainda têm sessão livre (o que já está neste horário conta como livre)
  const packages = data.packages
    .filter((p) => p.clientId === f.clientId)
    .map((p) => packageView(p, data.appointments, today, appointmentId))
    .filter((v) => v.usable || v.pkg.id === f.packageId);
  const usePackage = Boolean(f.packageId);

  function pickService(serviceId: string) {
    const s = data.services.find((x) => x.id === serviceId);
    setF((x) => ({
      ...x,
      serviceId,
      duration: s ? String(s.durationMin) : x.duration,
      price: s ? (s.priceCents > 0 ? centsToInput(s.priceCents) : "") : x.price,
      // se o cliente tem um pacote deste serviço, já vem escolhido
      packageId:
        x.packageId ||
        (data.packages
          .filter((p) => p.clientId === x.clientId && p.serviceId === serviceId)
          .map((p) => packageView(p, data.appointments, today, appointmentId))
          .find((v) => v.usable)?.pkg.id ??
          ""),
    }));
    clearField("serviceId");
  }

  async function submit(allowOverlap = false) {
    const e: Record<string, string> = {};
    const minutes = Number(f.duration);
    const price = f.price.trim() ? parseBRLToCents(f.price) : 0;
    if (!f.clientId) e.clientId = `Escolha um ${t.cliente}.`;
    if (f.clientId === NEW_CLIENT && f.newClientName.trim().length < 2)
      e.newClientName = "Digite o nome (pelo menos 2 letras).";
    if (!f.resourceId) e.resourceId = "Escolha quem vai atender.";
    if (!isISODate(f.date)) e.date = "Escolha a data.";
    if (!isTime(f.time)) e.time = "Digite a hora, por exemplo 09:30.";
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720) e.duration = "Use de 5 a 720 minutos.";
    if (price === null || price < 0) e.price = "Digite o valor, por exemplo 150,00 (ou deixe em branco).";
    setErrs(e);
    if (Object.keys(e).length) return;

    let cid = f.clientId;
    if (cid === NEW_CLIENT) {
      // a recepção cadastra o cliente já sob a responsabilidade de quem vai atender
      const ownerId = canAssignClientOwner(me.roles) && resource?.userId ? resource.userId : me.userId;
      const r = await exec({
        type: "client.save",
        name: f.newClientName,
        email: "",
        phone: f.newClientPhone,
        ownerId,
      });
      if (!r.ok || !r.id) return;
      cid = r.id;
      // se o horário der problema, a nova tentativa usa o cliente já cadastrado
      setF((x) => ({ ...x, clientId: r.id!, newClientName: "", newClientPhone: "" }));
    }
    const startsAt = fromLocal(f.date, f.time);
    const r = await exec({
      type: "appointment.save",
      id: appointmentId,
      clientId: cid,
      resourceId: f.resourceId,
      serviceId: f.serviceId || null,
      itemId: f.itemId || null,
      startsAt,
      endsAt: addMinutes(startsAt, minutes),
      priceCents: price ?? 0,
      notes: f.notes,
      repeat: existing ? "nao" : f.repeat,
      times: Number(f.times) || 1,
      allowOverlap,
      packageId: f.packageId || null,
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
      title={existing ? "Remarcar horário" : "Marcar horário"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {existing ? "Salvar horário" : "Marcar horário"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="grid gap-4"
        noValidate
      >
        {fieldErrors.overlap ? (
          <InlineAlert tone="amber" title="Horário ocupado">
            <p>{fieldErrors.overlap}</p>
            <Button size="sm" className="mt-2" loading={pending} onClick={() => submit(true)}>
              Marcar mesmo assim (encaixe)
            </Button>
          </InlineAlert>
        ) : (
          error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>
        )}

        <SelectField
          label={t.Cliente}
          value={f.clientId}
          onChange={(e) => {
            set("clientId")(e.target.value);
            setF((x) => ({ ...x, itemId: "" }));
          }}
          error={err("clientId")}
          data-autofocus
        >
          <option value="">Escolha…</option>
          {!existing && <option value={NEW_CLIENT}>+ Cadastrar novo {t.cliente}</option>}
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {f.clientId === NEW_CLIENT && (
          <div className="grid gap-4 rounded-lg bg-canvas p-3 sm:grid-cols-2">
            <TextField
              label={`Nome do ${t.cliente}`}
              value={f.newClientName}
              onChange={(e) => set("newClientName")(e.target.value)}
              error={err("newClientName") ?? fieldErrors.name}
              autoComplete="off"
            />
            <TextField
              label="Telefone ou WhatsApp"
              optional
              type="tel"
              value={f.newClientPhone}
              onChange={(e) => set("newClientPhone")(e.target.value)}
              placeholder="(11) 90000-0000"
              hint="Com DDD, para mandar o lembrete."
            />
          </div>
        )}
        {itemKind && f.clientId && f.clientId !== NEW_CLIENT && (
          <SelectField
            label={ITEM_KINDS[itemKind].noun[0].charAt(0).toUpperCase() + ITEM_KINDS[itemKind].noun[0].slice(1)}
            optional
            value={f.itemId}
            onChange={(e) => set("itemId")(e.target.value)}
            error={err("itemId")}
            hint={items.length ? undefined : `Nenhum ${ITEM_KINDS[itemKind].noun[0]} cadastrado na ficha.`}
          >
            <option value="">Não informado</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.alert ? ` — atenção: ${i.alert}` : ""}
              </option>
            ))}
          </SelectField>
        )}

        {packages.length > 0 && (
          <SelectField
            label="Usar pacote"
            value={f.packageId}
            onChange={(e) => set("packageId")(e.target.value)}
            error={err("packageId")}
            hint={
              usePackage
                ? "O atendimento desconta uma sessão do pacote e não gera cobrança nova."
                : "Este cliente tem pacote com sessões livres."
            }
          >
            <option value="">Não usar pacote</option>
            {packages.map((v) => (
              <option key={v.pkg.id} value={v.pkg.id}>
                {v.pkg.name} — {v.free === 1 ? "1 sessão livre" : `${v.free} sessões livres`}
              </option>
            ))}
          </SelectField>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Quem atende"
            value={f.resourceId}
            onChange={(e) => set("resourceId")(e.target.value)}
            error={err("resourceId")}
          >
            {ag.manageable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            label="Serviço"
            optional
            value={f.serviceId}
            onChange={(e) => pickService(e.target.value)}
            hint={services.length ? "Preenche a duração e o valor." : undefined}
          >
            <option value="">Sem serviço</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <TextField
            label="Data"
            type="date"
            value={f.date}
            onChange={(e) => set("date")(e.target.value)}
            error={err("date")}
            wrapperClassName="col-span-2 sm:col-span-1"
          />
          <TextField
            label="Hora"
            type="time"
            value={f.time}
            onChange={(e) => set("time")(e.target.value)}
            error={err("time")}
          />
          <TextField
            label="Duração (min)"
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            step={5}
            value={f.duration}
            onChange={(e) => set("duration")(e.target.value)}
            error={err("duration") ?? fieldErrors.endsAt}
          />
          {usePackage ? (
            <div className="col-span-2 sm:col-span-1">
              <p className="mb-1 text-sm font-semibold">Valor</p>
              <p className="flex min-h-11 items-center text-muted">Pago no pacote</p>
            </div>
          ) : (
            <MoneyField
              label="Valor"
              optional
              value={f.price}
              onChange={(e) => set("price")(e.target.value)}
              error={err("price")}
              wrapperClassName="col-span-2 sm:col-span-1"
            />
          )}
        </div>

        {!existing && (
          <div className="grid grid-cols-2 gap-4">
            <SelectField label="Repetir" value={f.repeat} onChange={(e) => set("repeat")(e.target.value)}>
              <option value="nao">Não repete</option>
              <option value="semanal">Toda semana</option>
              <option value="quinzenal">A cada 15 dias</option>
            </SelectField>
            {f.repeat !== "nao" && (
              <SelectField
                label="Quantas vezes"
                value={f.times}
                onChange={(e) => set("times")(e.target.value)}
                hint="Contando com este horário."
              >
                {Array.from({ length: MAX_REPEAT - 1 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n} vezes
                  </option>
                ))}
              </SelectField>
            )}
          </div>
        )}

        <TextAreaField
          label="Observações"
          optional
          value={f.notes}
          onChange={(e) => set("notes")(e.target.value)}
          error={err("notes")}
          maxLength={500}
          className="min-h-16"
        />
      </form>
    </Modal>
  );
}
