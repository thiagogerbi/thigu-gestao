"use client";

/**
 * PRÉVIA: tudo acontece na memória deste navegador, com dados fictícios.
 * Não conversa com servidor, banco ou Supabase. Recarregar a página restaura o exemplo.
 */
import type { Action } from "@/lib/actions/schemas";
import { toISODate } from "@/lib/domain/dates";
import type { CompanyData } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction } from "@/lib/preview/engine";
import { buildPreviewSeed, PREVIEW_COMPANY_IDS } from "@/lib/preview/seed";
import { BackendContext, type BackendValue } from "@/state/backend-context";
import { useCallback, useMemo, useRef, useState } from "react";

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

export function PreviewBackend({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<CompanyData[]>(() => buildPreviewSeed());
  const [companyId, setCompanyId] = useState<string>(PREVIEW_COMPANY_IDS.aurora);
  const [personaByCompany, setPersonaByCompany] = useState<Record<string, string>>({});
  const processed = useRef(new Map());

  const current = companies.find((c) => c.company.id === companyId) ?? companies[0];
  const personaId =
    personaByCompany[current.company.id] ?? current.members.find((m) => m.roles.includes("admin"))!.userId;
  const me = current.members.find((m) => m.userId === personaId)!;

  // fonte da verdade para as ações (atualizada junto com o estado em run/reset)
  const companiesRef = useRef(companies);

  const run = useCallback(
    async (action: Action) => {
      // pequena espera para que os estados de carregamento sejam visíveis e testáveis
      await new Promise((r) => setTimeout(r, 250));
      const all = companiesRef.current;
      const idx = all.findIndex((c) => c.company.id === current.company.id);
      const { data, result } = applyAction(all[idx], me, action, {
        now: new Date(),
        newId,
        processed: processed.current,
      });
      if (result.ok) {
        const next = all.slice();
        next[idx] = data;
        companiesRef.current = next;
        setCompanies(next);
      }
      return result;
    },
    [current.company.id, me],
  );

  const value: BackendValue = useMemo(
    () => ({
      mode: "previa",
      basePath: "/previa",
      data: visibleData(current, me),
      me,
      companies: companies.filter((c) => c.members.some((m) => m.userId === "u-ana")).map((c) => c.company),
      today: toISODate(new Date()),
      switchCompany: (id) => setCompanyId(id),
      run,
      preview: {
        personas: current.members,
        setPersona: (userId) => setPersonaByCompany((p) => ({ ...p, [current.company.id]: userId })),
        reset: () => {
          const seed = buildPreviewSeed();
          companiesRef.current = seed;
          processed.current.clear();
          setCompanies(seed);
          setPersonaByCompany({});
        },
      },
    }),
    [current, me, companies, run],
  );

  return <BackendContext value={value}>{children}</BackendContext>;
}
