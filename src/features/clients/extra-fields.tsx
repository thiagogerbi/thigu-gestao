"use client";
import { SelectField, TextField } from "@/components/ui/fields";
import { formatDateBR } from "@/lib/domain/dates";
import type { FieldDef } from "@/lib/domain/segments";

/** Valor inicial de um formulário com campos do ramo: todos os campos presentes, vazios se não houver nada. */
export function fieldValues(fields: readonly FieldDef[], current: Record<string, string> | undefined) {
  return Object.fromEntries(fields.map((f) => [f.key, current?.[f.key] ?? ""]));
}

/** Campos do ramo (ficha do cliente ou do pet) dentro de um formulário. `prefix` casa com as chaves de erro. */
export function ExtraFields({
  fields,
  values,
  onChange,
  errors,
  prefix,
}: {
  fields: readonly FieldDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  errors: Record<string, string>;
  prefix: string;
}) {
  if (!fields.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const error = errors[`${prefix}.${f.key}`];
        const value = values[f.key] ?? "";
        if (f.type === "select") {
          return (
            <SelectField
              key={f.key}
              label={f.label}
              optional
              value={value}
              onChange={(e) => onChange(f.key, e.target.value)}
              error={error}
              hint={f.hint}
            >
              <option value="">Não informado</option>
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </SelectField>
          );
        }
        return (
          <TextField
            key={f.key}
            label={f.label}
            optional
            type={f.type === "date" ? "date" : "text"}
            value={value}
            onChange={(e) => onChange(f.key, e.target.value)}
            error={error}
            hint={f.hint}
            autoComplete="off"
            // textos longos (endereço, preferências) ocupam a linha inteira
            wrapperClassName={f.type === "text" && f.hint ? "sm:col-span-2" : undefined}
          />
        );
      })}
    </div>
  );
}

/** Os mesmos campos, só para leitura. Mostra apenas os preenchidos. */
export function ExtraFieldsView({ fields, values }: { fields: readonly FieldDef[]; values: Record<string, string> }) {
  const filled = fields.filter((f) => values[f.key]);
  if (!filled.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      {filled.map((f) => (
        <div key={f.key} className={f.type === "text" && f.hint ? "col-span-2" : undefined}>
          <dt className="text-muted">{f.label}</dt>
          <dd className="break-words font-semibold">
            {f.type === "date" ? formatDateBR(values[f.key]) : values[f.key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
