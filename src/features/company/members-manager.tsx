"use client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { ROLE_LABEL, type Role } from "@/lib/domain/types";
import { addMember, setMemberRoles } from "@/lib/server/actions";
import { useBackend } from "@/state/backend-context";
import { useRouter } from "next/navigation";
import { useState } from "react";

const ROLES: Role[] = ["admin", "gestor", "vendedor", "financeiro"];

export function MembersManager() {
  const { data, me } = useBackend();
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<Role[]>(["vendedor"]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (r: Role, list: Role[]) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await addMember(data.company.id, email, roles);
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setEmail("");
    toast({ tone: "success", text: r.message });
    router.refresh();
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
              {ROLES.map((r) => (
                <label key={r} className="flex min-h-9 items-center gap-2 rounded-full border border-line px-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#3563E9]"
                    checked={m.roles.includes(r)}
                    onChange={() => {
                      const next = toggle(r, m.roles);
                      if (next.length) change(m.userId, next);
                    }}
                  />
                  {ROLE_LABEL[r]}
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
      <form onSubmit={add} className="grid gap-3 rounded-lg bg-canvas p-3" noValidate>
        <h3 className="font-display font-bold">Adicionar pessoa</h3>
        <p className="text-sm text-muted">
          A pessoa precisa ter criado uma conta no Thigu com este e-mail. Nenhum convite é enviado automaticamente.
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
          {ROLES.map((r) => (
            <label
              key={r}
              className="flex min-h-9 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-[#3563E9]"
                checked={roles.includes(r)}
                onChange={() => setRoles(toggle(r, roles))}
              />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </fieldset>
        <div>
          <Button type="submit" loading={pending} disabled={!roles.length}>
            Adicionar pessoa à empresa
          </Button>
        </div>
      </form>
    </div>
  );
}
