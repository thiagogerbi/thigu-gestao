import { ThiguLogo } from "@/components/brand/thigu-logo";
import { buttonClass } from "@/components/ui/styles";
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <section className="bg-navy px-6 py-16 text-white sm:py-24">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <ThiguLogo dark size="lg" />
          </div>
          <h1 className="font-display text-4xl font-extrabold leading-tight sm:text-5xl">
            Gestão simples. Negócios em movimento.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-[#dbe4f3]">
            Clientes, negociações, propostas e o dinheiro recebido no mesmo lugar. Feito para pequenas empresas, com uma
            linguagem que qualquer pessoa entende.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/previa" className={buttonClass("primary", "lg")}>
              Experimentar a prévia
            </Link>
            <Link href="/app" className={buttonClass("secondary", "lg")}>
              Entrar na minha conta
            </Link>
          </div>
          <p className="mt-3 text-sm text-[#c9d6ea]">A prévia usa dados fictícios e não precisa de cadastro.</p>
        </div>
      </section>
      <section className="mx-auto grid max-w-4xl gap-4 px-6 py-12 sm:grid-cols-3">
        {[
          ["1. Cadastre e negocie", "Registre clientes e acompanhe cada negociação por etapas."],
          ["2. Proponha e feche", "Monte a proposta, registre o aceite e combine as parcelas."],
          ["3. Receba e acompanhe", "O financeiro confere a venda e registra cada recebimento."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-white p-5">
            <h2 className="font-display text-lg font-bold">{t}</h2>
            <p className="mt-1 text-muted">{d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
