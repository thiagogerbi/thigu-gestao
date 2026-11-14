"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { cx } from "@/components/ui/styles";
import { ClientSection } from "@/features/clients/client-section";
import { StageSelect } from "@/features/deals/stage-select";
import { formatDateBR } from "@/lib/domain/dates";
import { daysInStage, isOpenStage, staleReason } from "@/lib/domain/deals";
import { formatBRL } from "@/lib/domain/money";
import { canEditDeal } from "@/lib/domain/permissions";
import { STAGE_LABEL, type Deal } from "@/lib/domain/types";
import { useBackend, useCan, useMemberName } from "@/state/backend-context";
import { saleForDeal } from "@/state/selectors";

/** Negociações do cliente, com as ações de cada uma (mudar etapa, proposta, fechar venda, conferir). */
export function ClientDealsList({
  clientId,
  deals,
  focusDeal,
  editable,
}: {
  clientId: string;
  deals: Deal[];
  /** Negociação a destacar (quando a ficha foi aberta a partir dela). */
  focusDeal: string | null;
  editable: boolean;
}) {
  const { data, me, today } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const dialogs = useDialogs();
  return (
    <ClientSection
      title="Negociações"
      collapsible
      count={deals.length}
      defaultOpen={Boolean(focusDeal) || deals.length <= 2}
      action={
        editable && (
          <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "deal", clientId })}>
            Adicionar
          </Button>
        )
      }
    >
      {deals.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma negociação ainda.</p>
      ) : (
        <ul className="grid gap-3">
          {deals.map((d) => {
            const sale = saleForDeal(data, d.id);
            const stale = staleReason(d, today);
            const mayEdit = canEditDeal(me.roles, me.userId, d);
            return (
              <li
                key={d.id}
                id={`ficha-neg-${d.id}`}
                className={cx(
                  "rounded-lg border p-3",
                  d.id === focusDeal ? "border-primary bg-primary-50/40 ring-2 ring-primary/20" : "border-line",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{d.title}</p>
                    <p className="text-sm text-muted tabular">
                      {formatBRL(d.valueCents)} · {name(d.ownerId)} ·{" "}
                      {isOpenStage(d.stage)
                        ? `${daysInStage(d, today)} dias em ${STAGE_LABEL[d.stage]}`
                        : STAGE_LABEL[d.stage]}
                    </p>
                    {d.expectedClose && isOpenStage(d.stage) && (
                      <p className="text-sm text-muted">Previsão de fechamento: {formatDateBR(d.expectedClose)}</p>
                    )}
                    {d.lostReason && <p className="text-sm">Motivo da perda: {d.lostReason}</p>}
                  </div>
                  {stale && <Badge tone="amber">{stale}</Badge>}
                  {sale && (
                    <Badge tone={sale.status === "confirmada" ? "green" : "amber"}>
                      {sale.status === "confirmada" ? "Parcelas confirmadas" : "Parcelas a confirmar"}
                    </Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {isOpenStage(d.stage) && (
                    <div className="w-full sm:w-52">
                      <StageSelect deal={d} />
                    </div>
                  )}
                  {mayEdit && isOpenStage(d.stage) && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => dialogs.open({ kind: "proposal", dealId: d.id })}
                    >
                      Preparar proposta
                    </Button>
                  )}
                  {mayEdit && isOpenStage(d.stage) && (
                    <Button size="sm" variant="money" onClick={() => dialogs.open({ kind: "closeSale", dealId: d.id })}>
                      Fechar venda
                    </Button>
                  )}
                  {sale?.status === "aguardando_conferencia" && (
                    <Button
                      size="sm"
                      variant={canDo("venda.conferir") ? "money" : "secondary"}
                      onClick={() => dialogs.open({ kind: "reviewSale", saleId: sale.id })}
                    >
                      {canDo("venda.conferir") ? "Confirmar parcelas" : "Ver situação da venda"}
                    </Button>
                  )}
                  {mayEdit && (
                    <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "deal", dealId: d.id })}>
                      Editar
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </ClientSection>
  );
}
