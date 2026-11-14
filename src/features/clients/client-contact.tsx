"use client";
import { IconMail, IconPhone } from "@/components/ui/icons";
import { buttonClass } from "@/components/ui/styles";
import { ClientSection } from "@/features/clients/client-section";
import { telUrl, whatsappUrl } from "@/lib/domain/phone";
import type { Client } from "@/lib/domain/types";

/** E-mail, telefone e conversa no WhatsApp: um toque para falar com o cliente. */
export function ClientContact({ client }: { client: Client }) {
  const phoneHref = telUrl(client.phone);
  const whatsappHref = whatsappUrl(client.phone);
  return (
    <ClientSection title="Contato" collapsible defaultOpen>
      <ul className="grid gap-2 text-base">
        <li className="flex items-center gap-2">
          <IconMail className="h-4 w-4 shrink-0 text-muted" />
          {client.email ? (
            <a
              className="inline-flex min-h-11 items-center break-all text-primary-700 underline-offset-2 hover:underline sm:min-h-0"
              href={`mailto:${client.email}`}
            >
              {client.email}
            </a>
          ) : (
            <span className="text-muted">Sem e-mail</span>
          )}
        </li>
        <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <IconPhone className="h-4 w-4 shrink-0 text-muted" />
          {!client.phone ? (
            <span className="text-muted">Sem telefone</span>
          ) : phoneHref ? (
            <a
              className="inline-flex min-h-11 items-center text-primary-700 underline-offset-2 hover:underline sm:min-h-0"
              href={phoneHref}
            >
              {client.phone}
            </a>
          ) : (
            <span>{client.phone}</span>
          )}
          {/* no celular abre o aplicativo do WhatsApp já na conversa com o cliente */}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("secondary", "sm", "ml-auto")}
            >
              Chamar no WhatsApp
            </a>
          )}
        </li>
      </ul>
    </ClientSection>
  );
}
