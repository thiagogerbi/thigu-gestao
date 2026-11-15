/**
 * MOTOR DA PRÉVIA — pedidos com prazo e receita de óculos. Mesmas regras de 20261114000023_orders.sql.
 */
import type { Action, ActionResult } from "@/lib/actions/schemas";
import { MODULE_OFF } from "@/lib/domain/agenda";
import { openSession } from "@/lib/domain/cash";
import { checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import { ORDER_STAGE_LABEL, prescriptionError, technicianCanMove } from "@/lib/domain/orders";
import { can } from "@/lib/domain/permissions";
import { moduleEnabled } from "@/lib/domain/segments";
import { stockOf, stockShortages } from "@/lib/domain/stock";
import type { Account, CompanyData, Member, Order } from "@/lib/domain/types";

export type OrderAction = Extract<Action, { type: `order.${string}` | "prescription.save" }>;

export interface OrderContext {
  nowIso: string;
  today: string;
  newId: () => string;
  visible: CompanyData;
  log: (kind: string, description: string, clientId: string | null) => void;
}

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});

export function runOrder(d: CompanyData, actor: Member, a: OrderAction, c: OrderContext): ActionResult {
  const roles = actor.roles;
  const me = actor.userId;
  const stockOn = moduleEnabled(d.company, "estoque");
  const operatesCash = moduleEnabled(d.company, "caixa") && can(roles, "caixa.operar");

  if (a.type === "prescription.save") {
    if (!moduleEnabled(d.company, "receita")) return fail(MODULE_OFF);
    if (!can(roles, "receita.usar")) return fail("Seu papel nesta empresa não permite lançar receitas.");
    if (!c.visible.clients.some((x) => x.id === a.clientId)) return fail("Cliente não encontrado.");
    const err = prescriptionError(a);
    if (err) return fail(err);
    const id = c.newId();
    d.prescriptions.push({ id, ...a, createdBy: me, createdAt: c.nowIso });
    return { ok: true, message: "Receita lançada.", id };
  }

  if (!moduleEnabled(d.company, "pedidos")) return fail(MODULE_OFF);
  const edits = can(roles, "pedidos.editar");
  const makes = (o: Order) =>
    o.resourceId !== null && d.resources.some((r) => r.id === o.resourceId && r.userId === me);
  const event = (o: Order, description: string) =>
    d.orderEvents.push({ id: c.newId(), orderId: o.id, description, actorId: me, createdAt: c.nowIso });
  const load = (id: string, mode: "editar" | "tecnico" | "entregar"): Order | ActionResult => {
    const o = c.visible.orders.some((x) => x.id === id) ? d.orders.find((x) => x.id === id) : undefined;
    if (!o) return fail("Pedido não encontrado.");
    if (mode === "editar" && !edits) return fail("Seu papel nesta empresa não permite alterar pedidos.");
    if (mode === "tecnico" && !edits && !makes(o))
      return fail("Só o técnico responsável ou o atendimento mexem neste pedido.");
    if (mode === "entregar" && !can(roles, "pedidos.entregar"))
      return fail("Seu papel nesta empresa não permite entregar pedidos.");
    if (o.stage === "entregue" || o.stage === "cancelado") return fail(`Este pedido já foi ${o.stage}.`);
    return o;
  };
  const isOrder = (x: Order | ActionResult): x is Order => "number" in x;
  const account = (
    p: Pick<Account, "kind" | "clientId" | "description" | "origin" | "amountCents" | "dueDate"> & Partial<Account>,
  ): Account => ({
    id: c.newId(),
    supplier: null,
    saleId: null,
    installmentNumber: 1,
    installmentCount: 1,
    category: null,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
    createdAt: c.nowIso,
    ...p,
  });
  const pay = (
    accountId: string,
    amountCents: number,
    method: NonNullable<Extract<OrderAction, { type: "order.open" }>["method"]>,
    direction: "entrada" | "saida",
    sessionId: string,
  ) =>
    d.movements.push({
      id: c.newId(),
      accountId,
      direction,
      amountCents,
      paidOn: c.today,
      method,
      registeredBy: me,
      createdAt: c.nowIso,
      undoneAt: null,
      undoneBy: null,
      undoReason: null,
      cashSessionId: sessionId,
    });

  switch (a.type) {
    case "order.open": {
      if (!edits) return fail("Seu papel nesta empresa não permite abrir pedidos.");
      const client = c.visible.clients.find((x) => x.id === a.clientId);
      if (!client) return fail("Cliente não encontrado.");
      if (a.promisedOn < c.today)
        return fail("A data prometida precisa ser hoje ou depois.", { promisedOn: "Escolha hoje ou depois." });
      if (a.resourceId && !d.resources.some((r) => r.id === a.resourceId && r.active))
        return fail("Técnico não encontrado.");
      if (a.prescriptionId && !d.prescriptions.some((p) => p.id === a.prescriptionId && p.clientId === client.id))
        return fail("Esta receita não é deste cliente.");
      const total = a.items.reduce((s, i) => s + i.quantity * i.unitCents, 0);
      if (a.downCents > total)
        return fail("O sinal não pode passar do total do pedido.", { downCents: "Sinal maior que o total." });
      const session = openSession(d.cashSessions);
      if (a.downCents > 0) {
        if (!a.method) return fail("Escolha como o sinal foi pago.");
        if (!session) return fail("Abra o caixa para receber o sinal.");
        if (!operatesCash) return fail("Seu papel nesta empresa não permite usar o caixa.");
      }
      if (stockOn) {
        const short = stockShortages(d.products, a.items)[0];
        if (short) return fail(`Estoque insuficiente de ${short.product.name} (tem ${stockOf(short.product)}).`);
      }
      const number = d.orders.reduce((m, o) => Math.max(m, o.number), 0) + 1;
      const o: Order = {
        id: c.newId(),
        number,
        clientId: client.id,
        resourceId: a.resourceId,
        prescriptionId: a.prescriptionId,
        title: a.title,
        details: a.details,
        stage: "recebido",
        promisedOn: a.promisedOn,
        totalCents: total,
        downCents: a.downCents,
        readyAt: null,
        deliveredAt: null,
        canceledAt: null,
        cancelReason: null,
        createdBy: me,
        createdAt: c.nowIso,
      };
      d.orders.push(o);
      for (const i of a.items) {
        d.orderItems.push({ id: c.newId(), orderId: o.id, ...i });
        const p = i.productId ? d.products.find((x) => x.id === i.productId) : undefined;
        if (stockOn && p?.trackStock) {
          d.stockMovements.push({
            id: c.newId(),
            productId: p.id,
            kind: "venda",
            quantity: -i.quantity,
            unitCostCents: null,
            saleId: null,
            orderId: o.id,
            reason: `Pedido nº ${number}`,
            createdBy: me,
            createdAt: c.nowIso,
          });
          p.stockQty = stockOf(p) - i.quantity;
        }
      }
      if (a.downCents > 0 && session && a.method) {
        const acc = account({
          kind: "receber",
          clientId: client.id,
          description: `Pedido nº ${number} — sinal`,
          origin: "pedido",
          amountCents: a.downCents,
          dueDate: c.today,
          orderId: o.id,
        });
        d.accounts.push(acc);
        pay(acc.id, a.downCents, a.method, "entrada", session.id);
      }
      event(o, a.downCents > 0 ? `Pedido aberto com sinal de ${formatBRL(a.downCents)}` : "Pedido aberto");
      c.log("pedido", `Pedido nº ${number}: ${a.title}`, client.id);
      return { ok: true, message: `Pedido nº ${number} aberto.`, id: o.id };
    }

    case "order.save": {
      const o = load(a.id, "editar");
      if (!isOrder(o)) return o;
      if (a.resourceId && !d.resources.some((r) => r.id === a.resourceId)) return fail("Técnico não encontrado.");
      if (a.promisedOn !== o.promisedOn)
        event(o, `Nova data prometida: ${a.promisedOn.split("-").reverse().join("/")}`);
      Object.assign(o, { title: a.title, details: a.details, promisedOn: a.promisedOn, resourceId: a.resourceId });
      return { ok: true, message: "Pedido salvo.", id: o.id };
    }

    case "order.move": {
      const o = load(a.id, "tecnico");
      if (!isOrder(o)) return o;
      if (!edits && !technicianCanMove(o.stage, a.stage))
        return fail("O técnico move o pedido entre em produção, no laboratório e pronto.");
      if (o.stage === a.stage) return { ok: true, message: "Nada mudou.", id: o.id };
      o.stage = a.stage;
      o.readyAt = a.stage === "pronto" ? c.nowIso : null;
      event(o, `Etapa: ${ORDER_STAGE_LABEL[a.stage].toLowerCase()}`);
      return { ok: true, message: `Pedido nº ${o.number}: ${ORDER_STAGE_LABEL[a.stage].toLowerCase()}.`, id: o.id };
    }

    case "order.deliver": {
      const o = load(a.id, "entregar");
      if (!isOrder(o)) return o;
      const rest = o.totalCents - o.downCents;
      if (rest > 0) {
        if (a.plan.length) {
          const check = checkPlan(a.plan, rest);
          if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
          for (const inst of a.plan)
            d.accounts.push(
              account({
                kind: "receber",
                clientId: o.clientId,
                description: `Pedido nº ${o.number} — restante`,
                origin: "pedido",
                amountCents: inst.amountCents,
                dueDate: inst.dueDate,
                installmentNumber: inst.number,
                installmentCount: a.plan.length,
                orderId: o.id,
              }),
            );
        } else {
          if (!a.method) return fail("Escolha como o cliente pagou o restante.");
          const session = openSession(d.cashSessions);
          if (!session) return fail("Abra o caixa para receber o restante.");
          if (!operatesCash) return fail("Seu papel nesta empresa não permite usar o caixa.");
          const acc = account({
            kind: "receber",
            clientId: o.clientId,
            description: `Pedido nº ${o.number} — restante`,
            origin: "pedido",
            amountCents: rest,
            dueDate: c.today,
            orderId: o.id,
          });
          d.accounts.push(acc);
          pay(acc.id, rest, a.method, "entrada", session.id);
        }
      }
      o.stage = "entregue";
      o.deliveredAt = c.nowIso;
      event(o, rest > 0 ? `Entregue ao cliente — restante ${formatBRL(rest)}` : "Entregue ao cliente");
      c.log("pedido", `Pedido nº ${o.number} entregue`, o.clientId);
      return { ok: true, message: `Pedido nº ${o.number} entregue.`, id: o.id };
    }

    case "order.cancel": {
      const o = load(a.id, "editar");
      if (!isOrder(o)) return o;
      if (a.refund && o.downCents > 0) {
        if (!a.method) return fail("Escolha como o sinal volta para o cliente.");
        const session = openSession(d.cashSessions);
        if (!session) return fail("Abra o caixa para devolver o sinal.");
        const acc = account({
          kind: "pagar",
          clientId: o.clientId,
          supplier: d.clients.find((x) => x.id === o.clientId)?.name ?? null,
          description: `Pedido nº ${o.number} — sinal devolvido`,
          origin: "devolucao",
          amountCents: o.downCents,
          dueDate: c.today,
          category: "Devoluções",
          orderId: o.id,
        });
        d.accounts.push(acc);
        pay(acc.id, o.downCents, a.method, "saida", session.id);
      }
      if (stockOn)
        for (const it of d.orderItems.filter((i) => i.orderId === o.id && i.productId)) {
          const p = d.products.find((x) => x.id === it.productId);
          if (!p?.trackStock) continue;
          d.stockMovements.push({
            id: c.newId(),
            productId: p.id,
            kind: "devolucao",
            quantity: it.quantity,
            unitCostCents: null,
            saleId: null,
            orderId: o.id,
            reason: `Pedido nº ${o.number} cancelado`,
            createdBy: me,
            createdAt: c.nowIso,
          });
          p.stockQty = stockOf(p) + it.quantity;
        }
      Object.assign(o, { stage: "cancelado", canceledAt: c.nowIso, cancelReason: a.reason });
      event(o, `Cancelado: ${a.reason}${a.refund && o.downCents > 0 ? " (sinal devolvido)" : ""}`);
      return { ok: true, message: `Pedido nº ${o.number} cancelado.`, id: o.id };
    }
  }
}
