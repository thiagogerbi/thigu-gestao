"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { canEditDeal } from "@/lib/domain/permissions";
import { STAGES, type Deal, type Stage } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";

export function StageSelect({ deal, compact = false }: { deal: Deal; compact?: boolean }) {
  const { me } = useBackend();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec, pending } = useAction();
  const editable = canEditDeal(me.roles, me.userId, deal) && deal.stage !== "ganha";

  async function change(stage: Stage) {
    if (stage === deal.stage) return;
    if (stage === "ganha") return dialogs.open({ kind: "closeSale", dealId: deal.id });
    if (stage === "perdida") return dialogs.open({ kind: "lostDeal", dealId: deal.id });
    const r = await exec({ type: "deal.move", id: deal.id, stage, lostReason: null });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <label className={cx("relative block", compact ? "" : "min-w-44")}>
      <span className={compact ? "sr-only" : "mb-1 block text-sm font-semibold"}>Etapa</span>
      <select
        value={deal.stage}
        disabled={!editable || pending}
        onChange={(e) => change(e.target.value as Stage)}
        aria-label={`Mover “${deal.title}” para outra etapa`}
        className="min-h-10 w-full rounded-lg border border-[#c5cfdf] bg-white px-2 text-sm font-medium disabled:bg-canvas"
      >
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id === "ganha" && deal.stage !== "ganha"
              ? "Ganha — fechar venda…"
              : s.id === "perdida" && deal.stage !== "perdida"
                ? "Perdida — informar motivo…"
                : s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
