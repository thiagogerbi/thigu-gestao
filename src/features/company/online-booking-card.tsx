"use client";
import { Button } from "@/components/ui/button";
import { Badge, Card, InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { hasHours } from "@/lib/domain/hours";
import { moduleAvailable } from "@/lib/domain/segments";
import { useAction, useBackend, useCan } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useState, useSyncExternalStore } from "react";

/** "Studio Bella" → "studio-bella" */
export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

const noSubscribe = () => () => {};

/** Liga o link público de agendamento: o endereço, se já entra confirmado e o link para copiar. */
export function OnlineBookingCard() {
  const { data, mode } = useBackend();
  const canDo = useCan();
  const nav = useNav();
  const toast = useToast();
  const { exec, pending, fieldErrors, error, clear } = useAction();
  const company = data.company;
  const [slug, setSlug] = useState(company.bookingSlug ?? slugify(company.name));
  const [autoConfirm, setAutoConfirm] = useState(company.bookingAutoConfirm);
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );

  if (!moduleAvailable(company, "agendamento_online") || !canDo("empresa.gerenciar")) return null;

  const withHours = data.resources.filter((r) => r.active && hasHours(r.workHours));
  const activeServices = data.services.filter((s) => s.active);
  // na prévia, o link abre o exemplo (que não grava nada)
  const publicPath = mode === "previa" ? "/agendar/exemplo" : `/agendar/${company.bookingSlug ?? ""}`;
  const url = `${origin}${publicPath}`;

  async function save(enabled: boolean) {
    const r = await exec({ type: "company.setBooking", enabled, slug: slug.trim() || null, autoConfirm });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
  }

  return (
    <Card className="mb-6 p-4" aria-labelledby="agendamento-online">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="agendamento-online" className="font-display text-lg font-bold">
          Agendamento online
        </h2>
        <Badge tone={company.bookingEnabled ? "green" : "gray"}>
          {company.bookingEnabled ? "ligado" : "desligado"}
        </Badge>
      </div>
      <p className="mb-3 text-sm text-muted">
        Um link para colocar no Instagram, no WhatsApp ou no Google. O cliente escolhe o serviço, quem atende e um
        horário livre, e o horário aparece na agenda marcado como “online”.
      </p>

      {(withHours.length === 0 || activeServices.length === 0) && (
        <div className="mb-3">
          <InlineAlert tone="amber" title="Falta pouco">
            {activeServices.length === 0 && "Cadastre pelo menos um serviço. "}
            {withHours.length === 0 &&
              "Defina o horário de trabalho de quem atende (em Serviços e equipe): só aparece no link quem tem horário."}{" "}
            <a href={nav.href("/servicos")} className="font-semibold underline">
              Abrir Serviços e equipe
            </a>
          </InlineAlert>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <TextField
          label="Endereço da página"
          prefix="/agendar/"
          className="pl-[5.5rem]!"
          value={slug}
          maxLength={40}
          onChange={(e) => {
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
            clear();
          }}
          error={fieldErrors.slug ?? (error && !company.bookingEnabled ? error : null)}
          hint="Letras minúsculas, números e hífen. Ex.: studio-bella"
          autoComplete="off"
        />
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={autoConfirm}
          onChange={(e) => setAutoConfirm(e.target.checked)}
        />
        Horário marcado pelo link já entra confirmado (sem isso, a recepção confirma)
      </label>
      <p className="mt-1 text-sm text-muted">
        Proteções: só horários a partir de 30 minutos e até 60 dias, no máximo 3 horários futuros por celular.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {company.bookingEnabled ? (
          <>
            <Button loading={pending} onClick={() => save(true)}>
              Salvar
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => save(false)}>
              Desligar o link
            </Button>
          </>
        ) : (
          <Button loading={pending} onClick={() => save(true)} disabled={!slug.trim()}>
            Ligar o agendamento online
          </Button>
        )}
      </div>

      {company.bookingEnabled && company.bookingSlug && (
        <div className="mt-4 rounded-lg bg-canvas p-3">
          <p className="text-sm font-semibold">Link para divulgar</p>
          <p className="mt-1 break-all font-mono text-sm">{url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(url);
                  toast({ tone: "success", text: "Link copiado." });
                } catch {
                  toast({ tone: "error", text: "Não deu para copiar. Selecione o link e copie." });
                }
              }}
            >
              Copiar link
            </Button>
            <a
              href={publicPath}
              target="_blank"
              rel="noopener"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-primary-700 hover:bg-white sm:min-h-9"
            >
              Abrir a página {mode === "previa" && "(exemplo)"}
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}
