"use client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { ClientSection } from "@/features/clients/client-section";
import { localParts, timeRange } from "@/lib/domain/agenda";
import { formatDateBR, formatDateTimeBR } from "@/lib/domain/dates";
import type { ClinicalNote } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useAgenda } from "@/state/use-agenda";
import { useState } from "react";

/**
 * Ficha de atendimento (prontuário). Só quem escreveu lê — nem o administrador.
 * Nada é apagado nem editado: para corrigir, escreve-se uma correção, que fica ligada à anotação original.
 */
export function ClientClinicalNotes({ clientId }: { clientId: string }) {
  const { data, me, today } = useBackend();
  const ag = useAgenda();
  const toast = useToast();
  const { exec, pending, error, clear } = useAction();
  const [body, setBody] = useState("");
  const [correcting, setCorrecting] = useState<ClinicalNote | null>(null);
  const notes = data.clinicalNotes
    .filter((n) => n.clientId === clientId && n.authorId === me.userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const corrected = new Set(notes.map((n) => n.correctsId).filter(Boolean));
  // anotação de hoje fica ligada ao atendimento de hoje com este paciente, se houver
  const todayAppointment = data.appointments.find(
    (a) =>
      a.clientId === clientId && localParts(a.startsAt).date === today && ag.canManage(a) && a.status !== "cancelado",
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({
      type: "clinicalNote.add",
      clientId,
      appointmentId: correcting ? correcting.appointmentId : (todayAppointment?.id ?? null),
      body,
      correctsId: correcting?.id ?? null,
    });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      setBody("");
      setCorrecting(null);
    }
  }

  return (
    <ClientSection title="Ficha de atendimento" collapsible defaultOpen count={notes.length}>
      <p className="mb-3 rounded-lg bg-canvas px-3 py-2 text-sm text-muted">
        Só você vê o que escreve aqui. As anotações não podem ser apagadas nem editadas: para corrigir, escreva uma
        correção.
      </p>
      <form onSubmit={save} className="mb-4 grid gap-2" noValidate>
        {correcting && (
          <InlineAlert tone="amber" title={`Corrigindo a anotação de ${formatDateTimeBR(correcting.createdAt)}`}>
            <p className="line-clamp-2">{correcting.body}</p>
          </InlineAlert>
        )}
        <TextAreaField
          label={correcting ? "Correção" : "Nova anotação"}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            clear();
          }}
          error={error}
          maxLength={5000}
          hint={
            !correcting && todayAppointment
              ? `Fica ligada ao atendimento de hoje (${timeRange(todayAppointment)}).`
              : undefined
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" loading={pending} disabled={!body.trim()}>
            {correcting ? "Salvar correção" : "Salvar anotação"}
          </Button>
          {correcting && (
            <Button size="sm" variant="ghost" onClick={() => setCorrecting(null)}>
              Desistir da correção
            </Button>
          )}
        </div>
      </form>
      {notes.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma anotação sua ainda.</p>
      ) : (
        <ol className="grid gap-3">
          {notes.map((n) => {
            const original = n.correctsId ? notes.find((o) => o.id === n.correctsId) : undefined;
            return (
              <li key={n.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold text-muted">
                  {formatDateTimeBR(n.createdAt)}
                  {original && ` · correção da anotação de ${formatDateBR(original.createdAt)}`}
                  {corrected.has(n.id) && " · corrigida depois"}
                </p>
                <p
                  className={
                    corrected.has(n.id)
                      ? "mt-1 whitespace-pre-wrap text-muted line-through"
                      : "mt-1 whitespace-pre-wrap"
                  }
                >
                  {n.body}
                </p>
                {!corrected.has(n.id) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="-ml-2 mt-1"
                    onClick={() => {
                      setCorrecting(n);
                      setBody(n.body);
                    }}
                  >
                    Corrigir
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </ClientSection>
  );
}
