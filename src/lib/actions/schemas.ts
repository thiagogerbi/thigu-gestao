import { LOGO_DATA_URL_RE, LOGO_MAX_CHARS } from "@/lib/domain/branding";
import { isISODate } from "@/lib/domain/dates";
import { isValidDocument, normalizeDocument } from "@/lib/domain/document";
import { SEGMENT_IDS } from "@/lib/domain/segments";
import type { Segment } from "@/lib/domain/types";
import { z } from "zod";

/**
 * Contrato único das operações do Thigu Gestão.
 * A interface envia estes objetos; a prévia aplica em memória e a versão real
 * revalida tudo no servidor (zod + papéis) e no banco (RLS + funções SQL).
 */

const id = z.string().min(1).max(64);
const cents = z.number().int().min(0).max(100_000_000_00);
const positiveCents = z.number().int().min(1).max(100_000_000_00);
const date = z.string().refine(isISODate, "Data inválida");
/** Instante completo (ISO com fuso), como o navegador envia ("2026-11-14T12:30:00.000Z"). */
const instant = z
  .string()
  .max(40)
  .refine((s) => s.includes("T") && !Number.isNaN(Date.parse(s)), "Data e hora inválidas");
const text = (max: number) => z.string().trim().max(max);
const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.")
  .transform((v) => v.toLowerCase())
  .nullable();

/** Campos extras por ramo: aqui só o formato; a lista de campos é conferida contra o ramo da empresa. */
const fieldValues = z.record(z.string().max(40), z.string().max(300));

export const planSchema = z
  .array(z.object({ number: z.number().int().min(1).max(36), amountCents: positiveCents, dueDate: date }))
  .min(1)
  .max(36);

