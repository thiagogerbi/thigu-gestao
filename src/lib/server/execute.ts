import type { Action, ActionResult } from "@/lib/actions/schemas";
import { checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import {
  addMinutes,
  durationMinutes,
  MODULE_OFF,
  scheduleWarning,
  seriesStarts,
  slotError,
  statusMessage,
} from "@/lib/domain/agenda";
import {
  can,
  canAssignClientOwner,
  canAssignOthers,
  canManageResource,
  type Capability,
} from "@/lib/domain/permissions";
import { hasProposalErrors, proposalTotalCents, validateProposal } from "@/lib/domain/proposals";
import {
  cleanFields,
  mergeFields,
  ITEM_KINDS,
  itemKindFor,
  moduleEnabled,
  SEGMENTS,
  termsFor,
  type CompanyFlags,
} from "@/lib/domain/segments";
import { classError } from "@/lib/domain/classes";
import { toISODate } from "@/lib/domain/dates";
import { workHoursError } from "@/lib/domain/hours";
import { packageError, packageView, startsOnError } from "@/lib/domain/recurring";
import { STAGE_LABEL, type Appointment, type AppointmentStatus, type Role, type WorkHours } from "@/lib/domain/types";
import { isPlate, normalizePlate } from "@/lib/domain/work-orders";
import { executeWorkOrder } from "@/lib/server/execute-work-orders";
import { executeStock } from "@/lib/server/execute-stock";
import { executeOrder } from "@/lib/server/execute-orders";
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

  /** Ramo, plano e módulos extras da empresa: decidem campos e módulos disponíveis (perguntas 1 e 2). */
  const companyFlags = async (): Promise<CompanyFlags | null> => {
    const { data } = await sb
      .from("companies")
      .select("segment, plan, extra_modules")
      .eq("id", companyId)
      .maybeSingle();
    return data ? { segment: data.segment, plan: data.plan, extraModules: data.extra_modules ?? [] } : null;
  };

  switch (a.type) {
    case "company.setSegment": {
      if (!need("empresa.gerenciar")) return fail("Somente o administrador troca o ramo da empresa.");
      const { data, error } = await sb
        .from("companies")
        .update({ segment: a.segment })
        .eq("id", companyId)
        .select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Somente o administrador troca o ramo da empresa.");
      return { ok: true, message: `Ramo alterado para ${SEGMENTS[a.segment].label}.` };
    }

    case "company.saveProfile": {
      if (!need("empresa.gerenciar")) return fail("Somente o administrador altera os dados da empresa.");
      const { data, error } = await sb
        .from("companies")
        .update({
          name: a.name,
          legal_name: a.legalName,
          document: a.document,
          phone: a.phone,
          email: a.email,
          address: a.address,
          default_terms: a.defaultTerms,
          logo_data_url: a.logoDataUrl,
          brand_color: a.brandColor,
          menu_color: a.menuColor,
        })
        .eq("id", companyId)
        .select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Somente o administrador altera os dados da empresa.");
      return { ok: true, message: "Dados da empresa salvos." };
    }

    case "client.save": {
      if (!need("clientes.editar_proprios")) return fail(NO_PERMISSION);
      const flags = await companyFlags();
      if (!flags) return fail("Empresa não encontrada.");
      const t = termsFor(flags.segment);
      if (!canAssignClientOwner(roles) && a.ownerId !== userId)
        return fail(`Você só pode cadastrar ${t.clientes} sob sua responsabilidade.`);
      const values: Record<string, unknown> = { name: a.name, email: a.email, phone: a.phone, owner_id: a.ownerId };
      if (a.extra) {
        const fields = SEGMENTS[flags.segment].clientFields;
        const extra = cleanFields(fields, a.extra, "extra");
        if (!extra.ok) return fail("Alguns campos precisam de ajuste.", extra.fieldErrors);
        // campos gravados por outro ramo ficam guardados (trocar de ramo não apaga nada)
        const current = a.id
          ? await sb.from("clients").select("extra").eq("id", a.id).eq("company_id", companyId).maybeSingle()
          : null;
        values.extra = mergeFields(
          fields,
          (current?.data?.extra as Record<string, string> | undefined) ?? {},
          extra.value,
        );
      }
      if (a.id) {
        const { data, error } = await sb
          .from("clients")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail(`${t.Cliente} não encontrado ou sem permissão para editar.`);
        await log(`Dados do ${t.cliente} atualizados`, "cliente", a.id);
        return { ok: true, message: `${t.Cliente} ${a.name} atualizado.`, id: a.id };
      }
      const { data, error } = await sb
        .from("clients")
        .insert({ ...values, company_id: companyId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      await log(`${t.Cliente} cadastrado`, "cliente", data.id);
      return { ok: true, message: `${t.Cliente} ${a.name} cadastrado.`, id: data.id };
    }

    case "item.save": {
      if (!need("clientes.editar_proprios")) return fail(NO_PERMISSION);
      const flags = await companyFlags();
      if (!flags || itemKindFor(flags) !== a.kind)
        return fail("Este cadastro não está disponível para o ramo da empresa.");
      const kind = ITEM_KINDS[a.kind];
      const details = cleanFields(kind.fields, a.details, "details");
      if (!details.ok) return fail("Alguns campos precisam de ajuste.", details.fieldErrors);
      const plate = a.kind === "veiculo" ? normalizePlate(a.plate ?? "") : null;
      if (plate !== null && !isPlate(plate))
        return fail("Confira a placa.", { plate: "Use a placa com 7 letras e números, como ABC1D23 ou ABC-1234." });
      const values = { name: a.name, details: details.value, alert: a.alert, plate };
      const plateTaken = (e: { code?: string; message?: string } | null) =>
        e?.code === "23505" && /plate/.test(e.message ?? "")
          ? fail("Esta placa já está cadastrada.", {
              plate: "Já existe um veículo com esta placa. Procure pela placa.",
            })
          : dbFail(e);
      if (a.id) {
        const { data, error } = await sb
          .from("client_items")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return plateTaken(error);
        if (!data?.length) return fail("Cadastro não encontrado ou sem permissão para editar.");
        await log(`Dados de ${a.name} (${kind.noun[0]}) atualizados`, "cliente", a.clientId);
        return { ok: true, message: `${a.name} atualizado.`, id: a.id };
      }
      const { data, error } = await sb
        .from("client_items")
        .insert({ ...values, kind: a.kind, client_id: a.clientId, company_id: companyId, created_by: userId })
        .select("id")
        .single();
      if (error) return plateTaken(error);
      await log(`${a.name} (${kind.noun[0]}) cadastrado`, "cliente", a.clientId);
      return { ok: true, message: `${a.name} cadastrado.`, id: data.id };
    }

    case "vehicle.transfer":
    case "workOrder.open":
    case "workOrder.save":
    case "workOrder.diagnosis":
    case "workOrder.addItem":
    case "workOrder.removeItem":
    case "workOrder.discount":
    case "workOrder.send":
    case "workOrder.approve":
    case "workOrder.move":
    case "workOrder.deliver":
    case "workOrder.cancel":
    case "workOrder.addPhoto": {
      const flags = await companyFlags();
      if (!flags || !moduleEnabled(flags, "ordem_servico")) return fail(MODULE_OFF);
      return executeWorkOrder(ctx, a, dbFail);
    }

    case "cash.sale":
    case "product.save":
    case "stock.entry":
    case "stock.adjust":
    case "counter.return":
    case "client.setCreditLimit": {
      const flags = await companyFlags();
      if (!flags || !moduleEnabled(flags, "caixa")) return fail(MODULE_OFF);
      if (
        (a.type === "stock.entry" || a.type === "stock.adjust" || a.type === "client.setCreditLimit") &&
        !moduleEnabled(flags, "estoque")
      )
        return fail(MODULE_OFF);
      if (a.type === "stock.entry" || a.type === "stock.adjust") {
        if (!need("estoque.movimentar")) return fail("Seu papel nesta empresa não permite mexer no estoque.");
      }
      if (a.type === "client.setCreditLimit" && !need("crediario.limite"))
        return fail("Somente o financeiro ou o dono definem o limite de crediário.");
      return executeStock(ctx, a, dbFail);
    }

    case "order.open":
    case "order.save":
    case "order.move":
    case "order.deliver":
    case "order.cancel":
    case "prescription.save": {
      const flags = await companyFlags();
      const mod = a.type === "prescription.save" ? "receita" : "pedidos";
      if (!flags || !moduleEnabled(flags, mod)) return fail(MODULE_OFF);
      return executeOrder(ctx, a, dbFail);
    }

    case "item.setActive": {
      if (!need("clientes.editar_proprios")) return fail(NO_PERMISSION);
      const { data, error } = await sb
        .from("client_items")
        .update({ active: a.active })
        .eq("id", a.id)
        .eq("company_id", companyId)
        .select("id, name, client_id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Cadastro não encontrado ou sem permissão para editar.");
      await log(`${data[0].name} ${a.active ? "voltou para a ficha" : "arquivado"}`, "cliente", data[0].client_id);
      return { ok: true, message: a.active ? `${data[0].name} voltou para a ficha.` : `${data[0].name} arquivado.` };
    }

    case "service.save": {
      if (!need("agenda.configurar")) return fail("Somente o administrador ou o gestor cadastram serviços.");
      const flags = await companyFlags();
      if (!flags || !moduleEnabled(flags, "servicos")) return fail(MODULE_OFF);
      const values = { name: a.name, duration_min: a.durationMin, price_cents: a.priceCents, active: a.active };
      if (a.id) {
        const { data, error } = await sb
          .from("services")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail("Serviço não encontrado.");
        return { ok: true, message: `Serviço ${a.name} salvo.`, id: a.id };
      }
      const { data, error } = await sb
        .from("services")
        .insert({ ...values, company_id: companyId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      return { ok: true, message: `Serviço ${a.name} cadastrado.`, id: data.id };
    }

    case "resource.save": {
      if (!need("agenda.configurar")) return fail("Somente o administrador ou o gestor cadastram quem atende.");
      const flags = await companyFlags();
      if (!flags || !moduleEnabled(flags, "agenda")) return fail(MODULE_OFF);
      if (a.workHours) {
        const hoursErr = workHoursError(a.workHours);
        if (hoursErr) return fail(hoursErr, { workHours: hoursErr });
      }
      const values: Record<string, unknown> = { name: a.name, user_id: a.userId, active: a.active };
      if (a.workHours) values.work_hours = a.workHours;
      const { data, error } = a.id
        ? await sb.from("resources").update(values).eq("id", a.id).eq("company_id", companyId).select("id")
        : await sb
            .from("resources")
            .insert({ ...values, company_id: companyId })
            .select("id");
      if (error?.code === "23505")
        return fail("Esta pessoa já tem uma agenda.", { userId: "Esta pessoa já tem uma agenda." });
      if (error?.code === "23503")
        return fail("Escolha alguém da equipe.", { userId: "Pessoa não encontrada na equipe." });
      if (error) return dbFail(error);
      if (!data?.length) return fail("Agenda não encontrada.");
      return { ok: true, message: a.id ? `Agenda de ${a.name} salva.` : `Agenda de ${a.name} criada.`, id: data[0].id };
    }

    case "appointment.save": {
      const flags = await companyFlags();
      if (!flags || !moduleEnabled(flags, "agenda")) return fail(MODULE_OFF);
      const t = termsFor(flags.segment);
      const { data: resource } = await sb
        .from("resources")
        .select("id, name, user_id, active, work_hours")
        .eq("id", a.resourceId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!resource?.active) return fail("Escolha quem vai atender.", { resourceId: "Escolha quem vai atender." });
      if (!canManageResource(roles, userId, { userId: resource.user_id }))
        return fail("Você só pode marcar na sua própria agenda.");
      const slotErr = slotError(a.startsAt, a.endsAt);
      if (slotErr) return fail(slotErr, { endsAt: slotErr });
      const packageId = a.packageId ?? null;
      if (packageId) {
        // sessões livres do pacote: total − usadas − já marcadas (o banco confere de novo ao atender)
        const [{ data: pkg }, { data: uses }] = await Promise.all([
          sb
            .from("packages")
            .select(
              "id, client_id, service_id, item_id, name, sessions_total, price_cents, valid_until, closed_at, created_at",
            )
            .eq("id", packageId)
            .eq("company_id", companyId)
            .maybeSingle(),
          sb.from("appointments").select("id, status, consumes_package, package_id").eq("package_id", packageId),
        ]);
        const view =
          pkg && pkg.client_id === a.clientId
            ? packageView(
                {
                  id: pkg.id,
                  clientId: pkg.client_id,
                  serviceId: pkg.service_id,
                  itemId: pkg.item_id,
                  name: pkg.name,
                  sessionsTotal: pkg.sessions_total,
                  priceCents: Number(pkg.price_cents),
                  validUntil: pkg.valid_until,
                  closedAt: pkg.closed_at,
                  createdAt: pkg.created_at,
                },
                (uses ?? []).map(
                  (u) =>
                    ({
                      id: u.id,
                      status: u.status,
                      consumesPackage: u.consumes_package,
                      packageId: u.package_id,
                    }) as Appointment,
                ),
                toISODate(new Date()),
                a.id,
              )
            : undefined;
        const pkgErr = packageError(view, a.id ? 1 : seriesStarts(a.startsAt, a.repeat, a.times).length);
        if (pkgErr) return fail(pkgErr, { packageId: pkgErr });
      }
      const values = {
        client_id: a.clientId,
        resource_id: a.resourceId,
        service_id: a.serviceId,
        item_id: a.itemId,
        starts_at: a.startsAt,
        ends_at: a.endsAt,
        price_cents: a.priceCents,
        notes: a.notes,
        package_id: packageId,
      };
      const minutes = durationMinutes(a);
      const slots = a.id
        ? [{ startsAt: a.startsAt, endsAt: a.endsAt }]
        : seriesStarts(a.startsAt, a.repeat, a.times).map((s) => ({ startsAt: s, endsAt: addMinutes(s, minutes) }));
      // horários já marcados nesta agenda no período (o banco só devolve o que a pessoa pode ver,
      // e ela pode ver tudo desta agenda, porque pode marcar nela)
      const { data: taken, error: takenError } = await sb
        .from("appointments")
        .select("id, starts_at, ends_at, status")
        .eq("company_id", companyId)
        .eq("resource_id", a.resourceId)
        .neq("status", "cancelado")
        .lt("starts_at", slots[slots.length - 1].endsAt)
        .gt("ends_at", slots[0].startsAt);
      if (takenError) return dbFail(takenError);
      const existing = (taken ?? []).map((x) => ({
        id: x.id as string,
        resourceId: a.resourceId,
        startsAt: x.starts_at as string,
        endsAt: x.ends_at as string,
        status: x.status as AppointmentStatus,
      }));
      const { data: blockRows } = await sb
        .from("resource_blocks")
        .select("id, resource_id, starts_at, ends_at, reason, created_by")
        .eq("company_id", companyId)
        .eq("resource_id", a.resourceId)
        .lt("starts_at", slots[slots.length - 1].endsAt)
        .gt("ends_at", slots[0].startsAt);
      const warn = scheduleWarning({
        resourceId: a.resourceId,
        resourceName: resource.name,
        workHours: (resource.work_hours ?? {}) as WorkHours,
        appointments: existing,
        blocks: (blockRows ?? []).map((b) => ({
          id: b.id,
          resourceId: b.resource_id,
          startsAt: b.starts_at,
          endsAt: b.ends_at,
          reason: b.reason ?? "",
          createdBy: b.created_by,
        })),
        slots,
        ignoreId: a.id,
      });
      if (warn && !a.allowOverlap) return fail(warn, { overlap: warn });
      if (a.id) {
        const { data, error } = await sb
          .from("appointments")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail("Atendimento não encontrado ou já encerrado. Desfaça antes de remarcar.");
        await log(`Horário remarcado com ${resource.name}`, "agenda", a.clientId);
        return { ok: true, message: "Horário atualizado.", id: a.id };
      }
      const seriesId = slots.length > 1 ? crypto.randomUUID() : null;
      const { data, error } = await sb
        .from("appointments")
        .insert(
          slots.map((s) => ({
            ...values,
            starts_at: s.startsAt,
            ends_at: s.endsAt,
            series_id: seriesId,
            company_id: companyId,
            created_by: userId,
          })),
        )
        .select("id, starts_at")
        .order("starts_at");
      if (error) {
        if (/row-level security/i.test(error.message ?? ""))
          return fail(`Não foi possível marcar: confira o ${t.cliente} e quem vai atender.`);
        return dbFail(error);
      }
      await log(
        slots.length > 1
          ? `${slots.length} horários marcados com ${resource.name}`
          : `Horário marcado com ${resource.name}`,
        "agenda",
        a.clientId,
      );
      return {
        ok: true,
        message: slots.length > 1 ? `${slots.length} horários marcados.` : "Horário marcado.",
        id: data?.[0]?.id,
      };
    }

    case "appointment.setStatus": {
      const { data, error } = await sb.rpc("set_appointment_status", {
        p_appointment: a.id,
        p_status: a.status,
        p_charge: a.charge,
      });
      if (error) return dbFail(error);
      const r = data as { already: boolean; account_id?: string | null; package_session?: boolean };
      return {
        ok: true,
        message: statusMessage(a.status, Boolean(r?.account_id), Boolean(r?.package_session)),
        id: a.id,
      };
    }

    case "package.sell": {
      if (!need("recorrentes.vender")) return fail("Seu papel nesta empresa não permite vender pacotes.");
      if (a.priceCents > 0) {
        const check = checkPlan(a.plan, a.priceCents);
        if (!check.ok) return fail(check.errors[0] ?? "Revise as parcelas.");
      }
      const { data, error } = await sb.rpc("sell_package", {
        p_client: a.clientId,
        p_service: a.serviceId,
        p_item: a.itemId,
        p_name: a.name,
        p_sessions: a.sessions,
        p_price: a.priceCents,
        p_valid_until: a.validUntil,
        p_plan: a.priceCents > 0 ? plan(a.plan) : [],
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      const r = data as { package_id: string; duplicate: boolean };
      return {
        ok: true,
        message:
          a.priceCents > 0
            ? `Pacote vendido. ${a.plan.length === 1 ? "A cobrança foi" : `As ${a.plan.length} parcelas foram`} para o financeiro.`
            : "Pacote cadastrado.",
        id: r.package_id,
      };
    }

    case "package.close": {
      if (!need("recorrentes.vender")) return fail("Seu papel nesta empresa não permite encerrar pacotes.");
      const { error } = await sb.rpc("close_package", { p_package: a.id });
      if (error) return dbFail(error);
      return { ok: true, message: "Pacote encerrado.", id: a.id };
    }

    case "subscription.save": {
      if (!need("recorrentes.vender")) return fail("Seu papel nesta empresa não permite criar mensalidades.");
      if (a.endsOn && a.endsOn < a.startsOn)
        return fail("O fim precisa ser depois do início.", { endsOn: "O fim precisa ser depois do início." });
      const values = { name: a.name, amount_cents: a.amountCents, day_of_month: a.dayOfMonth, ends_on: a.endsOn };
      if (a.id) {
        const { data, error } = await sb
          .from("subscriptions")
          .update(values)
          .eq("id", a.id)
          .eq("company_id", companyId)
          .select("id");
        if (error) return dbFail(error);
        if (!data?.length) return fail("Mensalidade não encontrada ou já cancelada.");
        await sb.rpc("generate_subscription_charges", { cid: companyId });
        return { ok: true, message: "Mensalidade atualizada. Vale para as próximas cobranças.", id: a.id };
      }
      const startErr = startsOnError(a.startsOn, toISODate(new Date()));
      if (startErr) return fail(startErr, { startsOn: startErr });
      const { data, error } = await sb
        .from("subscriptions")
        .insert({ ...values, client_id: a.clientId, starts_on: a.startsOn, company_id: companyId, created_by: userId })
        .select("id")
        .single();
      if (error) return dbFail(error);
      const { data: created } = await sb.rpc("generate_subscription_charges", { cid: companyId });
      await log(`Mensalidade criada: ${a.name}`, "mensalidade", a.clientId);
      const n = Number(created ?? 0);
      return {
        ok: true,
        message: n
          ? `Mensalidade criada. ${n === 1 ? "A cobrança deste mês já está" : `${n} cobranças já estão`} no financeiro.`
          : "Mensalidade criada. A primeira cobrança aparece no financeiro no mês do vencimento.",
        id: data.id,
      };
    }

    case "subscription.cancel": {
      if (!need("recorrentes.vender")) return fail("Seu papel nesta empresa não permite cancelar mensalidades.");
      const { error } = await sb.rpc("cancel_subscription", { p_subscription: a.id });
      if (error) return dbFail(error);
      return {
        ok: true,
        message: "Mensalidade cancelada. Não haverá novas cobranças; as que já existem continuam no financeiro.",
        id: a.id,
      };
    }

    case "block.create": {
      const { data: resource } = await sb
        .from("resources")
        .select("id, name, user_id")
        .eq("id", a.resourceId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!resource || !canManageResource(roles, userId, { userId: resource.user_id }))
        return fail("Você só pode bloquear a sua própria agenda.");
      const ms = new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime();
      if (!(ms > 0))
        return fail("O fim precisa ser depois do início.", { endsAt: "O fim precisa ser depois do início." });
      if (ms > 60 * 86_400_000) return fail("Bloqueie no máximo 60 dias de cada vez.", { endsAt: "Use até 60 dias." });
      const { data, error } = await sb
        .from("resource_blocks")
        .insert({
          company_id: companyId,
          resource_id: a.resourceId,
          starts_at: a.startsAt,
          ends_at: a.endsAt,
          reason: a.reason,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) return dbFail(error);
      return { ok: true, message: `Agenda de ${resource.name} bloqueada.`, id: data.id };
    }

    case "block.delete": {
      const { data, error } = await sb
        .from("resource_blocks")
        .delete()
        .eq("id", a.id)
        .eq("company_id", companyId)
        .select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Bloqueio não encontrado.");
      return { ok: true, message: "Bloqueio removido.", id: a.id };
    }

    case "cash.open": {
      if (!need("caixa.operar")) return fail("Seu papel nesta empresa não permite usar o caixa.");
      const { data, error } = await sb.rpc("open_cash", { p_company: companyId, p_opening: a.openingCents });
      if (error) return dbFail(error);
      return { ok: true, message: `Caixa aberto com ${formatBRL(a.openingCents)} de troco.`, id: data as string };
    }

    case "cash.receive": {
      if (!need("caixa.operar")) return fail("Seu papel nesta empresa não permite usar o caixa.");
      const { data, error } = await sb.rpc("cash_receive", {
        p_session: a.sessionId,
        p_account: a.accountId,
        p_amount: a.amountCents,
        p_method: a.method,
        p_request: a.requestId,
      });
      if (error) return dbFail(error);
      const left = Number((data as { balance_cents?: number })?.balance_cents ?? 0);
      return {
        ok: true,
        message:
          left > 0
            ? `Recebido ${formatBRL(a.amountCents)}. Faltam ${formatBRL(left)}.`
            : `Recebido ${formatBRL(a.amountCents)}. Conta quitada.`,
        id: a.accountId,
      };
    }

    case "cash.close": {
      if (!need("caixa.fechar")) return fail("Somente o financeiro ou o dono fecham o caixa.");
      const { data, error } = await sb.rpc("close_cash", {
        p_session: a.sessionId,
        p_counted: a.countedCents,
        p_notes: a.notes,
      });
      if (error) return dbFail(error);
      const diff = Number((data as { difference_cents: number }).difference_cents);
      return {
        ok: true,
        message:
          diff === 0
            ? "Caixa fechado. O dinheiro conferiu."
            : diff > 0
              ? `Caixa fechado. Sobraram ${formatBRL(diff)} na gaveta.`
              : `Caixa fechado. Faltaram ${formatBRL(-diff)} na gaveta.`,
        id: a.sessionId,
      };
    }

    case "commissionRule.save": {
      if (!need("comissoes.configurar")) return fail("Somente o administrador configura as comissões.");
      if ((a.percentBp === null) === (a.fixedCents === null)) return fail("Escolha porcentagem ou valor fixo.");
      const { data, error } = a.id
        ? await sb
            .from("commission_rules")
            .update({ percent_bp: a.percentBp, fixed_cents: a.fixedCents })
            .eq("id", a.id)
            .eq("company_id", companyId)
            .select("id")
        : await sb
            .from("commission_rules")
            .insert({
              company_id: companyId,
              resource_id: a.resourceId,
              service_id: a.serviceId,
              percent_bp: a.percentBp,
              fixed_cents: a.fixedCents,
            })
            .select("id");
      if (error?.code === "23505") return fail("Já existe uma regra para esta combinação. Edite a que já existe.");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Regra não encontrada.");
      return { ok: true, message: a.id ? "Regra de comissão salva." : "Regra de comissão criada.", id: data[0].id };
    }

    case "commissionRule.delete": {
      if (!need("comissoes.configurar")) return fail("Somente o administrador configura as comissões.");
      const { data, error } = await sb
        .from("commission_rules")
        .delete()
        .eq("id", a.id)
        .eq("company_id", companyId)
        .select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Regra não encontrada.");
      return { ok: true, message: "Regra removida.", id: a.id };
    }

    case "commission.close": {
      if (!need("comissoes.fechar")) return fail("Somente o financeiro ou o dono fecham comissões.");
      const { data, error } = await sb.rpc("close_commissions", { p_resource: a.resourceId, p_month: a.month });
      if (error) return dbFail(error);
      const r = data as { amount_cents: number };
      return {
        ok: true,
        message:
          Number(r.amount_cents) > 0
            ? `Comissão fechada: ${formatBRL(Number(r.amount_cents))}. A conta a pagar foi para o financeiro.`
            : "Mês fechado, sem comissão a pagar.",
        id: a.resourceId,
      };
    }

    case "class.save": {
      if (!need("turmas.gerenciar")) return fail("Somente o administrador ou o gestor criam turmas.");
      const err = classError(a);
      if (err) return fail(err);
      const values = {
        name: a.name,
        resource_id: a.resourceId,
        weekdays: [...new Set(a.weekdays)].sort(),
        start_time: a.startTime,
        duration_min: a.durationMin,
        capacity: a.capacity,
        active: a.active,
      };
      const { data, error } = a.id
        ? await sb.from("classes").update(values).eq("id", a.id).eq("company_id", companyId).select("id")
        : await sb
            .from("classes")
            .insert({ ...values, company_id: companyId })
            .select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Turma não encontrada.");
      return { ok: true, message: a.id ? `Turma ${a.name} salva.` : `Turma ${a.name} criada.`, id: data[0].id };
    }

    case "enrollment.create": {
      if (!need("turmas.matricular")) return fail("Seu papel nesta empresa não permite matricular.");
      const { data, error } = await sb
        .from("enrollments")
        .insert({ company_id: companyId, class_id: a.classId, client_id: a.clientId, created_by: userId })
        .select("id")
        .single();
      if (error?.code === "23505") return fail("Este aluno já está nesta turma.");
      if (error) return dbFail(error);
      await log("Matrícula em turma", "turma", a.clientId);
      return { ok: true, message: "Aluno matriculado.", id: data.id };
    }

    case "enrollment.end": {
      if (!need("turmas.matricular")) return fail("Seu papel nesta empresa não permite mexer em matrículas.");
      const { data, error } = await sb
        .from("enrollments")
        .update({ ended_on: toISODate(new Date()) })
        .eq("id", a.id)
        .eq("company_id", companyId)
        .is("ended_on", null)
        .select("id, client_id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Matrícula não encontrada.");
      await log("Saiu da turma", "turma", data[0].client_id);
      return { ok: true, message: "Matrícula encerrada. A vaga ficou livre.", id: a.id };
    }

    case "attendance.mark": {
      if (a.status === null) {
        const { error } = await sb
          .from("attendance")
          .delete()
          .eq("company_id", companyId)
          .eq("class_id", a.classId)
          .eq("client_id", a.clientId)
          .eq("class_date", a.date);
        if (error) return dbFail(error);
        return { ok: true, message: "Marcação removida.", id: a.classId };
      }
      const { error } = await sb.from("attendance").upsert(
        {
          company_id: companyId,
          class_id: a.classId,
          client_id: a.clientId,
          class_date: a.date,
          status: a.status,
          marked_by: userId,
          marked_at: new Date().toISOString(),
        },
        { onConflict: "class_id,client_id,class_date" },
      );
      if (error) return dbFail(error);
      return { ok: true, message: a.status === "falta" ? "Falta marcada." : "Presença marcada.", id: a.classId };
    }

    case "company.setBooking": {
      if (!need("empresa.gerenciar")) return fail("Somente o administrador configura o agendamento online.");
      const flags = await companyFlags();
      if (!flags || !moduleEnabled(flags, "agendamento_online")) return fail(MODULE_OFF);
      if (a.enabled && !a.slug) return fail("Escolha o endereço da página.", { slug: "Escolha o endereço da página." });
      const { data, error } = await sb
        .from("companies")
        .update({ booking_enabled: a.enabled, booking_slug: a.slug, booking_auto_confirm: a.autoConfirm })
        .eq("id", companyId)
        .select("id");
      if (error?.code === "23505")
        return fail("Este endereço já está em uso. Escolha outro.", { slug: "Endereço em uso." });
      if (error) return dbFail(error);
      if (!data?.length) return fail("Somente o administrador configura o agendamento online.");
      return { ok: true, message: a.enabled ? "Agendamento online ligado." : "Agendamento online desligado." };
    }

    case "appointment.markReminded": {
      const { data, error } = await sb
        .from("appointments")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", a.id)
        .eq("company_id", companyId)
        .select("id");
      if (error) return dbFail(error);
      if (!data?.length) return fail("Atendimento não encontrado.");
      return { ok: true, message: "Lembrete anotado.", id: a.id };
    }

    case "clinicalNote.add": {
      if (!need("prontuario.escrever")) return fail("Somente quem atende escreve a ficha de atendimento.");
      const { data, error } = await sb
        .from("clinical_notes")
        .insert({
          company_id: companyId,
          client_id: a.clientId,
          appointment_id: a.appointmentId,
          author_id: userId,
          body: a.body,
          corrects_id: a.correctsId,
        })
        .select("id")
        .single();
      if (error) return dbFail(error);
      return { ok: true, message: a.correctsId ? "Correção salva." : "Anotação salva.", id: data.id };
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
