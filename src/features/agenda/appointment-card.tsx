"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { buttonClass, cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { dayOf, isOpenStatus, STATUS_LABEL, STATUS_TONE, timeRange } from "@/lib/domain/agenda";
import { formatDateTimeBR, formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import type { Appointment, AppointmentStatus } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useAgenda } from "@/state/use-agenda";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";

/**
 * Um horário da agenda, com as ações do dia a dia: confirmar, atendido, faltou, remarcar, cancelar
 * e lembrar pelo WhatsApp. Atendido, falta e cancelado só voltam atrás com "Desfazer".
 */
export function AppointmentCard({
  ap,
  showResource = false,
  showDate = false,
  showClient = true,
}: {
  ap: Appointment;
  showResource?: boolean;
  showDate?: boolean;
  showClient?: boolean;
}) {
  const { data } = useBackend();
  const ag = useAgenda();
  const t = useTerms();
  const nav = useNav();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec, pending } = useAction();
  const client = clientById(data, ap.clientId);
  const manage = ag.canManage(ap);
  const open = isOpenStatus(ap.status);
  const remind = open && manage ? ag.reminderUrl(ap) : null;
  const who = client?.name ?? t.Cliente;
  const details = [
    ag.itemName(ap.itemId),
    ag.serviceName(ap.serviceId),
    showResource ? ag.resourceName(ap.resourceId) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function setStatus(status: AppointmentStatus) {
    const r = await exec({ type: "appointment.setStatus", id: ap.id, status, charge: false });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }
  function cancel() {
    if (window.confirm(`Cancelar o horário de ${who} (${timeRange(ap)})?`)) setStatus("cancelado");
  }
  function undo() {
    const msg = ap.accountId
      ? "O atendimento volta para agendado e a conta a receber criada para ele será cancelada. Continuar?"
      : "O atendimento volta para agendado. Continuar?";
    if (window.confirm(msg)) setStatus("agendado");
  }

  return (
    <li
      className={cx(
        "rounded-xl border border-line bg-white p-3",
        ap.status === "cancelado" && "bg-canvas opacity-75",
        ap.status === "confirmado" && "border-l-4 border-l-navy",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold tabular text-muted">
            {showDate && `${formatShortDateBR(dayOf(ap))} · `}
            {timeRange(ap)}
          </p>
          {showClient ? (
            <button
              type="button"
              onClick={() => nav.openClient(ap.clientId)}
              className="min-h-8 text-left font-display text-base font-bold hover:underline"
            >
              {who}
            </button>
          ) : (
            <p className="font-display text-base font-bold">{ag.resourceName(ap.resourceId)}</p>
          )}
          {details && <p className="text-sm text-muted">{details}</p>}
          {ap.notes && <p className="mt-1 text-sm">{ap.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={STATUS_TONE[ap.status]}>{STATUS_LABEL[ap.status]}</Badge>
          {ap.priceCents > 0 && <span className="text-sm tabular text-muted">{formatBRL(ap.priceCents)}</span>}
        </div>
      </div>

      {manage && open && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label={`Ações do horário de ${who}`}>
          {ap.status === "agendado" && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setStatus("confirmado")}>
              Confirmar
            </Button>
          )}
          <Button size="sm" variant="money" disabled={pending} onClick={() => setStatus("compareceu")}>
            Atendido
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => dialogs.open({ kind: "noShow", appointmentId: ap.id })}
          >
            Faltou
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => dialogs.open({ kind: "appointment", appointmentId: ap.id })}
          >
            Remarcar
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>
            Cancelar
          </Button>
          {remind && (
            <a
              href={remind}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => exec({ type: "appointment.markReminded", id: ap.id })}
              className={buttonClass("ghost", "sm")}
            >
              {ap.remindedAt ? "Lembrar de novo" : "Lembrar pelo WhatsApp"}
            </a>
          )}
        </div>
      )}
      {manage && !open && (
        <Button size="sm" variant="ghost" className="mt-1 -ml-2" disabled={pending} onClick={undo}>
          Desfazer
        </Button>
      )}
      {open && ap.remindedAt && (
        <p className="mt-1 text-xs text-muted">Lembrete aberto no WhatsApp em {formatDateTimeBR(ap.remindedAt)}</p>
      )}
    </li>
  );
}
