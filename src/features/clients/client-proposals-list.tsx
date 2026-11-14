"use client";
import { ClientSection } from "@/features/clients/client-section";
import { formatDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { proposalTotalCents } from "@/lib/domain/proposals";
import { PROPOSAL_STATUS_LABEL, type Proposal } from "@/lib/domain/types";
import { useNav } from "@/state/use-nav";
import Link from "next/link";

/** Propostas do cliente, da mais recente para a mais antiga. */
export function ClientProposalsList({ proposals, hasOpenDeals }: { proposals: Proposal[]; hasOpenDeals: boolean }) {
  const nav = useNav();
  return (
    <ClientSection title="Propostas" collapsible count={proposals.length}>
      {proposals.length === 0 ? (
        <p className="text-sm text-muted">
          Nenhuma proposta. {hasOpenDeals ? "Use “Preparar proposta” para montar uma." : ""}
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
                className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 sm:min-h-9"
              >
                Ver proposta
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ClientSection>
  );
}
