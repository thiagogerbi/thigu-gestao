import type { ActionResult } from "@/lib/actions/schemas";
import { formatBRL } from "@/lib/domain/money";
import { prescriptionError } from "@/lib/domain/orders";
import { can } from "@/lib/domain/permissions";
import type { OrderAction } from "@/lib/preview/engine-orders";
import type { ExecContext } from "@/lib/server/execute";
import "server-only";

/**
 * Pedidos com prazo e receita de óculos na versão real. As funções do banco (20261114000022_orders.sql)
 * conferem de novo papel, etapa, estoque, caixa e valores.
 */

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});
const plan = (p: { number: number; amountCents: number; dueDate: string }[]) =>
  p.map((x) => ({ number: x.number, amount_cents: x.amountCents, due_date: x.dueDate }));

export async function executeOrder(
  ctx: ExecContext,
  a: OrderAction,
  dbFail: (e: { message?: string; code?: string } | null) => ActionResult,
): Promise<ActionResult> {
  const { sb, companyId, userId, roles } = ctx;
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    return { data: data as T, error };
  };

  switch (a.type) {
    case "prescription.save": {
      if (!can(roles, "receita.usar")) return fail("Seu papel nesta empresa não permite lançar receitas.");
      const err = prescriptionError(a);
      if (err) return fail(err);
      const { data, error } = await sb
        .from("prescriptions")
        .insert({
          company_id: companyId,
          client_id: a.clientId,
          examined_on: a.examinedOn,
          valid_until: a.validUntil,
          doctor: a.doctor,
          od_sph: a.od.sph,
          od_cyl: a.od.cyl,
          od_axis: a.od.axis,
          od_add: a.od.add,
          oe_sph: a.oe.sph,
          oe_cyl: a.oe.cyl,
          oe_axis: a.oe.axis,
          oe_add: a.oe.add,
          dnp_od: a.dnpOd,
          dnp_oe: a.dnpOe,
          notes: a.notes,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) return dbFail(error);
      return { ok: true, message: "Receita lançada.", id: data.id };
    }

    case "order.open": {
      if (!can(roles, "pedidos.editar")) return fail("Seu papel nesta empresa não permite abrir pedidos.");
      const { data, error } = await rpc<{ id: string; number: number }>("open_order", {
        p_client: a.clientId,
        p_title: a.title,
        p_details: a.details,
        p_promised: a.promisedOn,
        p_resource: a.resourceId,
        p_prescription: a.prescriptionId,
        p_items: a.items.map((i) => ({
          product_id: i.productId,
          description: i.description,
          quantity: i.quantity,
          unit_cents: i.unitCents,
        })),
        p_down: a.downCents,
        p_method: a.downCents > 0 ? a.method : null,
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      return { ok: true, message: `Pedido nº ${data.number} aberto.`, id: data.id };
    }

    case "order.save": {
      const { error } = await rpc("save_order", {
        p_order: a.id,
        p_title: a.title,
        p_details: a.details,
        p_promised: a.promisedOn,
        p_resource: a.resourceId,
      });
      if (error) return dbFail(error);
      return { ok: true, message: "Pedido salvo.", id: a.id };
    }

    case "order.move": {
      const { error } = await rpc("move_order", { p_order: a.id, p_stage: a.stage });
      if (error) return dbFail(error);
      return { ok: true, message: "Etapa do pedido atualizada.", id: a.id };
    }

    case "order.deliver": {
      if (!can(roles, "pedidos.entregar")) return fail("Seu papel nesta empresa não permite entregar pedidos.");
      const { data, error } = await rpc<{ rest_cents?: number }>("deliver_order", {
        p_order: a.id,
        p_method: a.plan.length ? null : a.method,
        p_plan: a.plan.length ? plan(a.plan) : null,
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      const rest = Number(data?.rest_cents ?? 0);
      return {
        ok: true,
        message: rest > 0 ? `Pedido entregue. Restante de ${formatBRL(rest)} registrado.` : "Pedido entregue.",
        id: a.id,
      };
    }

    case "order.cancel": {
      const { error } = await rpc("cancel_order", {
        p_order: a.id,
        p_reason: a.reason,
        p_refund: a.refund,
        p_method: a.refund ? a.method : null,
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      return { ok: true, message: "Pedido cancelado.", id: a.id };
    }
  }
}
