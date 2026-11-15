/**
 * MOTOR DA PRÉVIA — ordem de serviço da oficina. Mesmas regras de 20261114000019_work_orders.sql.
 */
import type { Action, ActionResult } from "@/lib/actions/schemas";
import { checkPlan } from "@/lib/domain/installments";
import { MODULE_OFF } from "@/lib/domain/agenda";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleEnabled } from "@/lib/domain/segments";
import type { CompanyData, Member, WorkOrder, WorkOrderStage } from "@/lib/domain/types";
import {
  discountError,
  formatPlate,
  itemsOf,
  mechanicCanMove,
  PHOTO_LIMIT,
  quoteTotal,
  WO_STAGE_LABEL,
} from "@/lib/domain/work-orders";

export type WorkOrderAction = Extract<Action, { type: `workOrder.${string}` | "vehicle.transfer" }>;

export interface WoContext {
  nowIso: string;
  newId: () => string;
  visible: CompanyData;
  log: (kind: string, description: string, clientId: string | null) => void;
}

const fail = (message: string, fieldErrors?: Record<string, string>): ActionResult => ({
  ok: false,
  message,
  fieldErrors,
});

const CHANNEL_TEXT = {
  link: "pelo link",
  presencial: "na oficina",
  telefone: "por telefone",
  whatsapp: "pelo WhatsApp",
};

