"use client";

import { technicianCanMove } from "@/lib/domain/orders";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import type { Order, OrderStage } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";

/** O que as telas de pedidos precisam saber: quem pode o quê e os nomes. */
export function useOrders() {
  const { data, me } = useBackend();
  const myResources = new Set(data.resources.filter((r) => r.userId === me.userId).map((r) => r.id));
  const seesAll = can(me.roles, "pedidos.ver_todos");
  const enabled = moduleAvailable(data.company, "pedidos") && (seesAll || myResources.size > 0);
  const canEdit = can(me.roles, "pedidos.editar");
  const canDeliver = can(me.roles, "pedidos.entregar");
  const readsRx = moduleAvailable(data.company, "receita") && can(me.roles, "receita.usar");
  const isMine = (o: Order) => o.resourceId !== null && myResources.has(o.resourceId);
  const canMoveTo = (o: Order, to: OrderStage) => canEdit || (isMine(o) && technicianCanMove(o.stage, to));
  const client = (o: Pick<Order, "clientId">) => data.clients.find((c) => c.id === o.clientId);
  const technician = (o: Pick<Order, "resourceId">) =>
    o.resourceId ? (data.resources.find((r) => r.id === o.resourceId)?.name ?? "—") : "Sem técnico";
  const itemsOf = (o: Pick<Order, "id">) => data.orderItems.filter((i) => i.orderId === o.id);
  return { enabled, seesAll, canEdit, canDeliver, readsRx, isMine, canMoveTo, client, technician, itemsOf };
}
