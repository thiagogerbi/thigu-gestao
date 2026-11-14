"use client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { formatDateBR } from "@/lib/domain/dates";
import { rolesFor } from "@/lib/domain/segments";
import type { CompanyInvite, Role } from "@/lib/domain/types";
import { cancelInvite, inviteMember, setMemberRoles } from "@/lib/server/actions";
import { useBackend } from "@/state/backend-context";
import { useTerms } from "@/state/use-terms";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function MembersManager({ invites }: { invites: CompanyInvite[] }) {
  const { data, me } = useBackend();
  const router = useRouter();
  const toast = useToast();
  const t = useTerms();
  const segment = data.company.segment;
  // papéis do ramo; o primeiro depois do administrador já vem marcado no convite
  const inviteRoles = rolesFor(segment);
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>([inviteRoles.find((r) => r !== "admin") ?? "admin"]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (r: Role, list: Role[]) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await inviteMember(data.company.id, email, roles);
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setEmail("");
    toast({ tone: "success", text: r.message });
    router.refresh();
  }
  async function cancel(invite: CompanyInvite) {
    const r = await cancelInvite(invite.id);
    toast({ tone: r.ok ? "success" : "error", text: r.message });
    if (r.ok) router.refresh();
  }
  async function change(userId: string, next: Role[], active = true) {
    const r = await setMemberRoles(data.company.id, userId, next, active);
    toast({ tone: r.ok ? "success" : "error", text: r.message });
    if (r.ok) router.refresh();
  }

  return (
    <div className="mt-6 border-t border-line pt-4">
      <h3 className="mb-2 font-display font-bold">Papéis de cada pessoa</h3>
      <ul className="mb-6 grid gap-3">
        {data.members.map((m) => (
          <li key={m.userId} className="rounded-lg border border-line p-3">
            <p className="font-semibold">{m.name}</p>
            <fieldset className="mt-2 flex flex-wrap gap-2">
              <legend className="sr-only">Papéis de {m.name}</legend>
              {rolesFor(segment, m.roles).map((r) => (
                <label key={r} className="flex min-h-9 items-center gap-2 rounded-full border border-line px-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={m.roles.includes(r)}
                    onChange={() => {
                      const next = toggle(r, m.roles);
                      if (next.length) change(m.userId, next);
                    }}
                  />
                  {t.roleLabel(r)}
                </label>
              ))}
            </fieldset>
            {m.userId !== me.userId && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => change(m.userId, m.roles, false)}>
                Remover acesso de {m.name}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {invites.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 font-display font-bold">Convites aguardando resposta</h3>
          <ul className="grid gap-2">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-dashed border-[#aab6c9] p-3"
              >
                <div className="min-w-0">
                  <p className="break-all font-semibold">{i.email}</p>
                  <p className="text-sm text-muted">
                    {t.roleLabels(i.roles)} · convidado em {formatDateBR(i.createdAt)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => cancel(i)}
                  aria-label={`Cancelar convite de ${i.email}`}
                >
                  Cancelar convite
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={add} className="grid gap-3 rounded-lg bg-canvas p-3" noValidate>
        <h3 className="font-display font-bold">Convidar pessoa</h3>
        <p className="text-sm text-muted">
          A pessoa só entra na empresa depois de aceitar. O convite aparece quando ela entra no Thigu com este e-mail,
          mesmo que crie a conta depois. Nenhum e-mail é enviado: avise a pessoa.
        </p>
        <TextField
          label="E-mail da pessoa"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          error={error}
        />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-sm font-semibold">Papéis</legend>
          {inviteRoles.map((r) => (
            <label
              key={r}
              className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={roles.includes(r)}
                onChange={() => setRoles(toggle(r, roles))}
              />
              {t.roleLabel(r)}
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" loading={pending} disabled={!roles.length}>
            Convidar para a empresa
          </Button>
        </div>
      </form>
    </div>
  );
}
