"use client";

import { can } from "@/lib/domain/permissions";
import { packageView, subscriptionState } from "@/lib/domain/recurring";
import { moduleAvailable } from "@/lib/domain/segments";
import { useBackend } from "@/state/backend-context";

/** Pacotes e mensalidades: o que está ligado para a empresa, o que a pessoa pode fazer, e as situações. */
export function useRecurring() {
  const { data, me, today } = useBackend();
  const packagesOn = moduleAvailable(data.company, "pacotes");
  const subscriptionsOn = moduleAvailable(data.company, "mensalidades");
  const canSell = can(me.roles, "recorrentes.vender");
  /** Só quem vê o financeiro sabe se a mensalidade está atrasada. */
  const seesMoney = can(me.roles, "financeiro.ver");
  const label = packagesOn && subscriptionsOn ? "Pacotes e mensalidades" : packagesOn ? "Pacotes" : "Mensalidades";

  const packagesOf = (clientId?: string) =>
    data.packages
      .filter((p) => !clientId || p.clientId === clientId)
      .map((p) => packageView(p, data.appointments, today))
      .sort(
        (a, b) =>
          Number(a.closed || a.expired) - Number(b.closed || b.expired) ||
          b.pkg.createdAt.localeCompare(a.pkg.createdAt),
      );

  const subscriptionsOf = (clientId?: string) =>
    data.subscriptions
      .filter((s) => !clientId || s.clientId === clientId)
      .map((s) => ({ sub: s, ...subscriptionState(s, data.accounts, data.movements, today) }))
      .sort(
        (a, b) =>
          Number(Boolean(a.sub.canceledAt)) - Number(Boolean(b.sub.canceledAt)) ||
          a.sub.name.localeCompare(b.sub.name, "pt-BR"),
      );

  return {
    packagesOn,
    subscriptionsOn,
    enabled: packagesOn || subscriptionsOn,
    canSell,
    seesMoney,
    label,
    packagesOf,
    subscriptionsOf,
  };
}
