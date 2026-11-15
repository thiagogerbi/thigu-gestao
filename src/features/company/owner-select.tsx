"use client";
import { SelectField } from "@/components/ui/fields";
import { canAssignOthers } from "@/lib/domain/permissions";
import type { Member } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";

export function OwnerSelect({
  value,
  onChange,
  label = "Responsável",
  error,
  members,
  canChoose,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  members?: Member[];
  /** Pode escolher outra pessoa? Por padrão vale a regra de negociações e tarefas; a ficha do cliente tem a sua. */
  canChoose?: boolean;
}) {
  const { data, me } = useBackend();
  const t = useTerms();
  if (!(canChoose ?? canAssignOthers(me.roles))) {
    return (
      <div>
        <p className="mb-1 text-sm font-semibold">{label}</p>
        <p className="flex min-h-11 items-center rounded-lg border border-line bg-canvas px-3 text-muted">
          Você ({me.name})
        </p>
      </div>
    );
  }
  const list = members ?? data.members;
  return (
    <SelectField label={label} value={value} onChange={(e) => onChange(e.target.value)} error={error}>
      {list.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name} — {t.roleLabels(m.roles)}
        </option>
      ))}
    </SelectField>
  );
}
