"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { ClientSection } from "@/features/clients/client-section";
import { TaskItem } from "@/features/tasks/task-item";
import { relativeDayLabel } from "@/lib/domain/dates";
import { canEditDeal } from "@/lib/domain/permissions";
import type { Deal, Task } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";

/** A próxima ação combinada com o cliente (vem da negociação) e as tarefas em aberto. */
export function ClientNextAction({
  nextAction,
  tasks,
  hasOpenDeals,
}: {
  nextAction: Deal | undefined;
  tasks: Task[];
  hasOpenDeals: boolean;
}) {
  const { me, today } = useBackend();
  const dialogs = useDialogs();
  return (
    <ClientSection title="Próxima ação">
      {nextAction ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-semibold">{nextAction.nextAction}</p>
            <p className="text-sm text-muted">
              {nextAction.title}
              {nextAction.nextActionDate && (
                <>
                  {" "}
                  ·{" "}
                  {nextAction.nextActionDate < today ? (
                    <span className="font-semibold text-danger">
                      atrasada ({relativeDayLabel(nextAction.nextActionDate, today)})
                    </span>
                  ) : (
                    relativeDayLabel(nextAction.nextActionDate, today)
                  )}
                </>
              )}
            </p>
          </div>
          {canEditDeal(me.roles, me.userId, nextAction) && (
            <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "deal", dealId: nextAction.id })}>
              Alterar próxima ação
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Nenhuma próxima ação definida. {hasOpenDeals ? "Defina uma na negociação para não esquecer o cliente." : ""}
        </p>
      )}
      {tasks.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {tasks.map((t) => (
            <TaskItem key={t.id} task={t} showClient={false} />
          ))}
        </ul>
      )}
    </ClientSection>
  );
}
