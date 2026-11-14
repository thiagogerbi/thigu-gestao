import type { Action, ActionResult } from "@/lib/actions/schemas";
import { checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import { can, canAssignOthers, type Capability } from "@/lib/domain/permissions";
import { hasProposalErrors, proposalTotalCents, validateProposal } from "@/lib/domain/proposals";
import { STAGE_LABEL, type Role } from "@/lib/domain/types";
import type { ServerSupabase } from "@/lib/supabase/server";
import "server-only";

/**
 * Executa uma ação da aplicação real.
 * Camadas de proteção: (1) zod já validou o formato; (2) aqui conferimos o papel do usuário na empresa;
 * (3) o banco reaplica tudo via RLS e funções SQL. Mesmo que (2) falhe, (3) bloqueia.
 */
export interface ExecContext {
  sb: ServerSupabase;
  companyId: string;
  userId: string;
  roles: Role[];
}

const NO_PERMISSION = "Seu papel nesta empresa não permite esta ação.";
const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});

function dbFail(error: { message?: string; code?: string } | null): ActionResult {
  const msg = error?.message ?? "";
  if (error?.code === "42501" || /row-level security/i.test(msg))
    return fail(/row-level/i.test(msg) ? NO_PERMISSION : msg);
  if (error?.code === "P0001" || error?.code === "P0002" || error?.code === "22023" || error?.code === "23505")
    return fail(msg);
  if (error?.code === "23503") return fail("Registro relacionado não encontrado nesta empresa.");
  console.error("[thigu] erro do banco", error);
  return fail("Não foi possível salvar agora. Tente novamente em instantes.");
}

const plan = (p: { number: number; amountCents: number; dueDate: string }[]) =>
  p.map((x) => ({ number: x.number, amount_cents: x.amountCents, due_date: x.dueDate }));

