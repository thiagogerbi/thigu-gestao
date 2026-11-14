"use client";

/**
 * VERSÃO REAL: as ações vão para o servidor (src/lib/server/actions.ts), que valida papel e chama o
 * Supabase com a sessão do usuário. O banco aplica RLS e as funções transacionais.
 */
import type { Action } from "@/lib/actions/schemas";
import { toISODate } from "@/lib/domain/dates";
import type { Company, CompanyData, Member } from "@/lib/domain/types";
import { runAction, signOut, switchCompany } from "@/lib/server/actions";
import { BackendContext, type BackendValue } from "@/state/backend-context";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

export function RealBackend({
  initialData,
  me,
  companies,
  children,
}: {
  initialData: CompanyData;
  me: Member;
  companies: Company[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  // quando o servidor envia dados novos (router.refresh), eles substituem o estado local
  const [lastInitial, setLastInitial] = useState(initialData);
  if (initialData !== lastInitial) {
    setLastInitial(initialData);
    setData(initialData);
  }

  const run = useCallback(
    async (action: Action) => {
      const { result, data: fresh } = await runAction(data.company.id, action);
      if (fresh) setData(fresh);
      // o nome da empresa também aparece no seletor "Minha empresa", que vem do servidor
      if (result.ok && action.type === "company.saveProfile") router.refresh();
      return result;
    },
    [data.company.id, router],
  );

  const value: BackendValue = useMemo(
    () => ({
      mode: "real",
      basePath: "/app",
      data,
      me,
      companies,
      today: toISODate(new Date()),
      run,
      switchCompany: async (id) => {
        if (await switchCompany(id)) {
          router.push("/app");
          router.refresh();
        }
      },
      signOut: async () => {
        await signOut();
        router.push("/entrar");
        router.refresh();
      },
    }),
    [data, me, companies, run, router],
  );
  return <BackendContext value={value}>{children}</BackendContext>;
}
