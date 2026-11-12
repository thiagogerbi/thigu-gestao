"use client";

import { useBackend } from "@/state/backend-context";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Monta links respeitando a base (/previa ou /app) e abre/fecha a ficha lateral via URL. */
export function useNav() {
  const { basePath } = useBackend();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const href = useCallback(
    (path: string, query?: Record<string, string | undefined>) => {
      const q = new URLSearchParams();
      Object.entries(query ?? {}).forEach(([k, v]) => v && q.set(k, v));
      const s = q.toString();
      return `${basePath}${path === "/" ? "" : path}${s ? `?${s}` : ""}` || "/";
    },
    [basePath],
  );

  /** Abre a ficha do cliente por cima da tela atual, mantendo filtros e rolagem. */
  const openClient = useCallback(
    (clientId: string, dealId?: string) => {
      const q = new URLSearchParams(params.toString());
      q.set("cliente", clientId);
      if (dealId) q.set("negociacao", dealId);
      else q.delete("negociacao");
      router.push(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const closeClient = useCallback(() => {
    const q = new URLSearchParams(params.toString());
    q.delete("cliente");
    q.delete("negociacao");
    const s = q.toString();
    router.push(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
  }, [params, pathname, router]);

  const setQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const q = new URLSearchParams(params.toString());
      Object.entries(patch).forEach(([k, v]) => (v ? q.set(k, v) : q.delete(k)));
      const s = q.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [params, pathname, router],
  );

  return { href, openClient, closeClient, setQuery, params, router, pathname };
}
