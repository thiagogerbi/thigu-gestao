"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconDoc,
  IconMoneyIn,
  IconPlus,
  IconWallet,
} from "@/components/ui/icons";
import { KpiCard } from "@/components/ui/kpi-card";
import { cx } from "@/components/ui/styles";
import { formatDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { computeOverview } from "@/lib/domain/overview";
import { proposalTotalCents } from "@/lib/domain/proposals";
import { useBackend, useCan } from "@/state/backend-context";
import { clientById, firstName } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import Link from "next/link";

interface Priority {
  key: string;
  tone: "red" | "amber" | "blue" | "green";
  icon: React.ReactNode;
  title: string;
  detail: string;
  who?: string;
  href: string;
  cta: string;
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export function OverviewScreen() {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const nav = useNav();
  const dialogs = useDialogs();
  const ov = computeOverview(data, today);
  const fin = canDo("financeiro.ver");
  const crm = canDo("crm.editar_proprios");
  const seesReceivables = fin || canDo("recebiveis.ver_proprios");

  const pr: Priority[] = [];
  if (ov.awaitingReviewCount > 0 && (canDo("venda.conferir") || crm)) {
    pr.push({
      key: "conferir",
      tone: "amber",
      icon: <IconWallet />,
      title: `${ov.awaitingReviewCount} ${ov.awaitingReviewCount === 1 ? "venda aguardando" : "vendas aguardando"} conferência`,
      detail: `${formatBRL(ov.awaitingReviewCents)} ainda não viraram contas a receber.`,
      who: canDo("venda.conferir") ? "Você confere" : "O financeiro confere",
      href: nav.href("/financeiro", { aba: "conferir" }),
      cta: "Ver vendas para conferir",
    });
  }
  if (seesReceivables && ov.overdueReceivablesCount > 0) {
    pr.push({
      key: "atrasados",
      tone: "red",
      icon: <IconAlert />,
      title: `${ov.overdueReceivablesCount} ${ov.overdueReceivablesCount === 1 ? "recebimento atrasado" : "recebimentos atrasados"}`,
      detail: `${formatBRL(ov.overdueReceivablesCents)} venceram e ainda não foram recebidos.`,
      href: nav.href("/financeiro", { aba: "receber", filtro: "atrasadas" }),
      cta: "Ver recebimentos atrasados",
    });
  }
  if (fin && ov.overduePayablesCount + ov.dueSoonPayablesCount > 0) {
    pr.push({
      key: "pagar",
      tone: ov.overduePayablesCount ? "red" : "blue",
      icon: <IconClock />,
      title: ov.overduePayablesCount
        ? `${ov.overduePayablesCount} ${ov.overduePayablesCount === 1 ? "conta a pagar vencida" : "contas a pagar vencidas"}`
        : `${ov.dueSoonPayablesCount} ${ov.dueSoonPayablesCount === 1 ? "conta vence" : "contas vencem"} nos próximos 7 dias`,
      detail: `Total a pagar em aberto: ${formatBRL(ov.toPayCents)}.`,
      href: nav.href("/financeiro", { aba: "pagar", filtro: ov.overduePayablesCount ? "atrasadas" : "7dias" }),
      cta: ov.overduePayablesCount ? "Ver contas vencidas" : "Ver contas da semana",
    });
  }
  if (ov.tasksOverdue > 0) {
    pr.push({
      key: "tarefas-atrasadas",
      tone: "red",
      icon: <IconCheck />,
      title: `${ov.tasksOverdue} ${ov.tasksOverdue === 1 ? "tarefa atrasada" : "tarefas atrasadas"}`,
      detail: "Combinados que passaram do prazo.",
      href: nav.href("/tarefas", { filtro: "atrasadas" }),
      cta: "Ver tarefas atrasadas",
    });
  }
  if (ov.tasksToday > 0) {
    pr.push({
      key: "tarefas-hoje",
      tone: "blue",
      icon: <IconCheck />,
      title: `${ov.tasksToday} ${ov.tasksToday === 1 ? "tarefa para hoje" : "tarefas para hoje"}`,
      detail: "O que precisa ser feito ainda hoje.",
      href: nav.href("/tarefas", { filtro: "hoje" }),
      cta: "Ver tarefas de hoje",
    });
  }
  if (crm && ov.staleDealsCount > 0) {
    pr.push({
      key: "paradas",
      tone: "amber",
      icon: <IconClock />,
      title: `${ov.staleDealsCount} ${ov.staleDealsCount === 1 ? "negociação parada" : "negociações paradas"}`,
      detail: "Sem atualização há 7 dias ou com a próxima ação atrasada.",
      href: nav.href("/negociacoes", { filtro: "paradas" }),
      cta: "Ver negociações paradas",
    });
  }

  const steps = [
    {
      done: ov.onboarding.client,
      label: "Cadastre seu primeiro cliente",
      action: () => dialogs.open({ kind: "client" }),
      cta: "Cadastrar cliente",
    },
    {
      done: ov.onboarding.deal,
      label: "Adicione uma negociação",
      action: () => dialogs.open({ kind: "deal" }),
      cta: "Nova negociação",
    },
    {
      done: ov.onboarding.proposal,
      label: "Prepare uma proposta",
      action: () => {
        const d = data.deals[0];
        dialogs.open({ kind: "proposal", dealId: d?.id, clientId: d?.clientId });
      },
      cta: "Preparar proposta",
    },
    {
      done: ov.onboarding.receipt,
      label: "Registre o primeiro recebimento",
      action: () => dialogs.open({ kind: "settle", accountKind: "receber" }),
      cta: "Registrar recebimento",
    },
  ];
  const showOnboarding = crm && steps.some((s) => !s.done);
  const nextStep = steps.findIndex((s) => !s.done);

  const primary =
    canDo("financeiro.registrar") && !crm ? (
      <Button variant="money" onClick={() => dialogs.open({ kind: "settle", accountKind: "receber" })}>
        <IconMoneyIn className="h-5 w-5" /> Registrar recebimento
      </Button>
    ) : crm ? (
      <Button onClick={() => dialogs.open({ kind: "deal" })}>
        <IconPlus className="h-5 w-5" /> Nova negociação
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={
          <>
            {greeting()}, {firstName(me.name)}. Hoje é {formatDateBR(today)}. Veja o que precisa da sua atenção.
          </>
        }
        actions={
          <>
            {primary}
            {canDo("financeiro.registrar") && crm && (
              <Button variant="secondary" onClick={() => dialogs.open({ kind: "settle", accountKind: "receber" })}>
                Registrar recebimento
              </Button>
            )}
          </>
        }
      />

      {showOnboarding && (
        <Card className="mb-6 p-5">
          <h2 className="font-display text-lg font-bold">Primeiros passos</h2>
          <p className="mb-4 text-muted">Quatro passos para ver o Thigu funcionando do contato ao dinheiro recebido.</p>
          <ol className="grid gap-2 md:grid-cols-4">
            {steps.map((s, i) => (
              <li
                key={s.label}
                className={cx(
                  "flex flex-col gap-2 rounded-lg border p-3",
                  s.done
                    ? "border-[#bfe8d8] bg-money-50"
                    : i === nextStep
                      ? "border-primary bg-primary-50"
                      : "border-line",
                )}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <span
                    className={cx(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm",
                      s.done ? "bg-money-700 text-white" : "bg-white text-ink ring-1 ring-line",
                    )}
                  >
                    {s.done ? <IconCheck className="h-4 w-4" /> : i + 1}
                  </span>
                  {s.label}
                </span>
                {s.done ? (
                  <span className="text-sm text-money-700">Feito</span>
                ) : (
                  i === nextStep && (
                    <Button size="sm" onClick={s.action}>
                      {s.cta}
                    </Button>
                  )
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <section aria-labelledby="prioridades" className="mb-8">
        <h2 id="prioridades" className="mb-3 font-display text-lg font-bold">
          O que fazer agora
        </h2>
        {pr.length === 0 && ov.proposalsToFollow.length === 0 ? (
          <Card className="p-5">
            <p className="font-semibold">Tudo em dia por aqui.</p>
            <p className="text-muted">Nenhum atraso ou pendência importante agora.</p>
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pr.map((p) => (
              <li key={p.key}>
                <Link
                  href={p.href}
                  className={cx(
                    "flex h-full items-start gap-3 rounded-xl border bg-white p-4 hover:shadow-md",
                    { red: "border-[#f7c9c4]", amber: "border-[#f5d9a8]", blue: "border-line", green: "border-line" }[
                      p.tone
                    ],
                  )}
                >
                  <span
                    className={cx(
                      "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      {
                        red: "bg-danger-50 text-danger",
                        amber: "bg-warn-50 text-warn",
                        blue: "bg-primary-50 text-primary-700",
                        green: "bg-money-50 text-money-700",
                      }[p.tone],
                    )}
                  >
                    {p.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{p.title}</span>
                    <span className="block text-sm text-muted">
                      {p.detail}
                      {p.who ? ` ${p.who}.` : ""}
                    </span>
                    <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-primary-700">
                      {p.cta} <IconArrowRight className="h-4 w-4" />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {ov.proposalsToFollow.slice(0, 4).map((f) => {
              const p = data.proposals.find((x) => x.id === f.proposalId)!;
              const c = clientById(data, f.clientId);
              return (
                <li key={f.proposalId}>
                  <div className="flex h-full items-start gap-3 rounded-xl border border-line bg-white p-4">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                      <IconDoc />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Proposta para {c?.name} aguardando resposta</span>
                      <span className="block text-sm text-muted">
                        Nº {p.number} · {formatBRL(proposalTotalCents(p.items, p.discountCents))} · enviada há{" "}
                        {f.daysSinceSent} {f.daysSinceSent === 1 ? "dia" : "dias"}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-4">
                        <Link
                          href={nav.href(`/propostas/${p.id}`)}
                          className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary-700"
                        >
                          Ver proposta <IconArrowRight className="h-4 w-4" />
                        </Link>
                        {c && (
                          <button
                            type="button"
                            onClick={() => nav.openClient(c.id, p.dealId)}
                            className="min-h-9 text-sm font-semibold text-primary-700"
                          >
                            Abrir ficha do cliente
                          </button>
                        )}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {seesReceivables && (
        <section aria-labelledby="dinheiro" className="mb-8">
          <h2 id="dinheiro" className="mb-1 font-display text-lg font-bold">
            Vendas e dinheiro
          </h2>
          <p className="mb-3 text-sm text-muted">
            Venda fechada não é dinheiro no caixa: o valor só conta como recebido depois que alguém registra o
            recebimento.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard
              icon={<IconDoc className="h-4 w-4" />}
              label="Vendido"
              value={ov.soldCents}
              help={
                ov.awaitingReviewCents
                  ? `Vendas fechadas. ${formatBRL(ov.awaitingReviewCents)} aguardam conferência.`
                  : "Vendas fechadas (todas já conferidas)."
              }
            />
            <KpiCard
              icon={<IconMoneyIn className="h-4 w-4" />}
              label="Recebido"
              value={ov.receivedCents}
              tone="money"
              help="Dinheiro que efetivamente entrou."
              href={fin ? nav.href("/financeiro", { aba: "caixa" }) : undefined}
            />
            <KpiCard
              icon={<IconWallet className="h-4 w-4" />}
              label="A receber"
              value={ov.toReceiveCents}
              tone="primary"
              help={
                ov.overdueReceivablesCents
                  ? `Parcelas confirmadas em aberto. ${formatBRL(ov.overdueReceivablesCents)} em atraso.`
                  : "Parcelas confirmadas em aberto."
              }
              href={nav.href("/financeiro", { aba: "receber" })}
            />
            {fin && (
              <KpiCard
                icon={<IconClock className="h-4 w-4" />}
                label="Contas a pagar"
                value={ov.toPayCents}
                tone={ov.overduePayablesCount ? "danger" : "ink"}
                help="Despesas em aberto."
                href={nav.href("/financeiro", { aba: "pagar" })}
              />
            )}
            {fin && (
              <KpiCard
                icon={<IconCheck className="h-4 w-4" />}
                label="Caixa realizado"
                value={ov.cashCents}
                tone={ov.cashCents < 0 ? "danger" : "money"}
                help="Entradas menos saídas registradas."
                href={nav.href("/financeiro", { aba: "caixa" })}
              />
            )}
          </div>
        </section>
      )}

      {crm && (
        <section aria-labelledby="negs">
          <h2 id="negs" className="mb-3 font-display text-lg font-bold">
            Negociações em andamento
          </h2>
          <Link
            href={nav.href("/negociacoes")}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 hover:border-primary"
          >
            <span>
              <span className="block font-semibold">
                {ov.openDealsCount} {ov.openDealsCount === 1 ? "negociação aberta" : "negociações abertas"} ·{" "}
                <span className="tabular">{formatBRL(ov.pipelineCents)}</span>
              </span>
              <span className="block text-sm text-muted">
                Valores ainda incertos: não entram em “a receber” nem no caixa.
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700">
              Ver negociações <IconArrowRight className="h-4 w-4" />
            </span>
          </Link>
        </section>
      )}
    </>
  );
}
