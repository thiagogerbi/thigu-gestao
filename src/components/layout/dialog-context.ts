"use client";

import { createContext, useContext } from "react";

/** Todas as janelas que podem ser abertas de qualquer tela, com seus parâmetros. */
export type DialogSpec =
  | { kind: "client"; clientId?: string }
  | { kind: "item"; clientId: string; itemId?: string }
  | { kind: "appointment"; appointmentId?: string; clientId?: string; resourceId?: string; date?: string }
  | { kind: "noShow"; appointmentId: string }
  | { kind: "package"; clientId?: string }
  | { kind: "subscription"; clientId?: string; subscriptionId?: string }
  | { kind: "service"; serviceId?: string }
  | { kind: "resource"; resourceId?: string; userId?: string }
  | { kind: "deal"; dealId?: string; clientId?: string }
  | { kind: "task"; taskId?: string; clientId?: string; dealId?: string }
  | { kind: "lostDeal"; dealId: string }
  | { kind: "expense" }
  | { kind: "proposal"; proposalId?: string; dealId?: string; clientId?: string }
  | { kind: "sendProposal"; proposalId: string }
  | { kind: "acceptProposal"; proposalId: string }
  | { kind: "rejectProposal"; proposalId: string }
  | { kind: "closeSale"; dealId: string; proposalId?: string }
  | { kind: "reviewSale"; saleId: string }
  | { kind: "settle"; accountId?: string; accountKind: "receber" | "pagar" }
  | { kind: "undoMovement"; movementId: string }
  | { kind: "cancelAccount"; accountId: string };

/** Propriedades que toda janela recebe do DialogHost. */
export interface DialogProps {
  onClose: () => void;
  open: (d: DialogSpec) => void;
}

interface DialogsApi {
  open: (d: DialogSpec) => void;
  close: () => void;
}

export const DialogContext = createContext<DialogsApi>({ open: () => {}, close: () => {} });

export const useDialogs = () => useContext(DialogContext);
