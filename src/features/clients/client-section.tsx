"use client";
import { Card } from "@/components/ui/card";

/**
 * Seção da ficha do cliente. Com `collapsible`, vira um bloco que abre e fecha (nativo e acessível),
 * mostrando no título quantos itens há dentro — a ficha fica curta e a pessoa abre só o que precisa.
 */
export function ClientSection({
  title,
  children,
  action,
  id,
  collapsible = false,
  defaultOpen = false,
  count,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  count?: number;
}) {
  if (collapsible) {
    return (
      <details open={defaultOpen} className="group mb-3 rounded-xl border border-line bg-white">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-display text-base font-bold [&::-webkit-details-marker]:hidden">
          <span>
            {title}
            {count !== undefined && <span className="ml-2 font-sans text-sm font-semibold text-muted">({count})</span>}
          </span>
          <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="px-4 pb-4">
          {action && <div className="mb-3">{action}</div>}
          {children}
        </div>
      </details>
    );
  }
  return (
    <Card className="mb-3 p-4" aria-labelledby={id}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 id={id} className="font-display text-base font-bold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </Card>
  );
}
