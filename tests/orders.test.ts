/**
 * Pedidos com prazo e receita de óculos: regras puras e o MOTOR DA PRÉVIA.
 * As mesmas regras são testadas no banco em tests/db.test.ts ("pedidos no banco").
 */
import { expectedCash, openSession } from "@/lib/domain/cash";
import {
  dueLabel,
  eyeError,
  examsDue,
  formatDiopter,
  isLateOrder,
  parseDiopter,
  prescriptionError,
  prescriptionStatus,
  technicianCanMove,
} from "@/lib/domain/orders";
import { stockOf } from "@/lib/domain/stock";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date("2026-11-14T15:00:00Z");
const today = "2026-11-14";

function setup() {
  const shop = buildPreviewSeed(now).find((c) => c.company.id === "empresa-otica")!;
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
    order: (id: string) => data.orders.find((o) => o.id === id)!,
    product: (id: string) => data.products.find((p) => p.id === id)!,
    ana: who("u-ana"),
    lia: who("u-lia"), // atendente
    otavio: who("u-otavio"), // técnico
    fabio: who("u-fabio"), // financeiro
  };
}
const eye = (sph: number | null, cyl: number | null = null, axis: number | null = null, add: number | null = null) => ({
  sph,
  cyl,
  axis,
  add,
});

describe("receita de óculos: regras puras", () => {
  it("lê e escreve dioptrias com sinal e vírgula", () => {
    expect(parseDiopter("-1,25")).toBe(-1.25);
    expect(parseDiopter("+2.00")).toBe(2);
    expect(parseDiopter("−0,75")).toBe(-0.75);
    expect(parseDiopter("")).toBeNull();
    expect(Number.isNaN(parseDiopter("abc"))).toBe(true);
    expect(formatDiopter(-1.25)).toBe("−1,25");
    expect(formatDiopter(2)).toBe("+2,00");
    expect(formatDiopter(0)).toBe("0,00");
  });

  it("confere passos de 0,25, eixo com cilíndrico e validade", () => {
    expect(eyeError(eye(-1.25, -0.5, 180, 2), "OD")).toBeNull();
    expect(eyeError(eye(-1.3), "OD")).toMatch(/0,25/);
    expect(eyeError(eye(-1, -0.5), "OD")).toMatch(/eixo/);
    expect(eyeError(eye(-1, null, 90), "OD")).toMatch(/sem cilíndrico/);
    expect(eyeError(eye(-1, -0.5, 181), "OD")).toMatch(/0 a 180/);
    const base = { examinedOn: today, validUntil: "2027-11-14", od: eye(-1), oe: eye(-1), dnpOd: 31, dnpOe: 32 };
    expect(prescriptionError(base)).toBeNull();
    expect(prescriptionError({ ...base, validUntil: "2026-01-01" })).toMatch(/validade/);
    expect(prescriptionError({ ...base, dnpOd: 60 })).toMatch(/20 a 45/);
    expect(prescriptionStatus({ validUntil: "2026-12-01" }, today)).toBe("vencendo");
    expect(prescriptionStatus({ validUntil: "2026-11-13" }, today)).toBe("vencida");
    expect(prescriptionStatus({ validUntil: "2027-06-01" }, today)).toBe("valida");
  });

  it("pedidos: atraso, prazo e o que o técnico move", () => {
    expect(isLateOrder({ promisedOn: "2026-11-13", stage: "terceiro" }, today)).toBe(true);
    expect(isLateOrder({ promisedOn: "2026-11-13", stage: "pronto" }, today)).toBe(false);
    expect(dueLabel("2026-11-15", today)).toBe("amanhã");
    expect(dueLabel("2026-11-12", today)).toBe("atrasado 2 dias");
    expect(technicianCanMove("producao", "pronto")).toBe(true);
    expect(technicianCanMove("producao", "recebido")).toBe(false);
    const { data } = setup();
    // Carlos (vence em 15 dias) e Denise (venceu há 35)
    expect(examsDue(data.prescriptions, today).map((x) => x.prescription.clientId)).toEqual(["ot-3", "ot-2"]);
  });
});

