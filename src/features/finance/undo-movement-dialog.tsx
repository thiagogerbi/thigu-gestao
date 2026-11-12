"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { formatDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { useAction, useBackend } from "@/state/backend-context";
import { accountView, installmentLabel } from "@/state/selectors";
import { useState } from "react";

export function UndoMovementDialog({ onClose, movementId }: DialogProps & { movementId: string }) {
  const { data, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const [reason, setReason] = useState("");
  const mv = data.movements.find((m) => m.id === movementId);
  const acc = mv && data.accounts.find((a) => a.id === mv.accountId);
  if (!mv || !acc) return null;
  const v = accountView(data, acc, today);
  const isIn = mv.direction === "entrada";
  async function confirm() {
    const r = await exec({ type: "movement.undo", movementId, reason });
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
      title={`Desfazer ${isIn ? "recebimento" : "pagamento"}`}
      description={
        <>
          {v.partyName} · {installmentLabel(acc)} · {formatBRL(mv.amountCents)} em {formatDateBR(mv.paidOn)}
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Manter registro
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending}>
            Desfazer registro de {formatBRL(mv.amountCents)}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <InlineAlert tone="amber" title="O que acontece">
          O registro <strong>não é apagado</strong>: ele fica no histórico marcado como desfeito.{" "}
          {formatBRL(mv.amountCents)} volta a constar como em aberto nesta{" "}
          {acc.kind === "receber" ? "parcela" : "conta"} e o caixa realizado {isIn ? "diminui" : "aumenta"} esse valor.
        </InlineAlert>
        <TextAreaField
          label="Por que está desfazendo?"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            clearField("reason");
          }}
          error={fieldErrors.reason ?? (Object.keys(fieldErrors).length ? undefined : error)}
          hint="Ex.: valor lançado em duplicidade"
          data-autofocus
        />
      </div>
    </Modal>
  );
}