export async function executeAction(ctx: ExecContext, a: Action): Promise<ActionResult> {
  const { sb, companyId, userId, roles } = ctx;
  const need = (cap: Capability) => can(roles, cap);
  const log = (description: string, kind: string, clientId: string | null, dealId: string | null = null) =>
    sb
      .from("activities")
      .insert({ company_id: companyId, client_id: clientId, deal_id: dealId, kind, description, actor_id: userId });

  switch (a.type) {
    case "client.save": {
      if (!need("crm.editar_proprios")) return fail(NO_PERMISSION);
      if (!canAssignOthers(roles) && a.ownerId !== userId)
        return fail("Você só pode cadastrar clientes sob sua responsabilidade.");
      const values = { name: a.name, email: a.email, phone: a.phone, owner_id: a.ownerId };
      if (a.id) {
        const { data, error } = await sb
          .from("clients")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail("Cliente não encontrado ou sem permissão para editar.");
        await log("Dados do cliente atualizados", "cliente", a.id);
        return { ok: true, message: `Cliente ${a.name} atualizado.`, id: a.id };
      }
      const { data, error } = await sb
        .from("clients")
        .insert({ ...values, company_id: companyId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      await log("Cliente cadastrado", "cliente", data.id);
      return { ok: true, message: `Cliente ${a.name} cadastrado.`, id: data.id };
    }

    case "deal.save": {
      if (!need("crm.editar_proprios")) return fail(NO_PERMISSION);
      if (!canAssignOthers(roles) && a.ownerId !== userId)
        return fail("Você só pode criar negociações sob sua responsabilidade.");
      const values = {
        client_id: a.clientId,
        title: a.title,
        value_cents: a.valueCents,
        owner_id: a.ownerId,
        expected_close: a.expectedClose,
        next_action: a.nextAction || null,
        next_action_date: a.nextActionDate,
      };
      if (a.id) {
        const { data, error } = await sb
          .from("deals")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail("Negociação não encontrada ou sem permissão para editar.");
        await log(`Negociação "${a.title}" atualizada`, "negociacao", a.clientId, a.id);
        return { ok: true, message: "Negociação atualizada.", id: a.id };
      }
      const { data, error } = await sb
        .from("deals")
        .insert({ ...values, company_id: companyId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      await log(`Negociação "${a.title}" criada`, "negociacao", a.clientId, data.id);
      return { ok: true, message: `Negociação "${a.title}" criada.`, id: data.id };
    }

    case "deal.move": {
      if (a.stage === "perdida" && !a.lostReason?.trim())
        return fail("Conte o motivo da perda.", { lostReason: "Informe o motivo da perda." });
      const { data, error } = await sb
        .from("deals")
        .update({ stage: a.stage, lost_reason: a.stage === "perdida" ? a.lostReason!.trim() : null })
        .eq("id", a.id)
        .eq("company_id", companyId)
        .neq("stage", "ganha")
        .select("id, title, client_id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Negociação não encontrada, já fechada ou sem permissão.");
      await log(
        a.stage === "perdida"
          ? `Negociação marcada como perdida. Motivo: ${a.lostReason}`
          : `Etapa alterada para ${STAGE_LABEL[a.stage]}`,
        "etapa",
        data[0].client_id,
        a.id,
      );
      return { ok: true, message: `"${data[0].title}" agora está em ${STAGE_LABEL[a.stage]}.`, id: a.id };
    }

    case "note.add": {
      const { data, error } = await sb
        .from("notes")
        .insert({ company_id: companyId, client_id: a.clientId, deal_id: a.dealId, body: a.body, author_id: userId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      return { ok: true, message: "Anotação registrada.", id: data.id };
    }

    case "task.save": {
      if (!canAssignOthers(roles) && !need("empresa.gerenciar") && a.assigneeId !== userId)
        return fail("Você só pode criar tarefas para você mesmo.");
      const values = {
        title: a.title,
        client_id: a.clientId,
        deal_id: a.dealId,
        assignee_id: a.assigneeId,
        due_date: a.dueDate,
      };
      if (a.id) {
        const { data, error } = await sb
          .from("tasks")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail("Tarefa não encontrada ou sem permissão.");
        return { ok: true, message: "Tarefa atualizada.", id: a.id };
      }
      const { data, error } = await sb
        .from("tasks")
        .insert({ ...values, company_id: companyId, created_by: userId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      if (a.clientId) await log(`Tarefa criada: ${a.title}`, "tarefa", a.clientId, a.dealId);
      return { ok: true, message: "Tarefa criada.", id: data.id };
    }

    case "task.setDone": {
      const { data, error } = await sb
        .from("tasks")
        .update({ status: a.done ? "concluida" : "aberta", completed_at: a.done ? new Date().toISOString() : null })
        .eq("id", a.id)
        .eq("company_id", companyId)
        .select("id, title");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Só o responsável pode concluir esta tarefa.");
      return {
        ok: true,
        message: a.done ? `Tarefa "${data[0].title}" concluída.` : `Tarefa "${data[0].title}" reaberta.`,
        id: a.id,
      };
    }

    case "proposal.save": {
      if (hasProposalErrors(validateProposal(a.items, a.discountCents, a.validUntil)))
        return fail("Revise os itens da proposta.");
      const { data, error } = await sb.rpc("save_proposal", {
        p_company: companyId,
        p_id: a.id ?? null,
        p_deal: a.dealId,
        p_client: a.clientId,
        p_items: a.items.map((i) => ({ description: i.description, quantity: i.quantity, unit_cents: i.unitCents })),
        p_discount: a.discountCents,
        p_valid_until: a.validUntil,
        p_terms: a.terms,
      });
      if (error) return dbFail(error);
      return {
        ok: true,
        message: `Proposta de ${formatBRL(proposalTotalCents(a.items, a.discountCents))} salva.`,
        id: data as string,
      };
    }

    case "proposal.markSent": {
      const { error } = await sb.rpc("proposal_mark_sent", { p_proposal: a.id, p_follow_up: a.followUpTask });
      if (error) return dbFail(error);
      return {
        ok: true,
        message: a.followUpTask
          ? "Envio registrado e tarefa de retorno criada para daqui a 2 dias."
          : "Envio registrado.",
        id: a.id,
      };
    }

    case "proposal.accept": {
      const { data, error } = await sb.rpc("proposal_accept", { p_proposal: a.id, p_update_value: a.updateDealValue });
      if (error) return dbFail(error);
      if ((data as { already?: boolean })?.already)
        return { ok: true, message: "Esta proposta já estava registrada como aceita.", id: a.id };
      return { ok: true, message: "Aceite registrado. Próximo passo: fechar a venda.", id: a.id };
    }

    case "proposal.reject": {
      const { error } = await sb.rpc("proposal_reject", { p_proposal: a.id, p_reason: a.reason });
      if (error) return dbFail(error);
      return { ok: true, message: "Proposta marcada como recusada.", id: a.id };
    }

    case "sale.close": {
      if (!need("venda.fechar")) return fail(NO_PERMISSION);
      const check = checkPlan(a.plan, a.totalCents);
      if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
      const { data, error } = await sb.rpc("close_sale", {
        p_deal: a.dealId,
        p_proposal: a.proposalId,
        p_total: a.totalCents,
        p_mode: a.paymentMode,
        p_plan: plan(a.plan),
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      return {
        ok: true,
        message: `Venda de ${formatBRL(a.totalCents)} fechada. Agora o financeiro confirma as parcelas.`,
        id: (data as { sale_id: string }).sale_id,
      };
    }

    case "sale.confirm": {
      if (!need("venda.conferir")) return fail("Somente o financeiro ou o dono podem confirmar as parcelas.");
      const { data, error } = await sb.rpc("confirm_sale", { p_sale: a.saleId, p_plan: plan(a.plan) });
      if (error) return dbFail(error);
      const r = data as { created: number; duplicate: boolean };
      if (r.duplicate)
        return {
          ok: true,
          message: "As parcelas desta venda já tinham sido confirmadas. Nenhuma parcela nova foi criada.",
          id: a.saleId,
          extra: { duplicate: true },
        };
      return {
        ok: true,
        message: `${r.created} ${r.created === 1 ? "parcela criada" : "parcelas criadas"} em contas a receber.`,
        id: a.saleId,
      };
    }

    case "movement.register": {
      if (!need("financeiro.registrar"))
        return fail("Somente o financeiro ou o dono podem registrar recebimentos e pagamentos.");
      const { data: acc } = await sb
        .from("accounts")
        .select("kind")
        .eq("id", a.accountId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!acc) return fail("Conta não encontrada.");
      const { data, error } = await sb.rpc("register_movement", {
        p_account: a.accountId,
        p_amount: a.amountCents,
        p_paid_on: a.paidOn,
        p_method: a.method,
        p_request: a.requestId,
      });
      if (error) {
        const r = dbFail(error);
        return r.ok ? r : { ...r, fieldErrors: { amount: r.message } };
      }
      const rest = (data as { remaining_cents: number }).remaining_cents;
      const isIn = acc.kind === "receber";
      const verb = isIn ? "Recebimento" : "Pagamento";
      const tail =
        rest > 0
          ? ` ${isIn ? "Faltam" : "Ainda falta pagar"} ${formatBRL(rest)}.`
          : isIn
            ? " Parcela quitada."
            : " Conta quitada.";
      return {
        ok: true,
        message: `${verb} de ${formatBRL(a.amountCents)} registrado.${tail}`,
        id: (data as { movement_id: string }).movement_id,
        extra: { remainingCents: rest },
      };
    }

    case "movement.undo": {
      if (!need("financeiro.registrar")) return fail(NO_PERMISSION);
      const { data, error } = await sb.rpc("undo_movement", { p_movement: a.movementId, p_reason: a.reason });
      if (error) return dbFail(error);
      const r = data as { already: boolean; amount_cents?: number };
      if (r.already) return { ok: true, message: "Este registro já tinha sido desfeito.", id: a.movementId };
      return {
        ok: true,
        message: `Registro de ${formatBRL(r.amount_cents ?? 0)} desfeito. O valor voltou a constar como em aberto.`,
        id: a.movementId,
      };
    }

    case "account.cancel": {
      if (!need("financeiro.registrar")) return fail(NO_PERMISSION);
      const { error } = await sb.rpc("cancel_account", { p_account: a.accountId, p_reason: a.reason });
      if (error) return dbFail(error);
      return {
        ok: true,
        message: "Conta cancelada. Ela continua no histórico, mas não entra mais nos totais.",
        id: a.accountId,
      };
    }

    case "expense.create": {
      if (!need("financeiro.registrar")) return fail(NO_PERMISSION);
      const { data, error } = await sb
        .from("accounts")
        .insert({
          company_id: companyId,
          kind: "pagar",
          origin: "despesa",
          supplier: a.supplier || null,
          description: a.description,
          category: a.category,
          amount_cents: a.amountCents,
          due_date: a.dueDate,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) return dbFail(error);
      return {
        ok: true,
        message: `Despesa "${a.description}" de ${formatBRL(a.amountCents)} cadastrada.`,
        id: data.id,
      };
    }
  }
}
