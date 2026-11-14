"use client";

import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconMoneyIn, IconMoneyOut, IconPlus, IconSearch } from "@/components/ui/icons";
import { KpiCard } from "@/components/ui/kpi-card";
import { cx, keepInView } from "@/components/ui/styles";
import { onTabListKeyDown } from "@/components/ui/tabs";
import { CashForecastChart } from "@/features/finance/cash-forecast-chart";
import { AccountCard } from "@/features/finance/account-card";
import { addDays, formatDateBR, formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { computeOverview } from "@/lib/domain/overview";
import { METHOD_LABEL } from "@/lib/domain/types";
import { useBackend, useCan, useMemberName } from "@/state/backend-context";
import { accountView, clientById, dealById, installmentLabel } from "@/state/selectors";
import { useNav } from "@/state/use-nav";
import { useState } from "react";

type Tab = "conferir" | "receber" | "pagar" | "caixa";

/** Uma frase simples sobre cada aba, sempre visível logo abaixo das abas. */
const TAB_HELP: Record<Tab, string> = {
  conferir: "Vendas fechadas pelos vendedores. Confira valores e datas para que virem parcelas a receber.",
  receber: "Parcelas que os clientes vão pagar. Quando alguém pagar, toque em “Registrar recebimento”.",
  pagar: "Contas que a empresa precisa pagar, como aluguel e fornecedores.",
  caixa: "Tudo o que já entrou e saiu, e quanto deve sobrar nos próximos dias.",
};
const FILTERS = [
  { id: "abertas", label: "Em aberto" },
  { id: "atrasadas", label: "Atrasadas" },
  { id: "7dias", label: "Vencem em 7 dias" },
  { id: "parciais", label: "Parciais" },
  { id: "quitadas", label: "Quitadas" },
  { id: "canceladas", label: "Canceladas" },
  { id: "todas", label: "Todas" },
] as const;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function FinanceScreen() {
  const { data } = useBackend();
  const canDo = useCan();
  const nav = useNav();
  const dialogs = useDialogs();
  const fin = canDo("financeiro.ver");
  const tabs: { id: Tab; label: string; count?: number }[] = [
    {
      id: "conferir",
      label: "Vendas para confirmar",
      count: data.sales.filter((s) => s.status === "aguardando_conferencia").length,
    },
    { id: "receber", label: "A receber" },
    ...(fin
      ? [
          { id: "pagar" as Tab, label: "A pagar" },
          { id: "caixa" as Tab, label: "Caixa" },
        ]
      : []),
  ];
  const tabParam = nav.params.get("aba") as Tab | null;
  const tab: Tab = tabs.some((t) => t.id === tabParam) ? tabParam! : "receber";
  const filter = nav.params.get("filtro") ?? "abertas";
  const [q, setQ] = useState(nav.params.get("busca") ?? "");

  const primary =
    tab === "pagar"
      ? canDo("financeiro.registrar") && (
          <>
            <Button onClick={() => dialogs.open({ kind: "expense" })}>
              <IconPlus className="h-5 w-5" /> Nova despesa
            </Button>
            <Button variant="secondary" onClick={() => dialogs.open({ kind: "settle", accountKind: "pagar" })}>
              <IconMoneyOut className="h-5 w-5" /> Registrar pagamento
            </Button>
          </>
        )
      : canDo("financeiro.registrar") && (
          <Button variant="money" onClick={() => dialogs.open({ kind: "settle", accountKind: "receber" })}>
            <IconMoneyIn className="h-5 w-5" /> Registrar recebimento
          </Button>
        );

  return (
    <>
      <PageHeader
        title="Financeiro"
        description={
          fin
            ? "O dinheiro da empresa: o que os clientes vão pagar, o que a empresa precisa pagar e o que já entrou."
            : "Acompanhe as parcelas das suas vendas. Quem registra recebimentos é o financeiro."
        }
        actions={primary}
      />

      <div
        role="tablist"
        aria-label="Seções do financeiro"
        onKeyDown={onTabListKeyDown}
        className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`aba-financeiro-${t.id}`}
            aria-controls="painel-financeiro"
            tabIndex={tab === t.id ? 0 : -1}
            aria-selected={tab === t.id}
            ref={tab === t.id ? keepInView : undefined}
            onClick={() => nav.setQuery({ aba: t.id, filtro: null })}
            className={cx(
              "min-h-11 shrink-0 rounded-lg px-4 text-base font-semibold",
              tab === t.id ? "bg-navy text-white" : "text-ink hover:bg-canvas",
            )}
          >
            {t.label}
            {t.count ? (
              <span
                className={cx(
                  "ml-2 rounded-full px-2 text-sm",
                  tab === t.id ? "bg-white text-navy" : "bg-warn-50 text-warn",
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="painel-financeiro" aria-labelledby={`aba-financeiro-${tab}`}>
        <p className="-mt-2 mb-5 rounded-lg bg-primary-50 px-3 py-2 text-primary-700" role="note">
          {TAB_HELP[tab]}
        </p>

        {tab === "conferir" && <ReviewTab />}
        {(tab === "receber" || tab === "pagar") && (
          <AccountsTab
            kind={tab}
            filter={filter}
            q={q}
            setQ={(v) => {
              setQ(v);
              nav.setQuery({ busca: v || null });
            }}
          />
        )}
        {tab === "caixa" && <CashTab />}
      </div>
    </>
  );
}

function ReviewTab() {
  const { data } = useBackend();
  const canDo = useCan();
  const name = useMemberName();
  const dialogs = useDialogs();
  const pending = data.sales
    .filter((s) => s.status === "aguardando_conferencia")
    .sort((a, b) => a.closedAt.localeCompare(b.closedAt));
  const mayReview = canDo("venda.conferir");
  return (
    <>
      <Card className="mb-4 p-4">
        <ol className="grid gap-2 text-sm sm:grid-cols-3">
          <li>
            <strong>1. Venda fechada</strong> — o vendedor propõe como o cliente vai pagar.
          </li>
          <li>
            <strong>2. Confirmar parcelas</strong> — o financeiro (ou o dono) confere valores e datas.
          </li>
          <li>
            <strong>3. Acompanhar recebimentos</strong> — cada pagamento do cliente é registrado em “A receber”.
          </li>
        </ol>
      </Card>
      {pending.length === 0 ? (
        <EmptyState title="Nenhuma venda esperando confirmação">
          Quando alguém fechar uma venda, ela aparece aqui para o financeiro confirmar as parcelas.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {pending.map((s) => {
            const client = clientById(data, s.clientId);
            const deal = dealById(data, s.dealId);
            return (
              <Card as="li" key={s.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-[17px] font-bold">{client?.name}</p>
                    <p className="text-sm text-muted">Venda: {deal?.title}</p>
                  </div>
                  <Badge tone="amber">Etapa 2 de 3 · confirmar parcelas</Badge>
                </div>
                <p className="mt-2 text-base">
                  <strong className="tabular">{formatBRL(s.totalCents)}</strong> ·{" "}
                  {s.plan.length === 1
                    ? `à vista em ${formatShortDateBR(s.plan[0].dueDate)}`
                    : `${s.plan.length} parcelas, 1ª em ${formatShortDateBR(s.plan[0].dueDate)}`}
                </p>
                <p className="text-sm text-muted">
                  Fechada por {name(s.closedBy)} em {formatDateBR(s.closedAt)}
                </p>
                <p className="mt-2 text-sm">
                  Quem precisa agir: <strong>{mayReview ? "você" : "o financeiro"}</strong>
                </p>
                <div className="mt-3">
                  <Button
                    variant={mayReview ? "money" : "secondary"}
                    data-tour="conferir"
                    onClick={() => dialogs.open({ kind: "reviewSale", saleId: s.id })}
                  >
                    {mayReview
                      ? `Confirmar ${s.plan.length === 1 ? "parcela" : `${s.plan.length} parcelas`}`
                      : "Ver detalhes"}
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </>
  );
}

function AccountsTab({
  kind,
  filter,
  q,
  setQ,
}: {
  kind: "receber" | "pagar";
  filter: string;
  q: string;
  setQ: (v: string) => void;
}) {
  const { data, today } = useBackend();
  const nav = useNav();
  const term = norm(q.trim());
  const all = data.accounts.filter((a) => a.kind === kind).map((a) => accountView(data, a, today));
  const matches = (v: ReturnType<typeof accountView>) => {
    switch (filter) {
      case "atrasadas":
        return v.status === "atrasada";
      case "7dias":
        return v.balance > 0 && v.status !== "atrasada" && v.account.dueDate <= addDays(today, 7);
      case "parciais":
        return v.balance > 0 && v.settled > 0;
      case "quitadas":
        return v.status === "quitada";
      case "canceladas":
        return v.status === "cancelada";
      case "todas":
        return true;
      default:
        return v.balance > 0;
    }
  };
  const list = all
    .filter(matches)
    .filter((v) => !term || norm(`${v.partyName} ${v.saleTitle ?? ""} ${v.account.description}`).includes(term))
    .sort((a, b) => a.account.dueDate.localeCompare(b.account.dueDate));
  const total = list.reduce((s, v) => s + v.balance, 0);
  const label = FILTERS.find((f) => f.id === filter)?.label ?? "Em aberto";

  return (
    <>
      <div className="mb-3 grid gap-3 md:grid-cols-[1fr_280px]">
        <div role="group" aria-label="Filtrar por situação" className="chip-row min-w-0">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              ref={filter === f.id ? keepInView : undefined}
              onClick={() => nav.setQuery({ filtro: f.id === "abertas" ? null : f.id })}
              className={cx(
                "min-h-11 rounded-full border px-3.5 text-sm font-semibold sm:min-h-10 sm:px-3",
                filter === f.id
                  ? "border-primary bg-primary text-white"
                  : "border-line bg-white text-ink hover:bg-canvas",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <TextField
            label={kind === "receber" ? "Buscar por cliente ou venda" : "Buscar por fornecedor ou descrição"}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-10"
          />
          <IconSearch className="pointer-events-none absolute bottom-3 left-3 h-5 w-5 text-muted" />
        </div>
      </div>
      <p className="mb-3 text-sm text-muted" role="status">
        {list.length} {list.length === 1 ? "conta" : "contas"} · {label.toLowerCase()} · saldo {formatBRL(total)}
        {kind === "receber" && " · Só aparecem parcelas já confirmadas; negociações em andamento não entram aqui."}
      </p>
      {list.length === 0 ? (
        <EmptyState
          title={
            filter === "atrasadas"
              ? `Nenhuma conta ${kind === "receber" ? "a receber" : "a pagar"} atrasada`
              : "Nada por aqui"
          }
        >
          {kind === "receber"
            ? "Parcelas aparecem aqui depois que o financeiro confere uma venda."
            : "Cadastre despesas com “Nova despesa”."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {list.map((v) => (
            <AccountCard key={v.account.id} view={v} />
          ))}
        </ul>
      )}
    </>
  );
}

function CashTab() {
  const { data, today } = useBackend();
  const name = useMemberName();
  const ov = computeOverview(data, today);
  const movs = [...data.movements]
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30);
  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <KpiCard
          label="Entradas registradas"
          value={ov.receivedCents}
          tone="money"
          help="Recebimentos que não foram desfeitos."
        />
        <KpiCard label="Saídas registradas" value={ov.paidOutCents} help="Pagamentos que não foram desfeitos." />
        <KpiCard
          label="Saldo do caixa"
          value={ov.cashCents}
          tone={ov.cashCents < 0 ? "danger" : "money"}
          help="Entradas menos saídas."
        />
      </div>
      <Card className="mb-6 p-4">
        <h2 className="font-display text-lg font-bold">Previsão de caixa</h2>
        <p className="mb-3 text-sm text-muted">
          Saldo do caixa + parcelas confirmadas a receber − contas a pagar, por vencimento (inclui o que já está
          atrasado). Negociações em andamento não entram.
        </p>
        <CashForecastChart
          points={[
            { label: "Hoje", sub: formatShortDateBR(today), cents: ov.cashCents },
            ...ov.forecast.map((f) => ({
              label: `${f.days} dias`,
              sub: formatShortDateBR(addDays(today, f.days)),
              cents: f.netCents,
            })),
          ]}
        />
        <ul className="grid gap-2 sm:grid-cols-3">
          {ov.forecast.map((f) => (
            <li key={f.days} className="rounded-lg bg-canvas p-3 text-sm tabular">
              <p className="font-semibold">
                Até {formatShortDateBR(addDays(today, f.days))} ({f.days} dias)
              </p>
              <p>+ {formatBRL(f.inCents)} a receber</p>
              <p>− {formatBRL(f.outCents)} a pagar</p>
              <p className={cx("mt-1 text-base font-bold", f.netCents < 0 ? "text-danger" : "text-ink")}>
                = {formatBRL(f.netCents)}
              </p>
            </li>
          ))}
        </ul>
      </Card>
      <h2 className="mb-2 font-display text-lg font-bold">Últimos registros</h2>
      {movs.length === 0 ? (
        <EmptyState title="Nenhum registro ainda">Recebimentos e pagamentos registrados aparecem aqui.</EmptyState>
      ) : (
        <ul className="grid gap-2">
          {movs.map((m) => {
            const acc = data.accounts.find((a) => a.id === m.accountId);
            const v = acc ? accountView(data, acc, today) : null;
            const isIn = m.direction === "entrada";
            return (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-3"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={cx(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      isIn ? "bg-money-50 text-money-700" : "bg-[#f1f3f6] text-ink",
                    )}
                  >
                    {isIn ? <IconMoneyIn /> : <IconMoneyOut />}
                  </span>
                  <span className="min-w-0">
                    <span className={cx("block font-semibold", m.undoneAt && "line-through text-muted")}>
                      {isIn ? "Recebimento" : "Pagamento"} · {v?.partyName}
                    </span>
                    <span className="block text-sm text-muted">
                      {acc ? installmentLabel(acc) : ""} · {formatDateBR(m.paidOn)} · {METHOD_LABEL[m.method]} · por{" "}
                      {name(m.registeredBy)}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {m.undoneAt && <Badge tone="gray">Desfeito</Badge>}
                  <strong
                    className={cx(
                      "tabular",
                      isIn ? "text-money-700" : "text-ink",
                      m.undoneAt && "line-through opacity-60",
                    )}
                  >
                    {isIn ? "+" : "−"} {formatBRL(m.amountCents)}
                  </strong>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
