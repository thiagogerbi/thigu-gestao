"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { IconAlert, IconEdit, IconPlus } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { ClientSection } from "@/features/clients/client-section";
import { ExtraFieldsView } from "@/features/clients/extra-fields";
import { ITEM_KINDS } from "@/lib/domain/segments";
import type { ClientItem, ItemKind } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";

/** Pets do cliente na ficha: aviso em destaque, dados, e arquivar em vez de apagar. */
export function ClientItems({ clientId, kind, editable }: { clientId: string; kind: ItemKind; editable: boolean }) {
  const { data } = useBackend();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec, pending } = useAction();
  const info = ITEM_KINDS[kind];
  const all = data.items.filter((i) => i.clientId === clientId && i.kind === kind);
  const active = all.filter((i) => i.active);
  const archived = all.filter((i) => !i.active);
  const title = info.noun[1].charAt(0).toUpperCase() + info.noun[1].slice(1);

  async function setActive(item: ClientItem, value: boolean) {
    const r = await exec({ type: "item.setActive", id: item.id, active: value });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <ClientSection
      title={title}
      collapsible
      defaultOpen
      count={active.length}
      action={
        editable && (
          <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "item", clientId })}>
            <IconPlus className="h-4 w-4" /> Cadastrar {info.noun[0]}
          </Button>
        )
      }
    >
      {active.length === 0 ? (
        <p className="text-sm text-muted">Nenhum {info.noun[0]} cadastrado ainda.</p>
      ) : (
        <ul className="grid gap-3">
          {active.map((item) => (
            <li key={item.id} className="rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display text-base font-bold">{item.name}</p>
                {editable && (
                  <IconButton
                    label={`Editar ${item.name}`}
                    className="-mr-2 -mt-2"
                    onClick={() => dialogs.open({ kind: "item", clientId, itemId: item.id })}
                  >
                    <IconEdit />
                  </IconButton>
                )}
              </div>
              {item.alert && (
                <p className="mb-2 flex items-start gap-2 rounded-lg bg-warn-50 px-3 py-2 text-sm font-semibold text-warn">
                  <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <span className="sr-only">Atenção: </span>
                    {item.alert}
                  </span>
                </p>
              )}
              <ExtraFieldsView fields={info.fields} values={item.details} />
              {editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="-ml-2 mt-1"
                  disabled={pending}
                  onClick={() => setActive(item, false)}
                >
                  Arquivar {item.name}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {archived.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-sm font-semibold text-muted">Arquivados</p>
          <ul className="grid gap-2">
            {archived.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2">
                  {item.name} <Badge tone="gray">arquivado</Badge>
                </span>
                {editable && (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => setActive(item, true)}>
                    Voltar para a ficha
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ClientSection>
  );
}
