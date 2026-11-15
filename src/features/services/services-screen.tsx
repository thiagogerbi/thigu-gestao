"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton, LinkButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { IconEdit, IconPlus } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { hoursSummary } from "@/lib/domain/hours";
import { formatBRL } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import { useAction, useBackend, useMemberName } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useTerms } from "@/state/use-terms";

/** "Serviços e equipe": quem atende (uma agenda por pessoa ou sala) e a lista de serviços com duração e preço. */
export function ServicesScreen() {
  const { data, me } = useBackend();
  const dialogs = useDialogs();
  const nav = useNav();
  const t = useTerms();
  const toast = useToast();
  const name = useMemberName();
  const { exec, pending } = useAction();
  const agendaOn = moduleAvailable(data.company, "agenda");
  // na oficina, quem atende são os mecânicos (sem agenda de horários)
  const peopleOn = agendaOn || moduleAvailable(data.company, "ordem_servico");
  const peopleTitle = agendaOn ? "Quem atende" : "Mecânicos";
  const servicesOn = moduleAvailable(data.company, "servicos");
  const productsOn = moduleAvailable(data.company, "caixa") && can(me.roles, "produtos.gerenciar");

  if (!can(me.roles, "agenda.configurar") || (!agendaOn && !servicesOn)) {
    return (
      <>
        <PageHeader title="Serviços e equipe" />
        <EmptyState title="Página indisponível">
          Somente o administrador ou o gestor, em empresas com agenda ou lista de serviços, cadastram serviços e quem
          atende.
        </EmptyState>
      </>
    );
  }

  // pessoas da equipe que atendem e ainda não têm agenda: criar com um toque
  const withoutAgenda = data.members.filter(
    (m) => m.roles.includes("profissional") && !data.resources.some((r) => r.userId === m.userId),
  );
  async function quickCreate(userId: string, memberName: string) {
    const r = await exec({ type: "resource.save", name: memberName, userId, active: true });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <>
      <PageHeader
        title="Serviços e equipe"
        description={`O que a empresa oferece e quem atende. É daqui que a agenda tira os nomes, a duração e o valor de cada horário.`}
        actions={
          agendaOn && (
            <LinkButton href={nav.href("/agenda")} variant="secondary">
              Voltar para a agenda
            </LinkButton>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {peopleOn && (
          <Card className="p-4" aria-labelledby="quem-atende">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="quem-atende" className="font-display text-lg font-bold">
                {peopleTitle}
              </h2>
              <Button size="sm" onClick={() => dialogs.open({ kind: "resource" })}>
                <IconPlus className="h-4 w-4" /> {agendaOn ? "Nova agenda" : "Novo mecânico"}
              </Button>
            </div>
            <p className="mb-3 text-sm text-muted">
              {agendaOn
                ? "Uma agenda para cada pessoa ou sala. Ligada a alguém da equipe, essa pessoa vê e marca na própria agenda; sem ligação, serve para quem não usa o sistema (ou para uma sala, mesa, cadeira)."
                : "Quem pega as ordens de serviço. Ligado a alguém da equipe, o mecânico vê as OS dele no celular; sem ligação, serve para quem não usa o sistema (ex.: lava-rápido). A comissão é calculada por aqui."}
            </p>
            {withoutAgenda.length > 0 && (
              <div className="mb-3 rounded-lg bg-warn-50 p-3 text-sm">
                <p className="font-semibold text-warn">
                  {agendaOn ? "Na equipe, mas sem agenda:" : "Mecânicos da equipe ainda não cadastrados aqui:"}
                </p>
                <ul className="mt-1 grid gap-1">
                  {withoutAgenda.map((m) => (
                    <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {m.name} · {t.roleLabels(m.roles)}
                      </span>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => quickCreate(m.userId, m.name)}
                      >
                        {agendaOn ? "Criar agenda" : "Cadastrar"}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.resources.length === 0 ? (
              <p className="text-sm text-muted">{agendaOn ? "Nenhuma agenda ainda." : "Nenhum mecânico ainda."}</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.resources.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {r.name} {!r.active && <Badge tone="gray">desativada</Badge>}
                      </p>
                      <p className="text-sm text-muted">
                        {r.userId ? `Ligada a ${name(r.userId)}` : "Sem acesso ao sistema"}
                      </p>
                      {agendaOn && <p className="text-sm text-muted">{hoursSummary(r.workHours)}</p>}
                    </div>
                    <IconButton
                      label={`Editar agenda de ${r.name}`}
                      onClick={() => dialogs.open({ kind: "resource", resourceId: r.id })}
                    >
                      <IconEdit />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {servicesOn && (
          <Card className="p-4" aria-labelledby="servicos">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="servicos" className="font-display text-lg font-bold">
                Serviços
              </h2>
              <Button size="sm" onClick={() => dialogs.open({ kind: "service" })}>
                <IconPlus className="h-4 w-4" /> Novo serviço
              </Button>
            </div>
            {data.services.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhum serviço ainda. Cadastre os mais comuns: ao marcar um horário, o serviço preenche a duração e o
                valor.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.services.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {s.name} {!s.active && <Badge tone="gray">desativado</Badge>}
                      </p>
                      <p className="text-sm tabular text-muted">
                        {s.durationMin} min · {s.priceCents > 0 ? formatBRL(s.priceCents) : "sem valor"}
                      </p>
                    </div>
                    <IconButton
                      label={`Editar ${s.name}`}
                      onClick={() => dialogs.open({ kind: "service", serviceId: s.id })}
                    >
                      <IconEdit />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {productsOn && (
          <Card className="p-4" aria-labelledby="produtos">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="produtos" className="font-display text-lg font-bold">
                Produtos
              </h2>
              <Button size="sm" onClick={() => dialogs.open({ kind: "product" })}>
                <IconPlus className="h-4 w-4" /> Novo produto
              </Button>
            </div>
            <p className="mb-3 text-sm text-muted">O que é vendido no balcão. Aparece na venda rápida do caixa.</p>
            {data.products.length === 0 ? (
              <p className="text-sm text-muted">Nenhum produto ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.products.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {p.name} {!p.active && <Badge tone="gray">desativado</Badge>}
                      </p>
                      <p className="text-sm tabular text-muted">{formatBRL(p.priceCents)}</p>
                    </div>
                    <IconButton
                      label={`Editar ${p.name}`}
                      onClick={() => dialogs.open({ kind: "product", productId: p.id })}
                    >
                      <IconEdit />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