export const methodSchema = z.enum([
  "pix",
  "dinheiro",
  "cartao_credito",
  "cartao_debito",
  "boleto",
  "transferencia",
  "outro",
]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("company.saveProfile"),
    name: text(120).min(2, "Digite o nome da empresa (pelo menos 2 letras)."),
    legalName: text(160),
    document: z
      .string()
      .max(30)
      .transform(normalizeDocument)
      .refine(isValidDocument, "CNPJ ou CPF inválido. Confira os números (ou deixe em branco)."),
    phone: text(30),
    email: z.union([z.literal(""), z.string().trim().email("E-mail inválido. Exemplo: contato@empresa.com.br")]),
    address: text(300),
    defaultTerms: text(2000),
    logoDataUrl: z
      .string()
      .max(LOGO_MAX_CHARS, "A imagem ficou grande demais. Tente um arquivo menor.")
      .regex(LOGO_DATA_URL_RE, "Use uma imagem PNG, JPG ou WebP.")
      .nullable(),
    brandColor: hexColor,
    menuColor: hexColor,
  }),
  z.object({
    type: z.literal("company.setSegment"),
    segment: z.enum(SEGMENT_IDS as [Segment, ...Segment[]]),
  }),
  z.object({
    type: z.literal("client.save"),
    id: id.optional(),
    name: text(120).min(2, "Digite o nome (pelo menos 2 letras)."),
    email: z.union([z.literal(""), z.string().trim().email("E-mail inválido. Exemplo: nome@empresa.com.br")]),
    phone: text(30),
    ownerId: id,
    /** Sem este campo, os dados extras que já existem são mantidos. */
    extra: fieldValues.optional(),
  }),
  z.object({
    type: z.literal("item.save"),
    id: id.optional(),
    clientId: id,
    kind: z.enum(["pet"]),
    name: text(80).min(1, "Digite o nome."),
    details: fieldValues,
    alert: text(200),
  }),
  z.object({ type: z.literal("item.setActive"), id, active: z.boolean() }),
  z.object({
    type: z.literal("service.save"),
    id: id.optional(),
    name: text(80).min(1, "Digite o nome do serviço."),
    durationMin: z.number().int().min(5, "Use pelo menos 5 minutos.").max(720, "Use até 12 horas."),
    priceCents: cents,
    active: z.boolean(),
  }),
  z.object({
    type: z.literal("resource.save"),
    id: id.optional(),
    name: text(80).min(1, "Digite o nome."),
    userId: id.nullable(),
    active: z.boolean(),
    /** Sem este campo, o horário que já existe é mantido. */
    workHours: z.record(z.string().max(1), z.array(z.tuple([z.string().max(5), z.string().max(5)])).max(4)).optional(),
  }),
  z.object({
    type: z.literal("block.create"),
    resourceId: id,
    startsAt: instant,
    endsAt: instant,
    reason: text(120),
  }),
  z.object({ type: z.literal("block.delete"), id }),
  z.object({
    type: z.literal("product.save"),
    id: id.optional(),
    name: text(80).min(1, "Digite o nome do produto."),
    priceCents: cents,
    active: z.boolean(),
  }),
  z.object({ type: z.literal("cash.open"), openingCents: z.number().int().min(0).max(1_000_000_00) }),
  z.object({
    type: z.literal("cash.sale"),
    sessionId: id,
    clientId: id.nullable(),
    items: z
      .array(
        z.object({
          productId: id.nullable(),
          serviceId: id.nullable(),
          description: text(120).min(1, "Descreva o item."),
          quantity: z.number().int().min(1).max(999),
          unitCents: positiveCents,
        }),
      )
      .min(1, "Adicione pelo menos um item.")
      .max(30),
    method: methodSchema,
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("cash.receive"),
    sessionId: id,
    accountId: id,
    amountCents: positiveCents,
    method: methodSchema,
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("cash.close"),
    sessionId: id,
    countedCents: z.number().int().min(0).max(10_000_000_00),
    notes: text(500),
  }),
  z.object({
    type: z.literal("commissionRule.save"),
    id: id.optional(),
    resourceId: id.nullable(),
    serviceId: id.nullable(),
    percentBp: z.number().int().min(0).max(10000).nullable(),
    fixedCents: cents.nullable(),
  }),
  z.object({ type: z.literal("commissionRule.delete"), id }),
  z.object({ type: z.literal("commission.close"), resourceId: id, month: date }),
  z.object({
    type: z.literal("class.save"),
    id: id.optional(),
    name: text(80).min(1, "Dê um nome para a turma."),
    resourceId: id.nullable(),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Escolha os dias da semana.").max(7),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Digite o horário, por exemplo 18:00."),
    durationMin: z.number().int().min(5).max(720),
    capacity: z.number().int().min(1, "Use pelo menos 1 vaga.").max(200),
    active: z.boolean(),
  }),
  z.object({ type: z.literal("enrollment.create"), classId: id, clientId: id }),
  z.object({ type: z.literal("enrollment.end"), id }),
  z.object({
    type: z.literal("attendance.mark"),
    classId: id,
    clientId: id,
    date,
    /** null apaga a marcação. */
    status: z.enum(["presente", "falta", "reposicao"]).nullable(),
  }),
  z.object({
    type: z.literal("company.setBooking"),
    enabled: z.boolean(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/, "Use de 3 a 40 letras minúsculas, números e hífen.")
      .nullable(),
    autoConfirm: z.boolean(),
  }),
  z.object({
    type: z.literal("appointment.save"),
    id: id.optional(),
    clientId: id,
    resourceId: id,
    serviceId: id.nullable(),
    itemId: id.nullable(),
    startsAt: instant,
    endsAt: instant,
    priceCents: cents,
    notes: text(500),
    /** Só vale ao marcar um horário novo. */
    repeat: z.enum(["nao", "semanal", "quinzenal"]),
    times: z.number().int().min(1).max(12),
    /** A pessoa viu o aviso de horário ocupado e quer marcar mesmo assim (encaixe). */
    allowOverlap: z.boolean(),
    /** Pacote do cliente a usar (não gera cobrança; desconta uma sessão ao ser atendido). */
    packageId: id.nullable().optional(),
  }),
  z.object({
    type: z.literal("appointment.setStatus"),
    id,
    status: z.enum(["agendado", "confirmado", "compareceu", "faltou", "cancelado"]),
    /** Cobrar a falta (só vale para "faltou"). */
    charge: z.boolean(),
  }),
  z.object({ type: z.literal("appointment.markReminded"), id }),
  z.object({
    type: z.literal("package.sell"),
    clientId: id,
    serviceId: id.nullable(),
    itemId: id.nullable(),
    name: text(80).min(1, "Dê um nome para o pacote."),
    sessions: z.number().int().min(1, "Use pelo menos 1 sessão.").max(200, "Use até 200 sessões."),
    priceCents: cents,
    validUntil: date.nullable(),
    /** Parcelas (só quando há valor). */
    plan: z
      .array(z.object({ number: z.number().int().min(1).max(36), amountCents: positiveCents, dueDate: date }))
      .max(36),
    requestId: z.string().uuid(),
  }),
  z.object({ type: z.literal("package.close"), id }),
  z.object({
    type: z.literal("subscription.save"),
    id: id.optional(),
    clientId: id,
    name: text(80).min(1, "Dê um nome para a mensalidade."),
    amountCents: positiveCents,
    dayOfMonth: z.number().int().min(1, "Escolha o dia.").max(28, "Use um dia de 1 a 28."),
    startsOn: date,
    endsOn: date.nullable(),
  }),
  z.object({ type: z.literal("subscription.cancel"), id }),
  z.object({
    type: z.literal("clinicalNote.add"),
    clientId: id,
    appointmentId: id.nullable(),
    body: text(5000).min(1, "Escreva a anotação."),
    correctsId: id.nullable(),
  }),
  z.object({
    type: z.literal("deal.save"),
    id: id.optional(),
    clientId: id,
    title: text(120).min(2, "Dê um nome para a negociação."),
    valueCents: cents,
    ownerId: id,
    expectedClose: date.nullable(),
    nextAction: text(200).nullable(),
    nextActionDate: date.nullable(),
  }),
  z.object({
    type: z.literal("deal.move"),
    id,
    stage: z.enum(["novo_contato", "qualificacao", "negociacao", "proposta", "perdida"]),
    lostReason: text(300).nullable(),
  }),
  z.object({
    type: z.literal("note.add"),
    clientId: id,
    dealId: id.nullable(),
    body: text(2000).min(1, "Escreva o que foi combinado."),
  }),
  z.object({
    type: z.literal("task.save"),
    id: id.optional(),
    title: text(200).min(2, "Descreva a tarefa."),
    clientId: id.nullable(),
    dealId: id.nullable(),
    assigneeId: id,
    dueDate: date,
  }),
  z.object({ type: z.literal("task.setDone"), id, done: z.boolean() }),
  z.object({
    type: z.literal("proposal.save"),
    id: id.optional(),
    clientId: id,
    dealId: id,
    items: z
      .array(
        z.object({ description: text(200).min(1), quantity: z.number().positive().max(1_000_000), unitCents: cents }),
      )
      .min(1)
      .max(50),
    discountCents: cents,
    validUntil: date,
    terms: text(2000),
  }),
  z.object({ type: z.literal("proposal.markSent"), id, followUpTask: z.boolean() }),
  z.object({ type: z.literal("proposal.accept"), id, updateDealValue: z.boolean() }),
  z.object({ type: z.literal("proposal.reject"), id, reason: text(300).nullable() }),
  z.object({
    type: z.literal("sale.close"),
    dealId: id,
    proposalId: id.nullable(),
    totalCents: positiveCents,
    paymentMode: z.enum(["avista", "parcelado"]),
    plan: planSchema,
    requestId: z.string().uuid(),
  }),
  z.object({ type: z.literal("sale.confirm"), saleId: id, plan: planSchema }),
  z.object({
    type: z.literal("movement.register"),
    accountId: id,
    amountCents: positiveCents,
    paidOn: date,
    method: methodSchema,
    requestId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("movement.undo"),
    movementId: id,
    reason: text(300).min(3, "Explique em poucas palavras por que está desfazendo."),
  }),
  z.object({
    type: z.literal("account.cancel"),
    accountId: id,
    reason: text(300).min(3, "Explique em poucas palavras o motivo do cancelamento."),
  }),
  z.object({
    type: z.literal("expense.create"),
    description: text(200).min(2, "Descreva a despesa."),
    category: text(60).min(1, "Escolha uma categoria."),
    supplier: text(120),
    amountCents: positiveCents,
    dueDate: date,
  }),
]);

export type Action = z.infer<typeof actionSchema>;
export type ActionType = Action["type"];

export type ActionResult =
  | { ok: true; message: string; id?: string; extra?: Record<string, unknown> }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export function parseAction(input: unknown): { ok: true; action: Action } | { ok: false; result: ActionResult } {
  const r = actionSchema.safeParse(input);
  if (r.success) return { ok: true, action: r.data };
  return {
    ok: false,
    result: { ok: false, message: "Alguns campos precisam de ajuste.", fieldErrors: zodFieldErrors(r.error) },
  };
}
