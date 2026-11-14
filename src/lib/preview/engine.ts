/**
 * MOTOR DA PRÉVIA — simulação em memória, sem banco, sem login.
 * Aplica as mesmas regras de negócio da versão real para que a prévia seja fiel,
 * mas NÃO é a camada de segurança da aplicação real (essa fica no servidor e no banco).
 */
import { parseAction, type Action, type ActionResult } from "@/lib/actions/schemas";
import { balanceCents, validateSettlement } from "@/lib/domain/accounts";
import { addDays, toISODate } from "@/lib/domain/dates";
import { checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import { can, canAssignOthers, canEditClient, canEditDeal } from "@/lib/domain/permissions";
import { hasProposalErrors, proposalTotalCents, validateProposal } from "@/lib/domain/proposals";
import { STAGE_LABEL, type Activity, type CompanyData, type Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";

export interface EngineContext {
  now: Date;
  newId: () => string;
  /** requestIds já processados (proteção contra cliques repetidos/reenvio). */
  processed: Map<string, ActionResult>;
}

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});
const NO_PERMISSION = "Seu papel nesta empresa não permite esta ação.";

export function applyAction(
  data: CompanyData,
  actor: Member,
  rawAction: unknown,
  ctx: EngineContext,
): { data: CompanyData; result: ActionResult } {
  const parsed = parseAction(rawAction);
  if (!parsed.ok) return { data, result: parsed.result };
  const action = parsed.action;

  if ("requestId" in action && ctx.processed.has(action.requestId)) {
    return { data, result: ctx.processed.get(action.requestId)! };
  }

  const d: CompanyData = structuredClone(data);
  const result = run(d, actor, action, ctx);
  if (!result.ok) return { data, result };
  if ("requestId" in action) ctx.processed.set(action.requestId, result);
  return { data: d, result };
}

