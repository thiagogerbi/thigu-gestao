"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { addDays, formatDateBR } from "@/lib/domain/dates";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById, firstName } from "@/state/selectors";
import { useState } from "react";

export function SendProposalDialog({ onClose, proposalId }: DialogProps & { proposalId: string }) {
  const { data, mode, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const [followUp, setFollowUp] = useState(true);
  const p = data.proposals.find((x) => x.id === proposalId);
  if (!p) return null;
  const client = clientById(data, p.clientId);
  const isPreview = mode === "previa";
  async function confirm() {
    const r = await exec({ type: "proposal.markSent", id: proposalId, followUpTask: followUp });
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
      title={isPreview ? "Simular envio da proposta" : "Registrar envio da proposta"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={pending}>
            {isPreview ? "Simular envio" : "Registrar que enviei"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {error && <InlineAlert>{error}</InlineAlert>}
        <InlineAlert tone="blue" title={isPreview ? "Isto é uma simulação" : "O sistema não envia mensagens"}>
          {isPreview
            ? "Na prévia nada é enviado de verdade. Vamos apenas marcar a proposta como enviada."
            : `Envie a proposta para ${client?.name ?? "o cliente"} por e-mail, WhatsApp ou pessoalmente (use “Imprimir ou salvar em PDF”). Aqui você só registra que enviou.`}
        </InlineAlert>
        <label className="flex cursor-pointer gap-3 rounded-lg border border-line p-3">
          <input
            type="checkbox"
            checked={followUp}
            onChange={(e) => setFollowUp(e.target.checked)}
            className="mt-1 h-4 w-4 accent-primary"
          />
          <span>
            <span className="block font-semibold">Criar tarefa de retorno para {formatDateBR(addDays(today, 2))}</span>
            <span className="block text-sm text-muted">
              Daqui a 2 dias, para perguntar a {client ? firstName(client.name) : "o cliente"} o que achou.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
