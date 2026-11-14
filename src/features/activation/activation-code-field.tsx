"use client";

import { TextField } from "@/components/ui/fields";
import { formatCodeInput } from "@/lib/domain/activation";

/**
 * Campo do código de ativação. Formata enquanto a pessoa digita (THIGU-XXXX-XXXX-XXXX),
 * aceita colar o código inteiro do e-mail e ignora espaços e minúsculas.
 */
export function ActivationCodeField({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label="Código de ativação"
      value={value}
      onChange={(e) => onChange(e.target.value.trim() === "" ? "" : formatCodeInput(e.target.value))}
      error={error}
      hint="Está no e-mail que você recebeu depois da compra. Você pode copiar e colar."
      placeholder="THIGU-XXXX-XXXX-XXXX"
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      className="font-mono tracking-wider"
      data-autofocus={autoFocus || undefined}
    />
  );
}
