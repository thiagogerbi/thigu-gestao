import { cx } from "@/components/ui/styles";
import { companyInitials } from "@/lib/domain/branding";

interface Props {
  name: string;
  logoDataUrl: string | null;
  /** "menu": bloco largo para o menu lateral escuro; "compacto": barra do celular. */
  variant: "menu" | "compacto";
}

/**
 * Marca da empresa dentro do sistema: o logotipo, ou as iniciais na cor da marca quando ainda não há logotipo.
 * A marca Thigu fica só nas telas de entrada (login e criação de empresa).
 */
export function CompanyMark({ name, logoDataUrl, variant }: Props) {
  if (logoDataUrl) {
    return (
      <span
        className={cx(
          "flex items-center justify-center",
          variant === "menu" ? "h-16 w-full rounded-lg bg-white p-2" : "h-10 max-w-28",
        )}
      >
        {/* data URL gerado no navegador; next/image não otimiza data URLs */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoDataUrl} alt={`Logotipo de ${name}`} className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  const initials = (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center rounded-lg bg-primary font-display font-extrabold text-white",
        variant === "menu" ? "h-11 w-11 text-lg" : "h-9 w-9 text-sm",
      )}
    >
      {companyInitials(name)}
    </span>
  );
  if (variant === "compacto") return initials;
  return (
    <span className="flex min-w-0 items-center gap-3">
      {initials}
      <span className="min-w-0 font-display text-lg font-bold leading-tight text-white">{name}</span>
    </span>
  );
}
