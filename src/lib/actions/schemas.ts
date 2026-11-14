import { LOGO_DATA_URL_RE, LOGO_MAX_CHARS } from "@/lib/domain/branding";
import { isISODate } from "@/lib/domain/dates";
import { isValidDocument, normalizeDocument } from "@/lib/domain/document";
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
const text = (max: number) => z.string().trim().max(max);

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
    brandColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.")
      .transform((v) => v.toLowerCase())
      .nullable(),
  }),
  z.object({
    type: z.literal("client.save"),
    id: id.optional(),
    name: text(120).min(2, "Digite o nome do cliente (pelo menos 2 letras)."),
    email: z.union([z.literal(""), z.string().trim().email("E-mail inválido. Exemplo: nome@empresa.com.br")]),
    phone: text(30),
    ownerId: id,
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
