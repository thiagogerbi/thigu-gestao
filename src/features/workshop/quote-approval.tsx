"use client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconCheckCircle } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { PlateBadge } from "@/features/workshop/plate-badge";
import { formatShortDateBR } from "@/lib/domain/dates";
import { formatBRL } from "@/lib/domain/money";
import { formatPlate } from "@/lib/domain/work-orders";
import { quoteApprove, type QuoteInfo } from "@/lib/server/quote";
import { useState, useTransition } from "react";

/** O cliente marca o que quer fazer e confirma com o nome. Fica registrado com data e hora. */
export function QuoteApproval({ token, info }: { token: string; info: QuoteInfo }) {
  const pending = info.items.filter((i) => i.status === "pendente");
  const [chosen, setChosen] = useState<string[]>(pending.map((i) => i.id));
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { approved: number; demo: boolean }>(null);
  const [sending, start] = useTransition();
  const line = (i: QuoteInfo["items"][number]) => i.quantity * i.unitCents;
  const decided = info.items.filter((i) => i.status !== "pendente");
  const approvedBefore = decided.filter((i) => i.status === "aprovado").reduce((s, i) => s + line(i), 0);
  const chosenSum = pending.filter((i) => chosen.includes(i.id)).reduce((s, i) => s + line(i), 0);
  const total = Math.max(0, approvedBefore + chosenSum - info.discountCents);

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await quoteApprove({ token, approvedIds: chosen, name });
      if (r.ok) setDone({ approved: r.approved, demo: r.demo });
      else setError(r.message);
    });
  }

  const header = (
    <header className="mb-5 flex items-center gap-3">
      {info.company.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.company.logo} alt="" className="h-12 w-12 rounded-xl object-contain" />
      ) : (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy font-display text-xl font-extrabold text-white"
          style={info.company.brandColor ? { background: info.company.brandColor } : undefined}
        >
          {info.company.name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-extrabold">{info.company.name}</p>
        <p className="text-sm text-muted">Orçamento nº {info.number}</p>
      </div>
    </header>
  );

  if (done) {
    return (
      <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
        {header}
        <div className="rounded-2xl border border-line bg-white p-6 text-center shadow-card">
          <IconCheckCircle className="mx-auto h-12 w-12 text-money-700" />
          <h1 className="mt-3 font-display text-2xl font-extrabold">
            {done.approved ? "Obrigado! A oficina já recebeu." : "Recebido. Nada foi aprovado."}
          </h1>
          <p className="mt-2 text-muted">
            {done.approved
              ? `Você aprovou ${done.approved} ${done.approved === 1 ? "item" : "itens"}. O serviço começa e avisaremos quando o carro estiver pronto.`
              : "A oficina vai entrar em contato para combinar a retirada do carro."}
            {info.company.phone && ` Dúvidas: ${info.company.phone}.`}
          </p>
          {done.demo && (
            <p className="mt-4 rounded-lg bg-warn-50 p-2 text-sm text-warn">Isto é um exemplo: nada foi gravado.</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      {header}
      {info.demo && (
        <p className="mb-4 rounded-lg bg-warn-50 p-2 text-sm text-warn">
          Exemplo de como o cliente aprova o orçamento. Nada é gravado.
        </p>
      )}
      <section className="mb-4 rounded-2xl border border-line bg-white p-4 shadow-card">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <PlateBadge plate={formatPlate(info.vehicle.plate)} /> {info.vehicle.name}
        </p>
        {info.clientName && (
          <p className="mt-1 text-sm text-muted">Olá, {info.clientName}! Confira o que encontramos no seu carro.</p>
        )}
        {info.complaint && (
          <p className="mt-3 text-sm">
            <span className="font-semibold">Você relatou: </span>
            {info.complaint}
          </p>
        )}
        {info.diagnosis && (
          <p className="mt-1 text-sm">
            <span className="font-semibold">O que encontramos: </span>
            {info.diagnosis}
          </p>
        )}
        {info.promisedOn && (
          <p className="mt-1 text-sm text-muted">Previsão de entrega: {formatShortDateBR(info.promisedOn)}</p>
        )}
      </section>

      {pending.length === 0 ? (
        <InlineAlert tone="green" title="Orçamento já respondido">
          {info.approvedByName ? `Decidido por ${info.approvedByName}.` : "Nada aguardando a sua decisão."} Total:{" "}
          {formatBRL(Math.max(0, approvedBefore - info.discountCents))}.
        </InlineAlert>
      ) : (
        <form onSubmit={confirm} className="grid gap-4" noValidate>
          <h1 className="font-display text-xl font-extrabold">Marque o que você autoriza</h1>
          <ul className="grid gap-2">
            {pending.map((i) => {
              const on = chosen.includes(i.id);
              return (
                <li key={i.id}>
                  <label
                    className={cx(
                      "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border bg-white px-4 py-3",
                      on ? "border-primary" : "border-line opacity-75",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-primary"
                      checked={on}
                      onChange={(e) =>
                        setChosen((c) => (e.target.checked ? [...c, i.id] : c.filter((x) => x !== i.id)))
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {i.quantity > 1 && `${i.quantity} × `}
                        {i.description}
                      </span>
                      <span className="text-sm text-muted">
                        {i.kind === "peca" ? "Peça" : "Mão de obra"}
                        {i.warrantyDays ? ` · garantia de ${i.warrantyDays} dias` : ""}
                      </span>
                    </span>
                    <span className="font-semibold tabular">{formatBRL(line(i))}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {decided.length > 0 && (
            <p className="text-sm text-muted">
              Já aprovado antes: {formatBRL(approvedBefore)}
              {info.discountCents > 0 && ` · desconto de ${formatBRL(info.discountCents)}`}
            </p>
          )}
          <div className="flex items-baseline justify-between rounded-xl bg-canvas px-4 py-3">
            <span className="font-semibold">Total</span>
            <span className="font-display text-2xl font-extrabold tabular">{formatBRL(total)}</span>
          </div>
          {error && <InlineAlert>{error}</InlineAlert>}
          <TextField
            label="Seu nome"
            value={name}
            maxLength={120}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
            hint="Fica registrado com a data e a hora, como confirmação."
          />
          <Button type="submit" size="lg" loading={sending} disabled={name.trim().length < 2}>
            {chosen.length ? `Aprovar ${formatBRL(chosenSum)}` : "Não autorizo nenhum item"}
          </Button>
          <p className="text-center text-xs text-muted">O que ficar desmarcado não será feito nem cobrado.</p>
        </form>
      )}
      <p className="mt-10 text-center text-xs text-muted">Orçamento por Thigu Gestão</p>
    </main>
  );
}
