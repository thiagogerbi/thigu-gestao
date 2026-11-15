"use server";

/**
 * Ações da EQUIPE THIGU (painel /admin/codigos). O banco confere de novo se a pessoa está em
 * platform_admins — estas verificações aqui só dão mensagens melhores.
 */
import type { ActionResult } from "@/lib/actions/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

export interface ActivationCodeRow {
  id: string;
  codeHint: string;
  customerName: string;
  customerEmail: string | null;
  accessDays: number;
  validUntil: string;
  note: string | null;
  createdAt: string;
  usedAt: string | null;
  companyName: string | null;
  companyAccessUntil: string | null;
  revokedAt: string | null;
}

async function adminSession() {
  const sb = await createSupabaseServerClient();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  const { data: isAdmin } = await sb.rpc("is_platform_admin");
  return isAdmin ? sb : null;
}

export async function listActivationCodes(): Promise<ActivationCodeRow[] | null> {
  const sb = await adminSession();
  if (!sb) return null;
  const { data, error } = await sb.rpc("list_activation_codes");
  if (error) throw error;
  return ((data ?? []) as Record<string, never>[]).map((r) => ({
    id: r.id,
    codeHint: r.code_hint,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    accessDays: r.access_days,
    validUntil: r.valid_until,
    note: r.note,
    createdAt: r.created_at,
    usedAt: r.used_at,
    companyName: r.company_name,
    companyAccessUntil: r.company_access_until,
    revokedAt: r.revoked_at,
  }));
}

const generateSchema = z.object({
  customerName: z.string().trim().min(2, "Digite o nome do cliente.").max(120),
  customerEmail: z.union([z.literal(""), z.string().trim().email("E-mail inválido. Exemplo: nome@empresa.com.br")]),
  accessDays: z.number().int().min(1, "Informe quantos dias de acesso.").max(1100, "No máximo 1.100 dias."),
  validDays: z.number().int().min(1).max(365, "O código pode valer no máximo 365 dias para ser usado."),
  note: z.string().trim().max(300),
});

export type GenerateInput = z.infer<typeof generateSchema>;

export async function generateActivationCode(
  input: GenerateInput,
): Promise<ActionResult & { code?: string; validUntil?: string }> {
  const sb = await adminSession();
  if (!sb) return { ok: false, message: "Somente a equipe Thigu pode gerar códigos." };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Confira os campos destacados.", fieldErrors };
  }
  const v = parsed.data;
  const { data, error } = await sb.rpc("generate_activation_code", {
    p_customer_name: v.customerName,
    p_customer_email: v.customerEmail || null,
    p_access_days: v.accessDays,
    p_valid_days: v.validDays,
    p_note: v.note || null,
  });
  if (error) {
    console.error("[thigu] generate_activation_code", error);
    return { ok: false, message: error.message || "Não foi possível gerar o código agora." };
  }
  const r = data as { id: string; code: string };
  const { data: row } = await sb.from("activation_codes").select("valid_until").eq("id", r.id).single();
  return { ok: true, message: "Código gerado.", id: r.id, code: r.code, validUntil: row?.valid_until };
}

export async function revokeActivationCode(id: string): Promise<ActionResult> {
  const sb = await adminSession();
  if (!sb) return { ok: false, message: "Somente a equipe Thigu pode cancelar códigos." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, message: "Código inválido." };
  const { error } = await sb.rpc("revoke_activation_code", { p_id: id });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Código cancelado. Ele não pode mais ser usado." };
}
