"use client";

import { Badge, Card, InlineAlert, PageHeader } from "@/components/ui/card";
import { AccessCard } from "@/features/activation/access-status";
import { CompanyLetterhead } from "@/features/company/company-letterhead";
import { CompanyProfileForm } from "@/features/company/company-profile-form";
import { ROLE_LABEL, type Role } from "@/lib/domain/types";
import { useBackend, useCan } from "@/state/backend-context";

const ROLE_HELP: Record<Role, string> = {
  admin: "Gerencia a empresa, os membros e os dois módulos. Pode fazer todo o fluxo sozinho.",
  gestor: "Acompanha clientes, negociações e indicadores comerciais de toda a equipe.",
  vendedor: "Cuida dos próprios clientes e negociações, fecha vendas e propõe as parcelas.",
  financeiro: "Confere vendas, cria as contas a receber, cadastra despesas e registra pagamentos e recebimentos.",
};

/** Lista de membros e papéis. Na versão real, o gerenciamento fica em MembersManager (servidor). */
export function CompanyScreen({ manager }: { manager?: React.ReactNode }) {
  const { data, me, mode } = useBackend();
  const canDo = useCan();
  return (
    <>
      <PageHeader
        title="Minha empresa"
        description={`${data.company.name} · dados que aparecem nas propostas, aparência e quem faz parte da equipe.`}
      />
      {mode === "previa" && (
        <div className="mb-4">
          <InlineAlert tone="blue" title="Na prévia">
            Use “Experimente como”, no topo da página, para experimentar o sistema com cada papel. Pessoas e e-mails são
            fictícios.
          </InlineAlert>
        </div>
      )}
      <AccessCard />
      {canDo("empresa.gerenciar") ? (
        <CompanyProfileForm />
      ) : (
        <Card className="mb-6 p-4">
          <h2 className="mb-3 font-display text-lg font-bold">Dados da empresa</h2>
          <CompanyLetterhead company={data.company} />
          <p className="mt-3 text-sm text-muted">Somente o administrador altera estes dados.</p>
        </Card>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="p-4">
          <h2 className="mb-3 font-display text-lg font-bold">Membros</h2>
          <ul className="divide-y divide-line">
            {data.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="font-semibold">
                    {m.name}
                    {m.userId === me.userId ? " (você)" : ""}
                  </p>
                  <p className="text-sm text-muted">{m.email}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {m.roles.map((r) => (
                    <Badge key={r} tone={r === "admin" ? "navy" : "blue"}>
                      {ROLE_LABEL[r]}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {canDo("empresa.gerenciar") && manager}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-display text-lg font-bold">O que cada papel faz</h2>
          <dl className="grid gap-3 text-sm">
            {(Object.keys(ROLE_HELP) as Role[]).map((r) => (
              <div key={r}>
                <dt className="font-semibold">{ROLE_LABEL[r]}</dt>
                <dd className="text-muted">{ROLE_HELP[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">Uma pessoa pode ter mais de um papel. O dono pode acumular todos.</p>
        </Card>
      </div>
    </>
  );
}
