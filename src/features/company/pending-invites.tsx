"use client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { ROLE_LABEL, type MyInvite } from "@/lib/domain/types";
import { respondInvite } from "@/lib/server/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Convites que a pessoa logada recebeu e ainda não respondeu. Ninguém entra numa empresa sem aceitar:
 * até lá, ela não vê nada da empresa além do nome e de quem convidou.
 */
export function PendingInvites({ invites }: { invites: MyInvite[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (invites.length === 0) return null;

  async function respond(invite: MyInvite, accept: boolean) {
    setBusy(invite.id);
    setError(null);
    const r = await respondInvite(invite.id, accept);
    setBusy(null);
    if (!r.ok) return setError(r.message);
    if (accept) router.push("/app");
    router.refresh();
  }

  return (
    <section aria-label="Convites recebidos" className="mb-6 grid gap-3">
      {invites.map((i) => (
        <div key={i.id} className="rounded-2xl border border-primary/30 bg-primary-50 p-4">
          <h2 className="font-display text-lg font-bold">
            {i.invitedByName} convidou você para a empresa {i.companyName}
          </h2>
          <p className="mt-1 text-ink">Você entra como {i.roles.map((r) => ROLE_LABEL[r]).join(", ")}.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => respond(i, true)} loading={busy === i.id} disabled={busy !== null}>
              Aceitar convite
            </Button>
            <Button variant="secondary" onClick={() => respond(i, false)} disabled={busy !== null}>
              Recusar
            </Button>
          </div>
        </div>
      ))}
      {error && <InlineAlert>{error}</InlineAlert>}
    </section>
  );
}
