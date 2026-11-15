import { balanceCents } from "@/lib/domain/accounts";
import type { Account, Client, CounterSale, Movement, Product } from "@/lib/domain/types";

/**
 * Estoque, venda no balcão e crediário: regras puras. O banco tem as mesmas em 20261114000020_stock.sql.
 */

/** "Camiseta básica · M · Preta" */
export function productLabel(p: Pick<Product, "name" | "size" | "color">): string {
  return [p.name, p.size, p.color].filter((x) => x && x.trim()).join(" · ");
}

export const stockOf = (p: Pick<Product, "stockQty">) => p.stockQty ?? 0;
export const isLowStock = (p: Product) =>
  Boolean(p.active && p.trackStock && stockOf(p) <= (p.minStock ?? 0) && (p.minStock ?? 0) > 0);
export const isOutOfStock = (p: Product) => Boolean(p.trackStock && stockOf(p) <= 0);

/** Código de barras ou código interno, exatos (o leitor de código "digita" e aperta Enter). */
export function findByCode(products: readonly Product[], code: string): Product | undefined {
  const c = code.trim().toUpperCase();
  if (!c) return undefined;
  return (
    products.find((p) => p.active && p.barcode && p.barcode.toUpperCase() === c) ??
    products.find((p) => p.active && p.sku && p.sku.toUpperCase() === c)
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome, código, código de barras, tamanho, cor ou aplicação ("gol 1.0"). Todas as palavras precisam aparecer. */
export function searchProducts(products: readonly Product[], query: string, limit = 12): Product[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return products
    .filter((p) => p.active)
    .filter((p) => {
      const hay = fold([p.name, p.sku, p.barcode, p.size, p.color, p.fits].filter(Boolean).join(" "));
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/** Lucro bruto do produto em porcentagem sobre o preço (null sem custo). */
export function marginPercent(p: Pick<Product, "priceCents" | "costCents">): number | null {
  if (!p.costCents || p.priceCents <= 0) return null;
  return Math.round(((p.priceCents - p.costCents) / p.priceCents) * 100);
}

// ---------------------------------------------------------------- Venda

/** Quem não é dono ou gestor dá até 10% de desconto (igual a counter_sale no banco). */
export function saleDiscountError(discountCents: number, subtotalCents: number, unlimited: boolean): string | null {
  if (!Number.isInteger(discountCents) || discountCents < 0 || discountCents >= subtotalCents)
    return "O desconto precisa ser menor que o valor da venda.";
  if (!unlimited && discountCents * 10 > subtotalCents)
    return "Você pode dar até 10% de desconto. Acima disso, peça ao dono.";
  return null;
}

/** Itens que faltam no estoque para esta venda (somando o mesmo produto em linhas diferentes). */
export function stockShortages(
  products: readonly Product[],
  lines: readonly { productId: string | null; quantity: number }[],
): { product: Product; wanted: number }[] {
  const wanted = new Map<string, number>();
  for (const l of lines) if (l.productId) wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.quantity);
  const out: { product: Product; wanted: number }[] = [];
  for (const [id, qty] of wanted) {
    const p = products.find((x) => x.id === id);
    if (p?.trackStock && stockOf(p) < qty) out.push({ product: p, wanted: qty });
  }
  return out;
}

/** Devolução proporcional ao desconto da venda (igual ao banco: arredondamento comum). */
export function refundFor(sale: Pick<CounterSale, "subtotalCents" | "totalCents">, linesCents: number): number {
  return Math.round((linesCents * sale.totalCents) / sale.subtotalCents);
}

// ---------------------------------------------------------------- Crediário

/** Quanto o cliente ainda deve no crediário (igual a credit_used no banco). */
export function creditUsed(clientId: string, accounts: readonly Account[], movements: readonly Movement[]): number {
  return accounts
    .filter((a) => a.clientId === clientId && a.origin === "crediario" && !a.canceledAt)
    .reduce((s, a) => s + balanceCents(a, movements as Movement[]), 0);
}

export function creditAvailable(client: Pick<Client, "creditLimitCents">, used: number): number | null {
  if (client.creditLimitCents === null || client.creditLimitCents === undefined) return null;
  return Math.max(0, client.creditLimitCents - used);
}

export function chargeMessage(p: { clientName: string; companyName: string; overdueCents: number; oldestDue: string }) {
  const first = p.clientName.trim().split(/\s+/)[0] ?? p.clientName;
  const [y, m, d] = p.oldestDue.split("-");
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return `Olá, ${first}! Aqui é da ${p.companyName}. Consta em aberto no seu crediário ${brl(p.overdueCents)}, com vencimento desde ${d}/${m}/${y}. Quando puder, passe aqui ou responda esta mensagem para combinarmos. Obrigado!`;
}
