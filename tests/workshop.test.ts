/**
 * Oficina (ordem de serviço): regras puras e o MOTOR DA PRÉVIA.
 * As mesmas regras são testadas no banco em tests/db.test.ts ("oficina no banco").
 */
import { commissionSummary } from "@/lib/domain/commissions";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import {
  discountError,
  formatPlate,
  isLate,
  isPlate,
  normalizePlate,
  quoteMessage,
  revisionsDue,
  totals,
  warrantyUntil,
} from "@/lib/domain/work-orders";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date("2026-11-14T13:00:00Z");
const today = "2026-11-14";

function setup() {
  const all = buildPreviewSeed(now);
  const shop = all.find((c) => c.company.id === "empresa-oficina")!;
  const who = (userId: string) => shop.members.find((m) => m.userId === userId)!;
  const c: EngineContext = { now, newId: () => randomUUID(), processed: new Map() };
  let data: CompanyData = shop;
  const step = (actor: Member, action: unknown) => {
    const r = applyAction(data, actor, action, c);
    data = r.data;
    return r.result as typeof r.result & { id?: string; extra?: Record<string, unknown> };
  };
  return {
    step,
    get data() {
      return data;
    },
    ana: who("u-ana"),
    paula: who("u-paula"), // atendente
    rogerio: who("u-rogerio"), // mecânico
    sergio: who("u-sergio"), // mecânico
    vitor: who("u-vitor"), // financeiro
  };
}

describe("oficina: regras puras", () => {
  it("placa: aceita antiga e Mercosul, com ou sem hífen", () => {
    expect(normalizePlate("abc-1d23")).toBe("ABC1D23");
    expect(isPlate("ABC1D23")).toBe(true);
    expect(isPlate("ABC1234")).toBe(true);
    expect(isPlate("AB12345")).toBe(false);
    expect(isPlate("ABCD123")).toBe(false);
    expect(formatPlate("ABC1234")).toBe("ABC-1234");
    expect(formatPlate("ABC1D23")).toBe("ABC1D23");
  });

  it("total: tira os recusados e o desconto; desconto do atendimento até 10%", () => {
    const t = totals({ discountCents: 1000 }, [
      {
        id: "1",
        workOrderId: "w",
        kind: "peca",
        serviceId: null,
        description: "A",
        quantity: 2,
        unitCents: 5000,
        warrantyDays: null,
        status: "aprovado",
        addedBy: "u",
        createdAt: "",
      },
      {
        id: "2",
        workOrderId: "w",
        kind: "servico",
        serviceId: null,
        description: "B",
        quantity: 1,
        unitCents: 8000,
        warrantyDays: null,
        status: "pendente",
        addedBy: "u",
        createdAt: "",
      },
      {
        id: "3",
        workOrderId: "w",
        kind: "servico",
        serviceId: null,
        description: "C",
        quantity: 1,
        unitCents: 3000,
        warrantyDays: null,
        status: "recusado",
        addedBy: "u",
        createdAt: "",
      },
    ]);
    expect(t).toMatchObject({
      parts: 10000,
      labor: 8000,
      quote: 18000,
      approved: 10000,
      pending: 8000,
      refused: 3000,
      total: 17000,
    });
    expect(discountError(1800, 18000, false)).toBeNull();
    expect(discountError(1801, 18000, false)).toMatch(/10%/);
    expect(discountError(5000, 18000, true)).toBeNull();
    expect(discountError(18001, 18000, true)).toMatch(/entre zero/);
  });

  it("garantia, atraso, revisões e mensagem do orçamento", () => {
    expect(warrantyUntil({ warrantyDays: 90, status: "aprovado" }, "2026-11-14T20:00:00Z")).toBe("2027-02-12");
    expect(warrantyUntil({ warrantyDays: 90, status: "recusado" }, "2026-11-14T20:00:00Z")).toBeNull();
    // entregue às 23h30 de Brasília (02h30 UTC do dia seguinte): conta o dia de Brasília
    expect(warrantyUntil({ warrantyDays: 1, status: "aprovado" }, "2026-11-15T02:30:00Z")).toBe("2026-11-15");
    expect(isLate({ promisedOn: "2026-11-13", stage: "servico" }, today)).toBe(true);
    expect(isLate({ promisedOn: "2026-11-13", stage: "pronto" }, today)).toBe(false);
    const { data } = setup();
    expect(revisionsDue(data.workOrders, today).map((r) => r.workOrder.id)).toEqual(["os-1"]);
    const msg = quoteMessage({
      clientName: "Helena Prado",
      companyName: "Auto Center",
      model: "HB20",
      plate: "QWE4521",
      link: "https://x/orcamento/abc",
    });
    expect(msg).toContain("Olá, Helena!");
    expect(msg).toContain("HB20 (placa QWE-4521)");
    expect(msg).toContain("https://x/orcamento/abc");
  });
});

