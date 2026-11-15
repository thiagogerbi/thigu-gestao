"use client";

import { Button } from "@/components/ui/button";
import { IconCheck, IconX } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { toISODate } from "@/lib/domain/dates";
import { useBackend } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

/**
 * GUIA DA PRÉVIA: conta a história do produto em 5 passos, usando os dados fictícios.
 * "Me mostre" abre a tela certa e destaca o elemento marcado com data-tour="...".
 * Cada passo se marca como feito quando a ação acontece de verdade na prévia.
 */

interface Step {
  id: string;
  title: string;
  why: string;
  how: string;
  go: string;
  highlight: string;
  done: boolean;
}

/** Destaca um elemento por alguns segundos, esperando ele aparecer após a navegação. */
function highlight(selector: string) {
  let tries = 0;
  const timer = window.setInterval(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${selector}"]`);
    if (!el && ++tries < 30) return;
    window.clearInterval(timer);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("tour-highlight");
    window.setTimeout(() => el.classList.remove("tour-highlight"), 6000);
  }, 150);
}

/**
 * "auto": painel aberto em telas grandes e nada no celular, onde ele cobriria a tela inteira
 * (lá o guia abre pelo botão "Guia" do aviso da prévia);
 * "open": painel aberto; "mini": só o botão; "closed": nada.
 */
export type TourMode = "auto" | "open" | "mini" | "closed";

export function PreviewTour({ mode, onMode }: { mode: TourMode; onMode: (mode: TourMode) => void }) {
  const { data, preview, me, today, basePath } = useBackend();
  const nav = useNav();
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  if (!preview) return null;

  // compara pela data local (o horário é guardado em UTC, que à noite já é o dia seguinte)
  const isToday = (iso: string | null) => Boolean(iso) && toISODate(new Date(iso!)) === today;
  const proposal = data.proposals.find((p) => p.id === "p-2");
  const steps: Step[] = [
    {
      id: "jornada",
      title: "Entenda o caminho do dinheiro",
      why: "O Thigu acompanha cada cliente desde a primeira conversa até o pagamento cair.",
      how: "Na Visão geral, veja as 6 etapas e quanto dinheiro está em cada uma.",
      go: basePath,
      highlight: "jornada",
      done: Boolean(seen.jornada),
    },
    {
      id: "ficha",
      title: "Abra a ficha de uma cliente",
      why: "Tudo sobre a cliente fica num só lugar: conversas, propostas e pagamentos.",
      how: "Vamos abrir a ficha da Marina Costa. Veja o botão “O que fazer agora”.",
      go: `${basePath}/clientes?cliente=c-marina`,
      highlight: "proximo-passo",
      done: Boolean(seen.ficha),
    },
    {
      id: "aceite",
      title: "Registre que o cliente aceitou a proposta",
      why: "Quando o cliente diz “sim”, a negociação vira venda.",
      how: "Na proposta do João, clique em “Registrar aceite do cliente” e depois feche a venda em 3 parcelas.",
      go: `${basePath}/propostas/p-2`,
      highlight: "aceite",
      done: proposal?.status === "aceita",
    },
    {
      id: "conferir",
      title: "Confirme as parcelas da venda",
      why: "Antes de virar cobrança, alguém do financeiro (ou o dono) confere valores e datas.",
      how: "Clique em “Confirmar parcelas” e depois em “Criar parcelas a receber”.",
      go: `${basePath}/financeiro?aba=conferir`,
      highlight: "conferir",
      done: data.sales.some((s) => s.status === "confirmada" && isToday(s.reviewedAt)),
    },
    {
      id: "receber",
      title: "Registre que a Marina pagou R$ 200",
      why: "É assim que o dinheiro que entrou aparece nos números — e o que falta fica visível.",
      how: "Clique em “Registrar recebimento”, escolha “Recebi uma parte” e digite 200.",
      go: `${basePath}/financeiro?aba=receber&busca=Marina`,
      highlight: "receber",
      done: data.movements.some((m) => m.accountId.startsWith("a-marina") && isToday(m.createdAt)),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.findIndex((s) => !s.done);

  function show(step: Step) {
    // os passos funcionam melhor como a dona, que pode fazer tudo
    const owner = preview!.personas.find((p) => p.roles.includes("admin"));
    if (owner && owner.userId !== me.userId) preview!.setPersona(owner.userId);
    setSeen((s) => ({ ...s, [step.id]: true }));
    // depois de "Me mostre" o painel vira um botão pequeno, para não cobrir o que foi destacado
    onMode("mini");
    nav.router.push(step.go, { scroll: false });
    highlight(step.highlight);
  }

  if (mode === "closed") return null;
  const pill = (
    <button
      type="button"
      onClick={() => onMode("open")}
      className="fixed bottom-[5.25rem] right-3 z-[55] flex min-h-12 items-center gap-2 rounded-full bg-navy px-4 font-semibold text-white shadow-raised hover:bg-navy-700 lg:bottom-6 lg:right-6 print:hidden"
    >
      <span className="rounded-full bg-money px-2 text-sm tabular">
        {doneCount}/{steps.length}
      </span>
      {doneCount === steps.length ? "Guia concluído" : "Continuar o guia"}
    </button>
  );
  if (mode === "mini") return pill;
  const onClose = () => onMode("closed");
  const panel = (
    <aside
      aria-label="Guia da prévia"
      className={cx(
        // text-ink: o painel é montado dentro do aviso da prévia e herdaria o texto marrom dele
        "fixed bottom-[5.25rem] right-3 z-[55] w-[min(380px,calc(100vw-24px))] rounded-2xl border border-line bg-white text-ink shadow-raised lg:bottom-6 lg:right-6 print:hidden",
        mode === "auto" && "hidden lg:block",
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <p className="font-display text-base font-bold">Experimente em 5 passos</p>
          <p className="text-sm text-muted">
            {doneCount === steps.length
              ? "Pronto! Você viu o ciclo completo."
              : `${doneCount} de ${steps.length} feitos`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar guia"
          className="-mr-1 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-canvas"
        >
          <IconX className="h-5 w-5" />
        </button>
      </div>
      <div className="h-1.5 bg-canvas" aria-hidden="true">
        <div className="h-full bg-money transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="max-h-[55vh] overflow-y-auto px-2 py-2">
        {steps.map((s, i) => {
          const active = i === current;
          return (
            <li key={s.id} className={cx("rounded-xl p-2", active && "bg-primary-50")}>
              <div className="flex gap-3">
                <span
                  className={cx(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    s.done ? "bg-money-700 text-white" : active ? "bg-primary text-white" : "bg-canvas text-muted",
                  )}
                >
                  {s.done ? <IconCheck className="h-4 w-4" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cx("font-semibold", s.done && "text-muted")}>{s.title}</p>
                  {(active || !s.done) && <p className="text-sm text-muted">{s.why}</p>}
                  {active && <p className="mt-1 text-sm">{s.how}</p>}
                  {!s.done && (
                    <Button size="sm" variant={active ? "primary" : "ghost"} className="mt-2" onClick={() => show(s)}>
                      Me mostre
                    </Button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {doneCount === steps.length && (
        <p className="border-t border-line px-4 py-3 text-sm">
          Você fez o caminho completo: conversa → proposta → venda → parcelas → dinheiro recebido. Use “Recomeçar
          exemplo” para ver de novo.
        </p>
      )}
    </aside>
  );
  return panel;
}
