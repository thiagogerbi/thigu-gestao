import { ThiguLogo } from "@/components/brand/thigu-logo";
import { CodesAdmin } from "@/features/activation/codes-admin";
import { listActivationCodes } from "@/lib/server/platform-actions";
import { supabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = { title: "Códigos de ativação", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Painel da equipe Thigu: gerar e acompanhar códigos de ativação. Invisível para clientes. */
export default async function Page() {
  if (!supabaseConfig()) notFound();
  const sb = (await createSupabaseServerClient())!;
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/entrar");
  const codes = await listActivationCodes();
  // quem não é da equipe vê "página não encontrada" (não revela que a área existe)
  if (!codes) notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ThiguLogo />
        <span className="rounded-full bg-navy px-3 py-1 text-sm font-semibold text-white">Equipe Thigu</span>
      </div>
      <CodesAdmin initialCodes={codes} appUrl={process.env.NEXT_PUBLIC_THIGU_APP_URL?.trim() || ""} />
    </main>
  );
}