function run(d: CompanyData, actor: Member, a: Action, ctx: EngineContext): ActionResult {
  const nowIso = ctx.now.toISOString();
  const today = toISODate(ctx.now);
  const roles = actor.roles;
  const me = actor.userId;
  const visible = visibleData(d, actor);
  const log = (kind: string, description: string, clientId: string | null, dealId: string | null = null) => {
    const act: Activity = { id: ctx.newId(), kind, description, clientId, dealId, actorId: me, createdAt: nowIso };
    d.activities.push(act);
  };
  const isMember = (userId: string) => d.members.some((m) => m.userId === userId);
  const findVisibleClient = (id: string) =>
    visible.clients.find((c) => c.id === id) && d.clients.find((c) => c.id === id);
  const findVisibleDeal = (id: string) => visible.deals.find((x) => x.id === id) && d.deals.find((x) => x.id === id);

  switch (a.type) {
    case "company.saveProfile": {
      if (!can(roles, "empresa.gerenciar")) return fail("Somente o administrador altera os dados da empresa.");
      const { type: _type, ...profile } = a;
      Object.assign(d.company, profile);
      return { ok: true, message: "Dados da empresa salvos." };
    }

    case "client.save": {
      if (!isMember(a.ownerId))
        return fail("Escolha um responsável que faça parte da empresa.", { ownerId: "Responsável inválido." });
      if (!canAssignOthers(roles) && a.ownerId !== me)
        return fail("Você só pode cadastrar clientes sob sua responsabilidade.");
      if (a.id) {
        const c = findVisibleClient(a.id);
        if (!c) return fail("Cliente não encontrado.");
        if (!canEditClient(roles, me, c)) return fail(NO_PERMISSION);
        Object.assign(c, { name: a.name, email: a.email, phone: a.phone, ownerId: a.ownerId });
        log("cliente", "Dados do cliente atualizados", c.id);
        return { ok: true, message: `Cliente ${c.name} atualizado.`, id: c.id };
      }
      if (!can(roles, "crm.editar_proprios")) return fail(NO_PERMISSION);
      const id = ctx.newId();
      d.clients.push({ id, name: a.name, email: a.email, phone: a.phone, ownerId: a.ownerId, createdAt: nowIso });
      log("cliente", "Cliente cadastrado", id);
      return { ok: true, message: `Cliente ${a.name} cadastrado.`, id };
    }

    case "deal.save": {
      const client = findVisibleClient(a.clientId);
      if (!client) return fail("Escolha um cliente da lista.", { clientId: "Cliente não encontrado." });
      if (!isMember(a.ownerId)) return fail("Responsável inválido.", { ownerId: "Responsável inválido." });
      if (!canAssignOthers(roles) && a.ownerId !== me)
        return fail("Você só pode criar negociações sob sua responsabilidade.");
      if (a.id) {
        const deal = findVisibleDeal(a.id);
        if (!deal) return fail("Negociação não encontrada.");
        if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
        if (deal.stage === "ganha" && deal.valueCents !== a.valueCents)
          return fail("O valor de uma venda fechada não pode ser alterado aqui.");
        Object.assign(deal, {
          clientId: a.clientId,
          title: a.title,
          valueCents: a.valueCents,
          ownerId: a.ownerId,
          expectedClose: a.expectedClose,
          nextAction: a.nextAction || null,
          nextActionDate: a.nextActionDate,
          updatedAt: nowIso,
        });
        log("negociacao", `Negociação "${deal.title}" atualizada`, deal.clientId, deal.id);
        return { ok: true, message: "Negociação atualizada.", id: deal.id };
      }
      if (!can(roles, "crm.editar_proprios")) return fail(NO_PERMISSION);
      const id = ctx.newId();
      d.deals.push({
        id,
        clientId: a.clientId,
        title: a.title,
        valueCents: a.valueCents,
        ownerId: a.ownerId,
        stage: "novo_contato",
        expectedClose: a.expectedClose,
        stageChangedAt: nowIso,
        nextAction: a.nextAction || null,
        nextActionDate: a.nextActionDate,
        lostReason: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      log("negociacao", `Negociação "${a.title}" criada`, a.clientId, id);
      return { ok: true, message: `Negociação "${a.title}" criada.`, id };
    }

    case "deal.move": {
      const deal = findVisibleDeal(a.id);
      if (!deal) return fail("Negociação não encontrada.");
      if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
      if (deal.stage === "ganha") return fail("Esta venda já foi fechada. Para mudar, fale com o financeiro.");
      if (a.stage === "perdida" && !a.lostReason?.trim())
        return fail("Conte o motivo da perda.", { lostReason: "Informe o motivo da perda." });
      if (deal.stage === a.stage) return { ok: true, message: "A negociação já está nesta etapa.", id: deal.id };
      const from = deal.stage;
      deal.stage = a.stage;
      deal.stageChangedAt = nowIso;
      deal.updatedAt = nowIso;
      deal.lostReason = a.stage === "perdida" ? a.lostReason!.trim() : null;
      log(
        "etapa",
        a.stage === "perdida"
          ? `Negociação marcada como perdida. Motivo: ${deal.lostReason}`
          : `Etapa alterada de ${STAGE_LABEL[from]} para ${STAGE_LABEL[a.stage]}`,
        deal.clientId,
        deal.id,
      );
      return { ok: true, message: `"${deal.title}" agora está em ${STAGE_LABEL[a.stage]}.`, id: deal.id };
    }

    case "note.add": {
      const client = findVisibleClient(a.clientId);
      if (!client) return fail("Cliente não encontrado.");
      if (!canEditClient(roles, me, client) && !can(roles, "financeiro.registrar")) return fail(NO_PERMISSION);
      if (a.dealId && !d.deals.some((x) => x.id === a.dealId && x.clientId === client.id))
        return fail("Negociação não pertence a este cliente.");
      const id = ctx.newId();
      d.notes.push({ id, clientId: client.id, dealId: a.dealId, body: a.body, authorId: me, createdAt: nowIso });
      return { ok: true, message: "Anotação registrada.", id };
    }

    case "task.save": {
      if (!isMember(a.assigneeId)) return fail("Responsável inválido.", { assigneeId: "Responsável inválido." });
      if (!canAssignOthers(roles) && a.assigneeId !== me && !can(roles, "empresa.gerenciar"))
        return fail("Você só pode criar tarefas para você mesmo.");
      if (a.clientId && !findVisibleClient(a.clientId)) return fail("Cliente não encontrado.");
      if (a.dealId && !d.deals.some((x) => x.id === a.dealId && x.clientId === a.clientId))
        return fail("A negociação precisa ser do mesmo cliente.");
      if (a.id) {
        const t = visible.tasks.find((x) => x.id === a.id) && d.tasks.find((x) => x.id === a.id);
        if (!t) return fail("Tarefa não encontrada.");
        Object.assign(t, {
          title: a.title,
          clientId: a.clientId,
          dealId: a.dealId,
          assigneeId: a.assigneeId,
          dueDate: a.dueDate,
        });
        return { ok: true, message: "Tarefa atualizada.", id: t.id };
      }
      const id = ctx.newId();
      d.tasks.push({
        id,
        title: a.title,
        clientId: a.clientId,
        dealId: a.dealId,
        assigneeId: a.assigneeId,
        dueDate: a.dueDate,
        status: "aberta",
        completedAt: null,
        createdAt: nowIso,
      });
      if (a.clientId) log("tarefa", `Tarefa criada: ${a.title}`, a.clientId, a.dealId);
      return { ok: true, message: "Tarefa criada.", id };
    }

    case "task.setDone": {
      const t = visible.tasks.find((x) => x.id === a.id) && d.tasks.find((x) => x.id === a.id);
      if (!t) return fail("Tarefa não encontrada.");
      if (t.assigneeId !== me && !canAssignOthers(roles) && !can(roles, "empresa.gerenciar"))
        return fail("Só o responsável pode concluir esta tarefa.");
      t.status = a.done ? "concluida" : "aberta";
      t.completedAt = a.done ? nowIso : null;
      if (t.clientId)
        log("tarefa", `${a.done ? "Tarefa concluída" : "Tarefa reaberta"}: ${t.title}`, t.clientId, t.dealId);
      return {
        ok: true,
        message: a.done ? `Tarefa "${t.title}" concluída.` : `Tarefa "${t.title}" reaberta.`,
        id: t.id,
      };
    }

    case "proposal.save": {
      const deal = findVisibleDeal(a.dealId);
      if (!deal || deal.clientId !== a.clientId) return fail("A negociação precisa ser do mesmo cliente.");
      if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
      const errs = validateProposal(a.items, a.discountCents, a.validUntil);
      if (hasProposalErrors(errs)) return fail("Revise os itens da proposta.");
      if (a.id) {
        const p = d.proposals.find((x) => x.id === a.id && x.dealId === deal.id);
        if (!p) return fail("Proposta não encontrada.");
        if (p.status === "aceita") return fail("Uma proposta aceita não pode ser alterada. Crie uma nova proposta.");
        Object.assign(p, {
          items: a.items,
          discountCents: a.discountCents,
          validUntil: a.validUntil,
          terms: a.terms,
          updatedAt: nowIso,
        });
        log(
          "proposta",
          `Proposta nº ${p.number} atualizada (${formatBRL(proposalTotalCents(a.items, a.discountCents))})`,
          deal.clientId,
          deal.id,
        );
        return { ok: true, message: `Proposta nº ${p.number} salva.`, id: p.id };
      }
      const id = ctx.newId();
      const number = d.proposals.reduce((m, p) => Math.max(m, p.number), 0) + 1;
      d.proposals.push({
        id,
        number,
        clientId: a.clientId,
        dealId: a.dealId,
        items: a.items,
        discountCents: a.discountCents,
        validUntil: a.validUntil,
        terms: a.terms,
        status: "rascunho",
        sentAt: null,
        acceptedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      log(
        "proposta",
        `Proposta nº ${number} preparada (${formatBRL(proposalTotalCents(a.items, a.discountCents))})`,
        deal.clientId,
        deal.id,
      );
      return { ok: true, message: `Proposta nº ${number} salva.`, id };
    }

    case "proposal.markSent": {
      const p = d.proposals.find((x) => x.id === a.id);
      const deal = p && findVisibleDeal(p.dealId);
      if (!p || !deal) return fail("Proposta não encontrada.");
      if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
      if (p.status === "aceita" || p.status === "recusada")
        return fail("Esta proposta já foi respondida pelo cliente.");
      p.status = "enviada";
      p.sentAt = nowIso;
      p.updatedAt = nowIso;
      if (deal.stage !== "proposta") {
        deal.stage = "proposta";
        deal.stageChangedAt = nowIso;
      }
      deal.updatedAt = nowIso;
      log(
        "proposta",
        `Envio da proposta nº ${p.number} registrado (simulação — nada foi enviado)`,
        p.clientId,
        deal.id,
      );
      let taskId: string | undefined;
      if (a.followUpTask) {
        taskId = ctx.newId();
        const due = addDays(today, 2);
        const client = d.clients.find((c) => c.id === p.clientId);
        d.tasks.push({
          id: taskId,
          title: `Retornar para ${client?.name ?? "o cliente"} sobre a proposta nº ${p.number}`,
          clientId: p.clientId,
          dealId: deal.id,
          assigneeId: deal.ownerId,
          dueDate: due,
          status: "aberta",
          completedAt: null,
          createdAt: nowIso,
        });
        deal.nextAction = `Retornar sobre a proposta nº ${p.number}`;
        deal.nextActionDate = due;
      }
      return {
        ok: true,
        message: a.followUpTask
          ? "Envio registrado e tarefa de retorno criada para daqui a 2 dias."
          : "Envio registrado.",
        id: p.id,
        extra: { taskId },
      };
    }

    case "proposal.accept": {
      const p = d.proposals.find((x) => x.id === a.id);
      const deal = p && findVisibleDeal(p.dealId);
      if (!p || !deal) return fail("Proposta não encontrada.");
      if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
      if (p.status === "aceita")
        return { ok: true, message: "Esta proposta já estava registrada como aceita.", id: p.id };
      if (p.status === "recusada") return fail("Esta proposta foi recusada. Prepare uma nova proposta.");
      p.status = "aceita";
      p.acceptedAt = nowIso;
      p.updatedAt = nowIso;
      const total = proposalTotalCents(p.items, p.discountCents);
      if (a.updateDealValue && deal.stage !== "ganha") deal.valueCents = total;
      deal.updatedAt = nowIso;
      log("proposta", `Cliente aceitou a proposta nº ${p.number} (${formatBRL(total)})`, p.clientId, deal.id);
      return {
        ok: true,
        message: `Aceite da proposta nº ${p.number} registrado. Próximo passo: fechar a venda.`,
        id: p.id,
      };
    }

    case "proposal.reject": {
      const p = d.proposals.find((x) => x.id === a.id);
      const deal = p && findVisibleDeal(p.dealId);
      if (!p || !deal) return fail("Proposta não encontrada.");
      if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
      if (p.status === "aceita") return fail("Esta proposta já foi aceita.");
      p.status = "recusada";
      p.updatedAt = nowIso;
      log("proposta", `Proposta nº ${p.number} recusada${a.reason ? `: ${a.reason}` : ""}`, p.clientId, deal.id);
      return { ok: true, message: `Proposta nº ${p.number} marcada como recusada.`, id: p.id };
    }

    case "sale.close": {
      if (!can(roles, "venda.fechar")) return fail(NO_PERMISSION);
      const deal = findVisibleDeal(a.dealId);
      if (!deal) return fail("Negociação não encontrada.");
      if (!canEditDeal(roles, me, deal)) return fail(NO_PERMISSION);
      if (d.sales.some((s) => s.dealId === deal.id && s.status !== "cancelada"))
        return fail("Esta negociação já tem uma venda fechada.");
      if (deal.stage === "perdida") return fail("Reabra a negociação antes de fechar a venda.");
      if (a.proposalId && !d.proposals.some((p) => p.id === a.proposalId && p.dealId === deal.id))
        return fail("Proposta não pertence a esta negociação.");
      if (a.paymentMode === "avista" && a.plan.length !== 1) return fail("Pagamento à vista tem uma única parcela.");
      const check = checkPlan(a.plan, a.totalCents);
      if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
      const id = ctx.newId();
      d.sales.push({
        id,
        dealId: deal.id,
        clientId: deal.clientId,
        proposalId: a.proposalId,
        totalCents: a.totalCents,
        paymentMode: a.paymentMode,
        plan: a.plan,
        status: "aguardando_conferencia",
        closedBy: me,
        closedAt: nowIso,
        reviewedBy: null,
        reviewedAt: null,
      });
      deal.stage = "ganha";
      deal.valueCents = a.totalCents;
      deal.stageChangedAt = nowIso;
      deal.updatedAt = nowIso;
      deal.nextAction = null;
      deal.nextActionDate = null;
      log(
        "venda",
        `Venda fechada: ${formatBRL(a.totalCents)} em ${a.plan.length === 1 ? "1 parcela" : `${a.plan.length} parcelas`}. Aguardando o financeiro confirmar as parcelas.`,
        deal.clientId,
        deal.id,
      );
      return {
        ok: true,
        message: `Venda de ${formatBRL(a.totalCents)} fechada. Agora o financeiro confirma as parcelas.`,
        id,
      };
    }

    case "sale.confirm": {
      if (!can(roles, "venda.conferir")) return fail("Somente o financeiro ou o dono podem confirmar as parcelas.");
      const sale = d.sales.find((s) => s.id === a.saleId);
      if (!sale) return fail("Venda não encontrada.");
      if (sale.status === "confirmada") {
        return {
          ok: true,
          message: "As parcelas desta venda já tinham sido confirmadas. Nenhuma parcela nova foi criada.",
          id: sale.id,
          extra: { duplicate: true },
        };
      }
      if (sale.status === "cancelada") return fail("Esta venda foi cancelada.");
      const check = checkPlan(a.plan, sale.totalCents);
      if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
      const client = d.clients.find((c) => c.id === sale.clientId);
      const deal = d.deals.find((x) => x.id === sale.dealId);
      for (const inst of a.plan) {
        d.accounts.push({
          id: ctx.newId(),
          kind: "receber",
          clientId: sale.clientId,
          supplier: null,
          description: `${deal?.title ?? "Venda"} — ${client?.name ?? ""}`.trim(),
          origin: "venda",
          saleId: sale.id,
          installmentNumber: inst.number,
          installmentCount: a.plan.length,
          amountCents: inst.amountCents,
          dueDate: inst.dueDate,
          category: null,
          canceledAt: null,
          canceledBy: null,
          cancelReason: null,
          createdAt: nowIso,
        });
      }
      sale.plan = a.plan;
      sale.status = "confirmada";
      sale.reviewedBy = me;
      sale.reviewedAt = nowIso;
      log(
        "venda",
        `Financeiro confirmou as parcelas e criou ${a.plan.length} ${a.plan.length === 1 ? "conta" : "contas"} a receber.`,
        sale.clientId,
        sale.dealId,
      );
      return {
        ok: true,
        message: `${a.plan.length} ${a.plan.length === 1 ? "parcela criada" : "parcelas criadas"} em contas a receber.`,
        id: sale.id,
      };
    }

    case "movement.register": {
      if (!can(roles, "financeiro.registrar"))
        return fail("Somente o financeiro ou o dono podem registrar recebimentos e pagamentos.");
      const acc = d.accounts.find((x) => x.id === a.accountId);
      if (!acc) return fail("Conta não encontrada.");
      const err = validateSettlement(acc, d.movements, a.amountCents);
      if (err) return fail(err, { amount: err });
      const id = ctx.newId();
      const direction = acc.kind === "receber" ? "entrada" : "saida";
      d.movements.push({
        id,
        accountId: acc.id,
        direction,
        amountCents: a.amountCents,
        paidOn: a.paidOn,
        method: a.method,
        registeredBy: me,
        createdAt: nowIso,
        undoneAt: null,
        undoneBy: null,
        undoReason: null,
      });
      const rest = balanceCents(acc, d.movements);
      const verb = acc.kind === "receber" ? "Recebimento" : "Pagamento";
      if (acc.clientId)
        log(
          "financeiro",
          `${verb} de ${formatBRL(a.amountCents)} registrado (parcela ${acc.installmentNumber} de ${acc.installmentCount})`,
          acc.clientId,
        );
      const tail =
        rest > 0
          ? ` ${acc.kind === "receber" ? "Faltam" : "Ainda falta pagar"} ${formatBRL(rest)}.`
          : acc.kind === "receber"
            ? " Parcela quitada."
            : " Conta quitada.";
      return {
        ok: true,
        message: `${verb} de ${formatBRL(a.amountCents)} registrado.${tail}`,
        id,
        extra: { remainingCents: rest },
      };
    }

    case "movement.undo": {
      if (!can(roles, "financeiro.registrar")) return fail(NO_PERMISSION);
      const mv = d.movements.find((m) => m.id === a.movementId);
      if (!mv) return fail("Registro não encontrado.");
      if (mv.undoneAt) return { ok: true, message: "Este registro já tinha sido desfeito.", id: mv.id };
      mv.undoneAt = nowIso;
      mv.undoneBy = me;
      mv.undoReason = a.reason;
      const acc = d.accounts.find((x) => x.id === mv.accountId)!;
      if (acc.clientId)
        log("financeiro", `Registro de ${formatBRL(mv.amountCents)} desfeito. Motivo: ${a.reason}`, acc.clientId);
      return {
        ok: true,
        message: `Registro de ${formatBRL(mv.amountCents)} desfeito. O valor voltou a constar como em aberto.`,
        id: mv.id,
      };
    }

    case "account.cancel": {
      if (!can(roles, "financeiro.registrar")) return fail(NO_PERMISSION);
      const acc = d.accounts.find((x) => x.id === a.accountId);
      if (!acc) return fail("Conta não encontrada.");
      if (acc.canceledAt) return { ok: true, message: "Esta conta já estava cancelada.", id: acc.id };
      if (d.movements.some((m) => m.accountId === acc.id && !m.undoneAt)) {
        return fail("Esta conta tem valores registrados. Desfaça os registros antes de cancelar.");
      }
      acc.canceledAt = nowIso;
      acc.canceledBy = me;
      acc.cancelReason = a.reason;
      if (acc.clientId)
        log(
          "financeiro",
          `Conta cancelada (parcela ${acc.installmentNumber} de ${acc.installmentCount}). Motivo: ${a.reason}`,
          acc.clientId,
        );
      return {
        ok: true,
        message: "Conta cancelada. Ela continua no histórico, mas não entra mais nos totais.",
        id: acc.id,
      };
    }

    case "expense.create": {
      if (!can(roles, "financeiro.registrar")) return fail(NO_PERMISSION);
      const id = ctx.newId();
      d.accounts.push({
        id,
        kind: "pagar",
        clientId: null,
        supplier: a.supplier || null,
        description: a.description,
        origin: "despesa",
        saleId: null,
        installmentNumber: 1,
        installmentCount: 1,
        amountCents: a.amountCents,
        dueDate: a.dueDate,
        category: a.category,
        canceledAt: null,
        canceledBy: null,
        cancelReason: null,
        createdAt: nowIso,
      });
      return { ok: true, message: `Despesa "${a.description}" de ${formatBRL(a.amountCents)} cadastrada.`, id };
    }
  }
}
