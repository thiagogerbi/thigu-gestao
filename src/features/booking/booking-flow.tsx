"use client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { IconArrowLeft, IconCheckCircle, IconSpinner } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { brParts, nextDays, WEEKDAY_SHORT } from "@/lib/domain/hours";
import { formatBRL } from "@/lib/domain/money";
import { bookingConfirm, bookingSlots, type BookingInfo } from "@/lib/server/booking";
import { useEffect, useState, useTransition } from "react";

const DAYS = 14;
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
};
const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const timeOf = (iso: string) => brParts(iso).time;

/** Escolhas do cliente, em passos curtos e pensados para o celular. */
export function BookingFlow({ slug, info }: { slug: string; info: BookingInfo }) {
  const [serviceId, setServiceId] = useState(info.services.length === 1 ? info.services[0].id : "");
  const [resourceId, setResourceId] = useState(info.resources.length === 1 ? info.resources[0].id : "");
  const [days] = useState(() => nextDays(new Date(), DAYS));
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [startsAt, setStartsAt] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { status: "agendado" | "confirmado"; demo: boolean }>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [reload, setReload] = useState(0);
  const [loadingSlots, startSlots] = useTransition();
  const [sending, startSend] = useTransition();
  const service = info.services.find((s) => s.id === serviceId);
  const resource = info.resources.find((r) => r.id === resourceId);
  const accent = info.company.brandColor ?? undefined;

  // dias em que a pessoa atende (pelo horário de trabalho)
  const workDays = resource
    ? days.filter((d) => (resource.workHours[String(weekdayOf(d)) as "0"] ?? []).length > 0)
    : [];

  useEffect(() => {
    if (!serviceId || !resourceId || !date) return;
    let alive = true;
    startSlots(async () => {
      const list = await bookingSlots({ slug, serviceId, resourceId, date });
      if (alive) setSlots(list);
    });
    return () => {
      alive = false;
    };
  }, [slug, serviceId, resourceId, date, reload]);

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startSend(async () => {
      const r = await bookingConfirm({ slug, serviceId, resourceId, startsAt, name, phone, requestId });
      if (r.ok) return setDone({ status: r.status, demo: r.demo });
      setError(r.message);
      // horário tomado: volta para escolher outro, com um novo pedido
      if (/ocupado|não está mais livre|fora do atendimento/i.test(r.message)) {
        setStartsAt("");
        setRequestId(crypto.randomUUID());
        setSlots(null);
        setReload((n) => n + 1);
      }
    });
  }

  const header = (
    <header className="mb-6 flex items-center gap-3">
      {info.company.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={info.company.logo} alt="" className="h-12 w-12 rounded-xl object-contain" />
      ) : (
        <span
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy font-display text-xl font-extrabold text-white"
          style={accent ? { background: accent } : undefined}
        >
          {info.company.name.slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-extrabold">{info.company.name}</p>
        <p className="text-sm text-muted">Agende seu horário</p>
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
            {done.status === "confirmado" ? "Horário confirmado!" : "Pedido enviado!"}
          </h1>
          <p className="mt-2">
            {service?.name} com {resource?.name}
            <br />
            <span className="font-semibold">
              {WEEKDAY_SHORT[weekdayOf(date)]}, {dayLabel(date)} às {timeOf(startsAt)}
            </span>
          </p>
          <p className="mt-3 text-sm text-muted">
            {done.status === "confirmado"
              ? "Até lá! Se precisar desmarcar, fale com a empresa."
              : "A empresa vai confirmar pelo seu celular. Se precisar desmarcar, fale com ela."}
            {info.company.phone && ` Telefone: ${info.company.phone}.`}
          </p>
          {done.demo && (
            <p className="mt-4 rounded-lg bg-warn-50 p-2 text-sm text-warn">Isto é um exemplo: nada foi gravado.</p>
          )}
        </div>
      </main>
    );
  }

  const step = !serviceId ? 1 : !resourceId ? 2 : !startsAt ? 3 : 4;
  const back = () => {
    setError(null);
    if (step === 4) setStartsAt("");
    else if (step === 3 && info.resources.length > 1) {
      setResourceId("");
      setDate("");
      setSlots(null);
    } else if (info.services.length > 1) {
      setServiceId("");
      setDate("");
      setSlots(null);
    }
  };
  const canGoBack = step === 4 || (step === 3 && (info.resources.length > 1 || info.services.length > 1)) || step === 2;

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-4 py-8">
      {header}
      {info.demo && (
        <p className="mb-4 rounded-lg bg-warn-50 p-2 text-sm text-warn">
          Exemplo de como o seu cliente agenda. Nada é gravado.
        </p>
      )}
      {(service || resource) && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {canGoBack && (
            <button
              type="button"
              onClick={back}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 font-semibold text-primary-700 hover:bg-canvas"
            >
              <IconArrowLeft className="h-4 w-4" /> Voltar
            </button>
          )}
          {service && <span className="rounded-full bg-canvas px-3 py-1">{service.name}</span>}
          {resource && <span className="rounded-full bg-canvas px-3 py-1">com {resource.name}</span>}
          {startsAt && (
            <span className="rounded-full bg-canvas px-3 py-1">
              {dayLabel(date)} às {timeOf(startsAt)}
            </span>
          )}
        </div>
      )}

      {step === 1 && (
        <section aria-labelledby="passo-servico">
          <h1 id="passo-servico" className="mb-3 font-display text-xl font-extrabold">
            Qual serviço?
          </h1>
          <ul className="grid gap-2">
            {info.services.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setServiceId(s.id)}
                  className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left hover:border-primary"
                >
                  <span>
                    <span className="block font-semibold">{s.name}</span>
                    <span className="text-sm text-muted">{s.durationMin} min</span>
                  </span>
                  {s.priceCents > 0 && <span className="font-semibold tabular">{formatBRL(s.priceCents)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="passo-quem">
          <h1 id="passo-quem" className="mb-3 font-display text-xl font-extrabold">
            Com quem?
          </h1>
          <ul className="grid gap-2">
            {info.resources.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setResourceId(r.id)}
                  className="flex min-h-14 w-full items-center rounded-xl border border-line bg-white px-4 py-3 text-left font-semibold hover:border-primary"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="passo-dia">
          <h1 id="passo-dia" className="mb-3 font-display text-xl font-extrabold">
            Qual dia e horário?
          </h1>
          {workDays.length === 0 ? (
            <p className="text-muted">Sem dias livres nas próximas duas semanas.</p>
          ) : (
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Dia">
              {workDays.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={date === d}
                  onClick={() => {
                    if (d === date) return;
                    setSlots(null);
                    setDate(d);
                  }}
                  className={cx(
                    "flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center rounded-xl border px-2",
                    date === d ? "border-primary bg-primary text-white" : "border-line bg-white hover:border-primary",
                  )}
                >
                  <span className="text-xs uppercase">{WEEKDAY_SHORT[weekdayOf(d)]}</span>
                  <span className="font-semibold">{dayLabel(d)}</span>
                </button>
              ))}
            </div>
          )}
          {date &&
            (loadingSlots || slots === null ? (
              <p className="flex items-center gap-2 text-muted">
                <IconSpinner /> Procurando horários…
              </p>
            ) : slots.length === 0 ? (
              <p className="text-muted">Nenhum horário livre neste dia. Tente outro.</p>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Horários livres">
                {slots.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => setStartsAt(s)}
                      className="min-h-12 w-full rounded-xl border border-line bg-white font-semibold tabular hover:border-primary"
                    >
                      {timeOf(s)}
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {error && (
            <div className="mt-4">
              <InlineAlert>{error}</InlineAlert>
            </div>
          )}
        </section>
      )}

      {step === 4 && (
        <section aria-labelledby="passo-dados">
          <h1 id="passo-dados" className="mb-3 font-display text-xl font-extrabold">
            Seus dados
          </h1>
          <form onSubmit={confirm} className="grid gap-4" noValidate>
            {error && <InlineAlert>{error}</InlineAlert>}
            <TextField
              label="Seu nome"
              value={name}
              maxLength={120}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Celular com DDD"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 91234-5678"
              value={phone}
              maxLength={30}
              onChange={(e) => setPhone(e.target.value)}
              hint="A empresa usa para confirmar o horário."
            />
            <Button
              type="submit"
              size="lg"
              loading={sending}
              disabled={name.trim().length < 2 || phone.replace(/\D/g, "").length < 10}
            >
              Confirmar {dayLabel(date)} às {timeOf(startsAt)}
            </Button>
            <p className="text-center text-xs text-muted">
              Seus dados ficam só com {info.company.name}, para o atendimento.
            </p>
          </form>
        </section>
      )}
      <p className="mt-10 text-center text-xs text-muted">Agendamento por Thigu Gestão</p>
    </main>
  );
}
