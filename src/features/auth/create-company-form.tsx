"use client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { SegmentPicker } from "@/features/company/segment-picker";
import type { Segment } from "@/lib/domain/types";
import { createCompany } from "@/lib/server/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateCompanyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [segment, setSegment] = useState<Segment>("geral");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await createCompany(name, segment);
    setPending(false);
    if (!r.ok) return setError(r.fieldErrors?.name ?? r.message);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <TextField
        label="Nome da empresa"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        error={error}
        data-autofocus
      />
      <div>
        <SegmentPicker value={segment} onChange={setSegment} />
        <p className="mt-2 text-sm text-muted">
          O sistema se ajusta ao ramo: nomes das telas, papéis da equipe e campos das fichas. Dá para trocar depois em
          “Minha empresa”.
        </p>
      </div>
      <Button type="submit" loading={pending}>
        Criar empresa
      </Button>
    </form>
  );
}
