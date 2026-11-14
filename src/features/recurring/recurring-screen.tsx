"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { IconPlus } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { PackageRow, SubscriptionRow } from "@/features/recurring/recurring-items";
import { formatBRL } from "@/lib/domain/money";
import { useNav } from "@/state/use-nav";
import { useRecurring } from "@/state/use-recurring";

/** Pacotes vendidos e mensalidades da empresa. Atrasadas e pacotes acabando aparecem primeiro. */
export function RecurringScreen() {
  const rec = useRecurring();
  const dialogs = useDialogs();
  const nav = useNav();
  const all = nav.params.get("ver") === "todos";

  if (!rec.enabled) {
    return (
      <>
        <PageHeader title="Pacotes e mensalidades" />
        <EmptyState title="Indisponível para este ramo">
          Pacotes e mensalidades existem para clínicas, salões, pet shops e aulas.
        </EmptyState>
      </>
    );
  }

  const subs = rec.subscriptionsOf();
  const activeSubs = subs.filter((s) => !s.sub.canceledAt && s.state !== "encerrada");
  const shownSubs = (all ? subs : activeSubs).sort(
    (a, b) => Number(b.state === "atrasada") - Number(a.state === "atrasada"),
  );
  const monthly = activeSubs.reduce((s, x) => s + x.sub.amountCents, 0);
  const late = subs.filter((s) => s.state === "atrasada").length;
  const pkgs = rec.packagesOf();
  const openPkgs = pkgs.filter((v) => !v.closed && !v.expired && v.remaining > 0);
  const shownPkgs = (all ? pkgs : openPkgs).sort((a, b) => Number(b.endingSoon) - Number(a.endingSoon));

  return (
    <>
      <PageHeader
        title={rec.label}
        description="Dinheiro que se repete: pacotes pagos antes e mensalidades que viram cobrança todo mês."
        actions={
          rec.canSell && (
            <>
              {rec.packagesOn && (
                <Button onClick={() => dialogs.open({ kind: "package" })}>
                  <IconPlus className="h-5 w-5" /> Vender pacote
                </Button>
              )}
              {rec.subscriptionsOn && (
                <Button
                  variant={rec.packagesOn ? "secondary" : "primary"}
                  onClick={() => dialogs.open({ kind: "subscription" })}
                >
                  <IconPlus className="h-5 w-5" /> Nova mensalidade
                </Button>
              )}
            </>
          )
        }
      />

      <div
        className="mb-4 flex rounded-lg border border-line bg-white p-0.5"
        role="group"
        aria-label="O que mostrar"
        style={{ width: "fit-content" }}
      >
        {[
          { id: false, label: "Em uso" },
          { id: true, label: "Todos, inclusive encerrados" },
        ].map((v) => (
          <button
            key={v.label}
            type="button"
            aria-pressed={all === v.id}
            onClick={() => nav.setQuery({ ver: v.id ? "todos" : null })}
            className={cx(
              "min-h-9 rounded-md px-3 text-sm font-semibold",
              all === v.id ? "bg-primary text-white" : "text-muted hover:bg-canvas",
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {rec.subscriptionsOn && (
          <Card className="p-4" aria-labelledby="mensalidades">
            <h2 id="mensalidades" className="font-display text-lg font-bold">
              Mensalidades
            </h2>
            <p className="mb-3 text-sm text-muted">
              {activeSubs.length} {activeSubs.length === 1 ? "ativa" : "ativas"} · {formatBRL(monthly)} por mês
              {rec.seesMoney && late > 0 ? ` · ${late} com cobrança atrasada` : ""}
            </p>
            {shownSubs.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma mensalidade {all ? "" : "ativa "}ainda.</p>
            ) : (
              <ul className="grid gap-2">
                {shownSubs.map((s) => (
                  <SubscriptionRow key={s.sub.id} sub={s.sub} state={s.state} overdue={s.overdue} showClient />
                ))}
              </ul>
            )}
          </Card>
        )}
        {rec.packagesOn && (
          <Card className="p-4" aria-labelledby="pacotes">
            <h2 id="pacotes" className="font-display text-lg font-bold">
              Pacotes
            </h2>
            <p className="mb-3 text-sm text-muted">
              {openPkgs.length} em uso
              {openPkgs.some((v) => v.endingSoon)
                ? ` · ${openPkgs.filter((v) => v.endingSoon).length} acabando (bom momento para oferecer a renovação)`
                : ""}
            </p>
            {shownPkgs.length === 0 ? (
              <p className="text-sm text-muted">Nenhum pacote {all ? "" : "em uso "}ainda.</p>
            ) : (
              <ul className="grid gap-2">
                {shownPkgs.map((v) => (
                  <PackageRow key={v.pkg.id} view={v} showClient />
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
