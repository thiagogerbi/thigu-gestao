"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@/components/ui/icons";
import { ClientSection } from "@/features/clients/client-section";
import { PackageRow, SubscriptionRow } from "@/features/recurring/recurring-items";
import { useRecurring } from "@/state/use-recurring";

/** Pacotes e mensalidades do cliente, na ficha. */
export function ClientRecurring({ clientId }: { clientId: string }) {
  const rec = useRecurring();
  const dialogs = useDialogs();
  if (!rec.enabled) return null;
  const pkgs = rec.packagesOf(clientId).filter((v) => !v.closed);
  const subs = rec.subscriptionsOf(clientId).filter((s) => !s.sub.canceledAt);
  if (!rec.canSell && pkgs.length === 0 && subs.length === 0) return null;
  return (
    <ClientSection
      title={rec.label}
      collapsible
      defaultOpen={pkgs.length + subs.length > 0}
      count={pkgs.length + subs.length}
      action={
        rec.canSell && (
          <div className="flex flex-wrap gap-2">
            {rec.packagesOn && (
              <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "package", clientId })}>
                <IconPlus className="h-4 w-4" /> Vender pacote
              </Button>
            )}
            {rec.subscriptionsOn && (
              <Button size="sm" variant="secondary" onClick={() => dialogs.open({ kind: "subscription", clientId })}>
                <IconPlus className="h-4 w-4" /> Nova mensalidade
              </Button>
            )}
          </div>
        )
      }
    >
      {pkgs.length + subs.length === 0 ? (
        <p className="text-sm text-muted">Nenhum pacote ou mensalidade.</p>
      ) : (
        <ul className="grid gap-2">
          {subs.map((s) => (
            <SubscriptionRow key={s.sub.id} sub={s.sub} state={s.state} overdue={s.overdue} />
          ))}
          {pkgs.map((v) => (
            <PackageRow key={v.pkg.id} view={v} />
          ))}
        </ul>
      )}
    </ClientSection>
  );
}
