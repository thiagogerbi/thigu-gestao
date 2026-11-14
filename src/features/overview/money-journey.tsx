"use client";

import { IconArrowRight } from "@/components/ui/icons";
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
      className="mb-8 rounded-2xl border border-line bg-white p-4 sm:p-5"
    >
      <h2 id="jornada" className="font-display text-lg font-bold">
        Do primeiro contato ao dinheiro no bolso
      </h2>
      <p className="mb-4 text-muted">É isso que o sistema acompanha. Toque em uma etapa para ver os detalhes.</p>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {steps.map((s, i) => (
          <li key={s.label} className="relative">
            <Link
              href={s.href}
              className="flex h-full flex-col rounded-xl border border-line bg-canvas p-3 hover:border-primary hover:bg-primary-50"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-muted">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs text-white">
                  {i + 1}
                </span>
                {s.label}
              </span>
              <span
                className={cx(
                  "mt-1 font-display text-xl font-extrabold tabular",
                  s.tone === "money" ? "text-money-700" : s.tone === "danger" ? "text-danger" : "text-ink",
                )}
              >
                {s.value}
              </span>
              <span className="text-sm text-muted">{s.detail}</span>
            </Link>
            {i < steps.length - 1 && (
              <IconArrowRight className="absolute -right-2.5 top-1/2 z-10 hidden h-4 w-4 -translate-y-1/2 text-[#9aa6b8] xl:block" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
