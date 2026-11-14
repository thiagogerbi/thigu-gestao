"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button, LinkButton } from "@/components/ui/button";
import { Badge, EmptyState } from "@/components/ui/card";
import { IconArrowLeft, IconCheck, IconPrinter } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { formatDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { canEditDeal } from "@/lib/domain/permissions";
import { itemTotalCents, proposalSubtotalCents, proposalTotalCents } from "@/lib/domain/proposals";
import { PROPOSAL_STATUS_LABEL } from "@/lib/domain/types";
import { useBackend, useMemberName } from "@/state/backend-context";
import { clientById, dealById, saleForDeal } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import Link from "next/link";

export function ProposalScreen({ proposalId }: { proposalId: string }) {
  const { data, me, mode, today } = useBackend();
  const name = useMemberName();
  const nav = useNav();
  const dialogs = useDialogs();
  const p = data.proposals.find((x) => x.id === proposalId);
  if (!p) {
    return (
      <EmptyState
        title="Proposta não encontrada"
        action={
          <LinkButton href={nav.href("/clientes")} variant="secondary">
            Ir para clientes
          </LinkButton>
        }
      >
        Ela pode ser de outra empresa ou você não tem acesso a ela.
      </EmptyState>
    );
  }
  const client = clientById(data, p.clientId);
  const deal = dealById(data, p.dealId);
  const sale = deal ? saleForDeal(data, deal.id) : undefined;
  const total = proposalTotalCents(p.items, p.discountCents);
  const subtotal = proposalSubtotalCents(p.items);
  const editable = deal ? canEditDeal(me.roles, me.userId, deal) : false;
  const expired = p.status !== "aceita" && p.validUntil < today;

  const steps = [
    { label: "Preparada", done: true },
    { label: "Enviada", done: p.status !== "rascunho" },
    { label: "Aceita pelo cliente", done: p.status === "aceita" },
    { label: "Venda fechada", done: Boolean(sale) },
    { label: "Parcelas confirmadas", done: sale?.status === "confirmada" },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={client ? `${nav.href("/clientes")}?cliente=${client.id}&negociacao=${p.dealId}` : nav.href("/clientes")}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-primary-700 hover:bg-primary-50"
        >
          <IconArrowLeft className="h-4 w-4" /> Ficha de {client?.name ?? "cliente"}
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            <IconPrinter className="h-5 w-5" /> Imprimir ou salvar em PDF
          </Button>
          {editable && p.status !== "aceita" && (
            <Button variant="secondary" onClick={() => dialogs.open({ kind: "proposal", proposalId: p.id })}>
              Editar proposta
            </Button>
          )}
          {editable && (p.status === "rascunho" || p.status === "enviada") && (
            <Button
              variant={p.status === "rascunho" ? "primary" : "secondary"}
              onClick={() => dialogs.open({ kind: "sendProposal", proposalId: p.id })}
            >
              {mode === "previa"
                ? p.status === "enviada"
                  ? "Simular reenvio"
                  : "Simular envio"
                : p.status === "enviada"
                  ? "Registrar novo envio"
                  : "Registrar envio"}
            </Button>
          )}
          {editable && p.status === "enviada" && (
            <Button variant="secondary" onClick={() => dialogs.open({ kind: "rejectProposal", proposalId: p.id })}>
              Cliente recusou
            </Button>
          )}
          {editable && p.status === "enviada" && (
            <Button data-tour="aceite" onClick={() => dialogs.open({ kind: "acceptProposal", proposalId: p.id })}>
              <IconCheck className="h-5 w-5" /> Registrar aceite do cliente
            </Button>
          )}
          {editable && p.status === "aceita" && !sale && deal && (
            <Button
              variant="money"
              onClick={() => dialogs.open({ kind: "closeSale", dealId: deal.id, proposalId: p.id })}
            >
              Fechar venda
            </Button>
          )}
          {sale?.status === "aguardando_conferencia" && (
            <Button variant="secondary" onClick={() => dialogs.open({ kind: "reviewSale", saleId: sale.id })}>
              Ver confirmação das parcelas
            </Button>
          )}
        </div>
      </div>

      <ol className="mb-5 flex flex-wrap gap-2 print:hidden" aria-label="Andamento da proposta">
        {steps.map((s, i) => (
          <li
            key={s.label}
            className={cx(
              "flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
              s.done ? "border-[#bfe8d8] bg-money-50 text-money-700" : "border-line bg-white text-muted",
            )}
          >
            <span
              className={cx(
                "flex h-5 w-5 items-center justify-center rounded-full text-xs",
                s.done ? "bg-money-700 text-white" : "bg-canvas",
              )}
            >
              {s.done ? <IconCheck className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
          </li>
        ))}
      </ol>

      <article
        className="mx-auto max-w-3xl rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        aria-label={`Proposta comercial nº ${p.number}`}
      >
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div>
            <p className="font-display text-xl font-extrabold text-navy">{data.company.name}</p>
            <p className="text-sm text-muted">Responsável: {deal ? name(deal.ownerId) : "—"}</p>
          </div>
          <div className="text-right">
            <h1 className="font-display text-2xl font-bold">Proposta comercial nº {p.number}</h1>
            <p className="text-sm text-muted">Emitida em {formatDateBR(p.createdAt)}</p>
            <div className="mt-1 print:hidden">
              <Badge
                tone={
                  p.status === "aceita"
                    ? "green"
                    : p.status === "recusada"
                      ? "red"
                      : p.status === "enviada"
                        ? "blue"
                        : "gray"
                }
              >
                {PROPOSAL_STATUS_LABEL[p.status]}
              </Badge>
              {expired && (
                <Badge tone="amber" className="ml-1">
                  Validade vencida
                </Badge>
              )}
            </div>
          </div>
        </header>

        <section className="mb-6 grid gap-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Para</p>
          <p className="text-lg font-semibold">{client?.name}</p>
          {client?.email && <p className="text-sm">{client.email}</p>}
          {client?.phone && <p className="text-sm">{client.phone}</p>}
          {deal && (
            <p className="mt-2 text-sm">
              Referente a: <strong>{deal.title}</strong>
            </p>
          )}
        </section>

        <section className="mb-6">
          <h2 className="mb-2 font-display text-lg font-bold">Serviços e itens</h2>
          <ul className="divide-y divide-line border-y border-line">
            {p.items.map((it, i) => (
              <li key={i} className="grid gap-1 py-3 sm:grid-cols-[1fr_90px_130px_130px] sm:items-center sm:gap-3">
                <span className="font-medium">{it.description}</span>
                <span className="text-sm text-muted sm:text-right sm:text-ink">
                  <span className="sm:hidden">Quantidade: </span>
                  {String(it.quantity).replace(".", ",")}
                </span>
                <span className="text-sm text-muted tabular sm:text-right sm:text-ink">
                  <span className="sm:hidden">Preço unitário: </span>
                  {formatBRL(it.unitCents)}
                </span>
                <span className="font-semibold tabular sm:text-right">
                  <span className="font-normal text-muted sm:hidden">Total: </span>
                  {formatBRL(itemTotalCents(it))}
                </span>
              </li>
            ))}
          </ul>
          <dl className="ml-auto mt-3 grid max-w-xs gap-1 text-base tabular">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatBRL(subtotal)}</dd>
            </div>
            {p.discountCents > 0 && (
              <div className="flex justify-between">
                <dt>Desconto</dt>
                <dd>− {formatBRL(p.discountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-lg font-bold">
              <dt>Total</dt>
              <dd>{formatBRL(total)}</dd>
            </div>
          </dl>
        </section>

        <section className="mb-6">
          <h2 className="mb-1 font-display text-lg font-bold">Condições comerciais</h2>
          <p className="whitespace-pre-line">{p.terms || "—"}</p>
        </section>

        <p className="border-t border-line pt-4 text-sm text-muted">
          Proposta válida até {formatDateBR(p.validUntil)}.
        </p>
        {mode === "previa" && (
          <p className="mt-2 text-xs text-muted">
            Documento de exemplo gerado na prévia do Thigu Gestão com dados fictícios.
          </p>
        )}
      </article>
    </>
  );
}
