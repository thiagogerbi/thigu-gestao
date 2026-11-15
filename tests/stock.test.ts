/**
 * Estoque, venda no balcão, devolução e crediário: regras puras e o MOTOR DA PRÉVIA.
 * As mesmas regras são testadas no banco em tests/db.test.ts ("loja no banco").
 */
import { expectedCash, openSession } from "@/lib/domain/cash";
import {
  creditUsed,
  findByCode,
  isLowStock,
  marginPercent,
  productLabel,
  refundFor,
  saleDiscountError,
  searchProducts,
  stockOf,
  stockShortages,
} from "@/lib/domain/stock";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date("2026-11-14T15:00:00Z");

function setup() {
  const shop = buildPreviewSeed(now).find((c) => c.company.id === "empresa-autopecas")!;
  const who = (userId: string) => shop.members.find((m) => m.userId === userId)!;
  const c: EngineContext = { now, newId: () => randomUUID(), processed: new Map() };
  let data: CompanyData = shop;
  const step = (actor: Member, action: unknown) => {
    const r = applyAction(data, actor, action, c);
    data = r.data;
    return r.result as typeof r.result & { id?: string };
  };
  return {
    step,
    get data() {
      return data;
    },
    product: (id: string) => data.products.find((p) => p.id === id)!,
    ana: who("u-ana"),
    joana: who("u-joana"), // vendedor
    celso: who("u-celso"), // caixa
    marta: who("u-marta"), // financeiro
  };
}
const sale = (
  session: string,
  items: { productId: string | null; quantity: number; unitCents: number; description?: string }[],
  extra: Record<string, unknown> = {},
) => ({
  type: "cash.sale",
  sessionId: session,
  clientId: null,
  items: items.map((i) => ({ serviceId: null, description: i.description ?? "Item", ...i })),
  method: "pix",
  requestId: randomUUID(),
  ...extra,
});

describe("estoque: regras puras", () => {
  it("busca por nome, código, código de barras e carro; leitor acha pelo código exato", () => {
    const { data } = setup();
    expect(findByCode(data.products, "7891000100022")!.id).toBe("pa-2");
    expect(findByCode(data.products, "psl55")!.id).toBe("pa-2");
    expect(findByCode(data.products, "789")).toBeUndefined();
    expect(searchProducts(data.products, "pastilha onix").map((p) => p.id)).toEqual(["pa-3"]);
    expect(
      searchProducts(data.products, "gol")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["pa-2", "pa-5"]);
    expect(searchProducts(data.products, "camiseta m").map((p) => p.id)).toContain("pa-8");
    expect(productLabel({ name: "Camiseta", size: "M", color: "Preta" })).toBe("Camiseta · M · Preta");
  });

  it("estoque baixo, margem, desconto, falta de estoque e devolução proporcional", () => {
    const { data, product } = setup();
    expect(
      data.products
        .filter(isLowStock)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["pa-2", "pa-4"]);
    expect(marginPercent(product("pa-3"))).toBe(43);
    expect(saleDiscountError(1000, 10000, false)).toBeNull();
    expect(saleDiscountError(1001, 10000, false)).toMatch(/10%/);
    expect(saleDiscountError(10000, 10000, true)).toMatch(/menor/);
    expect(
      stockShortages(data.products, [
        { productId: "pa-2", quantity: 2 },
        { productId: "pa-2", quantity: 2 },
      ])[0].wanted,
    ).toBe(4);
    expect(refundFor({ subtotalCents: 12900, totalCents: 12000 }, 12900)).toBe(12000);
    expect(refundFor({ subtotalCents: 30000, totalCents: 27000 }, 10000)).toBe(9000);
    // a Oficina do Zé deve as 3 parcelas (R$ 600); a Rita pagou uma de duas (deve R$ 129)
    expect(creditUsed("ka-1", data.accounts, data.movements)).toBe(60000);
    expect(creditUsed("ka-2", data.accounts, data.movements)).toBe(12900);
  });
});

