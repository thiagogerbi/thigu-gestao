"use client";
import { IconCheck } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";

const STEPS = [
  { title: "Venda fechada", who: "Vendedor" },
  { title: "Confirmar parcelas", who: "Financeiro" },
  { title: "Acompanhar recebimentos", who: "Financeiro" },
];

export function SaleSteps({ current, doneUpTo }: { current: number; doneUpTo: number }) {
  return (
    <ol className="mb-5 grid grid-cols-3 gap-2" aria-label="Etapas da venda">
      {STEPS.map((s, i) => {
        const done = i < doneUpTo;
        const active = i === current;
        return (
          <li
            key={s.title}
            aria-current={active ? "step" : undefined}
            className={cx(
              "rounded-lg border px-2.5 py-2 text-sm",
              done ? "border-[#bfe8d8] bg-money-50" : active ? "border-primary bg-primary-50" : "border-line bg-white",
            )}
          >
            <span
              className={cx(
                "mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                done ? "bg-money-700 text-white" : active ? "bg-primary text-white" : "bg-canvas text-muted",
              )}
            >
              {done ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className="block font-semibold leading-tight">{s.title}</span>
            <span className="block text-muted">{done ? "Concluído" : active ? "Agora" : s.who}</span>
          </li>
        );
      })}
    </ol>
  );
}
