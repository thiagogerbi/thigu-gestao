"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { useAction, useBackend } from "@/state/backend-context";
import { useState } from "react";

export function RejectProposalDialog({ onClose, proposalId }: DialogProps & { proposalId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const [reason, setReason] = useState("");
  const p = data.proposals.find((x) => x.id === proposalId);
  if (!p) return null;
  async function confirm() {
    const r = await exec({ type: "proposal.reject", id: proposalId, reason: reason.trim() || null });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      dirty={reason !== ""}
      title={`Proposta nº ${p.number} recusada`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending}>
            Marcar proposta como recusada
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        {error && <InlineAlert>{error}</InlineAlert>}
        <p className="text-sm">
          A negociação continua aberta: você pode preparar uma nova proposta ou marcá-la como perdida depois.
        </p>
        <TextAreaField
          label="O que o cliente disse?"
          optional
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-autofocus
        />
      </div>
    </Modal>
  );
}
