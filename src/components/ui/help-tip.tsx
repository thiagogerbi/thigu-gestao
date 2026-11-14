"use client";

import { cx } from "@/components/ui/styles";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Botão "?" ao lado de um termo. Ao tocar, mostra uma frase simples explicando o que ele significa.
 * Fecha com Esc, com outro toque ou ao clicar fora.
 */
export function HelpTip({
  term,
  children,
  className,
}: {
  term: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={wrap} className={cx("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={`O que é “${term}”?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#c5cfdf] bg-white text-xs font-bold text-primary-700 hover:bg-primary-50"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-8 z-40 w-64 -translate-x-1/2 rounded-lg bg-navy px-3 py-2 text-left text-sm font-normal normal-case leading-snug tracking-normal text-white shadow-lg"
        >
          <strong className="block">{term}</strong>
          {children}
        </span>
      )}
    </span>
  );
}
