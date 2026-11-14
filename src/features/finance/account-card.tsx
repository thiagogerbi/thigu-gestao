"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { IconMoneyIn, IconMoneyOut, IconUndo } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { formatDateBR, formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { METHOD_LABEL } from "@/lib/domain/types";
import { useBackend, useCan, useMemberName } from "@/state/backend-context";
import { STATUS_TONE, type AccountView } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

export function AccountCard({ view, showParty = true }: { view: AccountView; showParty?: boolean }) {
  const { data } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const dialogs = useDialogs();
  const nav = useNav();
  const [open, setOpen] = useState(false);
  const a = view.account;
  const isIn = a.kind === "receber";
  const movs = data.movements
    .filter((m) => m.accountId === a.id)
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const mayRegister = canDo("financeiro.registrar");
  const historyId = `hist-${a.id}`;

  return (
    <Card as="li" className={cx("p-4", view.status === "atrasada" && "border-[#f7c9c4]")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {showParty &&
            (a.clientId ? (
              <button
                type="button"
                className="text-left font-display text-[17px] font-bold hover:underline"
                onClick={() => nav.openClient(a.clientId!)}
              >
                {view.partyName}
              </button>
            ) : (
              <p className="font-display text-[17px] font-bold">{view.partyName}</p>
            ))}
          <p className="text-sm text-muted">
            {view.saleTitle ? (
              <>
                Venda: <span className="text-ink">{view.saleTitle}</span>
              </>
            ) : (
              <>
                {a.description}
                {a.category ? ` · ${a.category}` : ""}
              </>
            )}
          </p>
          <p className="text-sm font-medium">{view.line}</p>
        </div>
        <Badge tone={STATUS_TONE[view.status]}>{view.statusText}</Badge>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-canvas p-2.5 text-sm tabular">
        <div>
          <dt className="text-muted">Valor</dt>
          <dd className="font-semibold">{formatBRL(a.amountCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">{isIn ? "Recebido" : "Pago"}</dt>
          <dd className="font-semibold text-money-700">{formatBRL(view.settled)}</dd>
        </div>
        <div>
          <dt className="text-muted">{isIn ? "Falta receber" : "Falta pagar"}</dt>
          <dd className="font-semibold">{formatBRL(view.balance)}</dd>
        </div>
      </dl>
      {a.canceledAt && (
        <p className="mt-2 text-sm text-muted">
          Cancelada em {formatDateBR(a.canceledAt)}. Motivo: {a.cancelReason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {mayRegister && view.balance > 0 && (
          <Button
            size="sm"
            variant={isIn ? "money" : "primary"}
            data-tour={isIn ? "receber" : undefined}
            onClick={() => dialogs.open({ kind: "settle", accountId: a.id, accountKind: a.kind })}
          >
            {isIn ? <IconMoneyIn className="h-4 w-4" /> : <IconMoneyOut className="h-4 w-4" />}
            {isIn ? "Registrar recebimento" : "Registrar pagamento"}
          </Button>
        )}
        {movs.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={open}
            aria-controls={historyId}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Ocultar registros" : `Ver registros (${movs.length})`}
          </Button>
        )}
        {mayRegister && !a.canceledAt && view.settled === 0 && (
          <Button size="sm" variant="ghost" onClick={() => dialogs.open({ kind: "cancelAccount", accountId: a.id })}>
            Cancelar conta
          </Button>
        )}
      </div>

      {open && (
        <ul id={historyId} className="mt-3 grid gap-2 border-t border-line pt-3 text-sm">
          {movs.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className={cx(m.undoneAt && "text-muted line-through")}>
                {formatBRL(m.amountCents)} em {formatShortDateBR(m.paidOn)} · {METHOD_LABEL[m.method]} · por{" "}
                {name(m.registeredBy)}
              </span>
              {m.undoneAt ? (
                <Badge tone="gray">Desfeito: {m.undoReason}</Badge>
              ) : (
                mayRegister && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => dialogs.open({ kind: "undoMovement", movementId: m.id })}
                  >
                    <IconUndo className="h-4 w-4" /> Desfazer registro
                  </Button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
