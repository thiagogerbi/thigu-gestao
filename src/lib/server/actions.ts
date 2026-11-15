"use server";

import { parseAction, type ActionResult } from "@/lib/actions/schemas";
import { canonicalCode, codeFormatError } from "@/lib/domain/activation";
import { formatDateBR } from "@/lib/domain/dates";
import { SEGMENT_IDS } from "@/lib/domain/segments";
import type { CompanyData, Role, Segment } from "@/lib/domain/types";
import { COMPANY_COOKIE } from "@/lib/server/constants";
import { executeAction } from "@/lib/server/execute";
import { loadCompanyData } from "@/lib/server/load";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { z } from "zod";
const uuid = z.string().uuid();

async function session() {
  const sb = await createSupabaseServerClient();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  if (!data.user) return null;
  return { sb, user: data.user };
}

async function rolesIn(
  sb: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>,
  companyId: string,
  userId: string,
): Promise<Role[] | null> {
  const { data } = await sb
    .from("memberships")
    .select("roles")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  return (data?.roles as Role[] | undefined) ?? null;
}

/** Executa uma ação e devolve os dados atualizados da empresa (para a tela refletir na hora). */
export async function runAction(
  companyId: string,
  raw: unknown,
): Promise<{ result: ActionResult; data?: CompanyData }> {
  const s = await session();
  if (!s) return { result: { ok: false, message: "Sua sessão terminou. Entre novamente." } };
  if (!uuid.safeParse(companyId).success) return { result: { ok: false, message: "Empresa inválida." } };
  const roles = await rolesIn(s.sb, companyId, s.user.id);
  if (!roles) return { result: { ok: false, message: "Você não faz parte desta empresa." } };
  const parsed = parseAction(raw);
  if (!parsed.ok) return { result: parsed.result };
  const result = await executeAction({ sb: s.sb, companyId, userId: s.user.id, roles }, parsed.action);
  const data = await loadCompanyData(s.sb, companyId).catch(() => undefined);
  return { result, data };
}

export async function switchCompany(companyId: string): Promise<boolean> {
  const s = await session();
  if (!s || !uuid.safeParse(companyId).success) return false;
  if (!(await rolesIn(s.sb, companyId, s.user.id))) return false;
  (await cookies()).set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}

/** Resposta das funções de ativação no banco (create_company / apply_activation_code). */
type RedeemResult = { ok: boolean; company_id?: string; access_until?: string; field?: string; message?: string };

function redeemFailure(r: RedeemResult): ActionResult {
  const message = r.message ?? "Não foi possível usar este código agora.";
  return { ok: false, message, fieldErrors: { [r.field ?? "code"]: message } };
}

/** Cadastra a empresa, no ramo escolhido, usando o código de ativação recebido por e-mail depois da compra. */
export async function createCompany(name: string, code: string, segment: string = "geral"): Promise<ActionResult> {
  const s = await session();
  if (!s) return { ok: false, message: "Sua sessão terminou. Entre novamente." };
  const fieldErrors: Record<string, string> = {};
  const parsedName = z
    .string()
    .trim()
    .min(2, "Digite o nome da empresa (pelo menos 2 letras).")
    .max(120)
    .safeParse(name);
  if (!parsedName.success) fieldErrors.name = parsedName.error.issues[0].message;
  const codeError = codeFormatError(code);
  if (codeError) fieldErrors.code = codeError;
  if (Object.keys(fieldErrors).length) return { ok: false, message: "Confira os campos destacados.", fieldErrors };
  if (!SEGMENT_IDS.includes(segment as Segment)) return { ok: false, message: "Escolha o ramo da empresa." };

  const { data, error } = await s.sb.rpc("create_company", {
    p_name: parsedName.data,
    p_code: canonicalCode(code),
    p_segment: segment,
  });
  if (error) {
    console.error("[thigu] create_company", error);
    return { ok: false, message: "Não foi possível criar a empresa agora. Tente de novo em instantes." };
  }
  const r = data as RedeemResult;
  if (!r.ok) return redeemFailure(r);
  await switchCompany(r.company_id!);
  return { ok: true, message: `Empresa ${parsedName.data!} criada.`, id: r.company_id };
}

