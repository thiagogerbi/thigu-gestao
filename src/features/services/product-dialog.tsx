"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { centsToInput, parseBRLToCents } from "@/lib/domain/money";
import { moduleAvailable } from "@/lib/domain/segments";
import { marginPercent } from "@/lib/domain/stock";
import { same } from "@/lib/utils/equality";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

/**
 * Produto vendido no balcão. Sem o módulo de estoque: só nome e preço. Com ele: códigos, custo,
 * estoque mínimo, tamanho e cor (moda) e em quais carros serve (autopeças). O saldo muda pelas entradas.
 */
export function ProductDialog({ onClose, productId }: DialogProps & { productId?: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const stockOn = moduleAvailable(data.company, "estoque");
  const existing = data.products.find((p) => p.id === productId);
  const initial = {
    name: existing?.name ?? "",
    price: existing ? centsToInput(existing.priceCents) : "",
    active: existing?.active ?? true,
    sku: existing?.sku ?? "",
    barcode: existing?.barcode ?? "",
    cost: existing?.costCents ? centsToInput(existing.costCents) : "",
    minStock: String(existing?.minStock ?? 0),
    size: existing?.size ?? "",
    color: existing?.color ?? "",
    fits: existing?.fits ?? "",
  };
  const [f, setF] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const set = (patch: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...patch }));
    setLocalError(null);
  };
  const price = parseBRLToCents(f.price);
  const cost = parseBRLToCents(f.cost);
  const margin = price !== null && cost !== null ? marginPercent({ priceCents: price, costCents: cost }) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (price === null || price < 0) return setLocalError("Digite o preço, por exemplo 39,90.");
    if (stockOn && f.cost.trim() && (cost === null || cost < 0))
      return setLocalError("Digite o custo, por exemplo 20,00.");
    const r = await exec({
      type: "product.save",
      id: productId,
      name: f.name,
      priceCents: price,
      active: f.active,
      ...(stockOn && {
        sku: f.sku.trim(),
        barcode: f.barcode.trim() || null,
        costCents: cost ?? 0,
        minStock: Math.max(0, Number(f.minStock) || 0),
        size: f.size.trim(),
        color: f.color.trim(),
        fits: f.fits.trim(),
      }),
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
      size={stockOn ? "lg" : "md"}
      dirty={!same(f, initial)}
      title={existing ? `Editar ${existing.name}` : "Novo produto"}
      description={
        stockOn
          ? "O estoque começa em zero: depois de salvar, registre a entrada da mercadoria."
          : "Aparece na lista de itens da venda no caixa."
      }
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
        {(localError || (error && !Object.keys(fieldErrors).length)) && (
          <InlineAlert>{localError ?? error}</InlineAlert>
        )}
        <TextField
          label="Nome"
          value={f.name}
          maxLength={80}
          onChange={(e) => {
            set({ name: e.target.value });
            clearField("name");
          }}
          error={fieldErrors.name}
          autoComplete="off"
          data-autofocus
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <MoneyField
            label="Preço de venda"
            value={f.price}
            onChange={(e) => set({ price: e.target.value })}
            error={fieldErrors.priceCents}
          />
          {stockOn && (
            <>
              <MoneyField
                label="Custo"
                optional
                value={f.cost}
                onChange={(e) => set({ cost: e.target.value })}
                hint={margin !== null ? `Margem de ${margin}% sobre o preço` : "Atualiza sozinho a cada entrada."}
              />
              <TextField
                label="Estoque mínimo"
                inputMode="numeric"
                value={f.minStock}
                onChange={(e) => set({ minStock: e.target.value.replace(/\D/g, "").slice(0, 7) })}
                hint="Avisa quando chegar nele."
              />
            </>
          )}
        </div>
        {stockOn && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Código interno"
                optional
                value={f.sku}
                maxLength={40}
                onChange={(e) => set({ sku: e.target.value.toUpperCase() })}
                className="font-mono uppercase"
                autoComplete="off"
              />
              <TextField
                label="Código de barras"
                optional
                value={f.barcode}
                maxLength={40}
                inputMode="numeric"
                onChange={(e) => {
                  set({ barcode: e.target.value.replace(/\s/g, "") });
                  clearField("barcode");
                }}
                error={fieldErrors.barcode}
                hint="Com o leitor, clique aqui e passe o produto."
                className="font-mono"
                autoComplete="off"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Tamanho"
                optional
                value={f.size}
                maxLength={20}
                onChange={(e) => set({ size: e.target.value })}
                hint="Ex.: P, M, G, 38. Cada tamanho é um produto."
              />
              <TextField
                label="Cor"
                optional
                value={f.color}
                maxLength={30}
                onChange={(e) => set({ color: e.target.value })}
              />
            </div>
            <TextField
              label="Serve em"
              optional
              value={f.fits}
              maxLength={300}
              onChange={(e) => set({ fits: e.target.value })}
              hint="Autopeças: modelos e anos (ex.: Gol, Voyage 1.0 2008 a 2016). Entra na busca."
            />
          </>
        )}
        {existing && (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={f.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            Ainda vendemos este produto
          </label>
        )}
      </form>
    </Modal>
  );
}
