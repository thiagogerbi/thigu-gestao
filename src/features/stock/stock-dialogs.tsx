"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { ChoiceCards, MoneyField, SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { creditAvailable, creditUsed, productLabel, stockOf } from "@/lib/domain/stock";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

/** Entrada de mercadoria: o saldo sobe e o custo do produto passa a ser o desta compra. */
export function StockEntryDialog({ onClose, productId }: DialogProps & { productId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const products = data.products.filter((p) => p.active).sort((a, b) => productLabel(a).localeCompare(productLabel(b)));
  const [f, setF] = useState({ productId: productId ?? "", quantity: "", cost: "", reason: "" });
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const product = data.products.find((p) => p.id === f.productId);
  const qty = Number(f.quantity) || 0;
  const cost = f.cost.trim() ? parseBRLToCents(f.cost) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return setLocalError("Escolha o produto.");
    if (qty < 1) return setLocalError("Digite a quantidade que chegou.");
    if (f.cost.trim() && (cost === null || cost < 0))
      return setLocalError("Digite o custo de cada unidade, por exemplo 18,50.");
    setLocalError(null);
    const r = await exec({
      type: "stock.entry",
      productId: product.id,
      quantity: qty,
      unitCostCents: cost,
      reason: f.reason.trim(),
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
      title="Entrada de mercadoria"
      description="Registre o que chegou do fornecedor. O estoque sobe na hora."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Dar entrada{qty > 0 ? ` de ${qty}` : ""}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <SelectField
          label="Produto"
          value={f.productId}
          onChange={(e) => {
            const p = data.products.find((x) => x.id === e.target.value);
            setF((x) => ({ ...x, productId: e.target.value, cost: p?.costCents ? centsToInput(p.costCents) : x.cost }));
          }}
          data-autofocus={!productId || undefined}
        >
          <option value="">Escolha…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {productLabel(p)}
              {p.sku ? ` (${p.sku})` : ""} — tem {stockOf(p)}
            </option>
          ))}
        </SelectField>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Quantidade que chegou"
            inputMode="numeric"
            value={f.quantity}
            onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
            data-autofocus={productId ? true : undefined}
          />
          <MoneyField
            label="Custo de cada"
            optional
            value={f.cost}
            onChange={(e) => setF((x) => ({ ...x, cost: e.target.value }))}
          />
        </div>
        <TextField
          label="Fornecedor ou nota"
          optional
          value={f.reason}
          maxLength={200}
          placeholder="Ex.: Distribuidora Paulista, NF 12345"
          onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))}
        />
        {product && qty > 0 && (
          <p className="text-sm text-muted">
            O estoque de {productLabel(product)} vai de {stockOf(product)} para {stockOf(product) + qty}.
          </p>
        )}
      </form>
    </Modal>
  );
}

/** Ajuste depois da contagem, ou perda (avaria, vencido, furto). Fica no histórico com o motivo. */
export function StockAdjustDialog({ onClose, productId }: DialogProps & { productId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors } = useAction();
  const p = data.products.find((x) => x.id === productId);
  const [kind, setKind] = useState<"ajuste" | "perda">("ajuste");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  if (!p) return null;
  const n = Number(value);
  const delta = value === "" ? 0 : kind === "ajuste" ? n - stockOf(p) : -n;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (value === "" || !Number.isInteger(n) || n < 0)
      return setLocalError(kind === "ajuste" ? "Digite quanto contou." : "Digite quantas unidades.");
    if (delta === 0) return setLocalError("Nada mudou: o estoque já está assim.");
    setLocalError(null);
    const r = await exec({ type: "stock.adjust", productId, delta, kind, reason: reason.trim() });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Ajustar ${productLabel(p)}`}
      description={`No sistema: ${stockOf(p)} ${stockOf(p) === 1 ? "unidade" : "unidades"}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar ajuste
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || (error && !fieldErrors.reason)) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <ChoiceCards
          legend="O que aconteceu"
          name="tipo-ajuste"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setValue("");
          }}
          options={[
            { value: "ajuste", label: "Contei o estoque", description: "Corrige para o que tem na prateleira" },
            { value: "perda", label: "Perda", description: "Avaria, vencido, furto" },
          ]}
        />
        <TextField
          label={kind === "ajuste" ? "Quanto tem de verdade" : "Quantas unidades foram perdidas"}
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            setValue(e.target.value.replace(/\D/g, "").slice(0, 7));
            setLocalError(null);
          }}
          hint={delta !== 0 ? `Diferença: ${delta > 0 ? "+" : ""}${delta}` : undefined}
          data-autofocus
        />
        <TextField
          label="Motivo"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          error={fieldErrors.reason}
          placeholder={kind === "ajuste" ? "Ex.: contagem do mês" : "Ex.: caixa amassada"}
        />
      </form>
    </Modal>
  );
}

/** Limite de crediário do cliente (financeiro ou dono). Sem limite, o cliente não compra no crediário. */
export function CreditLimitDialog({ onClose, clientId }: DialogProps & { clientId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const [selected, setSelected] = useState(clientId ?? "");
  const client = data.clients.find((c) => c.id === selected);
  const [value, setValue] = useState(client?.creditLimitCents ? centsToInput(client.creditLimitCents) : "");
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const used = client ? creditUsed(client.id, data.accounts, data.movements) : 0;
  const clients = [...data.clients].sort((a, b) => a.name.localeCompare(b.name));

  async function save(limitCents: number | null) {
    if (!client) return setLocalError("Escolha o cliente.");
    const r = await exec({ type: "client.setCreditLimit", clientId: client.id, limitCents });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Limite do crediário"
      description="Até quanto o cliente pode dever ao mesmo tempo. A venda que passar disso é recusada."
      footer={
        <>
          {client?.creditLimitCents !== null && client?.creditLimitCents !== undefined && (
            <Button variant="ghost" className="mr-auto text-danger" disabled={pending} onClick={() => save(null)}>
              Desligar crediário
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar limite
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          const cents = parseBRLToCents(value);
          if (cents === null || cents < 0) return setLocalError("Digite o limite, por exemplo 500,00.");
          void save(cents);
        }}
        className="grid gap-4"
        noValidate
      >
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        {!clientId && (
          <SelectField
            label="Cliente"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const c = data.clients.find((x) => x.id === e.target.value);
              setValue(c?.creditLimitCents ? centsToInput(c.creditLimitCents) : "");
              setLocalError(null);
            }}
            data-autofocus
          >
            <option value="">Escolha…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        )}
        <MoneyField
          label="Limite"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setLocalError(null);
          }}
          data-autofocus={clientId ? true : undefined}
        />
        {client && (
          <p className="text-sm text-muted">
            Deve hoje no crediário: {formatBRL(used)}
            {creditAvailable(client, used) !== null && ` · disponível ${formatBRL(creditAvailable(client, used)!)}`}
          </p>
        )}
      </form>
    </Modal>
  );
}