describe("loja na prévia", () => {
  it("entrada, ajuste e perda: quem pode, saldo e histórico", () => {
    const s = setup();
    expect(
      s.step(s.celso, { type: "stock.entry", productId: "pa-4", quantity: 10, unitCostCents: 1800, reason: "NF 1" }).ok,
    ).toBe(false);
    expect(
      s.step(s.marta, { type: "stock.entry", productId: "pa-4", quantity: 10, unitCostCents: 1800, reason: "NF 1" }).ok,
    ).toBe(true);
    expect(s.product("pa-4")).toMatchObject({ stockQty: 10, costCents: 1800, trackStock: true });
    expect(
      s.step(s.ana, { type: "stock.adjust", productId: "pa-4", delta: -11, kind: "ajuste", reason: "contagem" }).ok,
    ).toBe(false);
    expect(
      s.step(s.ana, { type: "stock.adjust", productId: "pa-4", delta: 2, kind: "perda", reason: "avaria" }).ok,
    ).toBe(false);
    expect(
      s.step(s.ana, { type: "stock.adjust", productId: "pa-4", delta: -1, kind: "perda", reason: "avaria" }).ok,
    ).toBe(true);
    expect(stockOf(s.product("pa-4"))).toBe(9);
    // o saldo é sempre a soma das movimentações
    for (const p of s.data.products)
      expect(s.data.stockMovements.filter((m) => m.productId === p.id).reduce((t, m) => t + m.quantity, 0)).toBe(
        stockOf(p),
      );
  });

  it("venda à vista baixa o estoque, recusa sem estoque e limita o desconto do caixa", () => {
    const s = setup();
    const cx = openSession(s.data.cashSessions)!.id;
    expect(s.step(s.celso, sale(cx, [{ productId: "pa-2", quantity: 4, unitCents: 3290 }])).message).toMatch(
      /Estoque insuficiente/,
    );
    expect(
      s.step(s.celso, sale(cx, [{ productId: "pa-1", quantity: 2, unitCents: 4990 }], { discountCents: 1500 })).ok,
    ).toBe(false);
    const r = s.step(
      s.celso,
      sale(cx, [{ productId: "pa-1", quantity: 2, unitCents: 4990 }], { discountCents: 998, method: "dinheiro" }),
    );
    expect(r.ok).toBe(true);
    expect(stockOf(s.product("pa-1"))).toBe(20);
    const v = s.data.counterSales.at(-1)!;
    expect(v).toMatchObject({ subtotalCents: 9980, discountCents: 998, totalCents: 8982, payment: "avista" });
    // o dono dá o desconto que quiser
    expect(
      s.step(s.ana, sale(cx, [{ productId: "pa-6", quantity: 1, unitCents: 2990 }], { discountCents: 1000 })).ok,
    ).toBe(true);
    // gaveta: 150 de troco + 120 (venda de hoje em dinheiro) + 89,82
    expect(expectedCash(openSession(s.data.cashSessions)!, s.data.movements)).toBe(15000 + 12000 + 8982);
  });

  it("crediário: só com limite, dentro do disponível e com as parcelas certas", () => {
    const s = setup();
    const cx = openSession(s.data.cashSessions)!.id;
    const plan = (total: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        number: i + 1,
        amountCents: total / n,
        dueDate: `2026-12-${String(10 + i).padStart(2, "0")}`,
      }));
    const credit = (clientId: string | null, total: number, n = 2) =>
      s.step(
        s.joana,
        sale(cx, [{ productId: "pa-5", quantity: 1, unitCents: total }], {
          clientId,
          method: null,
          plan: plan(total, n),
        }),
      );
    expect(credit(null, 2400).ok).toBe(false);
    expect(credit("ka-3", 2400).message).toMatch(/não tem crediário/);
    // Rita: limite 500, deve 129 → disponível 371
    expect(credit("ka-2", 40000).message).toMatch(/disponível R\$\s371,00/);
    const ok = credit("ka-2", 2400);
    expect(ok.ok).toBe(true);
    const accs = s.data.accounts.filter(
      (a) => a.origin === "crediario" && a.clientId === "ka-2" && a.dueDate.startsWith("2026-12"),
    );
    expect(accs.map((a) => [a.amountCents, a.installmentCount])).toEqual([
      [1200, 2],
      [1200, 2],
    ]);
    expect(creditUsed("ka-2", s.data.accounts, s.data.movements)).toBe(12900 + 2400);
    // limite: só financeiro ou dono
    expect(s.step(s.joana, { type: "client.setCreditLimit", clientId: "ka-3", limitCents: 20000 }).ok).toBe(false);
    expect(s.step(s.marta, { type: "client.setCreditLimit", clientId: "ka-3", limitCents: 20000 }).ok).toBe(true);
    expect(credit("ka-3", 2400).ok).toBe(true);
    // o vendedor vê as parcelas para cobrar no balcão
    expect(visibleData(s.data, s.joana).accounts.some((a) => a.origin === "crediario")).toBe(true);
    expect(visibleData(s.data, s.celso).accounts.some((a) => a.kind === "pagar")).toBe(false);
  });

  it("devolução: volta ao estoque, dinheiro sai do caixa, não devolve mais que vendeu", () => {
    const s = setup();
    const before = expectedCash(openSession(s.data.cashSessions)!, s.data.movements);
    const item = s.data.cashSaleItems.find((i) => i.id === "si-2")!; // pastilha vendida com desconto (R$ 129 por R$ 120, em dinheiro)
    expect(
      s.step(s.celso, {
        type: "counter.return",
        saleId: "vs-2",
        items: [{ itemId: item.id, quantity: 2 }],
        method: "dinheiro",
        requestId: randomUUID(),
      }).ok,
    ).toBe(false);
    const r = s.step(s.celso, {
      type: "counter.return",
      saleId: "vs-2",
      items: [{ itemId: item.id, quantity: 1 }],
      method: "dinheiro",
      requestId: randomUUID(),
    });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/R\$\s120,00/);
    expect(stockOf(s.product("pa-3"))).toBe(6);
    expect(expectedCash(openSession(s.data.cashSessions)!, s.data.movements)).toBe(before - 12000);
    expect(
      s.step(s.celso, {
        type: "counter.return",
        saleId: "vs-2",
        items: [{ itemId: item.id, quantity: 1 }],
        method: "dinheiro",
        requestId: randomUUID(),
      }).ok,
    ).toBe(false);
    // venda no crediário não se devolve pelo caixa
    expect(
      s.step(s.celso, {
        type: "counter.return",
        saleId: "vs-4",
        items: [{ itemId: "si-5", quantity: 1 }],
        method: "dinheiro",
        requestId: randomUUID(),
      }).message,
    ).toMatch(/crediário/);
  });

  it("o salão (caixa sem estoque) continua vendendo sem controle de estoque nem crediário", () => {
    const salon = buildPreviewSeed(now).find((c) => c.company.id === "empresa-salao")!;
    const c: EngineContext = { now, newId: () => randomUUID(), processed: new Map() };
    const ana = salon.members.find((m) => m.userId === "u-ana")!;
    let d = applyAction(salon, ana, { type: "cash.open", openingCents: 0 }, c).data;
    const cx = openSession(d.cashSessions)!.id;
    const r = applyAction(d, ana, sale(cx, [{ productId: "pr-shampoo", quantity: 3, unitCents: 4500 }]), c);
    expect(r.result.ok).toBe(true);
    d = r.data;
    expect(d.stockMovements).toHaveLength(0);
    const plan = [{ number: 1, amountCents: 4500, dueDate: "2026-12-10" }];
    expect(
      applyAction(
        d,
        ana,
        sale(cx, [{ productId: "pr-shampoo", quantity: 1, unitCents: 4500 }], {
          clientId: d.clients[0].id,
          method: null,
          plan,
        }),
        c,
      ).result.ok,
    ).toBe(false);
  });
});
