"use client";
import { IconCheck } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { MENU_PRESETS, menuPalette, THIGU_NAVY } from "@/lib/domain/branding";
import { useId } from "react";

/** Cor do menu lateral: automática (tom escuro da cor da marca), sugestões escuras ou qualquer cor. */
export function MenuColorPicker({
  brandColor,
  value,
  onChange,
}: {
  brandColor: string | null;
  value: string | null;
  onChange: (hex: string | null) => void;
}) {
  const id = useId();
  const palette = menuPalette(brandColor, value);
  const auto = menuPalette(brandColor, null).navy;
  const isPreset = value !== null && MENU_PRESETS.some((p) => p.hex === value);
  const swatch = (selected: boolean) =>
    cx(
      "flex h-11 w-11 items-center justify-center rounded-full border-2 text-white",
      selected ? "border-ink" : "border-transparent",
    );
  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-semibold text-ink">Cor do menu lateral</legend>
      <p id={`${id}-hint`} className="mb-2 text-sm text-muted">
        Fundo do menu à esquerda. No automático, usamos um tom escuro da cor da marca.
      </p>
      <div className="flex flex-wrap items-center gap-2" aria-describedby={`${id}-hint`}>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-pressed={value === null}
          className={cx(
            "flex min-h-11 items-center gap-2 rounded-full border-2 pl-1 pr-3 text-sm font-semibold",
            value === null ? "border-ink" : "border-line",
          )}
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: auto }}
          >
            {value === null && <IconCheck className="h-4 w-4" />}
          </span>
          Automático
        </button>
        {MENU_PRESETS.map((p) => {
          const selected = p.hex === value;
          return (
            <button
              key={p.hex}
              type="button"
              onClick={() => onChange(p.hex)}
              aria-pressed={selected}
              aria-label={p.label}
              title={p.label}
              className={swatch(selected)}
              style={{ backgroundColor: p.hex }}
            >
              {selected && <IconCheck className="h-5 w-5" />}
            </button>
          );
        })}
        <label
          className={cx(
            "flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-3 text-sm font-semibold",
            value !== null && !isPreset ? "border-ink" : "border-line",
          )}
        >
          <input
            type="color"
            value={value ?? THIGU_NAVY}
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
            style={{ backgroundColor: palette.navy }}
          />
          O menu tem texto branco, então essa cor precisa ser mais escura. Vamos usar o tom da amostra. Veja na prévia
          abaixo.
        </p>
      )}
    </fieldset>
  );
}
