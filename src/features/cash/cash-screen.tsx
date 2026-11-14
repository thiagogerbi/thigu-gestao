"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, InlineAlert, PageHeader } from "@/components/ui/card";
import { MoneyField } from "@/components/ui/fields";
import { IconMoneyIn, IconPlus } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { localParts } from "@/lib/domain/agenda";
import { COUNTER_ORIGINS, expectedCash, openSession, sessionMovements, totalsByMethod } from "@/lib/domain/cash";
import { formatDateBR, formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import { METHOD_LABEL, type PaymentMethod } from "@/lib/domain/types";
import { useAction, useBackend, useMemberName } from "@/state/backend-context";
import { accountView } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

/**
 * Caixa do dia: abre com o troco, registra vendas rápidas e recebimentos, mostra o total por forma de pagamento
 * e, no fim do dia, o financeiro ou o dono confere o dinheiro da gaveta e fecha.
 */
export function CashScreen() {
  const { data, me, today } = useBackend();
  const dialogs = useDialogs();
  const nav = useNav();
  const name = useMemberName();
  const toast = useToast();
  const { exec, pending, fieldErrors } = useAction();
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);

  if (!moduleAvailable(data.company, "caixa") || !can(me.roles, "caixa.operar")) {
    return (
      <>
        <PageHeader title="Caixa" />
        <EmptyState title="Página indisponível">
          O caixa existe para empresas com atendimento no balcão (salões, barbearias, estética, pet shops) e para quem
          recebe dos clientes: recepção, caixa, financeiro e o dono.
        </EmptyState>
      </>
    );
  }

  const session = openSession(data.cashSessions);
  const closeable = can(me.roles, "caixa.fechar");
  const history = data.cashSessions.filter((s) => s.closedAt).slice(0, 7);
  const pendingAccounts = data.accounts
    .filter(
      (a) =>
        a.kind === "receber" &&
        !a.canceledAt &&
        a.dueDate <= today &&
        (COUNTER_ORIGINS as readonly string[]).includes(a.origin),
    )
    .map((a) => accountView(data, a, today))
    .filter((v) => v.balance > 0)
    .sort((a, b) => b.account.dueDate.localeCompare(a.account.dueDate))
    .slice(0, 8);

  async function openCash(e: React.FormEvent) {
    e.preventDefault();
    const cents = opening.trim() === "" ? 0 : parseBRLToCents(opening);
    if (cents === null || cents < 0) return setOpenError("Digite o valor do troco, por exemplo 100,00.");
    setOpenError(null);
    const r = await exec({ type: "cash.open", openingCents: cents });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
    if (r.ok) setOpening("");
  }

  const products = can(me.roles, "produtos.gerenciar") && (
    <LinkButton href={nav.href("/servicos")} variant="secondary">
      Produtos e serviços
    </LinkButton>
  );

  if (!session) {
    return (
      <>
        <PageHeader
          title="Caixa"
          description="Abra o caixa no começo do dia com o dinheiro de troco que está na gaveta."
          actions={products}
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_1fr]">
          <Card className="p-4" aria-labelledby="abrir-caixa">
            <h2 id="abrir-caixa" className="font-display text-lg font-bold">
              O caixa está fechado
            </h2>
            <form onSubmit={openCash} className="mt-3 grid gap-3" noValidate>
              <MoneyField
                label="Troco na gaveta"
                value={opening}
                onChange={(e) => {
                  setOpening(e.target.value);
                  setOpenError(null);
                }}
                error={openError ?? fieldErrors.openingCents}
                hint="Deixe em branco se começar sem troco."
                data-autofocus
              />
              <Button type="submit" variant="money" loading={pending}>
                Abrir caixa
              </Button>
            </form>
          </Card>
          <CashHistory history={history} name={name} />
        </div>
      </>
    );
  }

  const moves = sessionMovements(session, data.movements).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const totals = totalsByMethod(session, data.movements);
  const total = Object.values(totals).reduce((s, v) => s + (v ?? 0), 0);
  const drawer = expectedCash(session, data.movements);
  const openedToday = localParts(session.openedAt).date === today;
  const accountDesc = (id: string) => data.accounts.find((a) => a.id === id)?.description ?? "—";

  return (
    <>
      <PageHeader
        title="Caixa"
        description={`Aberto ${openedToday ? "hoje" : `em ${formatDateBR(session.openedAt)}`} às ${localParts(session.openedAt).time} por ${name(session.openedBy)}, com ${formatBRL(session.openingCents)} de troco.`}
        actions={
          <>
            <Button variant="money" onClick={() => dialogs.open({ kind: "cashSale" })}>
              <IconPlus className="h-5 w-5" /> Nova venda
            </Button>
            <Button variant="secondary" onClick={() => dialogs.open({ kind: "cashReceive" })}>
              Receber conta
            </Button>
            {closeable && (
              <Button variant="secondary" onClick={() => dialogs.open({ kind: "cashClose" })}>
                Fechar caixa
              </Button>
            )}
          </>
        }
      />
      {!openedToday && (
        <div className="mb-4">
          <InlineAlert tone="amber" title="Este caixa ficou aberto de um dia para o outro">
            {closeable
              ? "Confira o dinheiro da gaveta e feche o caixa antes de começar o dia."
              : "Peça para o financeiro ou o dono conferir e fechar o caixa."}
          </InlineAlert>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">Recebido neste caixa</p>
          <p className="mt-2 font-display text-2xl font-extrabold tabular text-money-700">{formatBRL(total)}</p>
          <p className="mt-1 text-sm text-muted">
            {moves.length} {moves.length === 1 ? "lançamento" : "lançamentos"}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">Dinheiro na gaveta</p>
          <p className="mt-2 font-display text-2xl font-extrabold tabular">{formatBRL(drawer)}</p>
          <p className="mt-1 text-sm text-muted">Troco + o que entrou em dinheiro</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">Por forma de pagamento</p>
          {total === 0 ? (
            <p className="mt-2 text-sm text-muted">Nada recebido ainda.</p>
          ) : (
            <ul className="mt-2 grid gap-0.5 text-sm">
              {(Object.entries(totals) as [PaymentMethod, number][])
                .filter(([, v]) => v !== 0)
                .sort((a, b) => b[1] - a[1])
                .map(([m, v]) => (
                  <li key={m} className="flex justify-between gap-2">
                    <span>{METHOD_LABEL[m]}</span>
                    <span className="font-semibold tabular">{formatBRL(v)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-4" aria-labelledby="para-receber">
          <h2 id="para-receber" className="font-display text-lg font-bold">
            Para receber
          </h2>
          <p className="mb-3 text-sm text-muted">Atendimentos, pacotes e mensalidades que vencem até hoje.</p>
          {pendingAccounts.length === 0 ? (
            <p className="text-sm text-muted">Nada pendente. Tudo recebido.</p>
          ) : (
            <ul className="divide-y divide-line">
              {pendingAccounts.map((v) => (
                <li key={v.account.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{v.partyName}</p>
                    <p className="truncate text-sm text-muted">
                      {v.account.description} · {formatShortDateBR(v.account.dueDate)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => dialogs.open({ kind: "cashReceive", accountId: v.account.id })}
                  >
                    <IconMoneyIn className="h-4 w-4" /> {formatBRL(v.balance)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4" aria-labelledby="lancamentos">
          <h2 id="lancamentos" className="mb-3 font-display text-lg font-bold">
            Lançamentos deste caixa
          </h2>
          {moves.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma venda ou recebimento ainda.</p>
          ) : (
            <ul className="divide-y divide-line">
              {moves.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{accountDesc(m.accountId)}</p>
                    <p className="text-sm text-muted">
                      {localParts(m.createdAt).time} · {METHOD_LABEL[m.method]} · {name(m.registeredBy)}
                    </p>
                  </div>
                  <span className="font-semibold tabular text-money-700">{formatBRL(m.amountCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {products && <div className="mt-6">{products}</div>}
    </>
  );
}

function CashHistory({
  history,
  name,
}: {
  history: ReturnType<typeof useBackend>["data"]["cashSessions"];
  name: (id: string | null) => string;
}) {
  return (
    <Card className="p-4" aria-labelledby="caixas-anteriores">
      <h2 id="caixas-anteriores" className="mb-3 font-display text-lg font-bold">
        Caixas anteriores
      </h2>
      {history.length === 0 ? (
        <p className="text-sm text-muted">Nenhum caixa fechado ainda.</p>
      ) : (
        <ul className="divide-y divide-line">
          {history.map((s) => {
            const diff = (s.countedCents ?? 0) - (s.expectedCents ?? 0);
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div>
                  <p className="font-semibold">{formatDateBR(s.openedAt)}</p>
                  <p className="text-sm text-muted">
                    Fechado por {name(s.closedBy)} · contado {formatBRL(s.countedCents ?? 0)}
                    {s.notes && ` · ${s.notes}`}
                  </p>
                </div>
                {diff === 0 ? (
                  <Badge tone="green">Conferiu</Badge>
                ) : diff > 0 ? (
                  <Badge tone="amber">Sobrou {formatBRL(diff)}</Badge>
                ) : (
                  <Badge tone="red">Faltou {formatBRL(-diff)}</Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
