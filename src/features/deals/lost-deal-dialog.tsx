"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { useAction, useBackend } from "@/state/backend-context";
import { dealById } from "@/state/selectors";
import { useId, useState } from "react";

const LOST_SUGGESTIONS = [
  "Achou caro",
  "Escolheu outro fornecedor",
  "Parou de responder",
  "Adiou a decisão",
  "Não era o que precisava",
];

export function LostDealDialog({ onClose, dealId }: DialogProps & { dealId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const deal = dealById(data, dealId);
  const [reason, setReason] = useState("");
  const formId = useId();
  if (!deal) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({ type: "deal.move", id: dealId, stage: "perdida", lostReason: reason });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      dirty={reason.trim() !== ""}
      size="sm"
      title="Marcar negociação como perdida"
      description={<>“{deal.title}”. Saber o motivo ajuda a melhorar as próximas vendas.</>}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar sem alterar
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={pending}>
            Marcar como perdida
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-3" noValidate>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Motivos comuns">
          {LOST_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setReason(s);
                clearField("lostReason");
              }}
              className="min-h-9 rounded-full border border-line bg-white px-3 text-sm hover:bg-canvas"
              aria-pressed={reason === s}
            >
              {s}
            </button>
          ))}
        </div>
        <TextAreaField
          label="Motivo da perda"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            clearField("lostReason");
          }}
          error={fieldErrors.lostReason || (error && !Object.keys(fieldErrors).length ? error : undefined)}
          data-autofocus
        />
      </form>
    </Modal>
  );
}
