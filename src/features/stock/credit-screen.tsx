"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { IconMoneyIn } from "@/components/ui/icons";
import { balanceCents } from "@/lib/domain/accounts";
import { openSession } from "@/lib/domain/cash";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { whatsappUrl } from "@/lib/domain/phone";
import { moduleAvailable } from "@/lib/domain/segments";
import { chargeMessage, creditAvailable } from "@/lib/domain/stock";
import { useBackend } from "@/state/backend-context";

/**
 * Crediário e fiado: quem compra a prazo, quanto deve, o que está atrasado, cobrança pelo WhatsApp
 * e recebimento no caixa. O financeiro ou o dono definem o limite de cada cliente.
 */
export function CreditScreen() {
  const { data, me, today } = useBackend();
  const dialogs = useDialogs();
  const setsLimit = can(me.roles, "crediario.limite");
  const receives = can(me.roles, "caixa.operar");

  if (!moduleAvailable(data.company, "estoque") || !(receives || can(me.roles, "financeiro.ver"))) {
    return (
      <>
        <PageHeader title="Crediário" />
        <EmptyState title="Página indisponível">
          O crediário existe para lojas e comércio com venda no balcão, e para quem recebe dos clientes.
        </EmptyState>
      </>
    );
  }

  const session = openSession(data.cashSessions);
  const rows = data.clients
    .map((c) => {
      const open = data.accounts
        .filter((a) => a.clientId === c.id && a.origin === "crediario" && !a.canceledAt)
        .map((a) => ({ account: a, balance: balanceCents(a, data.movements) }))
        .filter((x) => x.balance > 0)
        .sort((a, b) => a.account.dueDate.localeCompare(b.account.dueDate));
      const owed = open.reduce((s, x) => s + x.balance, 0);
      const overdue = open.filter((x) => x.account.dueDate < today);
      return {
        client: c,
        open,
        owed,
        overdueCents: overdue.reduce((s, x) => s + x.balance, 0),
        oldestDue: overdue[0]?.account.dueDate ?? null,
        available: creditAvailable(c, owed),
      };
    })
    .filter((r) => r.owed > 0 || (r.client.creditLimitCents !== null && r.client.creditLimitCents !== undefined))
    .sort((a, b) => b.overdueCents - a.overdueCents || b.owed - a.owed || a.client.name.localeCompare(b.client.name));
  const totalOwed = rows.reduce((s, r) => s + r.owed, 0);
  const totalOverdue = rows.reduce((s, r) => s + r.overdueCents, 0);

  return (
    <>
      <PageHeader
        title="Crediário"
        description="Quem compra a prazo, quanto deve e o que está atrasado."
        actions={
          setsLimit && (
            <Button onClick={() => dialogs.open({ kind: "creditLimit" })}>Liberar crediário para um cliente</Button>
          )
        }
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">A receber no crediário</p>
          <p className="mt-1 font-display text-2xl font-extrabold tabular">{formatBRL(totalOwed)}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">Em atraso</p>
          <p className={`mt-1 font-display text-2xl font-extrabold tabular ${totalOverdue ? "text-danger" : ""}`}>
            {formatBRL(totalOverdue)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-sm font-semibold">Clientes com crediário</p>
          <p className="mt-1 font-display text-2xl font-extrabold">{rows.length}</p>
        </div>
      </div>

      {!session && receives && (
        <p className="mb-3 text-sm text-muted">Para receber uma parcela, abra o caixa do dia.</p>
      )}

      {rows.length === 0 ? (
        <EmptyState title="Ninguém no crediário ainda">
          {setsLimit
            ? "Libere o crediário para os clientes da casa, com um limite. Na venda, escolha “Crediário” como forma de pagamento."
            : "O financeiro ou o dono liberam o crediário para cada cliente."}
        </EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((r) => {
            const wa =
              r.overdueCents > 0 && r.oldestDue
                ? whatsappUrl(
                    r.client.phone,
                    chargeMessage({
                      clientName: r.client.name,
                      companyName: data.company.name,
                      overdueCents: r.overdueCents,
                      oldestDue: r.oldestDue,
                    }),
                  )
                : null;
            const next = r.open[0];
            return (
              <Card key={r.client.id} className="p-4" aria-labelledby={`cred-${r.client.id}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id={`cred-${r.client.id}`} className="font-display text-base font-bold">
                      {r.client.name}
                    </h2>
                    <p className="text-sm text-muted">
                      {r.client.creditLimitCents !== null && r.client.creditLimitCents !== undefined
                        ? `Limite ${formatBRL(r.client.creditLimitCents)} · disponível ${formatBRL(r.available ?? 0)}`
                        : "Crediário desligado (ainda deve parcelas)"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-extrabold tabular">{formatBRL(r.owed)}</p>
                    {r.overdueCents > 0 && <Badge tone="red">{formatBRL(r.overdueCents)} em atraso</Badge>}
                  </div>
                </div>
                {r.open.length > 0 && (
                  <ul className="mt-2 divide-y divide-line text-sm">
                    {r.open.slice(0, 4).map(({ account: a, balance }) => (
                      <li key={a.id} className="flex justify-between gap-2 py-1">
                        <span className={a.dueDate < today ? "font-semibold text-danger" : ""}>
                          Parcela {a.installmentNumber} de {a.installmentCount} · vence {formatShortDateBR(a.dueDate)}
                        </span>
                        <span className="tabular">{formatBRL(balance)}</span>
                      </li>
                    ))}
                    {r.open.length > 4 && <li className="py-1 text-muted">e mais {r.open.length - 4} parcelas</li>}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {receives && next && session && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => dialogs.open({ kind: "cashReceive", accountId: next.account.id })}
                    >
                      <IconMoneyIn className="h-4 w-4" /> Receber parcela
                    </Button>
                  )}
                  {wa && (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex min-h-11 items-center rounded-lg border border-[#bfe8d8] bg-money-50 px-3 text-sm font-semibold text-money-700 sm:min-h-9"
                    >
                      Cobrar pelo WhatsApp
                    </a>
                  )}
                  {setsLimit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dialogs.open({ kind: "creditLimit", clientId: r.client.id })}
                    >
                      Limite
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
