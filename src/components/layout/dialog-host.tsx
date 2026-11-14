"use client";

import { DialogContext, type DialogProps, type DialogSpec } from "@/components/layout/dialog-context";
import { ClientDialog } from "@/features/clients/client-dialog";
import { ItemDialog } from "@/features/clients/item-dialog";
import { AppointmentDialog } from "@/features/agenda/appointment-dialog";
import { NoShowDialog } from "@/features/agenda/no-show-dialog";
import { PackageDialog } from "@/features/recurring/package-dialog";
import { SubscriptionDialog } from "@/features/recurring/subscription-dialog";
import { ResourceDialog } from "@/features/services/resource-dialog";
import { ServiceDialog } from "@/features/services/service-dialog";
import { DealDialog } from "@/features/deals/deal-dialog";
import { LostDealDialog } from "@/features/deals/lost-deal-dialog";
import { CancelAccountDialog } from "@/features/finance/cancel-account-dialog";
import { ExpenseDialog } from "@/features/finance/expense-dialog";
import { SettleDialog } from "@/features/finance/settle-dialog";
import { UndoMovementDialog } from "@/features/finance/undo-movement-dialog";
import { AcceptProposalDialog } from "@/features/proposals/accept-proposal-dialog";
import { ProposalDialog } from "@/features/proposals/proposal-editor-dialog";
import { RejectProposalDialog } from "@/features/proposals/reject-proposal-dialog";
import { SendProposalDialog } from "@/features/proposals/send-proposal-dialog";
import { CloseSaleDialog } from "@/features/sales/close-sale-dialog";
import { ReviewSaleDialog } from "@/features/sales/review-sale-dialog";
import { TaskDialog } from "@/features/tasks/task-dialog";
import { Fragment, useCallback, useMemo, useState } from "react";

function renderDialog(spec: DialogSpec, props: DialogProps) {
  switch (spec.kind) {
    case "client":
      return <ClientDialog {...props} clientId={spec.clientId} />;
    case "item":
      return <ItemDialog {...props} clientId={spec.clientId} itemId={spec.itemId} />;
    case "appointment":
      return (
        <AppointmentDialog
          {...props}
          appointmentId={spec.appointmentId}
          clientId={spec.clientId}
          resourceId={spec.resourceId}
          date={spec.date}
        />
      );
    case "noShow":
      return <NoShowDialog {...props} appointmentId={spec.appointmentId} />;
    case "package":
      return <PackageDialog {...props} clientId={spec.clientId} />;
    case "subscription":
      return <SubscriptionDialog {...props} clientId={spec.clientId} subscriptionId={spec.subscriptionId} />;
    case "service":
      return <ServiceDialog {...props} serviceId={spec.serviceId} />;
    case "resource":
      return <ResourceDialog {...props} resourceId={spec.resourceId} userId={spec.userId} />;
    case "deal":
      return <DealDialog {...props} dealId={spec.dealId} clientId={spec.clientId} />;
    case "task":
      return <TaskDialog {...props} taskId={spec.taskId} clientId={spec.clientId} dealId={spec.dealId} />;
    case "lostDeal":
      return <LostDealDialog {...props} dealId={spec.dealId} />;
    case "expense":
      return <ExpenseDialog {...props} />;
    case "proposal":
      return <ProposalDialog {...props} proposalId={spec.proposalId} dealId={spec.dealId} clientId={spec.clientId} />;
    case "sendProposal":
      return <SendProposalDialog {...props} proposalId={spec.proposalId} />;
    case "acceptProposal":
      return <AcceptProposalDialog {...props} proposalId={spec.proposalId} />;
    case "rejectProposal":
      return <RejectProposalDialog {...props} proposalId={spec.proposalId} />;
    case "closeSale":
      return <CloseSaleDialog {...props} dealId={spec.dealId} proposalId={spec.proposalId} />;
    case "reviewSale":
      return <ReviewSaleDialog {...props} saleId={spec.saleId} />;
    case "settle":
      return <SettleDialog {...props} accountId={spec.accountId} accountKind={spec.accountKind} />;
    case "undoMovement":
      return <UndoMovementDialog {...props} movementId={spec.movementId} />;
    case "cancelAccount":
      return <CancelAccountDialog {...props} accountId={spec.accountId} />;
  }
}

/** Mantém uma janela aberta por vez. A chave muda a cada abertura: formulário limpo, sem erros antigos. */
export function DialogHost({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ spec: DialogSpec; key: number } | null>(null);
  const open = useCallback((spec: DialogSpec) => setCurrent((c) => ({ spec, key: (c?.key ?? 0) + 1 })), []);
  const close = useCallback(() => setCurrent(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);

  return (
    <DialogContext value={api}>
      {children}
      {current && <Fragment key={current.key}>{renderDialog(current.spec, { onClose: close, open })}</Fragment>}
    </DialogContext>
  );
}
