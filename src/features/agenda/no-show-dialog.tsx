"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { timeRange } from "@/lib/domain/agenda";
import { formatBRL } from "@/lib/domain/money";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";

/** Registrar uma falta, escolhendo se ela será cobrada (a cobrança vira conta a receber). */
export function NoShowDialog({ onClose, appointmentId }: DialogProps & { appointmentId: string }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const ap = data.appointments.find((a) => a.id === appointmentId);
  if (!ap) {
    return (
      <Modal open onClose={onClose} title="Horário não encontrado" size="sm">
        <p>Este horário não existe mais ou você não tem acesso a ele.</p>
      </Modal>
    );
  }
  const name = clientById(data, ap.clientId)?.name ?? "";
  async function save(charge: boolean) {
    const r = await exec({ type: "appointment.setStatus", id: appointmentId, status: "faltou", charge });
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
      title={`${name} faltou?`}
      description={`Horário das ${timeRange(ap)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Voltar
          </Button>
          {ap.packageId ? (
            <Button variant="secondary" loading={pending} onClick={() => save(true)}>
              Registrar e descontar do pacote
            </Button>
          ) : (
            ap.priceCents > 0 && (
              <Button variant="secondary" loading={pending} onClick={() => save(true)}>
                Registrar e cobrar {formatBRL(ap.priceCents)}
              </Button>
            )
          )}
          <Button loading={pending} onClick={() => save(false)}>
            Registrar sem cobrar
          </Button>
        </>
      }
    >
      {error && <InlineAlert>{error}</InlineAlert>}
      <p>
        {ap.packageId
          ? "Este horário usa um pacote. Se a falta for cobrada, uma sessão do pacote é descontada."
          : ap.priceCents > 0
            ? "Se a falta for cobrada, o valor vai para o financeiro como conta a receber."
            : "Este horário não tem valor, então a falta não gera cobrança."}
      </p>
    </Modal>
  );
}
