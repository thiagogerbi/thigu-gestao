"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/card";
import { IconPlus } from "@/components/ui/icons";
import { cx, keepInView } from "@/components/ui/styles";
import { onTabListKeyDown } from "@/components/ui/tabs";
import { TaskItem } from "@/features/tasks/task-item";
import { useBackend, useCan } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";

const FILTERS = [
  { id: "hoje", label: "Hoje" },
  { id: "atrasadas", label: "Atrasadas" },
  { id: "proximas", label: "Próximas" },
  { id: "concluidas", label: "Concluídas" },
  { id: "todas", label: "Todas em aberto" },
] as const;

export function TasksScreen() {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const nav = useNav();
  const dialogs = useDialogs();
  const filter = (nav.params.get("filtro") ?? "todas") as (typeof FILTERS)[number]["id"];
  const deParam = nav.params.get("de");
  const who = deParam === "todos" ? "" : (deParam ?? (canDo("crm.ver_todos") ? "" : me.userId));

  const base = data.tasks.filter((t) => !who || t.assigneeId === who);
  const open = base.filter((t) => t.status === "aberta");
  const counts = {
    hoje: open.filter((t) => t.dueDate === today).length,
    atrasadas: open.filter((t) => t.dueDate < today).length,
    proximas: open.filter((t) => t.dueDate > today).length,
    concluidas: base.filter((t) => t.status === "concluida").length,
    todas: open.length,
  };
  const list = (
    filter === "hoje"
      ? open.filter((t) => t.dueDate === today)
      : filter === "atrasadas"
        ? open.filter((t) => t.dueDate < today)
        : filter === "proximas"
          ? open.filter((t) => t.dueDate > today)
          : filter === "concluidas"
            ? base.filter((t) => t.status === "concluida")
            : open
  ).sort((a, b) =>
    filter === "concluidas"
      ? (b.completedAt ?? "").localeCompare(a.completedAt ?? "")
      : a.dueDate.localeCompare(b.dueDate),
  );

  return (
    <>
      <PageHeader
        title="Tarefas"
        description="Combinados e lembretes. Conclua com o botão “Concluir tarefa”."
        actions={
          <Button onClick={() => dialogs.open({ kind: "task" })}>
            <IconPlus className="h-5 w-5" /> Nova tarefa
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div
          role="tablist"
          aria-label="Filtrar tarefas"
          onKeyDown={onTabListKeyDown}
          className="no-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              id={`aba-tarefas-${f.id}`}
              aria-controls="painel-tarefas"
              tabIndex={filter === f.id ? 0 : -1}
              aria-selected={filter === f.id}
              ref={filter === f.id ? keepInView : undefined}
              onClick={() => nav.setQuery({ filtro: f.id === "todas" ? null : f.id })}
              className={cx(
                "min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-semibold sm:min-h-10",
                filter === f.id ? "bg-primary text-white" : "text-ink hover:bg-canvas",
                f.id === "atrasadas" && counts.atrasadas > 0 && filter !== f.id && "text-danger",
              )}
            >
              {f.label} ({counts[f.id]})
            </button>
          ))}
        </div>
        <label className="text-sm">
          <span className="mb-1 block font-semibold">Responsável</span>
          <select
            value={who}
            onChange={(e) => nav.setQuery({ de: e.target.value || "todos" })}
            className="min-h-10 rounded-lg border border-[#c5cfdf] bg-white px-2"
          >
            <option value="">Todos</option>
            {data.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === me.userId ? `Você (${m.name})` : m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="tabpanel" id="painel-tarefas" aria-labelledby={`aba-tarefas-${filter}`}>
        {list.length === 0 ? (
          <EmptyState
            title={
              filter === "atrasadas"
                ? "Nenhuma tarefa atrasada"
                : filter === "hoje"
                  ? "Nada para hoje"
                  : "Nenhuma tarefa aqui"
            }
          >
            {filter === "concluidas"
              ? "Tarefas concluídas aparecem aqui."
              : "Crie tarefas para lembrar de ligar, enviar algo ou cobrar um retorno."}
          </EmptyState>
        ) : (
          <ul className="grid gap-2">
            {list.map((t) => (
              <TaskItem key={t.id} task={t} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
