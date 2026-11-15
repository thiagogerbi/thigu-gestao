"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { formatDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { whatsappUrl } from "@/lib/domain/phone";
import { chargeText, packageSummary, type PackageView, type SubscriptionState } from "@/lib/domain/recurring";
import type { Account, Subscription } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { clientById } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useRecurring } from "@/state/use-recurring";

/** Um pacote: sessões usadas, restantes e validade, com "Encerrar". */
export function PackageRow({ view, showClient = false }: { view: PackageView; showClient?: boolean }) {
  const { data } = useBackend();
  const rec = useRecurring();
  const nav = useNav();
  const toast = useToast();
  const { exec, pending } = useAction();
  const { pkg } = view;
  const client = clientById(data, pkg.clientId);
  const item = pkg.itemId ? data.items.find((i) => i.id === pkg.itemId) : undefined;
  async function close() {
    if (!window.confirm(`Encerrar o pacote "${pkg.name}"? Ele deixa de aparecer na hora de marcar horários.`)) return;
    const r = await exec({ type: "package.close", id: pkg.id });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showClient && client && (
            <button
              type="button"
              onClick={() => nav.openClient(client.id)}
              className="text-left font-semibold hover:underline"
            >
              {client.name}
            </button>
          )}
          <p className={showClient ? "text-sm" : "font-semibold"}>
            {pkg.name}
            {item ? ` · ${item.name}` : ""}
          </p>
        </div>
        {view.closed ? (
          <Badge tone="gray">Encerrado</Badge>
        ) : view.expired ? (
          <Badge tone="red">Vencido</Badge>
        ) : view.remaining === 0 ? (
          <Badge tone="gray">Todas usadas</Badge>
        ) : view.endingSoon ? (
          <Badge tone="amber">Acabando</Badge>
        ) : (
          <Badge tone="green">Em uso</Badge>
        )}
      </div>
      {/* barra de sessões: usadas em verde-escuro, marcadas em azul, livres em cinza */}
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#e3e8ef]"
        role="img"
        aria-label={`${view.used} usadas, ${view.booked} marcadas, de ${pkg.sessionsTotal}`}
      >
        <span className="bg-money-700" style={{ width: `${(view.used / pkg.sessionsTotal) * 100}%` }} />
        <span
          className="bg-primary/60"
          style={{ width: `${(Math.min(view.booked, view.remaining) / pkg.sessionsTotal) * 100}%` }}
        />
      </div>
      <p className="mt-1 text-sm text-muted">{packageSummary(view)}</p>
      {rec.canSell && !view.closed && (
        <Button size="sm" variant="ghost" className="-ml-2 mt-1" disabled={pending} onClick={close}>
          Encerrar pacote
        </Button>
      )}
    </li>
  );
}

const STATE_BADGE: Record<SubscriptionState, { tone: "green" | "red" | "gray"; label: string }> = {
  em_dia: { tone: "green", label: "Ativa" },
  atrasada: { tone: "red", label: "Atrasada" },
  cancelada: { tone: "gray", label: "Cancelada" },
  encerrada: { tone: "gray", label: "Encerrada" },
};

/** Uma mensalidade: valor, vencimento e, para quem vê o financeiro, as cobranças atrasadas com cobrança no WhatsApp. */
export function SubscriptionRow({
  sub,
  state,
  overdue,
  showClient = false,
}: {
  sub: Subscription;
  state: SubscriptionState;
  overdue: Account[];
  showClient?: boolean;
}) {
  const { data, today } = useBackend();
  const rec = useRecurring();
  const nav = useNav();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec, pending } = useAction();
  const client = clientById(data, sub.clientId);
  const shown = rec.seesMoney || state !== "atrasada" ? STATE_BADGE[state] : STATE_BADGE.em_dia;
  const oldest = [...overdue].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const chargeUrl =
    rec.seesMoney && oldest && client
      ? whatsappUrl(
          client.phone,
          chargeText({
            clientName: client.name,
            companyName: data.company.name,
            description: oldest.description,
            amountCents: oldest.amountCents,
            dueDate: oldest.dueDate,
          }),
        )
      : null;
  async function cancel() {
    if (!window.confirm(`Cancelar a mensalidade "${sub.name}"? Não haverá novas cobranças.`)) return;
    const r = await exec({ type: "subscription.cancel", id: sub.id });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }
  const active = !sub.canceledAt && !(sub.endsOn && sub.endsOn < today);
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showClient && client && (
            <button
              type="button"
              onClick={() => nav.openClient(client.id)}
              className="text-left font-semibold hover:underline"
            >
              {client.name}
            </button>
          )}
          <p className={showClient ? "text-sm" : "font-semibold"}>{sub.name}</p>
          <p className="text-sm tabular text-muted">
            {formatBRL(sub.amountCents)} por mês · vence todo dia {sub.dayOfMonth}
            {sub.endsOn ? ` · até ${formatDateBR(sub.endsOn)}` : ""}
          </p>
        </div>
        <Badge tone={shown.tone}>{shown.label}</Badge>
      </div>
      {rec.seesMoney && overdue.length > 0 && (
        <p className="mt-1 text-sm font-semibold text-danger">
          {overdue.length === 1
            ? `${formatBRL(overdue[0].amountCents)} venceu em ${formatDateBR(overdue[0].dueDate)}`
            : `${overdue.length} cobranças atrasadas`}
        </p>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {chargeUrl && (
          <a href={chargeUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
            Cobrar pelo WhatsApp
          </a>
        )}
        {rec.canSell && active && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dialogs.open({ kind: "subscription", subscriptionId: sub.id })}
            >
              Editar
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={cancel}>
              Cancelar mensalidade
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