export function runWorkOrder(d: CompanyData, actor: Member, a: WorkOrderAction, c: WoContext): ActionResult {
  const roles = actor.roles;
  const me = actor.userId;
  if (!moduleEnabled(d.company, "ordem_servico")) return fail(MODULE_OFF);
  const edits = can(roles, "os.editar");
  const worksOn = (w: WorkOrder) =>
    w.resourceId !== null && d.resources.some((r) => r.id === w.resourceId && r.userId === me);
  const event = (w: WorkOrder, description: string) =>
    d.workOrderEvents.push({ id: c.newId(), workOrderId: w.id, description, actorId: me, createdAt: c.nowIso });

  /** A OS, se a pessoa a vê e pode mexer do jeito pedido (igual a _wo_for). */
  const load = (id: string, mode: "editar" | "mecanico" | "entregar"): WorkOrder | ActionResult => {
    const w = c.visible.workOrders.some((x) => x.id === id) ? d.workOrders.find((x) => x.id === id) : undefined;
    if (!w) return fail("Ordem de serviço não encontrada.");
    if (mode === "editar" && !edits) return fail("Seu papel nesta empresa não permite alterar ordens de serviço.");
    if (mode === "mecanico" && !edits && !worksOn(w))
      return fail("Só o mecânico responsável ou o atendimento mexem nesta OS.");
    if (mode === "entregar" && !can(roles, "os.entregar"))
      return fail("Seu papel nesta empresa não permite entregar ordens de serviço.");
    if (w.stage === "entregue" || w.stage === "cancelada")
      return fail(`Esta OS já foi ${w.stage === "entregue" ? "entregue" : "cancelada"}.`);
    return w;
  };
  const isWo = (x: WorkOrder | ActionResult): x is WorkOrder => "number" in x;
  const vehicleLabel = (w: WorkOrder) => {
    const v = d.items.find((i) => i.id === w.itemId);
    return v?.plate ? formatPlate(v.plate) : (v?.name ?? "veículo");
  };

  switch (a.type) {
    case "vehicle.transfer": {
      const item = d.items.find((i) => i.id === a.itemId && i.kind === "veiculo");
      if (!item || !c.visible.clients.some((x) => x.id === item.clientId)) return fail("Veículo não encontrado.");
      if (!edits) return fail("Seu papel nesta empresa não permite transferir veículos.");
      const client = c.visible.clients.find((x) => x.id === a.clientId);
      if (!client) return fail("Cliente não encontrado.");
      if (d.workOrders.some((w) => w.itemId === item.id && w.stage !== "entregue" && w.stage !== "cancelada"))
        return fail("Este veículo tem OS em andamento. Entregue ou cancele antes de transferir.");
      item.clientId = client.id;
      c.log("os", `Veículo ${formatPlate(item.plate) || item.name} transferido para este cliente`, client.id);
      return {
        ok: true,
        message: `Veículo transferido para ${client.name}. O histórico continua com a placa.`,
        id: item.id,
      };
    }

    case "workOrder.open": {
      if (!edits) return fail("Seu papel nesta empresa não permite abrir ordens de serviço.");
      const client = c.visible.clients.find((x) => x.id === a.clientId);
      if (!client) return fail("Cliente não encontrado.");
      if (!d.items.some((i) => i.id === a.itemId && i.clientId === client.id && i.kind === "veiculo"))
        return fail("Este veículo não é deste cliente.", { itemId: "Escolha um veículo deste cliente." });
      if (a.resourceId && !d.resources.some((r) => r.id === a.resourceId && r.active))
        return fail("Mecânico não encontrado.");
      const number = d.workOrders.reduce((m, w) => Math.max(m, w.number), 0) + 1;
      const w: WorkOrder = {
        id: c.newId(),
        number,
        clientId: client.id,
        itemId: a.itemId,
        resourceId: a.resourceId,
        stage: "orcamento",
        complaint: a.complaint,
        diagnosis: "",
        km: a.km,
        fuel: a.fuel,
        checklist: a.checklist,
        promisedOn: a.promisedOn,
        discountCents: 0,
        shareToken: null,
        sentAt: null,
        approvedAt: null,
        approvedByName: null,
        approvalChannel: null,
        deliveredAt: null,
        totalCents: null,
        canceledAt: null,
        cancelReason: null,
        nextServiceOn: null,
        nextServiceNote: "",
        createdBy: me,
        createdAt: c.nowIso,
      };
      d.workOrders.push(w);
      event(w, "OS aberta");
      c.log("os", `OS nº ${number} aberta`, client.id);
      return { ok: true, message: `OS nº ${number} aberta.`, id: w.id };
    }

    case "workOrder.save": {
      const w = load(a.id, "editar");
      if (!isWo(w)) return w;
      if (a.resourceId && !d.resources.some((r) => r.id === a.resourceId)) return fail("Mecânico não encontrado.");
      if (a.resourceId !== w.resourceId)
        event(w, `Mecânico: ${d.resources.find((r) => r.id === a.resourceId)?.name ?? "nenhum"}`);
      Object.assign(w, {
        resourceId: a.resourceId,
        complaint: a.complaint,
        km: a.km,
        fuel: a.fuel,
        checklist: a.checklist,
        promisedOn: a.promisedOn,
      });
      return { ok: true, message: "Dados da OS salvos.", id: w.id };
    }

    case "workOrder.diagnosis": {
      const w = load(a.id, "mecanico");
      if (!isWo(w)) return w;
      w.diagnosis = a.text;
      return { ok: true, message: "Diagnóstico salvo.", id: w.id };
    }

    case "workOrder.addItem": {
      const w = load(a.workOrderId, "mecanico");
      if (!isWo(w)) return w;
      if (a.serviceId && !d.services.some((s) => s.id === a.serviceId)) return fail("Serviço não encontrado.");
      const id = c.newId();
      d.workOrderItems.push({
        id,
        workOrderId: w.id,
        kind: a.kind,
        serviceId: a.serviceId,
        description: a.description,
        quantity: a.quantity,
        unitCents: a.unitCents,
        warrantyDays: a.warrantyDays,
        status: "pendente",
        addedBy: me,
        createdAt: c.nowIso,
      });
      return { ok: true, message: `${a.kind === "peca" ? "Peça" : "Serviço"} incluído no orçamento.`, id };
    }

    case "workOrder.removeItem": {
      const it = d.workOrderItems.find((i) => i.id === a.id);
      if (!it) return fail("Item não encontrado.");
      const w = load(it.workOrderId, "mecanico");
      if (!isWo(w)) return w;
      if (it.status !== "pendente") return fail("O cliente já decidiu sobre este item; ele fica no histórico.");
      d.workOrderItems = d.workOrderItems.filter((i) => i.id !== it.id);
      return { ok: true, message: "Item retirado do orçamento.", id: w.id };
    }

    case "workOrder.discount": {
      const w = load(a.id, "editar");
      if (!isWo(w)) return w;
      const err = discountError(
        a.discountCents,
        quoteTotal(itemsOf(d.workOrderItems, w.id)),
        can(roles, "os.desconto_livre"),
      );
      if (err) return fail(err, { discountCents: err });
      w.discountCents = a.discountCents;
      event(w, `Desconto: ${formatBRL(a.discountCents)}`);
      return { ok: true, message: "Desconto aplicado.", id: w.id };
    }

    case "workOrder.send": {
      const w = load(a.id, "editar");
      if (!isWo(w)) return w;
      if (!itemsOf(d.workOrderItems, w.id).some((i) => i.status === "pendente"))
        return fail("Não há itens aguardando aprovação no orçamento.");
      w.shareToken = w.shareToken ?? c.newId();
      w.sentAt = c.nowIso;
      if (w.stage === "orcamento") w.stage = "aprovacao";
      event(w, "Orçamento enviado ao cliente");
      return { ok: true, message: "Orçamento pronto para enviar.", id: w.id, extra: { token: w.shareToken } };
    }

    case "workOrder.approve": {
      const w = load(a.id, "editar");
      if (!isWo(w)) return w;
      const pending = itemsOf(d.workOrderItems, w.id).filter((i) => i.status === "pendente");
      if (!pending.length) return fail("Não há itens aguardando aprovação.");
      for (const it of pending) it.status = a.approvedIds.includes(it.id) ? "aprovado" : "recusado";
      const anyApproved = itemsOf(d.workOrderItems, w.id).some((i) => i.status === "aprovado");
      Object.assign(w, { approvedAt: c.nowIso, approvedByName: a.name, approvalChannel: a.channel });
      if (w.stage === "orcamento" || w.stage === "aprovacao") w.stage = anyApproved ? "servico" : "pronto";
      event(w, `Orçamento decidido por ${a.name} (${CHANNEL_TEXT[a.channel]})`);
      const yes = pending.filter((i) => i.status === "aprovado").length;
      return {
        ok: true,
        message: yes
          ? `${yes} de ${pending.length} itens aprovados.`
          : "Orçamento recusado. A OS ficou pronta para retirada.",
        id: w.id,
      };
    }

    case "workOrder.move": {
      const w = load(a.id, "mecanico");
      if (!isWo(w)) return w;
      if (!edits && !mechanicCanMove(w.stage, a.stage))
        return fail("O mecânico move a OS entre aguardando peça, em serviço e pronto.");
      if (w.stage === a.stage) return { ok: true, message: "Nada mudou.", id: w.id };
      w.stage = a.stage as WorkOrderStage;
      event(w, `Etapa: ${WO_STAGE_LABEL[w.stage].toLowerCase()}`);
      return { ok: true, message: `OS nº ${w.number}: ${WO_STAGE_LABEL[w.stage].toLowerCase()}.`, id: w.id };
    }

    case "workOrder.deliver": {
      const w = load(a.id, "entregar");
      if (!isWo(w)) return w;
      const items = itemsOf(d.workOrderItems, w.id);
      if (items.some((i) => i.status === "pendente"))
        return fail(
          "Há itens aguardando a decisão do cliente. Registre a aprovação ou tire os itens antes de entregar.",
        );
      const total = Math.max(0, quoteTotal(items) - w.discountCents);
      if (total > 0) {
        const check = checkPlan(a.plan, total);
        if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
        for (const inst of a.plan)
          d.accounts.push({
            id: c.newId(),
            kind: "receber",
            clientId: w.clientId,
            supplier: null,
            description: `OS nº ${w.number} — ${vehicleLabel(w)}`,
            origin: "os",
            saleId: null,
            installmentNumber: inst.number,
            installmentCount: a.plan.length,
            amountCents: inst.amountCents,
            dueDate: inst.dueDate,
            category: null,
            canceledAt: null,
            canceledBy: null,
            cancelReason: null,
            createdAt: c.nowIso,
            workOrderId: w.id,
          });
      }
      Object.assign(w, {
        stage: "entregue",
        deliveredAt: c.nowIso,
        totalCents: total,
        nextServiceOn: a.nextServiceOn,
        nextServiceNote: a.nextServiceNote,
      });
      event(w, `Entregue ao cliente — ${formatBRL(total)}`);
      c.log("os", `OS nº ${w.number} entregue: ${formatBRL(total)}`, w.clientId);
      return {
        ok: true,
        message:
          total > 0
            ? `OS nº ${w.number} entregue. ${formatBRL(total)} foi para o financeiro.`
            : `OS nº ${w.number} entregue.`,
        id: w.id,
      };
    }

    case "workOrder.cancel": {
      const w = load(a.id, "editar");
      if (!isWo(w)) return w;
      Object.assign(w, { stage: "cancelada", canceledAt: c.nowIso, cancelReason: a.reason });
      event(w, `Cancelada: ${a.reason}`);
      return { ok: true, message: `OS nº ${w.number} cancelada.`, id: w.id };
    }

    case "workOrder.addPhoto": {
      const w = load(a.workOrderId, "mecanico");
      if (!isWo(w)) return w;
      const limit = PHOTO_LIMIT[d.company.plan];
      if (d.workOrderPhotos.filter((p) => p.workOrderId === w.id).length >= limit)
        return fail(`Esta OS já tem ${limit} fotos, o limite do plano.`);
      const id = c.newId();
      d.workOrderPhotos.push({
        id,
        workOrderId: w.id,
        url: a.dataUrl,
        caption: a.caption,
        createdBy: me,
        createdAt: c.nowIso,
      });
      return { ok: true, message: "Foto adicionada.", id };
    }
  }
}
