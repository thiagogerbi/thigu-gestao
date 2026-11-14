"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { IconDoc, IconEdit, IconPlus } from "@/components/ui/icons";
import { Drawer } from "@/components/ui/overlay";
import { ClientContact } from "@/features/clients/client-contact";
import { ClientDealsList } from "@/features/clients/client-deals-list";
import { ClientHistory, NOTE_FIELD_ID } from "@/features/clients/client-history";
import { ClientNextAction } from "@/features/clients/client-next-action";
import { ClientProposalsList } from "@/features/clients/client-proposals-list";
import { ClientSection } from "@/features/clients/client-section";
import { AccountCard } from "@/features/finance/account-card";
import { formatDateBR } from "@/lib/domain/dates";
import { isOpenStage } from "@/lib/domain/deals";
import { formatBRL } from "@/lib/domain/money";
import { canEditClient } from "@/lib/domain/permissions";
import { useBackend, useCan, useMemberName } from "@/state/backend-context";
import { accountView, clientById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useEffect, useState } from "react";

/**
 * Ficha do cliente (painel lateral): tudo sobre o cliente num só lugar.
 * Este arquivo junta os dados e decide a sugestão do topo; cada seção fica no seu arquivo:
 * client-next-action, client-contact, client-deals-list, client-proposals-list e client-history.
 */
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
  // o texto da anotação fica aqui porque a ficha avisa antes de fechar com algo não salvo
  const [note, setNote] = useState("");
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

  useEffect(() => {
    if (!focusDeal) return;
    const el = document.getElementById(`ficha-neg-${focusDeal}`);
    el?.scrollIntoView({ block: "center" });
  }, [focusDeal]);

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

      <ClientSection title="Resumo do relacionamento">
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
      </ClientSection>

      <ClientNextAction nextAction={nextAction} tasks={tasks} hasOpenDeals={openDeals.length > 0} />
      <ClientContact client={client} />
      <ClientDealsList clientId={clientId} deals={deals} focusDeal={focusDeal} editable={editable} />
      <ClientProposalsList proposals={proposals} hasOpenDeals={openDeals.length > 0} />

      {showMoney && (
        <ClientSection title="Parcelas e pagamentos" collapsible count={accounts.length} defaultOpen={Boolean(overdue)}>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted">
              {awaitingSale
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
        </ClientSection>
      )}

      <ClientHistory
        clientId={clientId}
        deals={deals}
        focusDeal={focusDeal}
        mayNote={mayNote}
        note={note}
        onNoteChange={setNote}
      />
    </Drawer>
  );
}
