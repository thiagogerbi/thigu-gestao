import type { ActionResult } from "@/lib/actions/schemas";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import type { StockAction } from "@/lib/preview/engine-stock";
import type { ExecContext } from "@/lib/server/execute";
import "server-only";

/**
 * Produtos, estoque, venda no balcão, devolução e crediário na versão real.
 * As funções do banco (20261114000021_stock.sql) conferem de novo papel, estoque, limite e valores.
 */

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});

export async function executeStock(
  ctx: ExecContext,
  a: StockAction,
  dbFail: (e: { message?: string; code?: string } | null) => ActionResult,
): Promise<ActionResult> {
  const { sb, companyId, roles } = ctx;
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    return { data: data as T, error };
  };

  switch (a.type) {
    case "product.save": {
      if (!can(roles, "produtos.gerenciar")) return fail("Somente o administrador ou o gestor cadastram produtos.");
      const values: Record<string, unknown> = { name: a.name, price_cents: a.priceCents, active: a.active };
      if (a.sku !== undefined) values.sku = a.sku;
      if (a.barcode !== undefined) values.barcode = a.barcode;
      if (a.costCents !== undefined) values.cost_cents = a.costCents;
      if (a.minStock !== undefined) values.min_stock = a.minStock;
      if (a.size !== undefined) values.size = a.size;
      if (a.color !== undefined) values.color = a.color;
      if (a.fits !== undefined) values.fits = a.fits;
      const { data, error } = a.id
        ? await sb.from("products").update(values).eq("id", a.id).eq("company_id", companyId).select("id")
        : await sb
            .from("products")
            .insert({ ...values, company_id: companyId })
            .select("id");
      if (error?.code === "23505")
        return fail("Este código de barras já está em outro produto.", { barcode: "Código de barras já usado." });
      if (error) return dbFail(error);
      if (!data?.length) return fail("Produto não encontrado.");
      return { ok: true, message: a.id ? `Produto ${a.name} salvo.` : `Produto ${a.name} cadastrado.`, id: data[0].id };
    }

    case "stock.entry": {
      const { error } = await rpc("stock_entry", {
        p_product: a.productId,
        p_quantity: a.quantity,
        p_unit_cost: a.unitCostCents,
        p_reason: a.reason,
      });
      if (error) return dbFail(error);
      return { ok: true, message: `Entrada de ${a.quantity} registrada.`, id: a.productId };
    }

    case "stock.adjust": {
      const { error } = await rpc("stock_adjust", {
        p_product: a.productId,
        p_delta: a.delta,
        p_kind: a.kind,
        p_reason: a.reason,
      });
      if (error) return dbFail(error);
      return { ok: true, message: "Estoque ajustado.", id: a.productId };
    }

    case "client.setCreditLimit": {
      const { error } = await rpc("set_credit_limit", { p_client: a.clientId, p_limit: a.limitCents });
      if (error) return dbFail(error);
      return {
        ok: true,
        message: a.limitCents === null ? "Crediário desligado." : `Limite de crediário: ${formatBRL(a.limitCents)}.`,
        id: a.clientId,
      };
    }

    case "cash.sale": {
      if (!can(roles, "caixa.operar")) return fail("Seu papel nesta empresa não permite usar o caixa.");
      const { data, error } = await rpc<{ account_id?: string; total_cents?: number }>("counter_sale", {
        p_session: a.sessionId,
        p_client: a.clientId,
        p_items: a.items.map((i) => ({
          product_id: i.productId,
          service_id: i.serviceId,
          description: i.description,
          quantity: i.quantity,
          unit_cents: i.unitCents,
        })),
        p_discount: a.discountCents,
        p_method: a.plan.length ? null : a.method,
        p_plan: a.plan.length
          ? a.plan.map((x) => ({ number: x.number, amount_cents: x.amountCents, due_date: x.dueDate }))
          : null,
        p_request: a.requestId,
      });
      if (error) return error.code === "42501" ? fail(error.message, { discountCents: error.message }) : dbFail(error);
      const total = a.items.reduce((s, i) => s + i.quantity * i.unitCents, 0) - a.discountCents;
      return {
        ok: true,
        message: a.plan.length
          ? `Venda de ${formatBRL(total)} no crediário em ${a.plan.length}x.`
          : `Venda de ${formatBRL(total)} registrada.`,
        id: data?.account_id,
      };
    }

    case "counter.return": {
      if (!can(roles, "caixa.operar")) return fail("Seu papel nesta empresa não permite usar o caixa.");
      const { data, error } = await rpc<{ refund_cents?: number; duplicate: boolean }>("counter_return", {
        p_sale: a.saleId,
        p_items: a.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })),
        p_method: a.method,
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      return {
        ok: true,
        message:
          data.refund_cents !== undefined
            ? `Devolução registrada. Devolver ${formatBRL(Number(data.refund_cents))} ao cliente.`
            : "Devolução registrada.",
      };
    }
  }
}