/** Renova o acesso da empresa com um novo código (só o administrador). */
export async function renewAccess(companyId: string, code: string): Promise<ActionResult> {
  const s = await session();
  if (!s) return { ok: false, message: "Sua sessão terminou. Entre novamente." };
  if (!uuid.safeParse(companyId).success) return { ok: false, message: "Empresa inválida." };
  const roles = await rolesIn(s.sb, companyId, s.user.id);
  if (!roles?.includes("admin"))
    return { ok: false, message: "Somente o administrador da empresa pode renovar o acesso." };
  const codeError = codeFormatError(code);
  if (codeError) return { ok: false, message: codeError, fieldErrors: { code: codeError } };

  const { data, error } = await s.sb.rpc("apply_activation_code", {
    p_company: companyId,
    p_code: canonicalCode(code),
  });
  if (error) {
    console.error("[thigu] apply_activation_code", error);
    return { ok: false, message: "Não foi possível renovar agora. Tente de novo em instantes." };
  }
  const r = data as RedeemResult;
  if (!r.ok) return redeemFailure(r);
  return { ok: true, message: `Acesso renovado até ${formatDateBR(r.access_until!)}.` };
}

const roleList = z
  .array(z.enum(["admin", "gestor", "vendedor", "financeiro", "recepcao", "profissional", "caixa"]))
  .min(1, "Escolha pelo menos um papel.");

/** Mensagens que as funções do banco escrevem para a pessoa ler (as demais viram um texto genérico). */
const DB_MESSAGE_CODES = new Set(["P0001", "P0002", "22023", "42501"]);
function dbMessage(error: { message?: string; code?: string }, fallback: string) {
  return error.code && DB_MESSAGE_CODES.has(error.code) && error.message ? error.message : fallback;
}

/** Cria (ou atualiza) o convite para um e-mail. O vínculo só existe quando a pessoa aceitar. */
export async function inviteMember(companyId: string, email: string, roles: string[]): Promise<ActionResult> {
  const s = await session();
  if (!s) return { ok: false, message: "Sua sessão terminou. Entre novamente." };
  const r = roleList.safeParse(roles);
  const e = z.string().trim().email("E-mail inválido.").safeParse(email);
  if (!uuid.safeParse(companyId).success) return { ok: false, message: "Empresa inválida." };
  if (!r.success) return { ok: false, message: r.error.issues[0].message };
  if (!e.success)
    return { ok: false, message: e.error.issues[0].message, fieldErrors: { email: e.error.issues[0].message } };
  const mine = await rolesIn(s.sb, companyId, s.user.id);
  if (!mine?.includes("admin")) return { ok: false, message: "Somente o administrador gerencia membros." };
  const { error } = await s.sb.rpc("invite_member", { p_company: companyId, p_email: e.data, p_roles: r.data });
  if (error) return { ok: false, message: dbMessage(error, "Não foi possível criar o convite agora.") };
  return {
    ok: true,
    message: `Convite criado para ${e.data.toLowerCase()}. Avise a pessoa: ele aparece quando ela entrar no Thigu com este e-mail.`,
  };
}

export async function cancelInvite(inviteId: string): Promise<ActionResult> {
  const s = await session();
  if (!s) return { ok: false, message: "Sua sessão terminou. Entre novamente." };
  if (!uuid.safeParse(inviteId).success) return { ok: false, message: "Convite inválido." };
  const { error } = await s.sb.rpc("cancel_invite", { p_invite: inviteId });
  if (error) return { ok: false, message: dbMessage(error, "Não foi possível cancelar o convite agora.") };
  return { ok: true, message: "Convite cancelado." };
}

/** Resposta de quem foi convidado. Ao aceitar, a empresa passa a ser a empresa aberta. */
export async function respondInvite(inviteId: string, accept: boolean): Promise<ActionResult> {
  const s = await session();
  if (!s) return { ok: false, message: "Sua sessão terminou. Entre novamente." };
  if (!uuid.safeParse(inviteId).success) return { ok: false, message: "Convite inválido." };
  const { data, error } = await s.sb.rpc("respond_invite", { p_invite: inviteId, p_accept: accept });
  if (error) return { ok: false, message: dbMessage(error, "Não foi possível responder ao convite agora.") };
  if (accept) await switchCompany(data as string);
  return { ok: true, message: accept ? "Convite aceito." : "Convite recusado.", id: data as string };
}

export async function setMemberRoles(
  companyId: string,
  userId: string,
  roles: string[],
  active: boolean,
): Promise<ActionResult> {
  const s = await session();
  if (!s) return { ok: false, message: "Sua sessão terminou. Entre novamente." };
  const r = roleList.safeParse(roles);
  if (!r.success || !uuid.safeParse(userId).success) return { ok: false, message: "Dados inválidos." };
  const { error } = await s.sb.rpc("set_member_roles", {
    p_company: companyId,
    p_user: userId,
    p_roles: r.data,
    p_active: active,
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: active ? "Papéis atualizados." : "Acesso removido." };
}

export async function signOut() {
  const sb = await createSupabaseServerClient();
  await sb?.auth.signOut();
  (await cookies()).delete(COMPANY_COOKIE);
}
