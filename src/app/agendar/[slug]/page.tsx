import { BookingFlow } from "@/features/booking/booking-flow";
import { bookingInfo } from "@/lib/server/booking";
import type { Metadata } from "next";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const info = await bookingInfo((await params).slug);
  return {
    title: info ? `Agendar horário — ${info.company.name}` : "Agendamento indisponível",
    robots: { index: false },
  };
}

/** Página pública: o cliente escolhe o serviço, quem atende, o dia e o horário, e deixa nome e celular. */
export default async function Page({ params }: Props) {
  const { slug } = await params;
  const info = await bookingInfo(slug);
  if (!info || info.services.length === 0 || info.resources.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-2xl font-extrabold">Agendamento indisponível</h1>
        <p className="mt-2 text-muted">
          Este link não está ativo no momento. Fale direto com a empresa para marcar o seu horário.
        </p>
      </main>
    );
  }
  return <BookingFlow slug={slug} info={info} />;
}
