import { cx } from "@/components/ui/styles";
import { formatBRL, formatBRLCompact } from "@/lib/domain/money";

export interface ForecastPoint {
  /** "Hoje", "7 dias"… */
  label: string;
  /** Data por extenso curta, mostrada embaixo do rótulo. */
  sub: string;
  cents: number;
}

/**
 * Saldo do caixa hoje e o saldo previsto em cada horizonte, em barras a partir do zero.
 * Uma única série (o título do cartão já diz o que é), por isso não há legenda. Saldo negativo
 * desce abaixo da linha do zero, em vermelho e com o sinal de menos — nunca só pela cor.
 * Os valores exatos ficam na lista logo abaixo do gráfico, que serve de tabela.
 */
export function CashForecastChart({ points }: { points: ForecastPoint[] }) {
  const max = Math.max(0, ...points.map((p) => p.cents));
  const min = Math.min(0, ...points.map((p) => p.cents));
  const range = max - min || 1;
  const zero = (max / range) * 100; // distância do topo até a linha do zero, em %
  const hasNegative = min < 0;
  const summary = points.map((p) => `${p.label}: ${formatBRL(p.cents)}`).join("; ");

  return (
    <figure className="mb-4">
      <div
        role="img"
        aria-label={`Gráfico do saldo previsto. ${summary}.`}
        className={cx("relative mt-7 h-32", hasNegative && "mb-7")}
      >
        <div aria-hidden="true" className="absolute inset-x-0 border-t border-[#c5cfdf]" style={{ top: `${zero}%` }} />
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((p) => {
            const negative = p.cents < 0;
            const height = (Math.abs(p.cents) / range) * 100;
            const top = negative ? zero : zero - height;
            return (
              <div key={p.label} className="relative" title={`${p.label} (${p.sub}): ${formatBRL(p.cents)}`}>
                <div
                  className={cx(
                    "absolute inset-x-[22%] min-h-[3px]",
                    negative ? "rounded-b bg-danger" : "rounded-t bg-navy-600",
                  )}
                  style={{ top: `${top}%`, height: `${height}%` }}
                />
                <span
                  className="absolute inset-x-0 whitespace-nowrap text-center text-[13px] font-semibold leading-5 text-ink tabular"
                  style={negative ? { top: `calc(${top + height}% + 3px)` } : { bottom: `calc(${100 - top}% + 3px)` }}
                >
                  {formatBRLCompact(p.cents)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div
        aria-hidden="true"
        className="mt-1.5 grid text-center"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((p) => (
          <div key={p.label}>
            <p className="text-sm font-semibold">{p.label}</p>
            <p className="text-xs text-muted">{p.sub}</p>
          </div>
        ))}
      </div>
    </figure>
  );
}
