"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { formatBRL } from "@/lib/domain/money";
import { proposalTotalCents } from "@/lib/domain/proposals";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById, dealById } from "@/state/selectors";
import { useState } from "react";

export function AcceptProposalDialog({ onClose, proposalId, open }: DialogProps & { proposalId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const p = data.proposals.find((x) => x.id === proposalId);
  const deal = p && dealById(data, p.dealId);
  const total = p ? proposalTotalCents(p.items, p.discountCents) : 0;
  const differs = deal ? deal.valueCents !== total : false;
  const [updateValue, setUpdateValue] = useState(true);
  if (!p || !deal) return null;
  const client = clientById(data, p.clientId);
  async function confirm() {
    const r = await exec({ type: "proposal.accept", id: proposalId, updateDealValue: differs && updateValue });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      open({ kind: "closeSale", dealId: deal!.id, proposalId });
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Registrar aceite da proposta nº ${p.number}`}
      description={
        <>
          {client?.name} aceitou a proposta de <strong className="text-ink">{formatBRL(total)}</strong>?
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={pending}>
            Registrar aceite de {formatBRL(total)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <InlineAlert>{error}</InlineAlert>}
        <p className="text-sm">
          Nada muda até você clicar no botão abaixo. Em seguida, você poderá fechar a venda e escolher as parcelas.
        </p>
        {differs && (
          <label className="flex cursor-pointer gap-3 rounded-lg border border-line p-3">
            <input
              type="checkbox"
              checked={updateValue}
              onChange={(e) => setUpdateValue(e.target.checked)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block font-semibold">Atualizar o valor da negociação para {formatBRL(total)}</span>
              <span className="block text-sm text-muted">Hoje ela está com {formatBRL(deal.valueCents)}.</span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}
