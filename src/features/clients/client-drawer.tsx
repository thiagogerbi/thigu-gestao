"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/fields";
import { IconDoc, IconEdit, IconMail, IconPhone, IconPlus } from "@/components/ui/icons";
import { Drawer } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { StageSelect } from "@/features/deals/stage-select";
import { AccountCard } from "@/features/finance/account-card";
import { TaskItem } from "@/features/tasks/task-item";
import { formatDateBR, formatDateTimeBR, relativeDayLabel } from "@/lib/domain/dates";
import { daysInStage, isOpenStage, staleReason } from "@/lib/domain/deals";
import { formatBRL } from "@/lib/domain/money";
import { canEditClient, canEditDeal } from "@/lib/domain/permissions";
import { proposalTotalCents } from "@/lib/domain/proposals";
import { PROPOSAL_STATUS_LABEL, STAGE_LABEL } from "@/lib/domain/types";
import { useAction, useBackend, useCan, useMemberName } from "@/state/backend-context";
import { accountView, clientById, saleForDeal } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import Link from "next/link";
import { useEffect, useState } from "react";

const NOTE_FIELD_ID = "ficha-anotacao";

/**
 * Seção da ficha. Com `collapsible`, vira um bloco que abre e fecha (nativo e acessível),
 * mostrando no título quantos itens há dentro — a ficha fica curta e a pessoa abre só o que precisa.
 */
