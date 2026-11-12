"use client";
import { SelectField } from "@/components/ui/fields";
import { canAssignOthers } from "@/lib/domain/permissions";
import { ROLE_LABEL, type Member } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";

export function OwnerSelect({
  value,
  onChange,
  label = "Responsável",
  error,
  members,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  members?: Member[];
}) {
  const { data, me } = useBackend();
  if (!canAssignOthers(me.roles)) {
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
          {m.name} — {m.roles.map((r) => ROLE_LABEL[r]).join(", ")}
        </option>
      ))}
    </SelectField>
  );
}
