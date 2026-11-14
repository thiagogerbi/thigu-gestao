"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button, LinkButton } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/card";
import { HelpTip } from "@/components/ui/help-tip";
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
import { cx } from "@/components/ui/styles";
import { MoneyJourney } from "@/features/overview/money-journey";
import { formatDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { computeOverview } from "@/lib/domain/overview";
import { usesCrm } from "@/lib/domain/permissions";
import { proposalTotalCents } from "@/lib/domain/proposals";
import { useBackend, useCan } from "@/state/backend-context";
import { clientById, firstName } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";
import Link from "next/link";
import { useState } from "react";

const VISIBLE_PRIORITIES = 3;

interface Priority {
  key: string;
  tone: "red" | "amber" | "blue";
  icon: React.ReactNode;
  title: string;
  detail: string;
  href: string;
  cta: string;
}

const TONE_BORDER = { red: "border-[#f7c9c4]", amber: "border-[#f5d9a8]", blue: "border-line" };
const TONE_ICON = {
  red: "bg-danger-50 text-danger",
  amber: "bg-warn-50 text-warn",
  blue: "bg-primary-50 text-primary-700",
};

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function OverviewScreen() {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const nav = useNav();
  const dialogs = useDialogs();
  const [showAll, setShowAll] = useState(false);
  const ov = computeOverview(data, today);
  const fin = canDo("financeiro.ver");
  const crm = canDo("crm.editar_proprios");
  const seesReceivables = fin || canDo("recebiveis.ver_proprios");
  const t = useTerms();
  // recepção, profissional e caixa não acompanham vendas nem dinheiro: veem um resumo dos clientes
  const followsSales = usesCrm(me.roles) || fin;
  const mayAddClient = canDo("clientes.editar_proprios");

  // Avisos em ordem de urgência: dinheiro atrasado primeiro, depois o que trava o fluxo, depois o dia a dia.
  const priorities: Priority[] = [];
  if (seesReceivables && ov.overdueReceivablesCount > 0) {
    priorities.push({
      key: "atrasados",
      tone: "red",
      icon: <IconAlert />,
      title: `${plural(ov.overdueReceivablesCount, "pagamento atrasado", "pagamentos atrasados")} de clientes`,
      detail: `${formatBRL(ov.overdueReceivablesCents)} já venceram. Se o cliente pagou, registre o recebimento.`,
      href: nav.href("/financeiro", { aba: "receber", filtro: "atrasadas" }),
      cta: "Ver quem está atrasado",
    });
  }
  if (ov.awaitingReviewCount > 0 && (canDo("venda.conferir") || crm)) {
    priorities.push({
      key: "conferir",
      tone: "amber",
      icon: <IconWallet />,
      title: `${plural(ov.awaitingReviewCount, "venda esperando", "vendas esperando")} confirmação das parcelas`,
      detail: canDo("venda.conferir")
        ? "Confirme as parcelas para que elas entrem em “Falta receber”."
        : "O financeiro precisa confirmar as parcelas.",
      href: nav.href("/financeiro", { aba: "conferir" }),
      cta: canDo("venda.conferir") ? "Confirmar parcelas" : "Ver vendas",
    });
  }
  if (fin && ov.overduePayablesCount > 0) {
    priorities.push({
      key: "pagar",
      tone: "red",
      icon: <IconClock />,
      title: `${plural(ov.overduePayablesCount, "conta da empresa vencida", "contas da empresa vencidas")}`,
      detail: "Contas que a empresa precisa pagar e já passaram do vencimento.",
      href: nav.href("/financeiro", { aba: "pagar", filtro: "atrasadas" }),
      cta: "Ver contas vencidas",
    });
  }
  if (ov.tasksOverdue > 0) {
    priorities.push({
      key: "tarefas-atrasadas",
      tone: "red",
      icon: <IconCheck />,
      title: plural(ov.tasksOverdue, "tarefa atrasada", "tarefas atrasadas"),
      detail: "Combinados que passaram do prazo.",
      href: nav.href("/tarefas", { filtro: "atrasadas" }),
      cta: "Ver tarefas atrasadas",
    });
  }
  for (const f of ov.proposalsToFollow) {
    const p = data.proposals.find((x) => x.id === f.proposalId)!;
    priorities.push({
      key: `proposta-${p.id}`,
      tone: "blue",
      icon: <IconDoc />,
      title: `${clientById(data, f.clientId)?.name ?? "Cliente"} ainda não respondeu a proposta`,
      detail: `${formatBRL(proposalTotalCents(p.items, p.discountCents))} · enviada há ${plural(f.daysSinceSent, "dia", "dias")}. Que tal ligar?`,
      href: nav.href(`/propostas/${p.id}`),
      cta: "Ver proposta",
    });
  }
  if (ov.tasksToday > 0) {
    priorities.push({
      key: "tarefas-hoje",
      tone: "blue",
      icon: <IconCheck />,
      title: plural(ov.tasksToday, "tarefa para hoje", "tarefas para hoje"),
      detail: "O que precisa ser feito ainda hoje.",
      href: nav.href("/tarefas", { filtro: "hoje" }),
      cta: "Ver tarefas de hoje",
    });
  }
  if (crm && ov.staleDealsCount > 0) {
    priorities.push({
      key: "paradas",
      tone: "amber",
      icon: <IconClock />,
      title: `${plural(ov.staleDealsCount, "negociação parada", "negociações paradas")}`,
      detail: "Clientes sem contato há mais de uma semana.",
      href: nav.href("/negociacoes", { filtro: "paradas" }),
      cta: "Ver negociações paradas",
    });
  }
  const visible = showAll ? priorities : priorities.slice(0, VISIBLE_PRIORITIES);
  const hidden = priorities.length - visible.length;

  const steps = [
    {
      done: ov.onboarding.client,
      label: "Cadastre seu primeiro cliente",
      cta: "Cadastrar cliente",
      action: () => dialogs.open({ kind: "client" }),
    },
    {
      done: ov.onboarding.deal,
      label: "Anote uma venda que está conversando",
      cta: "Nova negociação",
      action: () => dialogs.open({ kind: "deal" }),
    },
    {
      done: ov.onboarding.proposal,
      label: "Prepare uma proposta",
      cta: "Preparar proposta",
      action: () => {
        const d = data.deals[0];
        dialogs.open({ kind: "proposal", dealId: d?.id, clientId: d?.clientId });
      },
    },
    {
      done: ov.onboarding.receipt,
      label: "Registre o primeiro pagamento recebido",
      cta: "Registrar recebimento",
      action: () => dialogs.open({ kind: "settle", accountKind: "receber" }),
    },
  ];
  const showOnboarding = crm && steps.some((s) => !s.done);
  const nextStep = steps.findIndex((s) => !s.done);

  const primary =
    canDo("financeiro.registrar") && !crm ? (
      <Button variant="money" size="lg" onClick={() => dialogs.open({ kind: "settle", accountKind: "receber" })}>
        <IconMoneyIn className="h-5 w-5" /> Registrar recebimento
      </Button>
    ) : crm ? (
      <Button size="lg" onClick={() => dialogs.open({ kind: "deal" })}>
        <IconPlus className="h-5 w-5" /> Nova negociação
      </Button>
    ) : mayAddClient ? (
      <Button size="lg" onClick={() => dialogs.open({ kind: "client" })}>
        <IconPlus className="h-5 w-5" /> Novo {t.cliente}
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={
          <>
            {greeting()}, {firstName(me.name)}! Hoje é {formatDateBR(today)}. Aqui está o resumo do seu negócio.
          </>
        }
        actions={primary}
      />

      {showOnboarding && (
        <Card className="mb-6 p-5">
          <h2 className="font-display text-lg font-bold">Primeiros passos</h2>
          <p className="mb-4 text-muted">
            Quatro passos para ver o sistema funcionando do contato ao dinheiro recebido.
          </p>
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
          Hoje você precisa
        </h2>
        {priorities.length === 0 ? (
          <Card className="p-5">
            <p className="font-semibold">Tudo em dia por aqui.</p>
            <p className="text-muted">Nenhum atraso ou pendência importante agora.</p>
          </Card>
        ) : (
          <>
            <ul className="grid gap-3">
              {visible.map((p) => (
                <li key={p.key}>
                  <Link
                    href={p.href}
                    className={cx(
                      "flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-card transition-shadow hover:shadow-raised",
                      TONE_BORDER[p.tone],
                    )}
                  >
                    <span
                      className={cx(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                        TONE_ICON[p.tone],
                      )}
                    >
                      {p.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{p.title}</span>
                      <span className="block text-sm text-muted">{p.detail}</span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1 font-semibold text-primary-700 sm:inline-flex">
                      {p.cta} <IconArrowRight className="h-4 w-4" />
                    </span>
                    <IconArrowRight className="h-5 w-5 shrink-0 text-primary-700 sm:hidden" />
                  </Link>
                </li>
              ))}
            </ul>
            {(hidden > 0 || showAll) && priorities.length > VISIBLE_PRIORITIES && (
              <Button variant="ghost" className="mt-2" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll}>
                {showAll ? "Mostrar menos" : `Ver mais ${plural(hidden, "aviso", "avisos")}`}
              </Button>
            )}
          </>
        )}
      </section>

      {followsSales ? (
        <MoneyJourney ov={ov} />
      ) : (
        <Card className="p-5">
          <h2 className="font-display text-lg font-bold">{t.Clientes}</h2>
          <p className="text-muted">
            {data.clients.length === 0
              ? `Nenhum ${t.cliente} ${canDo("clientes.ver_todos") ? "cadastrado" : "sob seus cuidados"} ainda.`
              : canDo("clientes.ver_todos")
                ? `${plural(data.clients.length, `${t.cliente} cadastrado`, `${t.clientes} cadastrados`)}.`
                : `${plural(data.clients.length, t.cliente, t.clientes)} sob seus cuidados.`}
          </p>
          <div className="mt-3">
            <LinkButton href={nav.href("/clientes")} variant="secondary">
              Ver {t.clientes}
            </LinkButton>
          </div>
        </Card>
      )}

      {seesReceivables && (
        <section aria-labelledby="dinheiro">
          <h2 id="dinheiro" className="mb-3 font-display text-lg font-bold">
            Dinheiro
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <MoneyFigure
              label="Vendido"
              value={ov.soldCents}
              help="Soma das vendas fechadas. Ainda não é dinheiro no bolso: só conta como recebido quando o cliente paga."
            />
            <MoneyFigure
              label="Recebido"
              value={ov.receivedCents}
              tone="money"
              help="Dinheiro que realmente entrou, registrado com “Registrar recebimento”."
              href={fin ? nav.href("/financeiro", { aba: "caixa" }) : undefined}
            />
            <MoneyFigure
              label="Falta receber"
              value={ov.toReceiveCents}
              tone="primary"
              help="Parcelas já confirmadas que os clientes ainda vão pagar."
              href={nav.href("/financeiro", { aba: "receber" })}
            />
          </div>
        </section>
      )}
    </>
  );
}

function MoneyFigure({
  label,
  value,
  help,
  tone,
  href,
}: {
  label: string;
  value: number;
  help: string;
  tone?: "money" | "primary";
  href?: string;
}) {
  const color = tone === "money" ? "text-money-700" : tone === "primary" ? "text-primary-700" : "text-ink";
  const body = (
    <>
      <span className="whitespace-nowrap font-display text-2xl font-extrabold tabular sm:text-3xl">
        {formatBRL(value)}
      </span>
    </>
  );
  return (
    // no celular: nome à esquerda e valor à direita, numa linha só
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white p-4 shadow-card sm:block">
      <p className="flex items-center gap-2 font-semibold">
        {label} <HelpTip term={label}>{help}</HelpTip>
      </p>
      {href ? (
        <Link href={href} className={cx("block hover:underline sm:mt-1", color)}>
          {body}
        </Link>
      ) : (
        <p className={cx("sm:mt-1", color)}>{body}</p>
      )}
    </div>
  );
}
