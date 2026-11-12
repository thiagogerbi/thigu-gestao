import { ThiguLogo } from "@/components/brand/thigu-logo";
import { LoginForm } from "@/features/auth/login-form";
import { supabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const cfg = supabaseConfig();
  if (cfg) {
    const sb = await createSupabaseServerClient();
    const { data } = await sb!.auth.getUser();
    if (data.user) redirect("/app");
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <ThiguLogo />
        </div>
        {cfg ? (
          <LoginForm url={cfg.url} anonKey={cfg.anonKey} />
        ) : (
          <p className="text-muted">
            O login ainda não foi configurado nesta instalação (faltam as variáveis do Supabase). Veja o README.
          </p>
        )}
        <p className="mt-6 text-center text-sm text-muted">
          Só quer conhecer?{" "}
          <Link href="/previa" className="font-semibold text-primary-700 underline">
            Abrir a prévia com dados fictícios
          </Link>
        </p>
      </div>
    </main>
  );
}
