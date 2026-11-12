"use client";

import type { Action, ActionResult } from "@/lib/actions/schemas";
import { can, type Capability } from "@/lib/domain/permissions";
import type { Company, CompanyData, ISODate, Member } from "@/lib/domain/types";
import { createContext, useCallback, useContext, useRef, useState } from "react";

/**
 * Interface única que as telas usam. Há duas implementações:
 *  - PreviewBackend (src/components/preview-backend.tsx): memória do navegador, dados fictícios;
 *  - RealBackend (src/components/real-backend.tsx): ações no servidor + Supabase com RLS.
 */
export interface BackendValue {
  mode: "previa" | "real";
  basePath: string;
  data: CompanyData;
  me: Member;
  companies: Company[];
  today: ISODate;
  switchCompany: (companyId: string) => void | Promise<void>;
  run: (action: Action) => Promise<ActionResult>;
  preview?: {
    personas: Member[];
    setPersona: (userId: string) => void;
    reset: () => void;
  };
  signOut?: () => void | Promise<void>;
}

const Ctx = createContext<BackendValue | null>(null);

export function BackendContext({ value, children }: { value: BackendValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBackend(): BackendValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBackend fora do provedor");
  return v;
}

export function useCan() {
  const { me } = useBackend();
  return (cap: Capability) => can(me.roles, cap);
}

export function useMemberName() {
  const { data } = useBackend();
  return (userId: string | null | undefined) => data.members.find((m) => m.userId === userId)?.name ?? "—";
}

/**
 * Executa uma ação com estado de carregamento, bloqueio de clique duplo e erros por campo.
 * Erros antigos são sempre limpos antes de nova tentativa e após sucesso (problema 1 da avaliação).
 */
export function useAction() {
  const { run } = useBackend();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const inFlight = useRef(false);

  const clear = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  const clearField = useCallback((key: string) => {
    setFieldErrors((f) => {
      if (!(key in f)) return f;
      const { [key]: _omit, ...rest } = f;
      return rest;
    });
    setError(null);
  }, []);

  const exec = useCallback(
    async (action: Action): Promise<ActionResult> => {
      if (inFlight.current) return { ok: false, message: "Aguarde, ainda estamos processando o pedido anterior." };
      inFlight.current = true;
      setPending(true);
      setError(null);
      setFieldErrors({});
      try {
        const r = await run(action);
        if (!r.ok) {
          setError(r.message);
          setFieldErrors(r.fieldErrors ?? {});
        }
        return r;
      } catch {
        const msg = "Não foi possível concluir agora. Verifique sua conexão e tente de novo.";
        setError(msg);
        return { ok: false, message: msg };
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [run],
  );

  return { exec, pending, error, fieldErrors, clear, clearField, setError };
}
