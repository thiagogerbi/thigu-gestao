"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import { relativeDayLabel } from "@/lib/domain/dates";
import { isOpenStage } from "@/lib/domain/deals";
import { formatBRL } from "@/lib/domain/money";
import { useBackend, useCan, useMemberName } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function ClientsScreen() {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const nav = useNav();
  const dialogs = useDialogs();
  const [q, setQ] = useState(nav.params.get("busca") ?? "");
  const owner = nav.params.get("responsavel") ?? "";
  const term = norm(q.trim());
  const digits = q.replace(/\D/g, "");

  const rows = data.clients
    .filter((c) => !owner || c.ownerId === owner)
    .filter(
      (c) =>
        !term ||
        norm(c.name).includes(term) ||
        norm(c.email).includes(term) ||
        (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)),
    )
    .map((c) => {
      const open = data.deals.filter((d) => d.clientId === c.id && isOpenStage(d.stage));
      const next = open
        .filter((d) => d.nextAction)
        .sort((a, b) => (a.nextActionDate ?? "9").localeCompare(b.nextActionDate ?? "9"))[0];
      return { c, open, next, pipeline: open.reduce((s, d) => s + d.valueCents, 0) };
    })
    .sort((a, b) => a.c.name.localeCompare(b.c.name, "pt-BR"));

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Pessoas e empresas com quem você conversa. Clique em um cliente para ver tudo sobre ele."
        actions={
          canDo("crm.editar_proprios") && (
            <Button onClick={() => dialogs.open({ kind: "client" })}>
              <IconPlus className="h-5 w-5" /> Novo cliente
            </Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_240px]">
        <div className="relative">
          <TextField
            label="Buscar cliente"
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              nav.setQuery({ busca: e.target.value || null });
            }}
            placeholder="Nome, e-mail ou telefone"
            className="pl-10"
          />
          <IconSearch className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-muted" />
        </div>
        {canDo("crm.ver_todos") && (
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Responsável</span>
            <select
              value={owner}
              onChange={(e) => nav.setQuery({ responsavel: e.target.value || null })}
              className="min-h-11 w-full rounded-lg border border-[#c5cfdf] bg-white px-3"
            >
              <option value="">Todos</option>
              {data.members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <p className="mb-2 text-sm text-muted" role="status">
        {rows.length} {rows.length === 1 ? "cliente" : "clientes"}
        {q ? ` encontrados para “${q}”` : ""}
      </p>

      {data.clients.length === 0 ? (
        <EmptyState
          title="Nenhum cliente ainda"
          action={
            canDo("crm.editar_proprios") && (
              <Button onClick={() => dialogs.open({ kind: "client" })}>Cadastrar primeiro cliente</Button>
            )
          }
        >
          Comece cadastrando alguém com quem você já conversa. Só o nome é obrigatório.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nenhum cliente encontrado"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                nav.setQuery({ busca: null, responsavel: null });
              }}
            >
              Limpar busca
            </Button>
          }
        >
          Confira a grafia ou busque por parte do nome.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ c, open, next, pipeline }) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => nav.openClient(c.id)}
                className="flex h-full w-full flex-col rounded-xl border border-line bg-white p-4 text-left hover:border-primary hover:shadow-md"
                aria-label={`Abrir ficha de ${c.name}`}
              >
                <span className="flex w-full items-start justify-between gap-2">
                  <span className="font-display text-[17px] font-bold">{c.name}</span>
                  {c.ownerId === me.userId && <Badge tone="blue">Seu cliente</Badge>}
                </span>
                <span className="text-sm text-muted">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "Sem contato cadastrado"}
                </span>
                <span className="mt-2 text-sm">Responsável: {name(c.ownerId)}</span>
                <span className="mt-1 text-sm">
                  {open.length ? (
                    <>
                      {open.length} {open.length === 1 ? "negociação aberta" : "negociações abertas"} ·{" "}
                      <span className="tabular">{formatBRL(pipeline)}</span>
                    </>
                  ) : (
                    <span className="text-muted">Sem negociação aberta</span>
                  )}
                </span>
                {next && (
                  <span
                    className={
                      next.nextActionDate && next.nextActionDate < today
                        ? "mt-2 text-sm font-semibold text-danger"
                        : "mt-2 text-sm text-ink"
                    }
                  >
                    Próxima ação: {next.nextAction}
                    {next.nextActionDate ? ` (${relativeDayLabel(next.nextActionDate, today)})` : ""}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