describe("pedidos na prévia", () => {
  it("abre com sinal no caixa, tira a armação do estoque, técnico move, entrega parcelada", () => {
    const s = setup();
    const drawer = () => expectedCash(openSession(s.data.cashSessions)!, s.data.movements);
    const before = drawer();
    const base = {
      type: "order.open",
      clientId: "ot-2",
      title: "Óculos completo",
      details: "",
      promisedOn: "2026-11-21",
      resourceId: "r-otavio",
      prescriptionId: "rx-2",
      items: [
        { productId: "ar-2", description: "Armação metal dourada", quantity: 1, unitCents: 34000 },
        { productId: "ar-3", description: "Lentes", quantity: 1, unitCents: 38000 },
      ],
      downCents: 30000,
      method: "dinheiro",
      requestId: randomUUID(),
    };
    // receita de outro cliente, prazo no passado, sinal maior que o total, estoque que não tem
    expect(s.step(s.lia, { ...base, prescriptionId: "rx-1", requestId: randomUUID() }).ok).toBe(false);
    expect(s.step(s.lia, { ...base, promisedOn: "2026-11-01", requestId: randomUUID() }).ok).toBe(false);
    expect(s.step(s.lia, { ...base, downCents: 90000, requestId: randomUUID() }).ok).toBe(false);
    expect(
      s.step(s.lia, {
        ...base,
        items: [{ productId: "ar-2", description: "Armação", quantity: 2, unitCents: 34000 }],
        requestId: randomUUID(),
      }).message,
    ).toMatch(/Estoque insuficiente/);
    // só o atendimento abre
    expect(s.step(s.otavio, { ...base, requestId: randomUUID() }).ok).toBe(false);
    const r = s.step(s.lia, base);
    expect(r.ok).toBe(true);
    const o = () => s.order(r.id!);
    expect(o()).toMatchObject({ number: 6, totalCents: 72000, downCents: 30000, stage: "recebido" });
    expect(stockOf(s.product("ar-2"))).toBe(0);
    expect(drawer()).toBe(before + 30000);

    // o técnico move para produção e pronto; não volta para recebido nem entrega
    expect(s.step(s.otavio, { type: "order.move", id: r.id, stage: "producao" }).ok).toBe(true);
    expect(s.step(s.otavio, { type: "order.move", id: r.id, stage: "recebido" }).ok).toBe(false);
    expect(s.step(s.otavio, { type: "order.move", id: r.id, stage: "pronto" }).ok).toBe(true);
    expect(o().readyAt).toBeTruthy();
    expect(
      s.step(s.otavio, { type: "order.deliver", id: r.id, method: "pix", plan: [], requestId: randomUUID() }).ok,
    ).toBe(false);

    const plan = [
      { number: 1, amountCents: 21000, dueDate: "2026-12-14" },
      { number: 2, amountCents: 21000, dueDate: "2027-01-14" },
    ];
    expect(
      s.step(s.fabio, {
        type: "order.deliver",
        id: r.id,
        method: null,
        plan: plan.slice(0, 1),
        requestId: randomUUID(),
      }).ok,
    ).toBe(false);
    expect(s.step(s.fabio, { type: "order.deliver", id: r.id, method: null, plan, requestId: randomUUID() }).ok).toBe(
      true,
    );
    expect(o().stage).toBe("entregue");
    expect(s.data.accounts.filter((a) => a.orderId === r.id).map((a) => a.amountCents)).toEqual([30000, 21000, 21000]);
    expect(s.step(s.lia, { type: "order.move", id: r.id, stage: "producao" }).ok).toBe(false);
  });

  it("entrega com pagamento no caixa e cancelamento com devolução do sinal e da armação", () => {
    const s = setup();
    const drawer = () => expectedCash(openSession(s.data.cashSessions)!, s.data.movements);
    // pedido 3 (pronto, sem sinal): restante de R$ 380 pago em dinheiro
    const before = drawer();
    expect(
      s.step(s.lia, { type: "order.deliver", id: "pd-3", method: "dinheiro", plan: [], requestId: randomUUID() }).ok,
    ).toBe(true);
    expect(drawer()).toBe(before + 38000);
    // pedido 5 (sinal de R$ 200 em pix, armação do estoque): cancela devolvendo o sinal em pix
    const stockBefore = stockOf(s.product("ar-1"));
    expect(
      s.step(s.lia, {
        type: "order.cancel",
        id: "pd-5",
        reason: "x",
        refund: true,
        method: "pix",
        requestId: randomUUID(),
      }).ok,
    ).toBe(false);
    expect(
      s.step(s.lia, {
        type: "order.cancel",
        id: "pd-5",
        reason: "Cliente desistiu",
        refund: true,
        method: "pix",
        requestId: randomUUID(),
      }).ok,
    ).toBe(true);
    expect(s.order("pd-5").stage).toBe("cancelado");
    expect(stockOf(s.product("ar-1"))).toBe(stockBefore + 1);
    const refund = s.data.accounts.find((a) => a.orderId === "pd-5" && a.kind === "pagar")!;
    expect(refund).toMatchObject({ origin: "devolucao", amountCents: 20000 });
  });

  it("receita: só quem atende lê e lança; o financeiro não vê", () => {
    const s = setup();
    const rx = {
      type: "prescription.save",
      clientId: "ot-3",
      examinedOn: today,
      validUntil: "2027-11-14",
      doctor: "",
      od: eye(-3, -1, 10),
      oe: eye(-2.75, -1.25, 175),
      dnpOd: 31,
      dnpOe: 31,
      notes: "",
    };
    expect(s.step(s.fabio, rx).ok).toBe(false);
    expect(s.step(s.lia, { ...rx, od: eye(-3, -1) }).ok).toBe(false);
    expect(s.step(s.lia, rx).ok).toBe(true);
    expect(visibleData(s.data, s.fabio).prescriptions).toHaveLength(0);
    expect(visibleData(s.data, s.lia).prescriptions.filter((p) => p.clientId === "ot-3")).toHaveLength(2);
    // o técnico vê os pedidos dele e os clientes deles
    expect(visibleData(s.data, s.otavio).orders).toHaveLength(5);
  });
});
