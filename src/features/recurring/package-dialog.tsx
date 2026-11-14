"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { addDays, formatDateBR, isISODate } from "@/lib/domain/dates";
import { buildPlan } from "@/lib/domain/installments";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { ITEM_KINDS, itemKindFor } from "@/lib/domain/segments";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useId, useState } from "react";

const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");

/** Vender um pacote de sessões. O valor vira contas a receber (à vista ou parcelado). */
export function PackageDialog({ onClose, clientId }: DialogProps & { clientId?: string }) {
  const { data, today } = useBackend();
  const t = useTerms();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const formId = useId();
  // o mesmo pedido em todas as tentativas: um clique repetido não vende duas vezes
  const [requestId] = useState(newRequestId);
  const itemKind = itemKindFor(data.company);
  const initial = {
    clientId: clientId ?? "",
    itemId: "",
    serviceId: "",
    name: "",
    sessions: "10",
    price: "",
    validUntil: addDays(today, 90),
    installments: "1",
    firstDue: today,
  };
  const [f, setF] = useState(initial);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrs((e) => ({ ...e, [k]: "" }));
    clearField(k);
  };
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const services = data.services.filter((s) => s.active);
  const items = data.items.filter((i) => i.clientId === f.clientId && i.active);
  const priceCents = f.price.trim() ? parseBRLToCents(f.price) : 0;
  const count = Number(f.installments);
  const plan = priceCents && priceCents > 0 && isISODate(f.firstDue) ? buildPlan(priceCents, count, f.firstDue) : [];

  function pickService(serviceId: string) {
    const s = data.services.find((x) => x.id === serviceId);
    const sessions = Number(f.sessions) || 10;
    setF((x) => ({
      ...x,
      serviceId,
      name: s ? `${sessions} × ${s.name}` : x.name,
      price: s && s.priceCents > 0 ? centsToInput(s.priceCents * sessions) : x.price,
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    const sessions = Number(f.sessions);
    if (!f.clientId) er.clientId = `Escolha o ${t.cliente}.`;
    if (!Number.isInteger(sessions) || sessions < 1 || sessions > 200) er.sessions = "Use de 1 a 200 sessões.";
    if (priceCents === null || priceCents < 0) er.price = "Digite o valor, por exemplo 900,00 (ou deixe em branco).";
    if (f.validUntil && !isISODate(f.validUntil)) er.validUntil = "Data inválida.";
    setErrs(er);
    if (Object.values(er).some(Boolean)) return;
    const r = await exec({
      type: "package.sell",
      clientId: f.clientId,
      serviceId: f.serviceId || null,
      itemId: f.itemId || null,
      name: f.name,
      sessions,
      priceCents: priceCents ?? 0,
      validUntil: f.validUntil || null,
      plan,
      requestId,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }
  const err = (k: string) => errs[k] || fieldErrors[k];

  return (
    <Modal
      open
      onClose={onClose}
      dirty={!same(f, initial)}
      title="Vender pacote"
      description="Cada atendimento marcado com o pacote desconta uma sessão e não gera cobrança nova."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Vender pacote
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <SelectField
          label={t.Cliente}
          value={f.clientId}
          onChange={(e) => {
            set("clientId")(e.target.value);
            setF((x) => ({ ...x, itemId: "" }));
          }}
          error={err("clientId")}
          disabled={Boolean(clientId)}
        >
          <option value="">Escolha…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {itemKind && f.clientId && (
          <SelectField
            label={ITEM_KINDS[itemKind].noun[0].replace(/^./, (c) => c.toUpperCase())}
            optional
            value={f.itemId}
            onChange={(e) => set("itemId")(e.target.value)}
            error={err("itemId")}
          >
            <option value="">Qualquer um</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </SelectField>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <SelectField
            label="Serviço"
            optional
            value={f.serviceId}
            onChange={(e) => pickService(e.target.value)}
            hint="Preenche o nome e o valor."
          >
            <option value="">Sem serviço</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Sessões"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={f.sessions}
            onChange={(e) => set("sessions")(e.target.value)}
            error={err("sessions")}
          />
        </div>
        <TextField
          label="Nome do pacote"
          value={f.name}
          onChange={(e) => set("name")(e.target.value)}
          error={err("name")}
          hint="Ex.: 10 sessões de fisioterapia, 4 banhos por mês"
          autoComplete="off"
        />
        <div className="grid grid-cols-2 gap-4">
          <MoneyField
            label="Valor total"
            optional
            value={f.price}
            onChange={(e) => set("price")(e.target.value)}
            error={err("price")}
          />
          <TextField
            label="Vale até"
            optional
            type="date"
            value={f.validUntil}
            onChange={(e) => set("validUntil")(e.target.value)}
            error={err("validUntil")}
          />
        </div>
        {priceCents !== null && priceCents > 0 && (
          <div className="grid gap-3 rounded-lg bg-canvas p-3">
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label="Pagamento"
                value={f.installments}
                onChange={(e) => set("installments")(e.target.value)}
              >
                <option value="1">À vista</option>
                {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n} parcelas
                  </option>
                ))}
              </SelectField>
              <TextField
                label={count > 1 ? "1ª parcela vence em" : "Vence em"}
                type="date"
                value={f.firstDue}
                onChange={(e) => set("firstDue")(e.target.value)}
              />
            </div>
            {plan.length > 1 && (
              <ul className="grid gap-1 text-sm tabular text-muted">
                {plan.map((p) => (
                  <li key={p.number}>
                    {p.number}ª · {formatBRL(p.amountCents)} · vence {formatDateBR(p.dueDate)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted">As cobranças vão para o financeiro, como contas a receber.</p>
          </div>
        )}
      </form>
    </Modal>
  );
}
