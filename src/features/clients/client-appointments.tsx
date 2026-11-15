"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import { AppointmentCard } from "@/features/agenda/appointment-card";
import { ClientSection } from "@/features/clients/client-section";
import { dayOf, isOpenStatus } from "@/lib/domain/agenda";
import { useBackend } from "@/state/backend-context";
import { useAgenda } from "@/state/use-agenda";

/** Horários do cliente na ficha: os próximos e os últimos atendimentos. */
export function ClientAppointments({ clientId }: { clientId: string }) {
  const { data, today } = useBackend();
  const ag = useAgenda();
  const dialogs = useDialogs();
  const all = data.appointments.filter((a) => a.clientId === clientId);
  const upcoming = all
    // os de hoje que ainda não foram encerrados continuam aqui, mesmo depois do horário
    .filter((a) => isOpenStatus(a.status) && dayOf(a) >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = all
    .filter((a) => !upcoming.includes(a))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 5);
  const absences = all.filter((a) => a.status === "faltou").length;

  return (
    <ClientSection
      title="Horários"
      collapsible
      defaultOpen
      count={upcoming.length}
      action={
        ag.manageable.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "appointment", clientId })}>
            <IconPlus className="h-4 w-4" /> Marcar horário
          </Button>
        )
      }
    >
      {upcoming.length === 0 ? (
        <p className="text-sm text-muted">Nenhum horário marcado.</p>
      ) : (
        <ul className="grid gap-2">
          {upcoming.map((a) => (
            <AppointmentCard key={a.id} ap={a} showDate showClient={false} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-sm font-semibold text-muted">
            Anteriores{absences > 0 ? ` · ${absences} ${absences === 1 ? "falta" : "faltas"}` : ""}
          </p>
          <ul className="grid gap-2">
            {past.map((a) => (
              <AppointmentCard key={a.id} ap={a} showDate showClient={false} />
            ))}
          </ul>
        </div>
      )}
    </ClientSection>
  );
}
