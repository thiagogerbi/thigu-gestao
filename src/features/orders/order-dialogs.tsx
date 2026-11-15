"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { IconPlus, IconX } from "@/components/ui/icons";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { COUNTER_METHODS } from "@/features/cash/cash-sale-dialog";
import { openSession } from "@/lib/domain/cash";
import { addDays, isISODate } from "@/lib/domain/dates";
import { buildPlan } from "@/lib/domain/installments";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { defaultValidity, formatDiopter, orderRest, parseDiopter, prescriptionError } from "@/lib/domain/orders";
import { productLabel, searchProducts, stockOf } from "@/lib/domain/stock";
import { METHOD_LABEL, type EyeValues, type PaymentMethod, type Product } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useOrders } from "@/state/use-orders";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

function MethodPicker({
  value,
  onChange,
  name,
}: {
  value: PaymentMethod;
  onChange: (m: PaymentMethod) => void;
  name: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {COUNTER_METHODS.map((m) => (
        <label
          key={m}
          className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm font-semibold has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30 ${value === m ? "border-primary bg-primary-50 text-primary-700" : "border-[#c5cfdf] bg-white"}`}
        >
          <input type="radio" name={name} className="sr-only" checked={value === m} onChange={() => onChange(m)} />
          {METHOD_LABEL[m]}
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Novo pedido

interface Line {
  key: number;
  productId: string | null;
  description: string;
  quantity: number;
  price: string;
}

export function OrderNewDialog({ onClose, clientId: presetClient }: DialogProps & { clientId?: string }) {
  const { data, me, today } = useBackend();
  const od = useOrders();
  const router = useRouter();
  const nav = useNav();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const [clientId, setClientId] = useState(presetClient ?? "");
  const [newClient, setNewClient] = useState({ name: "", phone: "" });
  const [f, setF] = useState({
    title: "",
    details: "",
    promisedOn: addDays(today, 7),
    resourceId: "",
    prescriptionId: "",
  });
  const [lines, setLines] = useState<Line[]>([{ key: 1, productId: null, description: "", quantity: 1, price: "" }]);
  const [search, setSearch] = useState("");
  const [down, setDown] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [requestId] = useState(() => crypto.randomUUID());
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name));
  const rxs = data.prescriptions
    .filter((p) => p.clientId === clientId)
    .sort((a, b) => b.examinedOn.localeCompare(a.examinedOn));
  const results = search.trim().length >= 2 ? searchProducts(data.products, search, 6) : [];
  const cents = (l: Line) => parseBRLToCents(l.price);
  const total = lines.reduce((s, l) => s + (cents(l) ?? 0) * l.quantity, 0);
  const downCents = down.trim() ? (parseBRLToCents(down) ?? -1) : 0;
  const session = openSession(data.cashSessions);
  const nextKey = () => lines.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  function addProduct(p: Product) {
    setSearch("");
    setLines((ls) => {
      const blank = ls.find((l) => !l.description && !l.price);
      const line = {
        key: nextKey(),
        productId: p.id,
        description: productLabel(p),
        quantity: 1,
        price: centsToInput(p.priceCents),
      };
      return blank ? ls.map((l) => (l === blank ? { ...line, key: l.key } : l)) : [...ls, line];
    });
  }
  const update = (key: number, patch: Partial<Line>) => {
    setLocalError(null);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    const used = lines.filter((l) => l.description.trim() || l.price.trim());
    if (!used.length) return setLocalError("Adicione pelo menos um item com valor.");
    if (used.some((l) => !l.description.trim() || cents(l) === null || cents(l)! < 0))
      return setLocalError("Confira os itens: cada um precisa de descrição e valor (pode ser 0,00).");
    if (downCents < 0) return setLocalError("Digite o sinal, por exemplo 100,00.");
    if (downCents > total) return setLocalError("O sinal não pode passar do total.");
    if (downCents > 0 && !session) return setLocalError("Abra o caixa para receber o sinal.");
    let cid = clientId;
    if (!cid) {
      if (newClient.name.trim().length < 2) return setLocalError("Escolha o cliente ou digite o nome do cliente novo.");
      const c = await exec({
        type: "client.save",
        name: newClient.name.trim(),
        email: "",
        phone: newClient.phone.trim(),
        ownerId: me.userId,
      });
      if (!c.ok || !c.id) return;
      cid = c.id;
      setClientId(c.id);
    }
    const r = await exec({
      type: "order.open",
      clientId: cid,
      title: f.title.trim(),
      details: f.details.trim(),
      promisedOn: f.promisedOn,
      resourceId: f.resourceId || null,
      prescriptionId: f.prescriptionId || null,
      items: used.map((l) => ({
        productId: l.productId,
        description: l.description.trim(),
        quantity: l.quantity,
        unitCents: cents(l)!,
      })),
      downCents,
      method: downCents > 0 ? method : null,
      requestId,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
      if (r.id) router.push(nav.href(`/pedidos/${r.id}`));
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      dirty={!!f.title || lines.some((l) => l.description)}
      title="Novo pedido"
      description="O que será feito, para quando, quanto custa e o sinal pago agora."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Abrir pedido{total > 0 ? ` · ${formatBRL(total)}` : ""}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || (error && !Object.keys(fieldErrors).length)) && (
          <InlineAlert>{localError ?? error}</InlineAlert>
        )}
        <SelectField
          label="Cliente"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setF((x) => ({ ...x, prescriptionId: "" }));
          }}
          data-autofocus
        >
          <option value="">Cliente novo (digitar abaixo)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        {!clientId && (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Nome do cliente"
              value={newClient.name}
              maxLength={120}
              onChange={(e) => setNewClient((x) => ({ ...x, name: e.target.value }))}
            />
            <TextField
              label="Celular com DDD"
              type="tel"
              inputMode="tel"
              value={newClient.phone}
              maxLength={30}
              onChange={(e) => setNewClient((x) => ({ ...x, phone: e.target.value }))}
              hint="Para avisar quando ficar pronto."
            />
          </div>
        )}
        <TextField
          label="O que é"
          value={f.title}
          maxLength={120}
          onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
          error={fieldErrors.title}
          placeholder="Ex.: Óculos multifocal, Ajuste de barra, Banner 2×1"
        />
        <TextAreaField
          label="Detalhes"
          optional
          value={f.details}
          maxLength={1000}
          onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))}
          className="min-h-16"
        />
        {od.readsRx && clientId && (
          <SelectField
            label="Receita"
            optional
            value={f.prescriptionId}
            onChange={(e) => setF((x) => ({ ...x, prescriptionId: e.target.value }))}
            hint={rxs.length ? undefined : "Este cliente ainda não tem receita lançada (lance na ficha dele)."}
          >
            <option value="">Sem receita</option>
            {rxs.map((p) => (
              <option key={p.id} value={p.id}>
                Exame de {p.examinedOn.split("-").reverse().join("/")} · OD {formatDiopter(p.od.sph)} · OE{" "}
                {formatDiopter(p.oe.sph)}
              </option>
            ))}
          </SelectField>
        )}

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">Itens e valores</legend>
          {data.products.length > 0 && (
            <div>
              <TextField
                label={<span className="sr-only">Buscar produto</span>}
                value={search}
                placeholder="Buscar produto do estoque (armação, tecido…)"
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
              {results.length > 0 && (
                <ul className="mt-1 rounded-lg border border-line bg-white shadow-card">
                  {results.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => addProduct(p)}
                        className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-canvas"
                      >
                        <span className="truncate">{productLabel(p)}</span>
                        <span className="shrink-0 text-sm tabular">
                          {formatBRL(p.priceCents)}
                          {p.trackStock && (
                            <span className={cx("ml-2", stockOf(p) <= 0 ? "text-danger" : "text-muted")}>
                              tem {stockOf(p)}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_5rem_8rem_auto]">
              <TextField
                label={<span className="sr-only">Item</span>}
                value={l.description}
                maxLength={120}
                placeholder="Item ou serviço"
                onChange={(e) =>
                  update(l.key, {
                    description: e.target.value,
                    productId: l.productId && e.target.value ? l.productId : null,
                  })
                }
                wrapperClassName="col-span-2 sm:col-span-1"
              />
              <TextField
                label={<span className="sr-only">Quantidade</span>}
                type="number"
                min={1}
                max={999}
                value={l.quantity}
                onChange={(e) => update(l.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
              />
              <TextField
                label={<span className="sr-only">Valor</span>}
                prefix="R$"
                inputMode="decimal"
                placeholder="0,00"
                className="tabular"
                value={l.price}
                onChange={(e) => update(l.key, { price: e.target.value })}
              />
              <IconButton
                label="Tirar item"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
              >
                <IconX className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() =>
              setLines((ls) => [...ls, { key: nextKey(), productId: null, description: "", quantity: 1, price: "" }])
            }
          >
            <IconPlus className="h-4 w-4" /> Mais um item
          </Button>
          <p className="text-right font-display text-lg font-extrabold tabular">Total {formatBRL(total)}</p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Prometido para"
            type="date"
            value={f.promisedOn}
            min={today}
            onChange={(e) => setF((x) => ({ ...x, promisedOn: e.target.value }))}
            error={fieldErrors.promisedOn}
          />
          <SelectField
            label="Técnico"
            optional
            value={f.resourceId}
            onChange={(e) => setF((x) => ({ ...x, resourceId: e.target.value }))}
          >
            <option value="">Definir depois</option>
            {data.resources
              .filter((r) => r.active)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </SelectField>
        </div>
        <div className="grid gap-2 rounded-lg bg-canvas p-3">
          <MoneyField
            label="Sinal pago agora"
            optional
            value={down}
            onChange={(e) => {
              setDown(e.target.value);
              setLocalError(null);
            }}
            hint={session ? "Entra no caixa aberto." : "Para receber sinal, abra o caixa do dia."}
            wrapperClassName="max-w-xs"
          />
          {downCents > 0 && <MethodPicker value={method} onChange={setMethod} name="metodo-sinal" />}
          {total > 0 && downCents >= 0 && (
            <p className="text-sm text-muted">Restante na entrega: {formatBRL(Math.max(0, total - downCents))}</p>
          )}
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Editar, entregar, cancelar

export function OrderEditDialog({ onClose, orderId }: DialogProps & { orderId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const o = data.orders.find((x) => x.id === orderId);
  const [f, setF] = useState({
    title: o?.title ?? "",
    details: o?.details ?? "",
    promisedOn: o?.promisedOn ?? "",
    resourceId: o?.resourceId ?? "",
  });
  const formId = useId();
  if (!o) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar pedido nº ${o.number}`}
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
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await exec({
            type: "order.save",
            id: orderId,
            title: f.title.trim(),
            details: f.details.trim(),
            promisedOn: f.promisedOn,
            resourceId: f.resourceId || null,
          });
          if (r.ok) {
            toast({ tone: "success", text: r.message });
            onClose();
          }
        }}
        className="grid gap-4"
        noValidate
      >
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label="O que é"
          value={f.title}
          maxLength={120}
          onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))}
          error={fieldErrors.title}
        />
        <TextAreaField
          label="Detalhes"
          optional
          value={f.details}
          maxLength={1000}
          onChange={(e) => setF((x) => ({ ...x, details: e.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Prometido para"
            type="date"
            value={f.promisedOn}
            onChange={(e) => setF((x) => ({ ...x, promisedOn: e.target.value }))}
          />
          <SelectField
            label="Técnico"
            optional
            value={f.resourceId}
            onChange={(e) => setF((x) => ({ ...x, resourceId: e.target.value }))}
          >
            <option value="">Sem técnico</option>
            {data.resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </SelectField>
        </div>
        <p className="text-sm text-muted">
          Itens e valores não mudam depois de aberto. Se mudou muito, cancele e abra outro.
        </p>
      </form>
    </Modal>
  );
}

export function OrderDeliverDialog({ onClose, orderId }: DialogProps & { orderId: string }) {
  const { data, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const o = data.orders.find((x) => x.id === orderId);
  const [mode, setMode] = useState<"agora" | "parcelado">("agora");
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [count, setCount] = useState(2);
  const [firstDue, setFirstDue] = useState(addDays(today, 30));
  const [requestId] = useState(() => crypto.randomUUID());
  const formId = useId();
  if (!o) return null;
  const rest = orderRest(o);
  const session = openSession(data.cashSessions);
  const plan = rest > 0 && mode === "parcelado" && isISODate(firstDue) ? buildPlan(rest, count, firstDue) : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Entregar o pedido nº ${o.number}`}
      description={rest > 0 ? `Falta pagar ${formatBRL(rest)}.` : "Já está todo pago."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="money"
            loading={pending}
            disabled={rest > 0 && mode === "agora" && !session}
          >
            {rest > 0
              ? mode === "agora"
                ? `Receber ${formatBRL(rest)} e entregar`
                : "Parcelar e entregar"
              : "Entregar"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await exec({
            type: "order.deliver",
            id: orderId,
            method: rest > 0 && mode === "agora" ? method : null,
            plan,
            requestId,
          });
          if (r.ok) {
            toast({ tone: "success", text: r.message });
            onClose();
          }
        }}
        className="grid gap-4"
        noValidate
      >
        {error && <InlineAlert>{error}</InlineAlert>}
        {rest > 0 && (
          <>
            <div
              className="flex rounded-lg border border-line bg-white p-0.5"
              role="group"
              aria-label="Como paga o restante"
            >
              {(
                [
                  ["agora", "Paga agora"],
                  ["parcelado", "Parcelado"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={mode === k}
                  onClick={() => setMode(k)}
                  className={cx(
                    "min-h-10 flex-1 rounded-md px-3 text-sm font-semibold",
                    mode === k ? "bg-primary text-white" : "text-muted hover:bg-canvas",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "agora" ? (
              <>
                {!session && <InlineAlert tone="amber">Abra o caixa do dia para receber.</InlineAlert>}
                <MethodPicker value={method} onChange={setMethod} name="metodo-entrega" />
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Parcelas" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                    <option key={n} value={n}>
                      {n}x de {formatBRL(Math.floor(rest / n))}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  label="1ª parcela vence em"
                  type="date"
                  value={firstDue}
                  min={today}
                  onChange={(e) => setFirstDue(e.target.value)}
                />
              </div>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

export function OrderCancelDialog({ onClose, orderId }: DialogProps & { orderId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const o = data.orders.find((x) => x.id === orderId);
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("dinheiro");
  const [requestId] = useState(() => crypto.randomUUID());
  const formId = useId();
  if (!o) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancelar o pedido nº ${o.number}`}
      description="Os produtos do estoque voltam para a prateleira. O pedido fica no histórico."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={pending}>
            Cancelar pedido
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await exec({
            type: "order.cancel",
            id: orderId,
            reason: reason.trim(),
            refund,
            method: refund ? method : null,
            requestId,
          });
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
          data-autofocus
        />
        {o.downCents > 0 && (
          <>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={refund}
                onChange={(e) => setRefund(e.target.checked)}
              />
              Devolver o sinal de {formatBRL(o.downCents)} pelo caixa
            </label>
            {refund && <MethodPicker value={method} onChange={setMethod} name="metodo-cancelar" />}
          </>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Receita de óculos

type EyeForm = { sph: string; cyl: string; axis: string; add: string };
const emptyEye: EyeForm = { sph: "", cyl: "", axis: "", add: "" };
const toEye = (e: EyeForm): EyeValues => ({
  sph: parseDiopter(e.sph),
  cyl: parseDiopter(e.cyl),
  axis: e.axis.trim() ? Number(e.axis) : null,
  add: parseDiopter(e.add),
});

export function PrescriptionDialog({ onClose, clientId }: DialogProps & { clientId: string }) {
  const { data, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const client = data.clients.find((c) => c.id === clientId);
  const [examinedOn, setExaminedOn] = useState(today);
  const [validUntil, setValidUntil] = useState(defaultValidity(today));
  const [doctor, setDoctor] = useState("");
  const [od, setOd] = useState<EyeForm>(emptyEye);
  const [oe, setOe] = useState<EyeForm>(emptyEye);
  const [dnp, setDnp] = useState({ od: "", oe: "" });
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const num = (s: string) => (s.trim() ? Number(s.replace(",", ".")) : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = { examinedOn, validUntil, od: toEye(od), oe: toEye(oe), dnpOd: num(dnp.od), dnpOe: num(dnp.oe) };
    const err = prescriptionError(values);
    if (err) return setLocalError(err);
    setLocalError(null);
    const r = await exec({
      type: "prescription.save",
      clientId,
      doctor: doctor.trim(),
      notes: notes.trim(),
      ...values,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  const eyeRow = (label: string, v: EyeForm, set: (v: EyeForm) => void) => (
    <tr>
      <th scope="row" className="pr-2 text-left text-sm font-semibold">
        {label}
      </th>
      {(["sph", "cyl", "axis", "add"] as const).map((k) => (
        <td key={k} className="p-1">
          <input
            aria-label={`${label} ${{ sph: "esférico", cyl: "cilíndrico", axis: "eixo", add: "adição" }[k]}`}
            value={v[k]}
            inputMode={k === "axis" ? "numeric" : "decimal"}
            placeholder={k === "axis" ? "0–180" : "0,00"}
            onChange={(e) => {
              set({ ...v, [k]: e.target.value });
              setLocalError(null);
            }}
            className="min-h-10 w-full min-w-16 rounded-lg border border-[#c5cfdf] bg-white px-2 tabular focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/20"
          />
        </td>
      ))}
    </tr>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Receita de ${client?.name ?? "cliente"}`}
      description="Copie da receita do médico. Não se corrige depois: lança-se uma nova."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Lançar receita
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Data do exame"
            type="date"
            value={examinedOn}
            max={today}
            onChange={(e) => {
              setExaminedOn(e.target.value);
              if (isISODate(e.target.value)) setValidUntil(defaultValidity(e.target.value));
            }}
          />
          <TextField
            label="Válida até"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            hint="Normalmente 1 ano."
          />
          <TextField
            label="Médico"
            optional
            value={doctor}
            maxLength={120}
            onChange={(e) => setDoctor(e.target.value)}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-muted">
                <th className="sr-only">Olho</th>
                <th className="px-1 font-medium">Esférico</th>
                <th className="px-1 font-medium">Cilíndrico</th>
                <th className="px-1 font-medium">Eixo</th>
                <th className="px-1 font-medium">Adição</th>
              </tr>
            </thead>
            <tbody>
              {eyeRow("OD", od, setOd)}
              {eyeRow("OE", oe, setOe)}
            </tbody>
          </table>
          <p className="mt-1 text-sm text-muted">Use vírgula ou ponto e o sinal: −1,25 ou +2,00. De 0,25 em 0,25.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="DNP olho direito (mm)"
            optional
            inputMode="decimal"
            value={dnp.od}
            onChange={(e) => setDnp((x) => ({ ...x, od: e.target.value }))}
          />
          <TextField
            label="DNP olho esquerdo (mm)"
            optional
            inputMode="decimal"
            value={dnp.oe}
            onChange={(e) => setDnp((x) => ({ ...x, oe: e.target.value }))}
          />
        </div>
        <TextField
          label="Observações"
          optional
          value={notes}
          maxLength={500}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </Modal>
  );
}
