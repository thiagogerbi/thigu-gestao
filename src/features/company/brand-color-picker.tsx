"use client";
import { IconCheck } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { BRAND_PRESETS, brandPalette, THIGU_BLUE } from "@/lib/domain/branding";
import { useId } from "react";

/** Escolha da cor da marca: sugestões prontas ou qualquer cor, com aviso quando ela precisa ser escurecida. */
export function BrandColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
}) {
  const id = useId();
  const current = value ?? THIGU_BLUE;
  const palette = brandPalette(current);
  const isPreset = BRAND_PRESETS.some((p) => p.hex === current);
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-semibold text-ink">Cor da marca</legend>
      <p id={`${id}-hint`} className="mb-2 text-sm text-muted">
        Usada nos botões e destaques. O verde do dinheiro e os alertas continuam iguais.
      </p>
      <div className="flex flex-wrap items-center gap-2" aria-describedby={`${id}-hint`}>
        {BRAND_PRESETS.map((p) => {
          const selected = p.hex === current;
          return (
            <button
              key={p.hex}
              type="button"
              onClick={() => onChange(p.hex === THIGU_BLUE ? null : p.hex)}
              aria-pressed={selected}
              aria-label={p.label}
              title={p.label}
              className={cx(
                "flex h-11 w-11 items-center justify-center rounded-full border-2 text-white",
                selected ? "border-ink" : "border-transparent",
              )}
              style={{ backgroundColor: p.hex }}
            >
              {selected && <IconCheck className="h-5 w-5" />}
            </button>
          );
        })}
        <label
          className={cx(
            "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-3 text-sm font-semibold",
            !isPreset ? "border-ink" : "border-line",
          )}
        >
          <input
            type="color"
            value={current}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
            className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          Outra cor
        </label>
      </div>
      {palette.adjusted && (
        <p className="mt-2 flex items-start gap-2 text-sm text-warn" role="status">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded"
            style={{ backgroundColor: palette.primary }}
          />
          Essa cor é clara demais para o texto branco dos botões. Vamos usar um tom mais escuro dela, como o da amostra,
          para que todos consigam ler. Veja na prévia abaixo.
        </p>
      )}
    </fieldset>
  );
}
