"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { formatDateBR, isISODate } from "@/lib/domain/dates";
import { centsToInput, parseBRLToCents } from "@/lib/domain/money";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

/** Criar ou ajustar uma mensalidade. A cobrança de cada mês aparece sozinha no financeiro. */
export function SubscriptionDialog({
  onClose,
  clientId,
  subscriptionId,
}: DialogProps & { clientId?: string; subscriptionId?: string }) {
  const { data, today } = useBackend();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const formId = useId();
  const existing = data.subscriptions.find((s) => s.id === subscriptionId);
  const initial = {
    clientId: existing?.clientId ?? clientId ?? "",
    name: existing?.name ?? "",
    amount: existing ? centsToInput(existing.amountCents) : "",
    day: String(existing?.dayOfMonth ?? Math.min(Number(today.slice(8, 10)), 28)),
    startsOn: existing?.startsOn ?? today,
    endsOn: existing?.endsOn ?? "",
  };
  const [f, setF] = useState(initial);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrs((e) => ({ ...e, [k]: "" }));
    clearField(k === "amount" ? "amountCents" : k === "day" ? "dayOfMonth" : k);
  };
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    const amount = parseBRLToCents(f.amount);
    if (!f.clientId) er.clientId = `Escolha o ${t.cliente}.`;
    if (amount === null || amount <= 0) er.amount = "Digite o valor por mês, por exemplo 280,00.";
    if (!isISODate(f.startsOn)) er.startsOn = "Escolha a data de início.";
    if (f.endsOn && !isISODate(f.endsOn)) er.endsOn = "Data inválida.";
    setErrs(er);
    if (Object.values(er).some(Boolean)) return;
    const r = await exec({
      type: "subscription.save",
      id: subscriptionId,
      clientId: f.clientId,
      name: f.name,
      amountCents: amount ?? 0,
      dayOfMonth: Number(f.day),
      startsOn: f.startsOn,
      endsOn: f.endsOn || null,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }
  const err = (k: string, server?: string) => errs[k] || fieldErrors[server ?? k];

  return (
    <Modal
      open
      onClose={onClose}
      dirty={!same(f, initial)}
      title={existing ? `Editar ${existing.name}` : "Nova mensalidade"}
      description={
        existing
          ? "As mudanças valem para as próximas cobranças. As que já existem continuam iguais no financeiro."
          : "Todo mês, a cobrança aparece sozinha no financeiro, com vencimento no dia escolhido."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar mensalidade
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <SelectField
          label={t.Cliente}
          value={f.clientId}
          onChange={(e) => set("clientId")(e.target.value)}
          error={err("clientId")}
          disabled={Boolean(clientId || existing)}
        >
          <option value="">Escolha…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Nome"
          value={f.name}
          onChange={(e) => set("name")(e.target.value)}
          error={err("name")}
          hint="Ex.: Pilates 2x por semana, Psicoterapia mensal, Clube da barba"
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-4">
          <MoneyField
            label="Valor por mês"
            value={f.amount}
            onChange={(e) => set("amount")(e.target.value)}
            error={err("amount", "amountCents")}
          />
          <SelectField
            label="Vence todo dia"
            value={f.day}
            onChange={(e) => set("day")(e.target.value)}
            error={err("day", "dayOfMonth")}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </SelectField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          {existing ? (
            <div>
              <p className="mb-1 text-sm font-semibold">Começou em</p>
              <p className="flex min-h-11 items-center">{formatDateBR(existing.startsOn)}</p>
            </div>
          ) : (
            <TextField
              label="Começa em"
              type="date"
              value={f.startsOn}
              onChange={(e) => set("startsOn")(e.target.value)}
              error={err("startsOn")}
              hint="Pode ser uma data passada, para quem já é cliente."
            />
          )}
          <TextField
            label="Termina em"
            optional
            type="date"
            value={f.endsOn}
            onChange={(e) => set("endsOn")(e.target.value)}
            error={err("endsOn")}
            hint="Deixe em branco se não tem fim."
          />
        </div>
      </form>
    </Modal>
  );
}
