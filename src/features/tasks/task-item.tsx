"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { IconCheck } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { formatDateBR, relativeDayLabel } from "@/lib/domain/dates";
import { type Task } from "@/lib/domain/types";
import { useAction, useBackend, useMemberName } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";

export function TaskItem({ task, showClient = true }: { task: Task; showClient?: boolean }) {
  const { data, today, me } = useBackend();
  const name = useMemberName();
  const nav = useNav();
  const toast = useToast();
  const dialogs = useDialogs();
  const { exec, pending } = useAction();
  const client = clientById(data, task.clientId);
  const done = task.status === "concluida";
  const late = !done && task.dueDate < today;
  const isToday = !done && task.dueDate === today;

  async function toggle() {
    const r = await exec({ type: "task.setDone", id: task.id, done: !done });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <li
      className={cx(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl border bg-white p-3.5 shadow-card sm:flex-nowrap",
        late ? "border-[#f7c9c4]" : "border-line",
      )}
    >
      {/* no celular o texto ocupa a linha inteira e os botões descem, em vez de espremer o título */}
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <p className={cx("font-semibold", done && "text-muted line-through")}>{task.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          {late && <Badge tone="red">Atrasada · {relativeDayLabel(task.dueDate, today)}</Badge>}
          {isToday && <Badge tone="blue">Para hoje</Badge>}
          {!late && !isToday && (
            <span>
              {done ? `Concluída` : `Vence ${formatDateBR(task.dueDate)} (${relativeDayLabel(task.dueDate, today)})`}
            </span>
          )}
          {showClient && client && (
            <button
              type="button"
              onClick={() => nav.openClient(client.id, task.dealId ?? undefined)}
              className="font-medium text-primary-700 underline-offset-2 hover:underline"
            >
              {client.name}
            </button>
          )}
          <span>{task.assigneeId === me.userId ? "Você" : name(task.assigneeId)}</span>
        </p>
      </div>
      <div className="flex w-full justify-end gap-2 sm:w-auto">
        {!done && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => dialogs.open({ kind: "task", taskId: task.id })}
            aria-label={`Editar tarefa: ${task.title}`}
          >
            Editar
          </Button>
        )}
        <Button
          size="sm"
          variant={done ? "secondary" : "primary"}
          onClick={toggle}
          loading={pending}
          aria-label={done ? `Reabrir tarefa: ${task.title}` : `Concluir tarefa: ${task.title}`}
        >
          {!done && <IconCheck className="h-4 w-4" />}
          {done ? "Reabrir" : "Concluir tarefa"}
        </Button>
      </div>
    </li>
  );
}
