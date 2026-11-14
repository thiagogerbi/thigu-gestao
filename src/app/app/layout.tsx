import { ThiguLogo } from "@/components/brand/thigu-logo";
import { AppShell } from "@/components/layout/app-shell";
import { CreateCompanyForm } from "@/features/auth/create-company-form";
import { SignOutButton } from "@/features/auth/sign-out-button";
import { COMPANY_COOKIE } from "@/lib/server/constants";
import { loadCompanyData, loadMemberships } from "@/lib/server/load";
import { supabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RealBackend } from "@/state/real-backend";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };
export const dynamic = "force-dynamic";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <ThiguLogo />
        </div>
        {children}
      </div>
    </main>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!supabaseConfig()) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Configuração pendente</h1>
        <p className="mt-2 text-muted">
          A versão real precisa de um projeto Supabase. Copie <code>.env.example</code> para <code>.env.local</code>,
          preencha a URL e a chave pública e aplique as migrações de <code>supabase/migrations</code>. O passo a passo
          está no README.
        </p>
        <p className="mt-4">
          <a className="font-semibold text-primary-700 underline" href="/previa">
            Enquanto isso, experimente a prévia com dados fictícios
          </a>
        </p>
      </Centered>
    );
  }
  const sb = (await createSupabaseServerClient())!;
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/entrar");

  const memberships = await loadMemberships(sb, auth.user.id);
  if (memberships.length === 0) {
    return (
      <Centered>
        <h1 className="text-xl font-bold">Vamos cadastrar sua empresa</h1>
        <p className="mb-4 mt-1 text-muted">
          Use o código de ativação que chegou no seu e-mail depois da compra. Você será o administrador e poderá
          convidar sua equipe depois.
        </p>
        <CreateCompanyForm salesContact={process.env.NEXT_PUBLIC_THIGU_SALES_URL?.trim() || undefined} />
        <div className="mt-6 border-t border-line pt-4 text-sm text-muted">
          <p>
            Você entrou como <strong className="text-ink">{auth.user.email}</strong>. Se alguém da sua empresa já usa o
            Thigu, peça para adicionar este e-mail em “Minha empresa” — aí não é preciso código.
          </p>
          <SignOutButton />
        </div>
      </Centered>
    );
  }
  const chosen = (await cookies()).get(COMPANY_COOKIE)?.value;
  const current = memberships.find((m) => m.companyId === chosen) ?? memberships[0];
  const data = await loadCompanyData(sb, current.companyId);
  const me = data.members.find((m) => m.userId === auth.user.id) ?? {
    userId: auth.user.id,
    name: auth.user.email ?? "Você",
    email: auth.user.email ?? "",
    roles: current.roles,
  };

  return (
    <RealBackend
      initialData={data}
      me={me}
      companies={memberships.map((m) => ({ id: m.companyId, name: m.companyName }))}
    >
      <AppShell>{children}</AppShell>
    </RealBackend>
  );
}
