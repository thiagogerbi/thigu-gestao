"use client";

import { roleLabel, termsFor, type Terms } from "@/lib/domain/segments";
import type { Role } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";

/** Nomes do ramo da empresa aberta: "paciente" no lugar de "cliente", "Mecânico" no lugar de "Profissional"… */
export function useTerms(): Terms & {
  roleLabel: (role: Role) => string;
  roleLabels: (roles: readonly Role[]) => string;
} {
  const { data } = useBackend();
  const segment = data.company.segment;
  return {
    ...termsFor(segment),
    roleLabel: (role) => roleLabel(segment, role),
    roleLabels: (roles) => roles.map((r) => roleLabel(segment, r)).join(", "),
  };
}
