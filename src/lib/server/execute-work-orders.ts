import type { ActionResult } from "@/lib/actions/schemas";
import { checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { WO_STAGE_LABEL } from "@/lib/domain/work-orders";
import type { WorkOrderAction } from "@/lib/preview/engine-work-orders";
import type { ExecContext } from "@/lib/server/execute";
import "server-only";

/**
 * Ordem de serviço na versão real. Toda gravação passa pelas funções do banco
 * (20261114000018_work_orders.sql), que conferem de novo papel, etapa e valores.
 */

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});

export const PHOTO_BUCKET = "os-fotos";

export async function executeWorkOrder(
  ctx: ExecContext,
  a: WorkOrderAction,
  dbFail: (e: { message?: string; code?: string } | null) => ActionResult,
): Promise<ActionResult> {
  const { sb, companyId, userId, roles } = ctx;
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    return { data: data as T, error };
  };

  switch (a.type) {
    case "vehicle.transfer": {
      if (!can(roles, "os.editar")) return fail("Seu papel nesta empresa não permite transferir veículos.");
      const { error } = await rpc("transfer_vehicle", { p_item: a.itemId, p_client: a.clientId });
      if (error) return dbFail(error);
      return { ok: true, message: "Veículo transferido. O histórico continua com a placa.", id: a.itemId };
    }

    case "workOrder.open": {
      if (!can(roles, "os.editar")) return fail("Seu papel nesta empresa não permite abrir ordens de serviço.");
      const { data, error } = await rpc<{ id: string; number: number }>("open_work_order", {
        p_client: a.clientId,
        p_item: a.itemId,
        p_resource: a.resourceId,
        p_complaint: a.complaint,
        p_km: a.km,
        p_fuel: a.fuel,
        p_checklist: a.checklist,
        p_promised: a.promisedOn,
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      return { ok: true, message: `OS nº ${data.number} aberta.`, id: data.id };
    }

    case "workOrder.save": {
      const { error } = await rpc("save_work_order", {
        p_wo: a.id,
        p_resource: a.resourceId,
        p_complaint: a.complaint,
        p_km: a.km,
        p_fuel: a.fuel,
        p_checklist: a.checklist,
        p_promised: a.promisedOn,
      });
      if (error) return dbFail(error);
      return { ok: true, message: "Dados da OS salvos.", id: a.id };
    }

    case "workOrder.diagnosis": {
      const { error } = await rpc("set_work_order_diagnosis", { p_wo: a.id, p_text: a.text });
      if (error) return dbFail(error);
      return { ok: true, message: "Diagnóstico salvo.", id: a.id };
    }

    case "workOrder.addItem": {
      const { data, error } = await rpc<string>("add_work_order_item", {
        p_wo: a.workOrderId,
        p_kind: a.kind,
        p_service: a.serviceId,
        p_description: a.description,
        p_quantity: a.quantity,
        p_unit: a.unitCents,
        p_warranty: a.warrantyDays,
      });
      if (error) return dbFail(error);
      return { ok: true, message: `${a.kind === "peca" ? "Peça" : "Serviço"} incluído no orçamento.`, id: data };
    }

    case "workOrder.removeItem": {
      const { error } = await rpc("remove_work_order_item", { p_item: a.id });
      if (error) return dbFail(error);
      return { ok: true, message: "Item retirado do orçamento.", id: a.id };
    }

    case "workOrder.discount": {
      const { error } = await rpc("set_work_order_discount", { p_wo: a.id, p_discount: a.discountCents });
      if (error)
        return error.code === "42501" || error.code === "22023"
          ? fail(error.message, { discountCents: error.message })
          : dbFail(error);
      return { ok: true, message: "Desconto aplicado.", id: a.id };
    }

    case "workOrder.send": {
      const { data, error } = await rpc<string>("send_work_order", { p_wo: a.id });
      if (error) return dbFail(error);
      return { ok: true, message: "Orçamento pronto para enviar.", id: a.id, extra: { token: data } };
    }

    case "workOrder.approve": {
      const { data, error } = await rpc<{ approved: number; refused: number }>("approve_work_order", {
        p_wo: a.id,
        p_approved: a.approvedIds,
        p_channel: a.channel,
        p_name: a.name,
      });
      if (error) return dbFail(error);
      const total = data.approved + data.refused;
      return {
        ok: true,
        message: data.approved
          ? `Aprovação registrada (${data.approved} de ${total} itens no total).`
          : "Orçamento recusado. A OS ficou pronta para retirada.",
        id: a.id,
      };
    }

    case "workOrder.move": {
      const { error } = await rpc("move_work_order", { p_wo: a.id, p_stage: a.stage });
      if (error) return dbFail(error);
      return { ok: true, message: `OS: ${WO_STAGE_LABEL[a.stage].toLowerCase()}.`, id: a.id };
    }

    case "workOrder.deliver": {
      if (!can(roles, "os.entregar")) return fail("Seu papel nesta empresa não permite entregar ordens de serviço.");
      if (a.plan.length) {
        const sum = a.plan.reduce((s, p) => s + p.amountCents, 0);
        const check = checkPlan(a.plan, sum);
        if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
      }
      const { data, error } = await rpc<{ total_cents: number }>("deliver_work_order", {
        p_wo: a.id,
        p_plan: a.plan.map((x) => ({ number: x.number, amount_cents: x.amountCents, due_date: x.dueDate })),
        p_next_service: a.nextServiceOn,
        p_next_note: a.nextServiceNote,
      });
      if (error) return dbFail(error);
      const total = Number(data.total_cents);
      return {
        ok: true,
        message: total > 0 ? `Veículo entregue. ${formatBRL(total)} foi para o financeiro.` : "Veículo entregue.",
        id: a.id,
      };
    }

    case "workOrder.cancel": {
      const { error } = await rpc("cancel_work_order", { p_wo: a.id, p_reason: a.reason });
      if (error) return dbFail(error);
      return { ok: true, message: "OS cancelada.", id: a.id };
    }

    case "workOrder.addPhoto": {
      // o arquivo vai para o Storage (bucket privado) com o login da pessoa; o banco confere o acesso nos dois lugares
      const m = /^data:(image\/(?:webp|jpeg|png));base64,(.+)$/.exec(a.dataUrl);
      if (!m) return fail("Foto inválida.");
      const ext = m[1] === "image/png" ? "png" : m[1] === "image/jpeg" ? "jpg" : "webp";
      const path = `${companyId}/${a.workOrderId}/${crypto.randomUUID()}.${ext}`;
      const bytes = Buffer.from(m[2], "base64");
      const up = await sb.storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType: m[1], upsert: false });
      if (up.error) {
        console.error("[thigu] envio de foto", up.error);
        return fail("Não foi possível enviar a foto agora. Confira se você pode mexer nesta OS e tente de novo.");
      }
      const { data, error } = await sb
        .from("work_order_photos")
        .insert({ company_id: companyId, work_order_id: a.workOrderId, path, caption: a.caption, created_by: userId })
        .select("id")
        .single();
      if (error) {
        // a linha não entrou (limite do plano, OS encerrada): o arquivo enviado não deve ficar perdido no Storage
        await sb.storage.from(PHOTO_BUCKET).remove([path]);
        return dbFail(error);
      }
      return { ok: true, message: "Foto adicionada.", id: data.id };
    }
  }
}
