import { documentLabel, formatDocument } from "@/lib/domain/document";
import type { CompanyProfile } from "@/lib/domain/types";

/** Cabeçalho da empresa: logotipo, nome e dados de contato. Usado na proposta e na prévia da tela da empresa. */
export function CompanyLetterhead({ company }: { company: CompanyProfile }) {
  const contact = [company.phone, company.email].filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 items-start gap-4">
      {company.logoDataUrl && (
        // data URL gerado no navegador; next/image não otimiza data URLs
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={company.logoDataUrl}
          alt={`Logotipo de ${company.name}`}
          className="h-auto max-h-16 w-auto max-w-40 shrink-0 object-contain"
        />
      )}
      <div className="min-w-0">
        <p className="font-display text-xl font-extrabold text-navy">{company.name}</p>
        {company.legalName && company.legalName !== company.name && (
          <p className="text-sm text-muted">{company.legalName}</p>
        )}
        {company.document && (
          <p className="text-sm text-muted">
            {documentLabel(company.document)} {formatDocument(company.document)}
          </p>
        )}
        {contact && <p className="text-sm text-muted">{contact}</p>}
        {company.address && <p className="text-sm text-muted">{company.address}</p>}
      </div>
    </div>
  );
}
