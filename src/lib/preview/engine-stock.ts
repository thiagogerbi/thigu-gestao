/**
 * MOTOR DA PRÉVIA — produtos, estoque, venda no balcão, devolução e crediário.
 * Mesmas regras de 20261114000021_stock.sql.
 */
import type { Action, ActionResult } from "@/lib/actions/schemas";
import { MODULE_OFF } from "@/lib/domain/agenda";
import { checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleEnabled } from "@/lib/domain/segments";
import { creditUsed, productLabel, refundFor, saleDiscountError, stockOf, stockShortages } from "@/lib/domain/stock";
import type { Account, CompanyData, Member, StockMovementKind } from "@/lib/domain/types";

export type StockAction = Extract<
  Action,
  { type: "cash.sale" | "product.save" | "stock.entry" | "stock.adjust" | "counter.return" | "client.setCreditLimit" }
>;

export interface StockContext {
  nowIso: string;
  today: string;
  newId: () => string;
  visible: CompanyData;
  log: (kind: string, description: string, clientId: string | null) => void;
  clientWord: string;
}

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});

export function runStock(d: CompanyData, actor: Member, a: StockAction, c: StockContext): ActionResult {
  const roles = actor.roles;
  const me = actor.userId;
  const stockOn = moduleEnabled(d.company, "estoque");
  const move = (
    productId: string,
    kind: StockMovementKind,
    quantity: number,
    extra: { unitCostCents?: number | null; saleId?: string | null; reason?: string } = {},
  ) => {
    d.stockMovements.push({
      id: c.newId(),
      productId,
      kind,
      quantity,
      unitCostCents: extra.unitCostCents ?? null,
      saleId: extra.saleId ?? null,
      reason: extra.reason ?? "",
      createdBy: me,
      createdAt: c.nowIso,
    });
    const p = d.products.find((x) => x.id === productId)!;
    p.stockQty = stockOf(p) + quantity;
  };
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

  switch (a.type) {
    case "product.save": {
      if (!moduleEnabled(d.company, "caixa")) return fail(MODULE_OFF);
      if (!can(roles, "produtos.gerenciar")) return fail("Somente o administrador ou o gestor cadastram produtos.");
      if (a.barcode && d.products.some((p) => p.barcode === a.barcode && p.id !== a.id))
        return fail("Este código de barras já está em outro produto.", { barcode: "Código de barras já usado." });
      const values = {
        name: a.name,
        priceCents: a.priceCents,
        active: a.active,
        ...(a.sku !== undefined && { sku: a.sku }),
        ...(a.barcode !== undefined && { barcode: a.barcode }),
        ...(a.costCents !== undefined && { costCents: a.costCents }),
        ...(a.minStock !== undefined && { minStock: a.minStock }),
        ...(a.size !== undefined && { size: a.size }),
        ...(a.color !== undefined && { color: a.color }),
        ...(a.fits !== undefined && { fits: a.fits }),
      };
      if (a.id) {
        const p = d.products.find((x) => x.id === a.id);
        if (!p) return fail("Produto não encontrado.");
        Object.assign(p, values);
        return { ok: true, message: `Produto ${a.name} salvo.`, id: p.id };
      }
      const id = c.newId();
      d.products.push({ id, stockQty: 0, trackStock: false, ...values });
      return { ok: true, message: `Produto ${a.name} cadastrado.`, id };
    }

    case "stock.entry":
    case "stock.adjust": {
      if (!stockOn) return fail(MODULE_OFF);
      if (!can(roles, "estoque.movimentar")) return fail("Seu papel nesta empresa não permite mexer no estoque.");
      const p = d.products.find((x) => x.id === a.productId);
      if (!p) return fail("Produto não encontrado.");
      if (a.type === "stock.entry") {
        move(p.id, "entrada", a.quantity, { unitCostCents: a.unitCostCents, reason: a.reason });
        p.trackStock = true;
        if (a.unitCostCents !== null) p.costCents = a.unitCostCents;
        return { ok: true, message: `Entrada de ${a.quantity} ${productLabel(p)}. Estoque: ${stockOf(p)}.`, id: p.id };
      }
      if (a.kind === "perda" && a.delta > 0) return fail("Perda sempre tira do estoque.");
      if (stockOf(p) + a.delta < 0) return fail("O estoque não pode ficar negativo.");
      move(p.id, a.kind, a.delta, { reason: a.reason });
      p.trackStock = true;
      return { ok: true, message: `Estoque de ${productLabel(p)} ajustado para ${stockOf(p)}.`, id: p.id };
    }

    case "client.setCreditLimit": {
      if (!stockOn) return fail(MODULE_OFF);
      if (!can(roles, "crediario.limite")) return fail("Somente o financeiro ou o dono definem o limite de crediário.");
      const client = c.visible.clients.some((x) => x.id === a.clientId) && d.clients.find((x) => x.id === a.clientId);
      if (!client) return fail(`${c.clientWord} não encontrado.`);
      client.creditLimitCents = a.limitCents;
      c.log(
        "crediario",
        a.limitCents === null ? "Crediário desligado" : `Limite de crediário: ${formatBRL(a.limitCents)}`,
        client.id,
      );
      return {
        ok: true,
        message:
          a.limitCents === null
            ? `Crediário de ${client.name} desligado.`
            : `Limite de ${client.name}: ${formatBRL(a.limitCents)}.`,
        id: client.id,
      };
    }

    case "cash.sale": {
      const session = d.cashSessions.find((s) => s.id === a.sessionId);
      if (!moduleEnabled(d.company, "caixa") || !can(roles, "caixa.operar") || !session)
        return fail("Caixa não encontrado.");
      if (session.closedAt) return fail("Este caixa já foi fechado. Abra o caixa de novo.");
      const client = a.clientId ? c.visible.clients.find((x) => x.id === a.clientId) : null;
      if (a.clientId && !client) return fail(`${c.clientWord} não encontrado.`);
      if (a.items.some((i) => i.productId && !d.products.some((p) => p.id === i.productId)))
        return fail("Produto não encontrado.");
      if (stockOn) {
        const short = stockShortages(d.products, a.items)[0];
        if (short) return fail(`Estoque insuficiente de ${short.product.name} (tem ${stockOf(short.product)}).`);
      }
      const subtotal = a.items.reduce((s, i) => s + i.quantity * i.unitCents, 0);
      const discErr = saleDiscountError(a.discountCents, subtotal, can(roles, "balcao.desconto_livre"));
      if (discErr) return fail(discErr, { discountCents: discErr });
      const total = subtotal - a.discountCents;
      const credit = a.plan.length > 0;
      if (credit) {
        if (!stockOn) return fail("O crediário não está disponível para o ramo da empresa.");
        if (!client) return fail("Escolha o cliente do crediário.", { clientId: "Escolha o cliente." });
        const full = d.clients.find((x) => x.id === client.id)!;
        if (full.creditLimitCents === null || full.creditLimitCents === undefined)
          return fail("Este cliente não tem crediário liberado.");
        const used = creditUsed(full.id, d.accounts, d.movements);
        if (used + total > full.creditLimitCents)
          return fail(
            `Passa do limite do crediário (disponível ${formatBRL(Math.max(0, full.creditLimitCents - used))}).`,
          );
        const check = checkPlan(a.plan, total);
        if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
      } else if (!a.method) return fail("Escolha a forma de pagamento.");

      const saleId = c.newId();
      d.counterSales.push({
        id: saleId,
        sessionId: session.id,
        clientId: a.clientId,
        subtotalCents: subtotal,
        discountCents: a.discountCents,
        totalCents: total,
        payment: credit ? "crediario" : "avista",
        method: credit ? null : a.method,
        createdBy: me,
        createdAt: c.nowIso,
      });
      const what = `${a.items[0].description}${a.items.length > 1 ? ` e mais ${a.items.length - 1}` : ""}`;
      let firstAccount = "";
      if (credit) {
        for (const inst of a.plan) {
          const acc = account({
            kind: "receber",
            clientId: a.clientId,
            description: `Crediário: ${what}`,
            origin: "crediario",
            amountCents: inst.amountCents,
            dueDate: inst.dueDate,
            installmentNumber: inst.number,
            installmentCount: a.plan.length,
            counterSaleId: saleId,
          });
          d.accounts.push(acc);
          firstAccount ||= acc.id;
        }
      } else {
        const acc = account({
          kind: "receber",
          clientId: a.clientId,
          description: `Venda no caixa: ${what}`,
          origin: "caixa",
          amountCents: total,
          dueDate: c.today,
          counterSaleId: saleId,
        });
        d.accounts.push(acc);
        firstAccount = acc.id;
        d.movements.push({
          id: c.newId(),
          accountId: acc.id,
          direction: "entrada",
          amountCents: total,
          paidOn: c.today,
          method: a.method!,
          registeredBy: me,
          createdAt: c.nowIso,
          undoneAt: null,
          undoneBy: null,
          undoReason: null,
          cashSessionId: session.id,
        });
      }
      for (const i of a.items) {
        d.cashSaleItems.push({ id: c.newId(), accountId: firstAccount, saleId, returnedQty: 0, ...i });
        const p = i.productId ? d.products.find((x) => x.id === i.productId) : undefined;
        if (stockOn && p?.trackStock) move(p.id, "venda", -i.quantity, { saleId });
      }
      if (a.clientId)
        log(
          c,
          credit ? `Compra no crediário: ${formatBRL(total)}` : `Compra no caixa: ${formatBRL(total)}`,
          a.clientId,
        );
      return {
        ok: true,
        message: credit
          ? `Venda de ${formatBRL(total)} no crediário em ${a.plan.length}x.`
          : `Venda de ${formatBRL(total)} registrada.`,
        id: firstAccount,
      };
    }

    case "counter.return": {
      const sale = d.counterSales.find((s) => s.id === a.saleId);
      if (!sale || !moduleEnabled(d.company, "caixa") || !can(roles, "caixa.operar"))
        return fail("Venda não encontrada.");
      if (sale.payment !== "avista")
        return fail("Venda no crediário: cancele as parcelas no financeiro e dê entrada do item no estoque.");
      const session = d.cashSessions.find((s) => !s.closedAt);
      if (!session) return fail("Abra o caixa para devolver o dinheiro.");
      let lines = 0;
      let count = 0;
      for (const r of a.items) {
        const it = d.cashSaleItems.find((i) => i.id === r.itemId && i.saleId === sale.id);
        if (!it) return fail("Item não encontrado nesta venda.");
        const left = it.quantity - (it.returnedQty ?? 0);
        if (r.quantity > left) return fail(`Só dá para devolver ${left} de ${it.description}.`);
      }
      for (const r of a.items) {
        const it = d.cashSaleItems.find((i) => i.id === r.itemId)!;
        it.returnedQty = (it.returnedQty ?? 0) + r.quantity;
        lines += r.quantity * it.unitCents;
        count += r.quantity;
        const p = it.productId ? d.products.find((x) => x.id === it.productId) : undefined;
        if (stockOn && p?.trackStock) move(p.id, "devolucao", r.quantity, { saleId: sale.id, reason: "Devolução" });
      }
      const refund = refundFor(sale, lines);
      const clientName = sale.clientId ? (d.clients.find((x) => x.id === sale.clientId)?.name ?? null) : null;
      const acc = account({
        kind: "pagar",
        clientId: sale.clientId,
        supplier: clientName ?? "Cliente do balcão",
        description: `Devolução de ${count} ${count === 1 ? "item" : "itens"}`,
        origin: "devolucao",
        amountCents: refund,
        dueDate: c.today,
        category: "Devoluções",
        counterSaleId: sale.id,
      });
      d.accounts.push(acc);
      d.movements.push({
        id: c.newId(),
        accountId: acc.id,
        direction: "saida",
        amountCents: refund,
        paidOn: c.today,
        method: a.method,
        registeredBy: me,
        createdAt: c.nowIso,
        undoneAt: null,
        undoneBy: null,
        undoReason: null,
        cashSessionId: session.id,
      });
      if (sale.clientId) log(c, `Devolução: ${formatBRL(refund)}`, sale.clientId);
      return { ok: true, message: `Devolução registrada. Devolver ${formatBRL(refund)} ao cliente.`, id: acc.id };
    }
  }
}

function log(c: StockContext, description: string, clientId: string) {
  c.log("caixa", description, clientId);
}
