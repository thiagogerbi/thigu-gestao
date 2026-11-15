import { QuoteApproval } from "@/features/workshop/quote-approval";
import { quoteInfo } from "@/lib/server/quote";
import type { Metadata } from "next";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const info = await quoteInfo((await params).token);
  return {
    title: info ? `Orçamento nº ${info.number} — ${info.company.name}` : "Orçamento indisponível",
    robots: { index: false, follow: false },
  };
}

/** Página pública: o cliente vê o orçamento do carro, escolhe o que aprovar e confirma com o nome. */
export default async function Page({ params }: Props) {
  const { token } = await params;
  const info = await quoteInfo(token);
  if (!info) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-2xl font-extrabold">Orçamento indisponível</h1>
        <p className="mt-2 text-muted">
          Este link não está mais ativo (ele vale por 30 dias). Fale com a oficina para receber um novo.
        </p>
      </main>
    );
  }
  return <QuoteApproval token={token} info={info} />;
}