function Section({
  title,
  children,
  action,
  id,
  collapsible = false,
  defaultOpen = false,
  count,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  count?: number;
}) {
  if (collapsible) {
    return (
      <details open={defaultOpen} className="group mb-3 rounded-xl border border-line bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-display text-base font-bold [&::-webkit-details-marker]:hidden">
          <span>
            {title}
            {count !== undefined && <span className="ml-2 font-sans text-sm font-semibold text-muted">({count})</span>}
          </span>
          <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="px-4 pb-4">
          {action && <div className="mb-3">{action}</div>}
          {children}
        </div>
      </details>
    );
  }
  return (
    <Card className="mb-3 p-4" aria-labelledby={id}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id={id} className="font-display text-base font-bold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function ClientDrawer() {
  const nav = useNav();
  const clientId = nav.params.get("cliente");
  const focusDeal = nav.params.get("negociacao");
  const { data } = useBackend();
  const client = clientById(data, clientId);
  if (!clientId) return null;
  if (!client) {
    return (
      <Drawer open onClose={nav.closeClient} title="Cliente não encontrado">
        <p>Este cliente não existe nesta empresa ou você não tem acesso a ele.</p>
      </Drawer>
    );
  }
  return <ClientDrawerBody key={client.id} clientId={client.id} focusDeal={focusDeal} />;
}

function ClientDrawerBody({ clientId, focusDeal }: { clientId: string; focusDeal: string | null }) {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const nav = useNav();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec, pending, error, clear } = useAction();
  const [note, setNote] = useState("");
  const [noteDeal, setNoteDeal] = useState(focusDeal ?? "");
  const client = clientById(data, clientId)!;
  const deals = data.deals
    .filter((d) => d.clientId === clientId)
    .sort(
      (a, b) => Number(isOpenStage(b.stage)) - Number(isOpenStage(a.stage)) || b.updatedAt.localeCompare(a.updatedAt),
    );
  const proposals = data.proposals.filter((p) => p.clientId === clientId).sort((a, b) => b.number - a.number);
  const tasks = data.tasks
    .filter((t) => t.clientId === clientId && t.status === "aberta")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const accounts = data.accounts
    .filter((a) => a.clientId === clientId)
    .map((a) => accountView(data, a, today))
    .sort((a, b) => a.account.dueDate.localeCompare(b.account.dueDate));
  const sales = data.sales.filter((s) => s.clientId === clientId && s.status !== "cancelada");
  const editable = canEditClient(me.roles, me.userId, client);
  const mayNote = editable || canDo("financeiro.registrar");
  const showMoney = canDo("financeiro.ver") || canDo("recebiveis.ver_proprios");
  const openDeals = deals.filter((d) => isOpenStage(d.stage));
  const nextAction = openDeals
    .filter((d) => d.nextAction)
    .sort((a, b) => (a.nextActionDate ?? "9999").localeCompare(b.nextActionDate ?? "9999"))[0];

  const timeline = [
    ...data.activities
      .filter((a) => a.clientId === clientId)
      .map((a) => ({ id: a.id, at: a.createdAt, who: a.actorId, text: a.description, kind: "evento" as const })),
    ...data.notes
      .filter((n) => n.clientId === clientId)
      .map((n) => ({ id: n.id, at: n.createdAt, who: n.authorId, text: n.body, kind: "anotacao" as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  useEffect(() => {
    if (!focusDeal) return;
    const el = document.getElementById(`ficha-neg-${focusDeal}`);
    el?.scrollIntoView({ block: "center" });
  }, [focusDeal]);

  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({ type: "note.add", clientId, dealId: noteDeal || null, body: note });
    if (r.ok) {
      setNote("");
      toast({ tone: "success", text: "Anotação registrada no histórico." });
    }
  }

  const totalSold = sales.reduce((s, x) => s + x.totalCents, 0);
  const received = accounts.reduce((s, v) => s + v.settled, 0);
  const open = accounts.reduce((s, v) => s + v.balance, 0);

  function focusNote() {
    const el = document.getElementById(NOTE_FIELD_ID);
    el?.closest("details")?.setAttribute("open", "");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus();
  }

  // Uma única sugestão, do mais urgente para o mais simples
  const awaitingSale = sales.find((s) => s.status === "aguardando_conferencia");
  const overdue = accounts.find((v) => v.status === "atrasada");
  const sentProposal = proposals.find((p) => p.status === "enviada");
  let suggestion: { text: string; cta: string; run: () => void; money?: boolean } | null = null;
  if (awaitingSale && canDo("venda.conferir")) {
    suggestion = {
      text: `A venda de ${formatBRL(awaitingSale.totalCents)} está esperando você confirmar as parcelas.`,
      cta: "Confirmar parcelas",
      run: () => dialogs.open({ kind: "reviewSale", saleId: awaitingSale.id }),
      money: true,
    };
  } else if (overdue && canDo("financeiro.registrar")) {
    suggestion = {
      text: `Tem uma parcela atrasada: faltam ${formatBRL(overdue.balance)}. Se ${client.name.split(" ")[0]} já pagou, registre aqui.`,
      cta: "Registrar recebimento",
      run: () => dialogs.open({ kind: "settle", accountId: overdue.account.id, accountKind: "receber" }),
      money: true,
    };
  } else if (sentProposal && editable) {
    suggestion = {
      text: `A proposta nº ${sentProposal.number} ainda está sem resposta. Que tal ligar e perguntar?`,
      cta: "Ver proposta",
      run: () => nav.router.push(nav.href(`/propostas/${sentProposal.id}`)),
    };
  } else if (openDeals.length === 0 && editable) {
    suggestion = {
      text: "Nenhuma venda em conversa com este cliente agora.",
      cta: "Começar uma negociação",
      run: () => dialogs.open({ kind: "deal", clientId }),
    };
  } else if (mayNote) {
    suggestion = {
      text: "Conversou com o cliente? Anote o que foi combinado para não esquecer.",
      cta: "Anotar conversa",
      run: focusNote,
    };
  }

  return (
    <Drawer
      open
      onClose={() => {
        if (note.trim() && !window.confirm("Você escreveu uma anotação que ainda não foi salva. Fechar mesmo assim?"))
          return;
        nav.closeClient();
      }}
      title={client.name}
      subtitle={<>Responsável: {name(client.ownerId)}</>}
      headerActions={
        editable && (
          <IconButton
            label={`Editar dados de ${client.name}`}
            onClick={() => dialogs.open({ kind: "client", clientId })}
          >
            <IconEdit />
          </IconButton>
        )
      }
    >
      {/* Uma única sugestão clara, depois atalhos menores */}
      {suggestion && (
        <div data-tour="proximo-passo" className="mb-3 rounded-xl border-2 border-primary bg-primary-50 p-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary-700">O que fazer agora</p>
          <p className="mt-1 text-base">{suggestion.text}</p>
          <Button
            className="mt-3 w-full sm:w-auto"
            variant={suggestion.money ? "money" : "primary"}
            onClick={suggestion.run}
          >
            {suggestion.cta}
          </Button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-x-1 gap-y-1" aria-label="Outras ações">
        {mayNote && (
          <Button size="sm" variant="ghost" onClick={focusNote}>
            Anotar conversa
          </Button>
        )}
        {editable && (
          <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "deal", clientId })}>
            <IconPlus className="h-4 w-4" /> Nova negociação
          </Button>
        )}
        {editable && openDeals.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              dialogs.open({ kind: "proposal", clientId, dealId: openDeals.length === 1 ? openDeals[0].id : undefined })
            }
          >
            <IconDoc className="h-4 w-4" /> Preparar proposta
          </Button>
        )}
        {mayNote && (
          <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "task", clientId })}>
            Nova tarefa
          </Button>
        )}
      </div>

      {/* Resumo */}
      <Section title="Resumo do relacionamento">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Cliente desde</dt>
            <dd className="font-semibold">{formatDateBR(client.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">Negociações abertas</dt>
            <dd className="font-semibold">{openDeals.length}</dd>
          </div>
          <div>
            <dt className="text-muted">Vendas fechadas</dt>
            <dd className="font-semibold tabular">{formatBRL(totalSold)}</dd>
          </div>
          {showMoney && (
            <div>
              <dt className="text-muted">Recebido · em aberto</dt>
              <dd className="font-semibold tabular">
                <span className="text-money-700">{formatBRL(received)}</span> · {formatBRL(open)}
              </dd>
            </div>
          )}
        </dl>
      </Section>

      {/* Próxima ação */}
      <Section title="Próxima ação">
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
              <Button
                size="sm"
                variant="secondary"
                onClick={() => dialogs.open({ kind: "deal", dealId: nextAction.id })}
              >
                Alterar próxima ação
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">
            Nenhuma próxima ação definida.{" "}
            {openDeals.length > 0 ? "Defina uma na negociação para não esquecer o cliente." : ""}
          </p>
        )}
        {tasks.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {tasks.map((t) => (
              <TaskItem key={t.id} task={t} showClient={false} />
            ))}
          </ul>
        )}
      </Section>

      {/* Contato */}
      <Section title="Contato" collapsible defaultOpen>
        <ul className="grid gap-2 text-base">
          <li className="flex items-center gap-2">
            <IconMail className="h-4 w-4 text-muted" />
            {client.email ? (
              <a className="text-primary-700 underline-offset-2 hover:underline" href={`mailto:${client.email}`}>
                {client.email}
              </a>
            ) : (
              <span className="text-muted">Sem e-mail</span>
            )}
          </li>
          <li className="flex items-center gap-2">
            <IconPhone className="h-4 w-4 text-muted" />
            {client.phone ? (
              <a
                className="text-primary-700 underline-offset-2 hover:underline"
                href={`tel:${client.phone.replace(/\D/g, "")}`}
              >
                {client.phone}
              </a>
            ) : (
              <span className="text-muted">Sem telefone</span>
            )}
          </li>
        </ul>
      </Section>

      {/* Negociações */}
      <Section
        title="Negociações"
        collapsible
        count={deals.length}
        defaultOpen={Boolean(focusDeal) || deals.length <= 2}
        action={
          editable && (
            <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "deal", clientId })}>
              Adicionar
            </Button>
          )
        }
      >
        {deals.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma negociação ainda.</p>
        ) : (
          <ul className="grid gap-3">
            {deals.map((d) => {
              const sale = saleForDeal(data, d.id);
              const stale = staleReason(d, today);
              const mayEdit = canEditDeal(me.roles, me.userId, d);
              return (
                <li
                  key={d.id}
                  id={`ficha-neg-${d.id}`}
                  className={cx(
                    "rounded-lg border p-3",
                    d.id === focusDeal ? "border-primary bg-primary-50/40 ring-2 ring-primary/20" : "border-line",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{d.title}</p>
                      <p className="text-sm text-muted tabular">
                        {formatBRL(d.valueCents)} · {name(d.ownerId)} ·{" "}
                        {isOpenStage(d.stage)
                          ? `${daysInStage(d, today)} dias em ${STAGE_LABEL[d.stage]}`
                          : STAGE_LABEL[d.stage]}
                      </p>
                      {d.expectedClose && isOpenStage(d.stage) && (
                        <p className="text-sm text-muted">Previsão de fechamento: {formatDateBR(d.expectedClose)}</p>
                      )}
                      {d.lostReason && <p className="text-sm">Motivo da perda: {d.lostReason}</p>}
                    </div>
                    {stale && <Badge tone="amber">{stale}</Badge>}
                    {sale && (
                      <Badge tone={sale.status === "confirmada" ? "green" : "amber"}>
                        {sale.status === "confirmada" ? "Parcelas confirmadas" : "Parcelas a confirmar"}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {isOpenStage(d.stage) && (
                      <div className="w-full sm:w-52">
                        <StageSelect deal={d} />
                      </div>
                    )}
                    {mayEdit && isOpenStage(d.stage) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => dialogs.open({ kind: "proposal", dealId: d.id })}
                      >
                        Preparar proposta
                      </Button>
                    )}
                    {mayEdit && isOpenStage(d.stage) && (
                      <Button
                        size="sm"
                        variant="money"
                        onClick={() => dialogs.open({ kind: "closeSale", dealId: d.id })}
                      >
                        Fechar venda
                      </Button>
                    )}
                    {sale?.status === "aguardando_conferencia" && (
                      <Button
                        size="sm"
                        variant={canDo("venda.conferir") ? "money" : "secondary"}
                        onClick={() => dialogs.open({ kind: "reviewSale", saleId: sale.id })}
                      >
                        {canDo("venda.conferir") ? "Confirmar parcelas" : "Ver situação da venda"}
                      </Button>
                    )}
                    {mayEdit && (
                      <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "deal", dealId: d.id })}>
                        Editar
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* Propostas */}
      <Section title="Propostas" collapsible count={proposals.length}>
        {proposals.length === 0 ? (
          <p className="text-sm text-muted">
            Nenhuma proposta. {openDeals.length ? "Use “Preparar proposta” para montar uma." : ""}
          </p>
        ) : (
          <ul className="grid gap-2">
            {proposals.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
              >
                <div>
                  <p className="font-semibold">
                    Proposta nº {p.number} ·{" "}
                    <span className="tabular">{formatBRL(proposalTotalCents(p.items, p.discountCents))}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {PROPOSAL_STATUS_LABEL[p.status]} · válida até {formatDateBR(p.validUntil)}
                  </p>
                </div>
                <Link
                  href={nav.href(`/propostas/${p.id}`)}
                  className="inline-flex min-h-9 items-center rounded-lg px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50"
                >
                  Ver proposta
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Parcelas */}
      {showMoney && (
        <Section title="Parcelas e pagamentos" collapsible count={accounts.length} defaultOpen={Boolean(overdue)}>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">
              {sales.some((s) => s.status === "aguardando_conferencia")
                ? "Há venda esperando o financeiro confirmar as parcelas. Elas aparecem aqui depois."
                : "Nenhuma parcela ainda."}
            </p>
          ) : (
            <ul className="grid gap-3">
              {accounts.map((v) => (
                <AccountCard key={v.account.id} view={v} showParty={false} />
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* Anotações + histórico */}
      <Section title="Anotações e histórico" id="ficha-historico">
        {mayNote && (
          <form onSubmit={saveNote} className="mb-4 grid gap-2">
            <TextAreaField
              id={NOTE_FIELD_ID}
              label="O que foi combinado com o cliente?"
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                clear();
              }}
              error={error}
              placeholder="Ex.: Combinamos entrega na sexta e pagamento via Pix."
            />
            <div className="flex flex-wrap items-end gap-2">
              {deals.length > 0 && (
                <label className="text-sm">
                  <span className="mb-1 block font-semibold">Sobre</span>
                  <select
                    value={noteDeal}
                    onChange={(e) => setNoteDeal(e.target.value)}
                    className="min-h-10 rounded-lg border border-[#c5cfdf] bg-white px-2"
                  >
                    <option value="">O cliente em geral</option>
                    {deals.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button type="submit" size="sm" loading={pending} disabled={!note.trim()}>
                Salvar anotação
              </Button>
            </div>
          </form>
        )}
        {timeline.length === 0 ? (
          <p className="text-sm text-muted">Nada registrado ainda.</p>
        ) : (
          <ol className="relative grid gap-3 border-l-2 border-line pl-4">
            {timeline.map((t) => (
              <li key={t.id} className="relative">
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-white",
                    t.kind === "anotacao" ? "bg-primary" : "bg-[#9aa6b8]",
                  )}
                />
                <p className="text-sm text-muted">
                  {formatDateTimeBR(t.at)} · {name(t.who)}
                  {t.kind === "anotacao" ? " · Anotação" : ""}
                </p>
                <p className={cx("text-base", t.kind === "anotacao" && "rounded-lg bg-primary-50 px-3 py-2")}>
                  {t.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </Drawer>
  );
}
