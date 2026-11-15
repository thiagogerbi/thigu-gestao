import { ThiguLogo } from "@/components/brand/thigu-logo";
import { buttonClass, cx } from "@/components/ui/styles";
import Link from "next/link";

/** O mesmo desenho da trilha da Visão geral, com números de exemplo: mostra o produto em vez de descrevê-lo. */
const TRAIL = [
  { label: "Clientes", detail: "pessoas cadastradas", value: "6" },
  { label: "Conversando", detail: "ainda incerto", value: "R$ 10.400" },
  { label: "Propostas", detail: "esperando resposta", value: "1" },
  { label: "Vendido", detail: "vendas fechadas", value: "R$ 5.900" },
  { label: "Falta receber", detail: "parcelas em aberto", value: "R$ 1.500" },
  { label: "Recebido", detail: "dinheiro que já entrou", value: "R$ 800" },
];
const SOLD_STEP = 3;

function TrailExample() {
  return (
    <figure className="rounded-2xl bg-white p-4 text-ink shadow-raised sm:p-5">
      <figcaption className="mb-2">
        <span className="block font-display text-lg font-bold">Do primeiro contato ao dinheiro no bolso</span>
        <span className="block text-sm text-muted">Exemplo com números fictícios</span>
      </figcaption>
      <ol>
        {TRAIL.map((s, i) => {
          const sold = i >= SOLD_STEP;
          const received = i === TRAIL.length - 1;
          return (
            <li key={s.label} className="relative flex items-start gap-3 py-2">
              {i < TRAIL.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute -bottom-2 left-[0.9375rem] top-10 border-l-2",
                    i > SOLD_STEP ? "border-money" : sold ? "border-navy" : "border-dashed border-[#aab6c9]",
                  )}
                />
              )}
              <span
                className={cx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular",
                  received
                    ? "bg-money-700 text-white"
                    : sold
                      ? "bg-navy text-white"
                      : "border-2 border-dashed border-[#aab6c9] bg-white text-muted",
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 pt-1">
                <span className="block font-semibold leading-6">{s.label}</span>
                <span className="block text-sm text-muted">{s.detail}</span>
              </span>
              <span
                className={cx(
                  "shrink-0 whitespace-nowrap font-display text-lg font-extrabold leading-8 tabular",
                  received && "text-money-700",
                )}
              >
                {s.value}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

const STEPS = [
  ["Cadastre e negocie", "Registre clientes e acompanhe cada negociação por etapas."],
  ["Proponha e feche", "Monte a proposta, registre o aceite e combine as parcelas."],
  ["Receba e acompanhe", "O financeiro confere a venda e registra cada recebimento."],
];

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <section className="bg-navy px-5 pb-28 pt-10 text-white sm:px-8 sm:pt-16 lg:pb-20">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-14">
          <div>
            <div className="mb-8 sm:mb-10">
              <ThiguLogo dark size="lg" />
            </div>
            <h1 className="font-display text-[2.5rem] font-extrabold leading-[1.08] sm:text-6xl">
              Gestão simples. Negócios em movimento.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-[#dbe4f3]">
              Clientes, negociações, propostas e o dinheiro recebido no mesmo lugar. Feito para pequenas empresas, com
              uma linguagem que qualquer pessoa entende.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/previa" className={buttonClass("primary", "lg", "min-h-14 text-[17px]")}>
                Experimentar a prévia
              </Link>
              <Link href="/app" className={buttonClass("secondary", "lg", "min-h-14 text-[17px]")}>
                Entrar na minha conta
              </Link>
            </div>
            <p className="mt-3 text-sm text-[#c9d6ea]">A prévia usa dados fictícios e não precisa de cadastro.</p>
          </div>
          {/* no celular o cartão "morde" a borda do bloco azul, ligando as duas partes da página */}
          <div className="-mb-44 lg:mb-0">
            <TrailExample />
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-14 pt-24 sm:px-8 lg:pt-16">
        <h2 className="font-display text-2xl font-extrabold sm:text-3xl">Como funciona</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3 sm:gap-8">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-4 sm:block">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy font-display text-lg font-extrabold text-white">
                {i + 1}
              </span>
              <div className="sm:mt-4">
                <h3 className="font-display text-lg font-bold">{title}</h3>
                <p className="mt-1 text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line bg-white px-5 py-12 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl">
            <h2 className="font-display text-xl font-bold">Feito para usar no celular</h2>
            <p className="mt-1 text-muted">
              Abra no navegador do celular e adicione à tela inicial: o Thigu passa a abrir em tela cheia, como um
              aplicativo, sem precisar instalar nada pela loja.
            </p>
          </div>
          <Link href="/previa" className={buttonClass("primary", "lg", "shrink-0")}>
            Experimentar a prévia
          </Link>
        </div>
      </section>
    </main>
  );
}
