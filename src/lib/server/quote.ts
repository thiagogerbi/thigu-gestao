"use server";

import { buildPreviewSeed } from "@/lib/preview/seed";
import { supabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Página pública do orçamento (/orcamento/[código]). Sem login: só chama public_work_order e
 * public_approve_work_order, que conferem o código, a validade (30 dias) e a etapa.
 * O código "exemplo" mostra uma OS da prévia e não grava nada.
 */

export interface QuoteItem {
  id: string;
  kind: "peca" | "servico";
  description: string;
  quantity: number;
  unitCents: number;
  warrantyDays: number | null;
  status: "pendente" | "aprovado" | "recusado";
}

export interface QuoteInfo {
  demo: boolean;
  company: { name: string; logo: string | null; brandColor: string | null; phone: string };
  number: number;
  stage: string;
  complaint: string;
  diagnosis: string;
  discountCents: number;
  approvedAt: string | null;
  approvedByName: string | null;
  promisedOn: string | null;
  clientName: string;
  vehicle: { name: string; plate: string | null };
  items: QuoteItem[];
}

export type ApproveResult = { ok: true; approved: number; demo: boolean } | { ok: false; message: string };

const DEMO = "exemplo";
const tokenSchema = z.union([z.literal(DEMO), z.string().uuid()]);

function anon() {
  const cfg = supabaseConfig();
  return cfg ? createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function demoQuote(): QuoteInfo {
  const d = buildPreviewSeed(new Date()).find((c) => c.company.id === "empresa-oficina")!;
  const w = d.workOrders.find((x) => x.id === "os-4")!;
  const v = d.items.find((i) => i.id === w.itemId)!;
  return {
    demo: true,
    company: {
      name: d.company.name,
      logo: d.company.logoDataUrl,
      brandColor: d.company.brandColor,
      phone: d.company.phone,
    },
    number: w.number,
    stage: w.stage,
    complaint: w.complaint,
    diagnosis: w.diagnosis,
    discountCents: w.discountCents,
    approvedAt: null,
    approvedByName: null,
    promisedOn: w.promisedOn,
    clientName: (d.clients.find((c) => c.id === w.clientId)?.name ?? "").split(" ")[0],
    vehicle: { name: v.name, plate: v.plate ?? null },
    items: d.workOrderItems
      .filter((i) => i.workOrderId === w.id)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        description: i.description,
        quantity: i.quantity,
        unitCents: i.unitCents,
        warrantyDays: i.warrantyDays,
        status: i.status,
      })),
  };
}

export async function quoteInfo(rawToken: string): Promise<QuoteInfo | null> {
  const token = tokenSchema.safeParse(rawToken);
  if (!token.success) return null;
  if (token.data === DEMO) return demoQuote();
  const sb = anon();
  if (!sb) return null;
  const { data, error } = await sb.rpc("public_work_order", { p_token: token.data });
  if (error || !data) return null;
  const j = data as {
    company: { name: string; logo: string | null; brand_color: string | null; phone: string | null };
    number: number;
    stage: string;
    complaint: string;
    diagnosis: string;
    discount_cents: number;
    approved_at: string | null;
    approved_by_name: string | null;
    promised_on: string | null;
    client_name: string | null;
    vehicle: { name: string; plate: string | null } | null;
    items: {
      id: string;
      kind: "peca" | "servico";
      description: string;
      quantity: number;
      unit_cents: number;
      warranty_days: number | null;
      status: QuoteItem["status"];
    }[];
  };
  return {
    demo: false,
    company: {
      name: j.company.name,
      logo: j.company.logo,
      brandColor: j.company.brand_color,
      phone: j.company.phone ?? "",
    },
    number: j.number,
    stage: j.stage,
    complaint: j.complaint ?? "",
    diagnosis: j.diagnosis ?? "",
    discountCents: Number(j.discount_cents),
    approvedAt: j.approved_at,
    approvedByName: j.approved_by_name,
    promisedOn: j.promised_on,
    clientName: j.client_name ?? "",
    vehicle: j.vehicle ?? { name: "Veículo", plate: null },
    items: j.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      description: i.description,
      quantity: i.quantity,
      unitCents: Number(i.unit_cents),
      warrantyDays: i.warranty_days,
      status: i.status,
    })),
  };
}

const approveInput = z.object({
  token: tokenSchema,
  approvedIds: z.array(z.string().min(1).max(64)).max(200),
  name: z.string().trim().min(2, "Digite seu nome.").max(120),
});

export async function quoteApprove(raw: z.input<typeof approveInput>): Promise<ApproveResult> {
  const p = approveInput.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Confira os dados." };
  if (p.data.token === DEMO) {
    const pending = demoQuote()
      .items.filter((i) => i.status === "pendente")
      .map((i) => i.id);
    return { ok: true, approved: p.data.approvedIds.filter((id) => pending.includes(id)).length, demo: true };
  }
  const sb = anon();
  if (!sb) return { ok: false, message: "Orçamento indisponível." };
  const { data, error } = await sb.rpc("public_approve_work_order", {
    p_token: p.data.token,
    p_approved: p.data.approvedIds,
    p_name: p.data.name,
  });
  if (error) {
    const known = ["P0001", "P0002", "22023"].includes(error.code ?? "");
    return { ok: false, message: known ? error.message : "Não foi possível registrar agora. Tente de novo." };
  }
  return { ok: true, approved: Number((data as { approved?: number })?.approved ?? 0), demo: false };
}
