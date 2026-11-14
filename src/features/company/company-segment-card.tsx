"use client";
import { Button } from "@/components/ui/button";
import { Card, InlineAlert } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { SegmentPicker } from "@/features/company/segment-picker";
import { SEGMENTS } from "@/lib/domain/segments";
import type { Segment } from "@/lib/domain/types";
import { useAction, useBackend, useCan } from "@/state/backend-context";
import { useState } from "react";

/** Ramo da empresa. Só o administrador troca; os demais veem qual é. */
export function CompanySegmentCard() {
  const { data } = useBackend();
  const canDo = useCan();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const current = data.company.segment;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<Segment>(current);

  async function save() {
    const r = await exec({ type: "company.setSegment", segment: choice });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      setEditing(false);
    }
  }

  return (
    <Card className="mb-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Ramo da empresa</h2>
          <p className="mt-1 font-semibold">{SEGMENTS[current].label}</p>
          <p className="text-sm text-muted">{SEGMENTS[current].examples}</p>
        </div>
        {canDo("empresa.gerenciar") && !editing && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setChoice(current);
              setEditing(true);
            }}
          >
            Trocar ramo
          </Button>
        )}
      </div>
      {editing && (
        <div className="mt-4 grid gap-3 border-t border-line pt-4">
          {error && <InlineAlert>{error}</InlineAlert>}
          <SegmentPicker value={choice} onChange={setChoice} legend="Escolha o novo ramo" />
          <p className="text-sm text-muted">
            Trocar o ramo muda os nomes das telas, os papéis oferecidos à equipe e os campos das fichas. Nenhum dado é
            apagado: o que não se aplica ao novo ramo fica guardado e volta se você trocar de novo.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={pending} disabled={choice === current}>
              Salvar ramo
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
