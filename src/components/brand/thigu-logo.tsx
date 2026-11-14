/**
 * Marca Thigu Gestão (conforme a identidade visual): símbolo "t" com um quadrado azul (relacionamento)
 * e um verde (dinheiro), e o nome "thigu" com "GESTÃO" espaçado.
 * Sem "use client": pode ser usado em componentes do servidor.
 */
export function ThiguMark({
  variant = "color",
  className = "h-9 w-9",
}: {
  variant?: "color" | "white" | "onBlue";
  className?: string;
}) {
  const stem = variant === "color" ? "#142D4E" : "#FFFFFF";
  const blue = variant === "color" ? "#3563E9" : variant === "white" ? "#3563E9" : "#FFFFFF";
  const green = variant === "onBlue" ? "#FFFFFF" : "#18A77B";
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" focusable="false">
      <rect x="8" y="2" width="11" height="40" rx="3.5" fill={stem} />
      <rect x="3" y="13" width="27" height="10" rx="3.5" fill={stem} />
      <rect x="32" y="17" width="13" height="13" rx="3.5" fill={blue} />
      {variant !== "onBlue" && <path d="M19 30h11.5v9a3 3 0 0 1-3 3H19z" fill={green} />}
    </svg>
  );
}

export function ThiguLogo({
  dark = false,
  size = "md",
  product,
}: {
  dark?: boolean;
  size?: "sm" | "md" | "lg";
  product?: "CRM" | "Financeiro";
}) {
  const s = {
    sm: { mark: "h-7 w-7", word: "text-[20px]", sub: "text-[8px]" },
    md: { mark: "h-9 w-9", word: "text-[26px]", sub: "text-[9px]" },
    lg: { mark: "h-14 w-14", word: "text-[44px]", sub: "text-sm" },
  }[size];
  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={product ? `thigu ${product}` : "Thigu Gestão"}
      role="img"
    >
      <ThiguMark variant={dark ? "white" : "color"} className={s.mark} />
      <span className="flex flex-col leading-none">
        <span
          className={`font-display font-extrabold tracking-[-0.03em] ${s.word} ${dark ? "text-white" : "text-navy"}`}
        >
          thigu{product && <span className={product === "CRM" ? " text-primary" : " text-money"}> {product}</span>}
        </span>
        {!product && (
          <span
            className={`mt-0.5 font-display font-bold uppercase tracking-[0.42em] ${s.sub} ${dark ? "text-[#c9d6ea]" : "text-navy"}`}
          >
            Gestão
          </span>
        )}
      </span>
    </span>
  );
}
