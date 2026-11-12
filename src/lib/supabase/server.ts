import { supabaseConfig } from "@/lib/supabase/config";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import "server-only";

/** Cliente do Supabase no servidor, autenticado com a sessão (cookie) do usuário. */
export async function createSupabaseServerClient() {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // chamado a partir de um Server Component: o proxy atualiza a sessão
        }
      },
    },
  });
}

export type ServerSupabase = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
