"use client";
import { ChoiceCards } from "@/components/ui/fields";
import { SEGMENT_IDS, SEGMENTS } from "@/lib/domain/segments";
import type { Segment } from "@/lib/domain/types";

const OPTIONS = SEGMENT_IDS.map((id) => ({ value: id, label: SEGMENTS[id].label, description: SEGMENTS[id].examples }));

/** Escolha do ramo da empresa: decide os nomes das telas, os papéis da equipe e os campos das fichas. */
export function SegmentPicker({
  value,
  onChange,
  legend = "Qual é o ramo da empresa?",
}: {
  value: Segment;
  onChange: (v: Segment) => void;
  legend?: string;
}) {
  return <ChoiceCards legend={legend} name="ramo" value={value} onChange={onChange} options={OPTIONS} />;
}
