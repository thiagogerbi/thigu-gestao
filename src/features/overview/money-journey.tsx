"use client";

import { IconChevronRight } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { isOpenStage } from "@/lib/domain/deals";
import { formatBRL } from "@/lib/domain/money";
import type { Overview } from "@/lib/domain/overview";
import { useBackend, useCan } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import Link from "next/link";

/**
 * Mostra, numa linha, para que serve o Thigu: o caminho do primeiro contato até o dinheiro recebido,
 * com a situação atual de cada etapa. Cada etapa leva à tela correspondente.
 */
export function MoneyJourney({ ov }: { ov: Overview }) {
  const { data } = useBackend();
  const canDo = useCan();
  const nav = useNav();
  const fin = canDo("financeiro.ver");
  const openDeals = data.deals.filter((d) => isOpenStage(d.stage));
  const sentProposals = data.proposals.filter((p) => p.status === "enviada").length;

  const steps = [
    {
      label: "Clientes",
      value: `${data.clients.length}`,
      detail: data.clients.length === 1 ? "pessoa cadastrada" : "pessoas cadastradas",
      href: nav.href("/clientes"),
    },
    {
      label: "Conversando",
      value: formatBRL(ov.pipelineCents),
      detail: `${openDeals.length} ${openDeals.length === 1 ? "negociação" : "negociações"} (ainda incerto)`,
      href: nav.href("/negociacoes"),
    },
    {
      label: "Propostas",
      value: `${sentProposals}`,
      detail: sentProposals === 1 ? "esperando resposta" : "esperando resposta",
      href: nav.href("/negociacoes", { etapa: "proposta" }),
    },
    {
      label: "Vendido",
      value: formatBRL(ov.soldCents),
      detail: ov.awaitingReviewCount ? `${ov.awaitingReviewCount} para confirmar parcelas` : "vendas fechadas",
      href: nav.href("/financeiro", { aba: ov.awaitingReviewCount ? "conferir" : "receber" }),
    },
    {
      label: "Falta receber",
      value: formatBRL(ov.toReceiveCents),
      detail: ov.overdueReceivablesCount ? `${ov.overdueReceivablesCount} atrasado(s)` : "parcelas em aberto",
      href: nav.href("/financeiro", { aba: "receber" }),
      tone: ov.overdueReceivablesCount ? "danger" : undefined,
    },
    {
      label: "Recebido",
      value: formatBRL(ov.receivedCents),
      detail: "dinheiro que já entrou",
      href: fin
        ? nav.href("/financeiro", { aba: "caixa" })
        : nav.href("/financeiro", { aba: "receber", filtro: "quitadas" }),
      tone: "money",
    },
  ];

  return (
    <section
      aria-labelledby="jornada"
      data-tour="jornada"
      className="mb-8 rounded-2xl border border-line bg-white shadow-card"
    >
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <h2 id="jornada" className="font-display text-lg font-bold">
          Do primeiro contato ao dinheiro no bolso
        </h2>
        <p className="text-muted">É isso que o sistema acompanha. Toque em uma etapa para ver os detalhes.</p>
      </div>
      {/*
        Uma trilha, não seis caixas: a linha liga as etapas na ordem em que o dinheiro anda.
        Tracejada enquanto é só conversa (pode não virar venda), contínua depois da venda fechada
        e verde quando o dinheiro entra. Em telas largas vira duas colunas: conversa | dinheiro.
      */}
      <ol className="grid p-2 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3 sm:gap-x-4 sm:px-4 sm:pb-4">
        {steps.map((s, i) => {
          const sold = i >= SOLD_STEP;
          const received = i === steps.length - 1;
          return (
            <li key={s.label} className="relative">
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute -bottom-2.5 left-[1.4375rem] top-[2.625rem] border-l-2",
                    i === SOLD_STEP - 1 && "sm:hidden",
                    i >= SOLD_STEP + 1 ? "border-money" : sold ? "border-navy" : "border-dashed border-[#aab6c9]",
                  )}
                />
              )}
              <Link
                href={s.href}
                className="relative flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-canvas active:bg-canvas"
              >
                <span
                  className={cx(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular",
                    received
                      ? "bg-money-700 text-white"
                      : sold
                        ? "bg-navy text-white"
                        : "border-2 border-dashed border-[#aab6c9] bg-white text-muted",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 pt-1">
                  <span className="block font-semibold leading-6">{s.label}</span>
                  <span className="block text-sm text-muted">{s.detail}</span>
                </span>
                <span
                  className={cx(
                    "shrink-0 whitespace-nowrap font-display text-lg font-extrabold leading-8 tabular",
                    s.tone === "money" ? "text-money-700" : s.tone === "danger" ? "text-danger" : "text-ink",
                  )}
                >
                  {s.value}
                </span>
                <IconChevronRight className="mt-2 h-4 w-4 shrink-0 text-[#8a97ab]" />
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A partir desta etapa (Vendido) o valor deixa de ser incerto. */
const SOLD_STEP = 3;
