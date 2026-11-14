"use client";

import { localParts, reminderText } from "@/lib/domain/agenda";
import { canManageResource, usesAgenda } from "@/lib/domain/permissions";
import { whatsappUrl } from "@/lib/domain/phone";
import { moduleAvailable } from "@/lib/domain/segments";
import type { Appointment } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";

/** O que as telas da agenda precisam saber: se ela existe para a pessoa, onde ela pode marcar e os nomes. */
export function useAgenda() {
  const { data, me, today } = useBackend();
  const company = data.company;
  const enabled = moduleAvailable(company, "agenda") && usesAgenda(me.roles);
  const resourceById = (id: string) => data.resources.find((r) => r.id === id);
  /** Agendas em que a pessoa pode marcar. */
  const manageable = data.resources.filter((r) => r.active && canManageResource(me.roles, me.userId, r));
  const canManage = (ap: Appointment) => canManageResource(me.roles, me.userId, resourceById(ap.resourceId));
  const resourceName = (id: string) => resourceById(id)?.name ?? "—";
  const serviceName = (id: string | null) => (id ? (data.services.find((s) => s.id === id)?.name ?? null) : null);
  const itemName = (id: string | null) => (id ? (data.items.find((i) => i.id === id)?.name ?? null) : null);
  const remindersOn = moduleAvailable(company, "lembretes");

  /** Link do WhatsApp com a mensagem do lembrete pronta, ou null (sem telefone com DDD, ou módulo desligado). */
  function reminderUrl(ap: Appointment): string | null {
    if (!remindersOn) return null;
    const client = clientById(data, ap.clientId);
    if (!client) return null;
    const text = reminderText({
      segment: company.segment,
      companyName: company.name,
      clientName: client.name,
      startsAt: ap.startsAt,
      resourceName: resourceName(ap.resourceId),
      serviceName: serviceName(ap.serviceId),
      itemName: itemName(ap.itemId),
      today,
    });
    return whatsappUrl(client.phone, text);
  }

  const onDay = (date: string) =>
    data.appointments
      .filter((a) => localParts(a.startsAt).date === date)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return { enabled, manageable, canManage, resourceName, serviceName, itemName, remindersOn, reminderUrl, onDay };
}
