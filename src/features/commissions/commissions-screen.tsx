"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { IconEdit, IconPlus, IconX } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { localParts } from "@/lib/domain/agenda";
import { commissionSummary, isPastMonth, ruleLabel } from "@/lib/domain/commissions";
import { addMonths, formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import type { CommissionRule, Resource } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useAgenda } from "@/state/use-agenda";
import { useNav } from "@/state/use-nav";

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
export const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;

/** Quem a regra pega: "Regra geral", "Lúcia", "Barba" ou "Tiago · Barba". */
export function ruleScope(
  rule: CommissionRule,
  resourceName: (id: string) => string,
  serviceName: (id: string) => string,
) {
  if (!rule.resourceId && !rule.serviceId) return "Regra geral (todos e todos os serviços)";
  return [rule.resourceId && resourceName(rule.resourceId), rule.serviceId && serviceName(rule.serviceId)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Comissões do mês: quanto cada profissional fez de atendimentos atendidos e quanto ganha de comissão.
 * O financeiro ou o dono fecha o mês que terminou e o valor vira uma conta a pagar no financeiro.
 */
export function CommissionsScreen() {
  const { data, me, today } = useBackend();
  const nav = useNav();
  const dialogs = useDialogs();
  const ag = useAgenda();
  const toast = useToast();
  const { exec, pending } = useAction();
  const seeAll = can(me.roles, "comissoes.ver_todas");
  const own = data.resources.filter((r) => r.userId === me.userId);

  if (!moduleAvailable(data.company, "comissoes") || (!seeAll && own.length === 0)) {
    return (
      <>
        <PageHeader title="Comissões" />
        <EmptyState title="Página indisponível">
          As comissões existem para empresas com profissionais comissionados (salões, barbearias, estética). Cada
          profissional vê a própria; o dono e o financeiro veem todas.
        </EmptyState>
      </>
    );
  }

  const thisMonth = `${today.slice(0, 7)}-01`;
  const param = nav.params.get("mes");
  const month = param && /^\d{4}-\d{2}-01$/.test(param) ? param : thisMonth;
  const past = isPastMonth(month, today);
  const resources: Resource[] = seeAll
    ? data.resources.filter((r) => r.active || data.appointments.some((a) => a.resourceId === r.id))
    : own;
  const closeable = can(me.roles, "comissoes.fechar") && past;
  const configure = can(me.roles, "comissoes.configurar");
  const serviceName = (id: string) => data.services.find((s) => s.id === id)?.name ?? "—";

  const rows = resources.map((r) => {
    const closing = data.commissionClosings.find((c) => c.resourceId === r.id && c.month === month);
    const sum = commissionSummary({
      resourceId: r.id,
      month,
      appointments: data.appointments,
      packages: data.packages,
      rules: data.commissionRules,
    });
    return { resource: r, closing, sum };
  });
  const total = rows.reduce((s, r) => s + (r.closing?.amountCents ?? r.sum.amountCents), 0);

  async function close(resourceId: string, name: string) {
    if (!window.confirm(`Fechar as comissões de ${name} em ${monthLabel(month)}? O valor vira uma conta a pagar.`))
      return;
    const r = await exec({ type: "commission.close", resourceId, month });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <>
      <PageHeader
        title="Comissões"
        description={
          seeAll
            ? "Quanto cada profissional ganha sobre os atendimentos atendidos no mês."
            : "Quanto você ganha sobre os seus atendimentos atendidos no mês."
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Mudar o mês">
          <Button variant="secondary" size="sm" onClick={() => nav.setQuery({ mes: addMonths(month, -1) })}>
            ‹ Mês anterior
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={month >= thisMonth}
            onClick={() => {
              const next = addMonths(month, 1);
              nav.setQuery({ mes: next === thisMonth ? null : next });
            }}
          >
            Próximo mês ›
          </Button>
        </div>
        <h2 className="font-display text-lg font-bold first-letter:uppercase">{monthLabel(month)}</h2>
        {!past && <Badge tone="blue">mês em andamento: valores parciais</Badge>}
      </div>

      {seeAll && (
        <p className="mb-4 text-sm text-muted">
          Total do mês: <span className="font-semibold text-ink tabular">{formatBRL(total)}</span>
        </p>
      )}

      <div className="grid gap-4">
        {rows.map(({ resource, closing, sum }) => (
          <Card key={resource.id} className="p-4" aria-labelledby={`com-${resource.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id={`com-${resource.id}`} className="font-display text-base font-bold">
                  {resource.name}
                </h3>
                <p className="text-sm text-muted">
                  {closing
                    ? `${closing.appointments} ${closing.appointments === 1 ? "atendimento" : "atendimentos"} · base ${formatBRL(closing.baseCents)}`
                    : `${sum.lines.length} ${sum.lines.length === 1 ? "atendimento" : "atendimentos"} · base ${formatBRL(sum.baseCents)}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-xl font-extrabold tabular">
                  {formatBRL(closing?.amountCents ?? sum.amountCents)}
                </span>
                {closing ? (
                  <Badge tone="green">Fechado em {formatShortDateBR(localParts(closing.closedAt).date)}</Badge>
                ) : (
                  closeable && (
                    <Button size="sm" disabled={pending} onClick={() => close(resource.id, resource.name)}>
                      Fechar mês
                    </Button>
                  )
                )}
              </div>
            </div>
            {sum.lines.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold text-primary-700">Ver atendimentos</summary>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {sum.lines.map((l) => (
                    <li key={l.appointment.id} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>
                        {formatShortDateBR(localParts(l.appointment.startsAt).date)} ·{" "}
                        {ag.serviceName(l.appointment.serviceId) ?? "Atendimento"}
                        {l.appointment.consumesPackage && " (sessão do pacote)"}
                      </span>
                      <span className="tabular">
                        {formatBRL(l.baseCents)} → <span className="font-semibold">{formatBRL(l.amountCents)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        ))}
      </div>

      {(configure || data.commissionRules.length > 0) && (
        <Card className="mt-6 p-4" aria-labelledby="regras">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="regras" className="font-display text-lg font-bold">
              Regras de comissão
            </h2>
            {configure && (
              <Button size="sm" onClick={() => dialogs.open({ kind: "commissionRule" })}>
                <IconPlus className="h-4 w-4" /> Nova regra
              </Button>
            )}
          </div>
          <p className="mb-3 text-sm text-muted">
            Vale a regra mais específica: profissional e serviço juntos, depois só o serviço, depois só o profissional,
            depois a regra geral.
          </p>
          {data.commissionRules.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma regra ainda. Comece com uma regra geral, por exemplo 40%.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.commissionRules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{ruleScope(r, ag.resourceName, serviceName)}</p>
                    <p className="text-sm text-muted">{ruleLabel(r, formatBRL)}</p>
                  </div>
                  {configure && (
                    <div className="flex">
                      <IconButton
                        label="Editar regra"
                        onClick={() => dialogs.open({ kind: "commissionRule", ruleId: r.id })}
                      >
                        <IconEdit />
                      </IconButton>
                      <IconButton
                        label="Apagar regra"
                        disabled={pending}
                        onClick={async () => {
                          if (!window.confirm("Apagar esta regra? Os meses já fechados não mudam.")) return;
                          const res = await exec({ type: "commissionRule.delete", id: r.id });
                          toast({ tone: res.ok ? "success" : "error", text: res.message });
                        }}
                      >
                        <IconX />
                      </IconButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
