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

/** Produto vendido no balcão (shampoo, pomada, ração). Sem estoque por enquanto: só nome e preço. */
export function ProductDialog({ onClose, productId }: DialogProps & { productId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const existing = data.products.find((p) => p.id === productId);
  const initial = {
    name: existing?.name ?? "",
    price: existing ? centsToInput(existing.priceCents) : "",
    active: existing?.active ?? true,
  };
  const [f, setF] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceCents = parseBRLToCents(f.price);
    if (priceCents === null || priceCents < 0) return setLocalError("Digite o preço, por exemplo 39,90.");
    setLocalError(null);
    const r = await exec({ type: "product.save", id: productId, name: f.name, priceCents, active: f.active });
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
      title={existing ? `Editar ${existing.name}` : "Novo produto"}
      description="Aparece na lista de itens da venda no caixa."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Salvar produto
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {error && !Object.keys(fieldErrors).length && <InlineAlert>{error}</InlineAlert>}
        <TextField
          label="Nome"
          value={f.name}
          maxLength={80}
          onChange={(e) => {
            setF((x) => ({ ...x, name: e.target.value }));
            clearField("name");
          }}
          error={fieldErrors.name}
          autoComplete="off"
          data-autofocus
        />
        <MoneyField
          label="Preço"
          value={f.price}
          onChange={(e) => {
            setF((x) => ({ ...x, price: e.target.value }));
            setLocalError(null);
          }}
          error={localError ?? fieldErrors.priceCents}
        />
        {existing && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={f.active}
              onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))}
            />
            Ainda vendemos este produto
          </label>
        )}
      </form>
    </Modal>
  );
}
