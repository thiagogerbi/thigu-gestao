"use client";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/styles";
import { localParts } from "@/lib/domain/agenda";
import { addDays } from "@/lib/domain/dates";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useAgenda } from "@/state/use-agenda";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";

/**
 * "Confirmar os horários de amanhã": um botão por horário que abre o WhatsApp com a mensagem pronta.
 * Não há envio automático; o sistema só anota que o lembrete foi aberto.
 */
export function RemindersPanel() {
  const { data, today } = useBackend();
  const ag = useAgenda();
  const t = useTerms();
  const nav = useNav();
  const { exec } = useAction();
  if (!ag.remindersOn) return null;
  const tomorrow = addDays(today, 1);
  const list = ag.onDay(tomorrow).filter((a) => a.status === "agendado" && ag.canManage(a));
  if (list.length === 0) return null;
  const pending = list.filter((a) => !a.remindedAt).length;

  return (
    <Card className="mb-5 border-primary/30 bg-primary-50 p-4" aria-labelledby="lembretes-amanha">
      <h2 id="lembretes-amanha" className="font-display text-base font-bold">
        Confirmar os horários de amanhã
      </h2>
      <p className="mb-3 text-sm text-muted">
        {pending > 0
          ? `${pending} ${pending === 1 ? "lembrete ainda não foi enviado" : "lembretes ainda não foram enviados"}. Toque para abrir o WhatsApp com a mensagem pronta.`
          : "Todos os lembretes foram abertos no WhatsApp. Quando a pessoa responder, toque em “Confirmar” no horário."}
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {list.map((a) => {
          const client = clientById(data, a.clientId);
          const url = ag.reminderUrl(a);
          return (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2.5">
              <span className="min-w-0">
                <span className="block font-semibold">
                  {localParts(a.startsAt).time} · {client?.name ?? t.Cliente}
                </span>
                <span className="block text-sm text-muted">
                  {[ag.itemName(a.itemId), ag.resourceName(a.resourceId)].filter(Boolean).join(" · ")}
                  {a.remindedAt ? " · lembrete aberto" : ""}
                </span>
              </span>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => exec({ type: "appointment.markReminded", id: a.id })}
                  className={buttonClass(a.remindedAt ? "ghost" : "secondary", "sm")}
                >
                  {a.remindedAt ? "Lembrar de novo" : "Lembrar pelo WhatsApp"}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => nav.openClient(a.clientId)}
                  className="text-sm font-semibold text-primary-700 underline-offset-2 hover:underline"
                >
                  Sem WhatsApp na ficha
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
