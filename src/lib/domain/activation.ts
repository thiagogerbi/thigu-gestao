import { formatDateBR } from "@/lib/domain/dates";
import type { ISODate } from "@/lib/domain/types";

/**
 * Códigos de ativação: "THIGU-XXXX-XXXX-XXXX", com 12 letras/números depois do prefixo.
 * O alfabeto evita símbolos parecidos (0/O, 1/I/L) — igual ao gerador no banco
 * (supabase/migrations/20261114000003_activation.sql).
 */
export const CODE_PREFIX = "THIGU";
export const CODE_BODY_LENGTH = 12;
const ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/;

/** Ignora espaços, traços e minúsculas: "thigu 7kq2-..." → "THIGU7KQ2...". */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Só a parte depois de "THIGU" (a pessoa pode digitar com ou sem o prefixo). */
function bodyOf(input: string): string {
  const n = normalizeCode(input);
  return n.startsWith(CODE_PREFIX) ? n.slice(CODE_PREFIX.length) : n;
}

const group4 = (s: string) => (s.match(/.{1,4}/g) ?? []).join("-");

/**
 * Formata enquanto a pessoa digita, sem atrapalhar: põe em maiúsculas e insere os traços,
 * respeitando se ela está digitando o prefixo ou não ("thi" → "THI", "7kq2ab" → "7KQ2-AB",
 * "thigu7kq2" → "THIGU-7KQ2"). Apagar com backspace funciona normalmente.
 */
export function formatCodeInput(input: string): string {
  const n = normalizeCode(input);
  if (n.length <= CODE_PREFIX.length && CODE_PREFIX.startsWith(n)) return n;
  const hasPrefix = n.startsWith(CODE_PREFIX);
  const grouped = group4((hasPrefix ? n.slice(CODE_PREFIX.length) : n).slice(0, CODE_BODY_LENGTH));
  return hasPrefix ? `${CODE_PREFIX}-${grouped}` : grouped;
}

/** Forma completa enviada ao banco: "7kq2abcdefgh" → "THIGU-7KQ2-ABCD-EFGH". */
export function canonicalCode(input: string): string {
  return `${CODE_PREFIX}-${group4(bodyOf(input))}`;
}

/** Mensagem para mostrar perto do campo, ou null se o formato está certo. */
export function codeFormatError(input: string): string | null {
  const body = bodyOf(input);
  if (body.length === 0) return "Digite o código de ativação que você recebeu por e-mail.";
  if (body.length < CODE_BODY_LENGTH)
    return `Faltam ${CODE_BODY_LENGTH - body.length} letras ou números. O código completo tem este formato: THIGU-XXXX-XXXX-XXXX.`;
  if (body.length > CODE_BODY_LENGTH || !ALPHABET.test(body))
    return "Esse código não está no formato certo. Copie e cole direto do e-mail, se puder.";
  return null;
}

/** Prazo de acesso em linguagem comum: 30 → "1 mês", 365 → "1 ano". */
export function describeAccess(days: number): string {
  if (days % 365 === 0) return days === 365 ? "1 ano" : `${days / 365} anos`;
  if (days % 30 === 0) return days === 30 ? "1 mês" : `${days / 30} meses`;
  return days === 1 ? "1 dia" : `${days} dias`;
}

export interface ActivationEmailInput {
  customerName: string;
  code: string;
  accessDays: number;
  validUntil: ISODate;
  appUrl: string;
}

/** Texto pronto para colar no e-mail enviado ao comprador depois do pagamento. */
export function activationEmail({ customerName, code, accessDays, validUntil, appUrl }: ActivationEmailInput) {
  const first = customerName.trim().split(/\s+/)[0] || customerName;
  const base = appUrl.replace(/\/+$/, "");
  return {
    subject: "Seu código de ativação do Thigu Gestão",
    body: [
      `Olá, ${first}!`,
      "",
      "Obrigado pela compra. Seu acesso ao Thigu Gestão está pronto para ser ativado.",
      "",
      `Seu código de ativação: ${code}`,
      `Ele libera ${describeAccess(accessDays)} de uso e pode ser ativado até ${formatDateBR(validUntil)}.`,
      "",
      "Como ativar (leva 2 minutos):",
      `1. Acesse ${base}/entrar e clique em "Criar conta", usando este mesmo e-mail.`,
      "2. Confirme o e-mail, se pedirmos.",
      '3. Na tela "Vamos cadastrar sua empresa", digite o nome da empresa e o código acima.',
      "",
      "Pronto! Você será o administrador e poderá convidar sua equipe depois.",
      "",
      "Qualquer dúvida, é só responder este e-mail.",
      "Equipe Thigu Gestão",
    ].join("\n"),
  };
}
