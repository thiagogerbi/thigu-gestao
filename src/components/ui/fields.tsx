"use client";
import { IconAlert } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useId } from "react";

const inputBase =
  "block w-full min-h-11 rounded-lg border bg-white px-3 text-base text-ink placeholder:text-[#6b7585] focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/20 disabled:bg-canvas";

function describedBy(id: string, hint?: React.ReactNode, error?: string | null) {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export function FieldShell({
  id,
  label,
  hint,
  error,
  optional,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
        {optional && <span className="font-normal text-muted"> (opcional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 flex items-start gap-1 text-sm font-medium text-danger">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = React.ComponentProps<"input"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  wrapperClassName?: string;
  prefix?: string;
};
export function TextField({
  label,
  hint,
  error,
  optional,
  wrapperClassName,
  prefix,
  id: idProp,
  className,
  ...rest
}: InputProps) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional} className={wrapperClassName}>
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">{prefix}</span>
        )}
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={cx(inputBase, error ? "border-danger" : "border-[#c5cfdf]", prefix && "pl-10", className)}
          {...rest}
        />
      </div>
    </FieldShell>
  );
}

export function MoneyField(props: Omit<InputProps, "prefix" | "inputMode">) {
  return (
    <TextField
      prefix="R$"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0,00"
      {...props}
      className={cx("tabular", props.className)}
    />
  );
}

export function SelectField({
  label,
  hint,
  error,
  optional,
  wrapperClassName,
  id: idProp,
  children,
  className,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  wrapperClassName?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional} className={wrapperClassName}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(inputBase, error ? "border-danger" : "border-[#c5cfdf]", className)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  wrapperClassName,
  id: idProp,
  className,
  ...rest
}: React.ComponentProps<"textarea"> & {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  wrapperClassName?: string;
}) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional} className={wrapperClassName}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cx(inputBase, "min-h-24 py-2", error ? "border-danger" : "border-[#c5cfdf]", className)}
        {...rest}
      />
    </FieldShell>
  );
}

export function ChoiceCards<T extends string>({
  legend,
  value,
  onChange,
  options,
  name,
}: {
  legend: string;
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; description?: string }[];
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-semibold">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              "flex cursor-pointer gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-primary/30",
              value === o.value ? "border-primary bg-primary-50" : "border-[#c5cfdf] bg-white hover:bg-canvas",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-1 h-4 w-4 accent-primary"
            />
            <span>
              <span className="block font-semibold">{o.label}</span>
              {o.description && <span className="block text-sm text-muted">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