describe("oficina na prévia", () => {
  it("fluxo completo: placa nova, OS, orçamento, aprovação parcial, mecânico, entrega com parcelas", () => {
    const s = setup();
    const car = s.step(s.paula, {
      type: "item.save",
      clientId: "ve-1",
      kind: "veiculo",
      name: "Tracker",
      details: { marca: "Chevrolet" },
      alert: "",
      plate: "abc-1d23",
    });
    expect(car.ok).toBe(true);
    expect(s.data.items.find((i) => i.id === car.id)!.plate).toBe("ABC1D23");
    // placa repetida e placa inválida
    expect(
      s.step(s.paula, {
        type: "item.save",
        clientId: "ve-2",
        kind: "veiculo",
        name: "X",
        details: {},
        alert: "",
        plate: "ABC1D23",
      }).ok,
    ).toBe(false);
    expect(
      s.step(s.paula, {
        type: "item.save",
        clientId: "ve-2",
        kind: "veiculo",
        name: "X",
        details: {},
        alert: "",
        plate: "12",
      }).ok,
    ).toBe(false);

    const open = s.step(s.paula, {
      type: "workOrder.open",
      clientId: "ve-1",
      itemId: car.id,
      resourceId: "r-rogerio",
      complaint: "Freio fazendo barulho",
      km: 30000,
      fuel: "1/2",
      checklist: ["Estepe"],
      promisedOn: "2026-11-16",
      requestId: randomUUID(),
    });
    expect(open.ok).toBe(true);
    const wo = () => s.data.workOrders.find((w) => w.id === open.id)!;
    expect(wo().number).toBe(8);
    // carro de outro cliente não entra
    expect(
      s.step(s.paula, {
        type: "workOrder.open",
        clientId: "ve-2",
        itemId: car.id,
        resourceId: null,
        complaint: "",
        km: null,
        fuel: null,
        checklist: [],
        promisedOn: null,
        requestId: randomUUID(),
      }).ok,
    ).toBe(false);

    const add = (actor: Member, kind: "peca" | "servico", description: string, unitCents: number) =>
      s.step(actor, {
        type: "workOrder.addItem",
        workOrderId: open.id,
        kind,
        serviceId: null,
        description,
        quantity: 1,
        unitCents,
        warrantyDays: 90,
      });
    const pads = add(s.rogerio, "peca", "Pastilhas", 30000);
    const labor = add(s.rogerio, "servico", "Troca das pastilhas", 15000);
    const disc = add(s.paula, "servico", "Troca dos discos", 40000);
    expect(pads.ok && labor.ok && disc.ok).toBe(true);
    // o outro mecânico não mexe nesta OS
    expect(add(s.sergio, "peca", "Qualquer", 100).ok).toBe(false);
    // desconto: o atendimento até 10%, o dono à vontade; o mecânico não dá desconto
    expect(s.step(s.paula, { type: "workOrder.discount", id: open.id, discountCents: 9000 }).ok).toBe(false);
    expect(s.step(s.rogerio, { type: "workOrder.discount", id: open.id, discountCents: 100 }).ok).toBe(false);
    expect(s.step(s.paula, { type: "workOrder.discount", id: open.id, discountCents: 5000 }).ok).toBe(true);

    const sent = s.step(s.paula, { type: "workOrder.send", id: open.id });
    expect(sent.ok).toBe(true);
    expect(sent.extra?.token).toBeTruthy();
    expect(wo().stage).toBe("aprovacao");
    // não entrega com itens aguardando o cliente
    expect(
      s.step(s.paula, { type: "workOrder.deliver", id: open.id, plan: [], nextServiceOn: null, nextServiceNote: "" })
        .ok,
    ).toBe(false);

    const ok = s.step(s.paula, {
      type: "workOrder.approve",
      id: open.id,
      approvedIds: [pads.id, labor.id],
      channel: "telefone",
      name: "Gustavo Lima",
    });
    expect(ok.ok).toBe(true);
    expect(wo().stage).toBe("servico");
    expect(s.data.workOrderItems.find((i) => i.id === disc.id)!.status).toBe("recusado");
    // item decidido não sai do orçamento
    expect(s.step(s.paula, { type: "workOrder.removeItem", id: pads.id }).ok).toBe(false);

    // o mecânico move só entre peça, serviço e pronto
    expect(s.step(s.rogerio, { type: "workOrder.move", id: open.id, stage: "orcamento" }).ok).toBe(false);
    expect(s.step(s.rogerio, { type: "workOrder.move", id: open.id, stage: "pronto" }).ok).toBe(true);
    // e não entrega
    expect(
      s.step(s.rogerio, { type: "workOrder.deliver", id: open.id, plan: [], nextServiceOn: null, nextServiceNote: "" })
        .ok,
    ).toBe(false);

    // total: 300 + 150 − 50 = 400, em 2 parcelas (o financeiro entrega e cobra)
    const plan = [
      { number: 1, amountCents: 20000, dueDate: "2026-11-14" },
      { number: 2, amountCents: 20000, dueDate: "2026-12-14" },
    ];
    expect(
      s.step(s.vitor, {
        type: "workOrder.deliver",
        id: open.id,
        plan: plan.slice(0, 1),
        nextServiceOn: null,
        nextServiceNote: "",
      }).ok,
    ).toBe(false);
    const done = s.step(s.vitor, {
      type: "workOrder.deliver",
      id: open.id,
      plan,
      nextServiceOn: "2027-05-14",
      nextServiceNote: "Troca de óleo",
    });
    expect(done.ok).toBe(true);
    expect(wo()).toMatchObject({ stage: "entregue", totalCents: 40000, nextServiceOn: "2027-05-14" });
    const accs = s.data.accounts.filter((a) => a.workOrderId === open.id);
    expect(accs.map((a) => [a.origin, a.amountCents, a.installmentCount])).toEqual([
      ["os", 20000, 2],
      ["os", 20000, 2],
    ]);
    // encerrada: nada mais muda
    expect(add(s.paula, "peca", "Mais uma", 100).ok).toBe(false);
    expect(s.data.workOrderEvents.filter((e) => e.workOrderId === open.id).length).toBeGreaterThanOrEqual(5);
  });

  it("cada mecânico vê só as OS dele e os clientes delas; o atendimento vê todas", () => {
    const s = setup();
    const mine = visibleData(s.data, s.rogerio)
      .workOrders.map((w) => w.id)
      .sort();
    expect(mine).toEqual(["os-1", "os-3", "os-5", "os-7"]);
    expect(
      visibleData(s.data, s.rogerio)
        .clients.map((c) => c.id)
        .sort(),
    ).toEqual(["ve-1", "ve-3", "ve-4"]);
    expect(visibleData(s.data, s.paula).workOrders).toHaveLength(7);
    expect(visibleData(s.data, s.vitor).workOrders).toHaveLength(7);
  });

  it("limite de fotos por plano e transferência do veículo", () => {
    const s = setup();
    const photo = "data:image/webp;base64,UklGRhYAAABXRUJQVlA4IAoAAAAQAACdASoBAAEAAA==";
    for (let i = 0; i < 12; i++)
      expect(
        s.step(s.rogerio, { type: "workOrder.addPhoto", workOrderId: "os-3", dataUrl: photo, caption: "" }).ok,
      ).toBe(true);
    expect(s.step(s.rogerio, { type: "workOrder.addPhoto", workOrderId: "os-3", dataUrl: photo, caption: "" }).ok).toBe(
      false,
    );
    // carro com OS em andamento não muda de dono; o histórico vai junto com a placa
    expect(s.step(s.paula, { type: "vehicle.transfer", itemId: "v-4", clientId: "ve-2" }).ok).toBe(false);
    expect(s.step(s.paula, { type: "vehicle.transfer", itemId: "v-5", clientId: "ve-2" }).ok).toBe(true);
    expect(s.data.items.find((i) => i.id === "v-5")!.clientId).toBe("ve-2");
    expect(s.data.workOrders.find((w) => w.id === "os-2")!.itemId).toBe("v-5");
    expect(s.step(s.rogerio, { type: "vehicle.transfer", itemId: "v-6", clientId: "ve-2" }).ok).toBe(false);
  });

  it("comissão do mecânico: mão de obra aprovada das OS entregues no mês", () => {
    const s = setup();
    const sum = commissionSummary({
      resourceId: "r-rogerio",
      month: "2026-10-01",
      appointments: [],
      packages: [],
      rules: s.data.commissionRules,
      workOrders: s.data.workOrders,
      workOrderItems: s.data.workOrderItems,
    });
    // OS nº 1 entregue em outubro: só a mão de obra (R$ 60) conta; peças não entram
    expect(sum).toMatchObject({ baseCents: 6000, amountCents: 1800 });
    const r = s.step(s.ana, { type: "commission.close", resourceId: "r-rogerio", month: "2026-10-01" });
    expect(r.ok).toBe(true);
    expect(s.data.commissionClosings.find((c) => c.resourceId === "r-rogerio")!.amountCents).toBe(1800);
  });
});
