"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { ChoiceCards, MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { PlateBadge } from "@/features/workshop/plate-badge";
import { addDays, addMonths, isISODate } from "@/lib/domain/dates";
import { buildPlan } from "@/lib/domain/installments";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import type { FuelLevel, WorkOrder } from "@/lib/domain/types";
import {
  CHECKLIST_SUGGESTIONS,
  FUEL_LABEL,
  FUEL_LEVELS,
  formatPlate,
  isPlate,
  lineTotal,
  normalizePlate,
} from "@/lib/domain/work-orders";
import { useAction, useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useWorkshop } from "@/state/use-workshop";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

// ---------------------------------------------------------------- Entrada (abrir e editar)

interface EntryForm {
  resourceId: string;
  complaint: string;
  km: string;
  fuel: FuelLevel | "";
  checklist: string[];
  promisedOn: string;
}

function EntryFields({ f, set }: { f: EntryForm; set: (patch: Partial<EntryForm>) => void }) {
  const { data } = useBackend();
  const [other, setOther] = useState("");
  const extras = f.checklist.filter((c) => !CHECKLIST_SUGGESTIONS.includes(c));
  const toggle = (item: string) =>
    set({ checklist: f.checklist.includes(item) ? f.checklist.filter((c) => c !== item) : [...f.checklist, item] });
  return (
    <>
      <TextAreaField
        label="O que o cliente relatou"
        value={f.complaint}
        maxLength={1000}
        onChange={(e) => set({ complaint: e.target.value })}
        placeholder="Ex.: barulho na suspensão dianteira em buracos"
        className="min-h-20"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Km"
          optional
          inputMode="numeric"
          value={f.km}
          onChange={(e) => set({ km: e.target.value.replace(/\D/g, "").slice(0, 7) })}
          className="tabular"
        />
        <SelectField
          label="Combustível"
          optional
          value={f.fuel}
          onChange={(e) => set({ fuel: e.target.value as FuelLevel | "" })}
        >
          <option value="">—</option>
          {FUEL_LEVELS.map((l) => (
            <option key={l} value={l}>
              {FUEL_LABEL[l]}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Previsão de entrega"
          optional
          type="date"
          value={f.promisedOn}
          onChange={(e) => set({ promisedOn: e.target.value })}
        />
      </div>
      <SelectField
        label="Mecânico"
        optional
        value={f.resourceId}
        onChange={(e) => set({ resourceId: e.target.value })}
        hint="Ligado a alguém da equipe, o mecânico vê a OS no celular. Cadastre em Serviços e equipe."
      >
        <option value="">Definir depois</option>
        {data.resources
          .filter((r) => r.active || r.id === f.resourceId)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
      </SelectField>
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Conferido na entrada</legend>
        <div className="flex flex-wrap gap-1.5">
          {[...CHECKLIST_SUGGESTIONS, ...extras].map((c) => {
            const on = f.checklist.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c)}
                className={cx(
                  "min-h-9 rounded-full border px-3 text-sm",
                  on
                    ? "border-primary bg-primary-50 font-semibold text-primary-700"
                    : "border-[#c5cfdf] bg-white text-muted",
                )}
              >
                {on ? "✓ " : ""}
                {c}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-2">
          <TextField
            label={<span className="sr-only">Outro item ou avaria</span>}
            value={other}
            maxLength={60}
            placeholder="Outro item ou avaria (ex.: risco na porta)"
            onChange={(e) => setOther(e.target.value)}
            wrapperClassName="flex-1"
            className="min-h-10"
          />
          <Button
            variant="secondary"
            disabled={!other.trim() || f.checklist.length >= 30}
            onClick={() => {
              if (!f.checklist.includes(other.trim())) set({ checklist: [...f.checklist, other.trim()] });
              setOther("");
            }}
          >
            Incluir
          </Button>
        </div>
      </fieldset>
    </>
  );
}

const entryPayload = (f: EntryForm) => ({
  resourceId: f.resourceId || null,
  complaint: f.complaint.trim(),
  km: f.km ? Number(f.km) : null,
  fuel: f.fuel || null,
  checklist: f.checklist,
  promisedOn: isISODate(f.promisedOn) ? f.promisedOn : null,
});

/** Nova OS: começa pela placa. Carro conhecido já traz o cliente; carro novo é cadastrado ali mesmo. */
export function WorkOrderNewDialog({
  onClose,
  clientId,
  itemId,
}: DialogProps & { clientId?: string; itemId?: string }) {
  const { data, me, today } = useBackend();
  const router = useRouter();
  const nav = useNav();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const preset = data.items.find((i) => i.id === itemId);
  const [plate, setPlate] = useState(formatPlate(preset?.plate));
  const [newCar, setNewCar] = useState({ model: "", brand: "", clientId: clientId ?? "", clientName: "", phone: "" });
  const [entry, setEntry] = useState<EntryForm>({
    resourceId: "",
    complaint: "",
    km: "",
    fuel: "",
    checklist: [],
    promisedOn: addDays(today, 1),
  });
  const [requestId] = useState(() => crypto.randomUUID());
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const norm = normalizePlate(plate);
  const found = isPlate(norm) ? data.items.find((i) => i.kind === "veiculo" && i.plate === norm) : undefined;
  const owner = found && data.clients.find((c) => c.id === found.clientId);
  const busy =
    found && data.workOrders.find((w) => w.itemId === found.id && w.stage !== "entregue" && w.stage !== "cancelada");
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (!isPlate(norm)) return setLocalError("Digite a placa com 7 letras e números, como ABC1D23 ou ABC-1234.");
    let vehicleId = found?.id;
    let ownerId = found?.clientId;
    if (!found) {
      if (!newCar.model.trim()) return setLocalError("Digite o modelo do carro.");
      ownerId = newCar.clientId || undefined;
      if (!ownerId) {
        if (newCar.clientName.trim().length < 2)
          return setLocalError("Escolha o cliente ou digite o nome do cliente novo.");
        const c = await exec({
          type: "client.save",
          name: newCar.clientName.trim(),
          email: "",
          phone: newCar.phone.trim(),
          ownerId: me.userId,
        });
        if (!c.ok || !c.id) return;
        ownerId = c.id;
      }
      const v = await exec({
        type: "item.save",
        clientId: ownerId,
        kind: "veiculo",
        name: newCar.model.trim(),
        details: newCar.brand.trim() ? { marca: newCar.brand.trim() } : {},
        alert: "",
        plate: norm,
      });
      if (!v.ok || !v.id) return;
      vehicleId = v.id;
    }
    const r = await exec({
      type: "workOrder.open",
      clientId: ownerId!,
      itemId: vehicleId!,
      ...entryPayload(entry),
      requestId,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
      if (r.id) router.push(nav.href(`/oficina/${r.id}`));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dirty={plate !== "" || entry.complaint !== ""}
      title="Nova ordem de serviço"
      description="Comece pela placa: se o carro já veio antes, o cliente aparece sozinho."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Abrir OS
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <TextField
          label="Placa"
          value={plate}
          maxLength={8}
          onChange={(e) => {
            setPlate(e.target.value.toUpperCase());
            setLocalError(null);
          }}
          error={fieldErrors.plate}
          className="font-mono text-lg uppercase tracking-widest"
          autoComplete="off"
          autoCapitalize="characters"
          hint="Ex.: ABC1D23 ou ABC-1234"
          data-autofocus
        />
        {found && owner ? (
          <div className="rounded-lg bg-canvas p-3">
            <p className="font-semibold">
              <PlateBadge plate={formatPlate(found.plate)} className="mr-2" />
              {found.name} · {owner.name}
            </p>
            <p className="text-sm text-muted">
              {data.workOrders.filter((w) => w.itemId === found.id).length} OS anteriores com esta placa.
            </p>
            {busy && (
              <p className="mt-1 text-sm font-semibold text-warn">
                Atenção: este carro já está no pátio na OS nº {busy.number}.
              </p>
            )}
          </div>
        ) : (
          isPlate(norm) && (
            <fieldset className="grid gap-3 rounded-lg border border-line p-3">
              <legend className="px-1 text-sm font-semibold">Carro novo por aqui</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Modelo"
                  value={newCar.model}
                  maxLength={80}
                  placeholder="Ex.: Onix LT"
                  onChange={(e) => setNewCar((x) => ({ ...x, model: e.target.value }))}
                />
                <TextField
                  label="Marca"
                  optional
                  value={newCar.brand}
                  maxLength={60}
                  placeholder="Ex.: Chevrolet"
                  onChange={(e) => setNewCar((x) => ({ ...x, brand: e.target.value }))}
                />
              </div>
              <SelectField
                label="Cliente"
                value={newCar.clientId}
                onChange={(e) => setNewCar((x) => ({ ...x, clientId: e.target.value }))}
              >
                <option value="">Cliente novo (digitar abaixo)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </SelectField>
              {!newCar.clientId && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Nome do cliente"
                    value={newCar.clientName}
                    maxLength={120}
                    onChange={(e) => setNewCar((x) => ({ ...x, clientName: e.target.value }))}
                    autoComplete="off"
                  />
                  <TextField
                    label="Celular com DDD"
                    type="tel"
                    inputMode="tel"
                    value={newCar.phone}
                    maxLength={30}
                    onChange={(e) => setNewCar((x) => ({ ...x, phone: e.target.value }))}
                    hint="Para mandar o orçamento e avisar quando ficar pronto."
                  />
                </div>
              )}
            </fieldset>
          )
        )}
        <EntryFields f={entry} set={(p) => setEntry((x) => ({ ...x, ...p }))} />
      </form>
    </Modal>
  );
}

export function WorkOrderEditDialog({ onClose, workOrderId }: DialogProps & { workOrderId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const w = data.workOrders.find((x) => x.id === workOrderId);
  const [entry, setEntry] = useState<EntryForm>({
    resourceId: w?.resourceId ?? "",
    complaint: w?.complaint ?? "",
    km: w?.km !== null && w?.km !== undefined ? String(w.km) : "",
    fuel: w?.fuel ?? "",
    checklist: w?.checklist ?? [],
    promisedOn: w?.promisedOn ?? "",
  });
  const formId = useId();
  if (!w) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({ type: "workOrder.save", id: workOrderId, ...entryPayload(entry) });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Entrada da OS nº ${w.number}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && <InlineAlert>{error}</InlineAlert>}
        <EntryFields f={entry} set={(p) => setEntry((x) => ({ ...x, ...p }))} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Itens do orçamento

const WARRANTY_OPTIONS = [
  { days: 0, label: "Sem garantia" },
  { days: 30, label: "30 dias" },
  { days: 90, label: "90 dias" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "1 ano" },
];

export function WorkOrderItemDialog({
  onClose,
  workOrderId,
  itemKind = "peca",
}: DialogProps & { workOrderId: string; itemKind?: "peca" | "servico" }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const [f, setF] = useState({ kind: itemKind, serviceId: "", description: "", quantity: "1", price: "", warranty: 0 });
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const services = data.services.filter((s) => s.active);
  const cents = parseBRLToCents(f.price);
  const qty = Number(f.quantity) || 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (cents === null || cents < 0) return setLocalError("Digite o valor, por exemplo 120,00.");
    if (qty < 1) return setLocalError("A quantidade precisa ser pelo menos 1.");
    setLocalError(null);
    const r = await exec({
      type: "workOrder.addItem",
      workOrderId,
      kind: f.kind,
      serviceId: f.kind === "servico" && f.serviceId ? f.serviceId : null,
      description: f.description.trim(),
      quantity: qty,
      unitCents: cents,
      warrantyDays: f.warranty || null,
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
      title={f.kind === "peca" ? "Incluir peça" : "Incluir mão de obra"}
      description="Entra no orçamento aguardando a aprovação do cliente."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Incluir{cents && qty ? ` · ${formatBRL(cents * qty)}` : ""}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || (error && !Object.keys(fieldErrors).length)) && (
          <InlineAlert>{localError ?? error}</InlineAlert>
        )}
        <div className="flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Tipo">
          {(
            [
              ["peca", "Peça"],
              ["servico", "Mão de obra"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={f.kind === k}
              onClick={() => setF((x) => ({ ...x, kind: k, serviceId: "" }))}
              className={cx(
                "min-h-10 flex-1 rounded-md px-3 text-sm font-semibold",
                f.kind === k ? "bg-primary text-white" : "text-muted hover:bg-canvas",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {f.kind === "servico" && services.length > 0 && (
          <SelectField
            label="Serviço da lista"
            optional
            value={f.serviceId}
            onChange={(e) => {
              const s = services.find((x) => x.id === e.target.value);
              setF((x) => ({
                ...x,
                serviceId: e.target.value,
                description: s ? s.name : x.description,
                price: s && s.priceCents > 0 ? centsToInput(s.priceCents) : x.price,
              }));
            }}
            hint="Usar a lista ajuda na comissão por serviço."
          >
            <option value="">Digitar</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.priceCents > 0 ? ` — ${formatBRL(s.priceCents)}` : ""}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Descrição"
          value={f.description}
          maxLength={120}
          onChange={(e) => {
            setF((x) => ({ ...x, description: e.target.value }));
            clearField("description");
          }}
          error={fieldErrors.description}
          placeholder={f.kind === "peca" ? "Ex.: Pastilha de freio dianteira" : "Ex.: Troca das pastilhas"}
          autoComplete="off"
          data-autofocus
        />
        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <TextField
            label="Qtd."
            inputMode="numeric"
            value={f.quantity}
            onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
          />
          <MoneyField
            label={f.kind === "peca" ? "Valor de cada" : "Valor"}
            value={f.price}
            onChange={(e) => {
              setF((x) => ({ ...x, price: e.target.value }));
              setLocalError(null);
            }}
          />
        </div>
        <SelectField
          label="Garantia"
          value={f.warranty}
          onChange={(e) => setF((x) => ({ ...x, warranty: Number(e.target.value) }))}
        >
          {WARRANTY_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Aprovação na oficina ou por telefone

export function WorkOrderApproveDialog({ onClose, workOrderId }: DialogProps & { workOrderId: string }) {
  const { data } = useBackend();
  const ws = useWorkshop();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const w = data.workOrders.find((x) => x.id === workOrderId);
  const pendingItems = w ? ws.itemsFor(w).filter((i) => i.status === "pendente") : [];
  const [chosen, setChosen] = useState<string[]>(pendingItems.map((i) => i.id));
  const [channel, setChannel] = useState<"presencial" | "telefone" | "whatsapp">("presencial");
  const [name, setName] = useState(w ? (ws.client(w)?.name ?? "") : "");
  const formId = useId();
  if (!w) return null;
  const sum = pendingItems.filter((i) => chosen.includes(i.id)).reduce((s, i) => s + lineTotal(i), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({
      type: "workOrder.approve",
      id: workOrderId,
      approvedIds: chosen,
      channel,
      name: name.trim(),
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
      title="Registrar aprovação"
      description="Marque o que o cliente autorizou. O que ficar desmarcado é registrado como recusado."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant={chosen.length ? "money" : "primary"} loading={pending}>
            {chosen.length ? `Aprovar ${formatBRL(sum)}` : "Registrar recusa"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && <InlineAlert>{error}</InlineAlert>}
        <ul className="grid gap-1">
          {pendingItems.map((i) => (
            <li key={i.id}>
              <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={chosen.includes(i.id)}
                  onChange={(e) => setChosen((c) => (e.target.checked ? [...c, i.id] : c.filter((x) => x !== i.id)))}
                />
                <span className="flex-1">
                  {i.quantity > 1 && `${i.quantity} × `}
                  {i.description}
                  <span className="block text-sm text-muted">{i.kind === "peca" ? "Peça" : "Mão de obra"}</span>
                </span>
                <span className="font-semibold tabular">{formatBRL(lineTotal(i))}</span>
              </label>
            </li>
          ))}
        </ul>
        <ChoiceCards
          legend="Como o cliente aprovou"
          name="canal"
          value={channel}
          onChange={setChannel}
          options={[
            { value: "presencial", label: "Na oficina" },
            { value: "telefone", label: "Por telefone" },
            { value: "whatsapp", label: "Pelo WhatsApp" },
          ]}
        />
        <TextField
          label="Quem aprovou"
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          error={fieldErrors.name}
          hint="Fica registrado com a data e a hora."
        />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Entrega

export function WorkOrderDeliverDialog({ onClose, workOrderId }: DialogProps & { workOrderId: string }) {
  const { data, today } = useBackend();
  const ws = useWorkshop();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const w = data.workOrders.find((x) => x.id === workOrderId) as WorkOrder | undefined;
  const [count, setCount] = useState(1);
  const [firstDue, setFirstDue] = useState(today);
  const [nextOn, setNextOn] = useState("");
  const [nextNote, setNextNote] = useState("");
  const formId = useId();
  if (!w) return null;
  const t = ws.totalsFor(w);
  const pendingCount = ws.itemsFor(w).filter((i) => i.status === "pendente").length;
  const plan = t.total > 0 && isISODate(firstDue) ? buildPlan(t.total, count, firstDue) : [];
  const quick = [
    { label: "Troca de óleo em 6 meses", date: addMonths(today, 6), note: "Troca de óleo" },
    { label: "Revisão em 1 ano", date: addMonths(today, 12), note: "Revisão anual" },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({
      type: "workOrder.deliver",
      id: workOrderId,
      plan,
      nextServiceOn: isISODate(nextOn) ? nextOn : null,
      nextServiceNote: nextOn ? nextNote.trim() : "",
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
      title={`Entregar o ${ws.vehicleName(w)}`}
      description="O valor aprovado vai para o financeiro como conta a receber."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} variant="money" loading={pending} disabled={pendingCount > 0}>
            Entregar{t.total > 0 ? ` e cobrar ${formatBRL(t.total)}` : ""}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {pendingCount > 0 && (
          <InlineAlert tone="amber">
            {pendingCount === 1 ? "1 item aguarda" : `${pendingCount} itens aguardam`} a decisão do cliente. Registre a
            aprovação ou tire os itens antes de entregar.
          </InlineAlert>
        )}
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="flex items-baseline justify-between rounded-lg bg-canvas px-3 py-2">
          <span className="font-semibold">Total a cobrar</span>
          <span className="font-display text-xl font-extrabold tabular">{formatBRL(t.total)}</span>
        </div>
        {t.total > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Pagamento" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              <option value={1}>À vista</option>
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}x de {formatBRL(Math.floor(t.total / n))}
                </option>
              ))}
            </SelectField>
            <TextField
              label={count === 1 ? "Vencimento" : "1ª parcela vence em"}
              type="date"
              value={firstDue}
              onChange={(e) => setFirstDue(e.target.value)}
            />
          </div>
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">
            Próxima revisão <span className="font-normal text-muted">(opcional)</span>
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                aria-pressed={nextOn === q.date && nextNote === q.note}
                onClick={() => {
                  setNextOn(q.date);
                  setNextNote(q.note);
                }}
                className={cx(
                  "min-h-9 rounded-full border px-3 text-sm",
                  nextOn === q.date && nextNote === q.note
                    ? "border-primary bg-primary-50 font-semibold text-primary-700"
                    : "border-[#c5cfdf] bg-white text-muted",
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Data"
              type="date"
              value={nextOn}
              min={today}
              onChange={(e) => setNextOn(e.target.value)}
            />
            <TextField
              label="O quê"
              value={nextNote}
              maxLength={200}
              placeholder="Ex.: Troca de óleo"
              onChange={(e) => setNextNote(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted">
            A oficina vê a lista de revisões chegando e lembra o cliente pelo WhatsApp.
          </p>
        </fieldset>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Cancelar e transferir

export function WorkOrderCancelDialog({ onClose, workOrderId }: DialogProps & { workOrderId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const [reason, setReason] = useState("");
  const formId = useId();
  const w = data.workOrders.find((x) => x.id === workOrderId);
  if (!w) return null;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Cancelar a OS nº ${w.number}`}
      description="A OS fica no histórico como cancelada. Nada é cobrado."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={pending}>
            Cancelar OS
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await exec({ type: "workOrder.cancel", id: workOrderId, reason: reason.trim() });
          if (r.ok) {
            toast({ tone: "success", text: r.message });
            onClose();
          }
        }}
        className="grid gap-4"
        noValidate
      >
        {error && !fieldErrors.reason && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label="Motivo"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          error={fieldErrors.reason}
          placeholder="Ex.: cliente desistiu do serviço"
          data-autofocus
        />
      </form>
    </Modal>
  );
}

export function VehicleTransferDialog({ onClose, itemId }: DialogProps & { itemId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const [clientId, setClientId] = useState("");
  const formId = useId();
  const item = data.items.find((i) => i.id === itemId);
  if (!item) return null;
  const options = data.clients.filter((c) => c.id !== item.clientId).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`${item.name} mudou de dono`}
      description="O histórico de serviços continua com a placa. Cadastre o novo dono antes, se ainda não existir."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!clientId}>
            Transferir
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await exec({ type: "vehicle.transfer", itemId, clientId });
          if (r.ok) {
            toast({ tone: "success", text: r.message });
            onClose();
          }
        }}
        className="grid gap-4"
        noValidate
      >
        {error && <InlineAlert>{error}</InlineAlert>}
        <SelectField label="Novo dono" value={clientId} onChange={(e) => setClientId(e.target.value)} data-autofocus>
          <option value="">Escolha…</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
      </form>
    </Modal>
  );
}
