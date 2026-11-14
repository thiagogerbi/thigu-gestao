"use client";
import type { DialogProps } from "@/components/layout/dialog-context";
import { Button, LinkButton } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { fromRows, PlanEditor, type PlanRow, toRows } from "@/features/sales/plan-editor";
import { SaleSteps } from "@/features/sales/sale-steps";
import { formatDateBR } from "@/lib/domain/dates";
import { buildPlan, checkPlan } from "@/lib/domain/installments";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { useAction, useBackend, useCan, useMemberName } from "@/state/backend-context";
import { clientById, dealById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useMemo, useState } from "react";

export function ReviewSaleDialog({ onClose, saleId }: DialogProps & { saleId: string }) {
  const { data } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const nav = useNav();
  const toast = useToast();
  const { exec, pending, error } = useAction();
  const sale = data.sales.find((s) => s.id === saleId);
  const initialRows = useMemo(() => (sale ? toRows(sale.plan) : []), [sale]);
  const [rows, setRows] = useState<PlanRow[]>(initialRows);
  const [created, setCreated] = useState<string | null>(null);
  if (!sale) return null;
  const client = clientById(data, sale.clientId);
  const deal = dealById(data, sale.dealId);
  const mayReview = canDo("venda.conferir");
  const reviewers = data.members.filter((m) => can(m.roles, "venda.conferir"));
  const plan = fromRows(rows);
  const check = checkPlan(plan, sale.totalCents);
  const already = sale.status === "confirmada";

  async function confirm() {
    const r = await exec({ type: "sale.confirm", saleId, plan });
    if (r.ok) {
      toast({ tone: "success", text: r.message });
      setCreated(r.message);
    }
  }

  const listHref = nav.href("/financeiro", { aba: "receber", busca: client?.name });

  if (created || already) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Parcelas confirmadas"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <LinkButton href={listHref} onClick={onClose}>
              Ver parcelas de {client?.name}
            </LinkButton>
          </>
        }
      >
        <SaleSteps current={2} doneUpTo={2} />
        <InlineAlert tone="green" title={created ?? "As parcelas desta venda já foram confirmadas."}>
          As parcelas agora aparecem em <strong>Financeiro › A receber</strong>. Quando {client?.name} pagar, use
          “Registrar recebimento”.
        </InlineAlert>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={mayReview && JSON.stringify(rows) !== JSON.stringify(initialRows)}
      size="lg"
      title="Confirmar parcelas da venda"
      description={
        <>
          {deal?.title} — <strong className="text-ink">{client?.name}</strong> — {formatBRL(sale.totalCents)}
        </>
      }
      footer={
        mayReview ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Confirmar depois
            </Button>
            <Button variant="money" onClick={confirm} loading={pending} disabled={!check.ok}>
              Criar {plan.length} {plan.length === 1 ? "parcela" : "parcelas"} a receber
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Entendi</Button>
        )
      }
    >
      <SaleSteps current={1} doneUpTo={1} />
      <p className="mb-4 text-sm">
        Venda fechada por <strong>{name(sale.closedBy)}</strong> em {formatDateBR(sale.closedAt)},{" "}
        {sale.paymentMode === "avista" ? "à vista" : `em ${sale.plan.length} parcelas`}.
        {mayReview
          ? " Confira se valores e datas estão corretos. Ao confirmar, as parcelas passam a constar em contas a receber."
          : ""}
      </p>
      {!mayReview && (
        <div className="mb-4">
          <InlineAlert tone="amber" title="Aguardando o financeiro">
            Quem pode confirmar: {reviewers.map((m) => m.name).join(", ")}. Seu papel permite propor as condições, mas
            não criar as contas a receber.
          </InlineAlert>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
      <PlanEditor
        rows={rows}
        setRows={setRows}
        totalCents={sale.totalCents}
        readOnly={!mayReview}
        onRedistribute={() =>
          setRows(toRows(buildPlan(sale.totalCents, rows.length, rows[0]?.dueDate ?? sale.plan[0].dueDate)))
        }
      />
    </Modal>
  );
}
