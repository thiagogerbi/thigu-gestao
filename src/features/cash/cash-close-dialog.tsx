"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { MoneyField, TextAreaField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { expectedCash, openSession } from "@/lib/domain/cash";
import { formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useState } from "react";

/** Fecha o caixa: conta o dinheiro da gaveta e compara com o esperado. Diferença fica registrada. */
export function CashCloseDialog({ onClose }: DialogProps) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const session = openSession(data.cashSessions);
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const formId = useId();
  const expected = session ? expectedCash(session, data.movements) : 0;
  const cents = parseBRLToCents(counted);
  const diff = cents === null ? null : cents - expected;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (cents === null || cents < 0) return setLocalError("Digite quanto dinheiro tem na gaveta.");
    if (diff !== 0 && !notes.trim())
      return setLocalError("O valor não bateu. Escreva uma observação (ex.: troco dado errado, sangria).");
    setLocalError(null);
    const r = await exec({ type: "cash.close", sessionId: session.id, countedCents: cents, notes: notes.trim() });
    if (r.ok) {
      toast({ tone: diff === 0 ? "success" : "info", text: r.message });
      onClose();
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={counted !== "" || notes !== ""}
      title="Fechar caixa"
      description="Conte só o dinheiro em espécie. Pix e cartão não ficam na gaveta."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending} disabled={!session}>
            Fechar caixa
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-4" noValidate>
        {(localError || error) && <InlineAlert>{localError ?? error}</InlineAlert>}
        <div className="flex items-baseline justify-between rounded-lg bg-canvas px-3 py-2">
          <span className="font-semibold">Deveria ter na gaveta</span>
          <span className="font-display text-xl font-extrabold tabular">{formatBRL(expected)}</span>
        </div>
        <MoneyField
          label="Quanto tem na gaveta"
          value={counted}
          onChange={(e) => {
            setCounted(e.target.value);
            setLocalError(null);
          }}
          data-autofocus
        />
        {diff !== null &&
          (diff === 0 ? (
            <InlineAlert tone="green">Conferiu certinho.</InlineAlert>
          ) : (
            <InlineAlert tone="amber">
              {diff > 0 ? `Sobrando ${formatBRL(diff)}.` : `Faltando ${formatBRL(-diff)}.`} Confira de novo ou explique
              abaixo.
            </InlineAlert>
          ))}
        <TextAreaField
          label="Observação"
          optional={diff === 0 || diff === null}
          value={notes}
          maxLength={500}
          onChange={(e) => {
            setNotes(e.target.value);
            setLocalError(null);
          }}
        />
      </form>
    </Modal>
  );
}
