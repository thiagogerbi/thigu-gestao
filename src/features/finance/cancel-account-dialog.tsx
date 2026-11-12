"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { activeMovements } from "@/lib/domain/accounts";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { useAction, useBackend } from "@/state/backend-context";
import { accountView } from "@/state/selectors";
import { useState } from "react";

export function CancelAccountDialog({ onClose, accountId }: DialogProps & { accountId: string }) {
  const { data, today } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const [reason, setReason] = useState("");
  const acc = data.accounts.find((a) => a.id === accountId);
  if (!acc) return null;
  const v = accountView(data, acc, today);
  const hasMovements = activeMovements(acc.id, data.movements).length > 0;
  async function confirm() {
    const r = await exec({ type: "account.cancel", accountId, reason });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      onClose();
    }
  }
  const label =
    acc.installmentCount > 1
      ? `Cancelar parcela ${acc.installmentNumber} de ${acc.installmentCount}`
      : "Cancelar esta conta";
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      dirty={reason !== ""}
      title={label}
      description={
        <>
          {v.partyName} · {formatBRL(acc.amountCents)} · vence {formatShortDateBR(acc.dueDate)}
        </>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar sem cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={pending} disabled={hasMovements}>
            {label}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {hasMovements ? (
          <InlineAlert tone="amber" title="Antes, desfaça os registros">
            Esta conta tem {acc.kind === "receber" ? "recebimentos" : "pagamentos"} registrados. Desfaça-os primeiro
            para manter o caixa correto.
          </InlineAlert>
        ) : (
          <InlineAlert tone="amber" title="O que acontece">
            A conta continua no histórico como <strong>cancelada</strong>, mas sai dos totais a{" "}
            {acc.kind === "receber" ? "receber" : "pagar"} e dos alertas. Não é possível desfazer o cancelamento.
          </InlineAlert>
        )}
        <TextAreaField
          label="Motivo do cancelamento"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            clearField("reason");
          }}
          error={fieldErrors.reason ?? (Object.keys(fieldErrors).length ? undefined : error)}
          disabled={hasMovements}
          data-autofocus
        />
      </div>
    </Modal>
  );
}
