"use server";

import { availableSlots, fromBr, MAX_AHEAD_DAYS } from "@/lib/domain/hours";
import { addDays, isISODate } from "@/lib/domain/dates";
import type { Segment, WorkHours } from "@/lib/domain/types";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { supabaseConfig } from "@/lib/supabase/config";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Página pública de agendamento (/agendar/[endereço]). Sem login: só chama as três funções públicas do banco
 * (public_booking_info, public_busy e public_book), que conferem tudo de novo. O endereço "exemplo"
 * mostra o Studio Bella da prévia e não grava nada.
 */

export interface BookingInfo {
  demo: boolean;
  company: {
    name: string;
    logo: string | null;
    brandColor: string | null;
    phone: string;
    address: string;
    segment: Segment;
  };
  services: { id: string; name: string; durationMin: number; priceCents: number }[];
  resources: { id: string; name: string; workHours: WorkHours }[];
}

export type BookResult =
  { ok: true; status: "agendado" | "confirmado"; demo: boolean } | { ok: false; message: string };

const DEMO = "exemplo";
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/);
const uuid = z.string().min(1).max(64);

function anon() {
  const cfg = supabaseConfig();
  // cliente sem sessão: a página é pública e não deve carregar o login de quem estiver no navegador
  return cfg ? createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
}

function demoCompany() {
  return buildPreviewSeed(new Date()).find((c) => c.company.id === "empresa-salao")!;
}

export async function bookingInfo(rawSlug: string): Promise<BookingInfo | null> {
  const slug = slugSchema.safeParse(rawSlug);
  if (!slug.success) return null;
  if (slug.data === DEMO) {
    const d = demoCompany();
    return {
      demo: true,
      company: {
        name: d.company.name,
        logo: d.company.logoDataUrl,
        brandColor: d.company.brandColor,
        phone: d.company.phone,
        address: d.company.address,
        segment: d.company.segment,
      },
      services: d.services
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, priceCents: s.priceCents })),
      resources: d.resources
        .filter((r) => r.active && Object.keys(r.workHours).length > 0)
        .map((r) => ({ id: r.id, name: r.name, workHours: r.workHours })),
    };
  }
  const sb = anon();
  if (!sb) return null;
  const { data, error } = await sb.rpc("public_booking_info", { p_slug: slug.data });
  if (error || !data) return null;
  const j = data as {
    company: {
      name: string;
      logo: string | null;
      brand_color: string | null;
      phone: string | null;
      address: string | null;
      segment: Segment;
    };
    services: { id: string; name: string; duration_min: number; price_cents: number }[];
    resources: { id: string; name: string; work_hours: WorkHours }[];
  };
  return {
    demo: false,
    company: {
      name: j.company.name,
      logo: j.company.logo,
      brandColor: j.company.brand_color,
      phone: j.company.phone ?? "",
      address: j.company.address ?? "",
      segment: j.company.segment,
    },
    services: j.services.map((s) => ({
      id: s.id,
      name: s.name,
      durationMin: s.duration_min,
      priceCents: Number(s.price_cents),
    })),
    resources: j.resources.map((r) => ({ id: r.id, name: r.name, workHours: r.work_hours ?? {} })),
  };
}

const slotsInput = z.object({
  slug: z.string(),
  serviceId: uuid,
  resourceId: uuid,
  date: z.string().refine(isISODate),
});

/** Horários livres num dia, já descontando o que está ocupado ou bloqueado. */
export async function bookingSlots(raw: z.input<typeof slotsInput>): Promise<string[]> {
  const p = slotsInput.safeParse(raw);
  if (!p.success) return [];
  const info = await bookingInfo(p.data.slug);
  const service = info?.services.find((s) => s.id === p.data.serviceId);
  const resource = info?.resources.find((r) => r.id === p.data.resourceId);
  if (!info || !service || !resource) return [];
  const from = fromBr(p.data.date, "00:00");
  const to = fromBr(addDays(p.data.date, 1), "00:00");
  let busy: { startsAt: string; endsAt: string }[];
  if (info.demo) {
    const d = demoCompany();
    busy = [
      ...d.appointments.filter((a) => a.resourceId === resource.id && a.status !== "cancelado"),
      ...d.blocks.filter((b) => b.resourceId === resource.id),
    ].map((x) => ({ startsAt: x.startsAt, endsAt: x.endsAt }));
  } else {
    const sb = anon();
    if (!sb) return [];
    const { data, error } = await sb.rpc("public_busy", {
      p_slug: p.data.slug.trim().toLowerCase(),
      p_resource: resource.id,
      p_from: from,
      p_to: to,
    });
    if (error) return [];
    busy = ((data ?? []) as { starts_at: string; ends_at: string }[]).map((b) => ({
      startsAt: b.starts_at,
      endsAt: b.ends_at,
    }));
  }
  return availableSlots({
    workHours: resource.workHours,
    busy,
    date: p.data.date,
    durationMin: service.durationMin,
    now: new Date(),
  });
}

const bookInput = z.object({
  slug: z.string(),
  serviceId: uuid,
  resourceId: uuid,
  startsAt: z.string().datetime({ offset: true }),
  name: z.string().trim().min(2, "Digite seu nome.").max(120),
  phone: z.string().trim().min(10, "Digite o celular com DDD.").max(30),
  requestId: z.string().uuid(),
});

export async function bookingConfirm(raw: z.input<typeof bookInput>): Promise<BookResult> {
  const p = bookInput.safeParse(raw);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? "Confira os dados." };
  const digits = p.data.phone.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digits.length < 10 || digits.length > 11) return { ok: false, message: "Digite o celular com DDD." };
  if (new Date(p.data.startsAt).getTime() > Date.now() + MAX_AHEAD_DAYS * 86_400_000)
    return { ok: false, message: "Escolha um horário em até 60 dias." };
  const info = await bookingInfo(p.data.slug);
  if (!info) return { ok: false, message: "Agendamento online indisponível." };
  if (info.demo) {
    // no exemplo, confere se o horário ainda está na lista e finge que marcou
    const date = new Date(new Date(p.data.startsAt).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
    const free = await bookingSlots({
      slug: p.data.slug,
      serviceId: p.data.serviceId,
      resourceId: p.data.resourceId,
      date,
    });
    if (!free.includes(new Date(p.data.startsAt).toISOString()))
      return { ok: false, message: "Este horário não está mais livre. Escolha outro." };
    return { ok: true, status: "agendado", demo: true };
  }
  const sb = anon();
  if (!sb) return { ok: false, message: "Agendamento online indisponível." };
  const { data, error } = await sb.rpc("public_book", {
    p_slug: p.data.slug.trim().toLowerCase(),
    p_service: p.data.serviceId,
    p_resource: p.data.resourceId,
    p_starts: p.data.startsAt,
    p_name: p.data.name,
    p_phone: p.data.phone,
    p_request: p.data.requestId,
  });
  if (error) {
    // mensagens escritas no banco para o público (P0001, P0002, 22023); o resto vira mensagem genérica
    const known = ["P0001", "P0002", "22023"].includes(error.code ?? "");
    return { ok: false, message: known ? error.message : "Não foi possível marcar agora. Tente de novo." };
  }
  const status = (data as { status?: string } | null)?.status === "confirmado" ? "confirmado" : "agendado";
  return { ok: true, status, demo: false };
}
