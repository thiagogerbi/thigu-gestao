"use client";
import { Button } from "@/components/ui/button";
import { TextAreaField } from "@/components/ui/fields";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { ClientSection } from "@/features/clients/client-section";
import { formatDateTimeBR } from "@/lib/domain/dates";
import type { Deal } from "@/lib/domain/types";
import { useAction, useBackend, useMemberName } from "@/state/backend-context";
import { useState } from "react";

/** Campo da anotação: a ficha rola até ele quando a pessoa escolhe "Anotar conversa". */
export const NOTE_FIELD_ID = "ficha-anotacao";

/**
 * Anotações e histórico do cliente numa linha do tempo só. O texto da anotação fica no componente
 * de cima (a ficha), que avisa antes de fechar se houver algo escrito e não salvo.
 */
export function ClientHistory({
  clientId,
  deals,
  focusDeal,
  mayNote,
  note,
  onNoteChange,
}: {
  clientId: string;
  deals: Deal[];
  focusDeal: string | null;
  mayNote: boolean;
  note: string;
  onNoteChange: (text: string) => void;
}) {
  const { data } = useBackend();
  const name = useMemberName();
  const toast = useToast();
  const { exec, pending, error, clear } = useAction();
  const [noteDeal, setNoteDeal] = useState(focusDeal ?? "");

  const timeline = [
    ...data.activities
      .filter((a) => a.clientId === clientId)
      .map((a) => ({ id: a.id, at: a.createdAt, who: a.actorId, text: a.description, kind: "evento" as const })),
    ...data.notes
      .filter((n) => n.clientId === clientId)
      .map((n) => ({ id: n.id, at: n.createdAt, who: n.authorId, text: n.body, kind: "anotacao" as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({ type: "note.add", clientId, dealId: noteDeal || null, body: note });
    if (r.ok) {
      onNoteChange("");
      toast({ tone: "success", text: "Anotação registrada no histórico." });
    }
  }

  return (
    <ClientSection title="Anotações e histórico" id="ficha-historico">
      {mayNote && (
        <form onSubmit={saveNote} className="mb-4 grid gap-2">
          <TextAreaField
            id={NOTE_FIELD_ID}
            label="O que foi combinado com o cliente?"
            value={note}
            onChange={(e) => {
              onNoteChange(e.target.value);
              clear();
            }}
            error={error}
            placeholder="Ex.: Combinamos entrega na sexta e pagamento via Pix."
          />
          <div className="flex flex-wrap items-end gap-2">
            {deals.length > 0 && (
              <label className="text-sm">
                <span className="mb-1 block font-semibold">Sobre</span>
                <select
                  value={noteDeal}
                  onChange={(e) => setNoteDeal(e.target.value)}
                  className="min-h-11 rounded-lg border border-[#c5cfdf] bg-white px-2 sm:min-h-10"
                >
                  <option value="">O cliente em geral</option>
                  {deals.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button type="submit" size="sm" loading={pending} disabled={!note.trim()}>
              Salvar anotação
            </Button>
          </div>
        </form>
      )}
      {timeline.length === 0 ? (
        <p className="text-sm text-muted">Nada registrado ainda.</p>
      ) : (
        <ol className="relative grid gap-3 border-l-2 border-line pl-4">
          {timeline.map((t) => (
            <li key={t.id} className="relative">
              <span
                aria-hidden="true"
                className={cx(
                  "absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-white",
                  t.kind === "anotacao" ? "bg-primary" : "bg-[#9aa6b8]",
                )}
              />
              <p className="text-sm text-muted">
                {formatDateTimeBR(t.at)} · {name(t.who)}
                {t.kind === "anotacao" ? " · Anotação" : ""}
              </p>
              <p className={cx("text-base", t.kind === "anotacao" && "rounded-lg bg-primary-50 px-3 py-2")}>{t.text}</p>
            </li>
          ))}
        </ol>
      )}
    </ClientSection>
  );
}
