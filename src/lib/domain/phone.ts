/**
 * Telefones brasileiros. O cadastro aceita o telefone como a pessoa digitar; aqui só montamos
 * os links de "ligar" e de conversa no WhatsApp a partir dos números.
 */

const digitsOf = (phone: string) => phone.replace(/\D/g, "");

/** Link para ligar (o celular abre o discador). */
export function telUrl(phone: string): string | null {
  const d = digitsOf(phone);
  return d.length >= 8 ? `tel:${d}` : null;
}

/**
 * Link que abre a conversa no WhatsApp (wa.me), ou null quando o número não tem DDD.
 * O WhatsApp exige o número completo com o código do país: 55 + DDD + número.
 */
export function whatsappUrl(phone: string, text?: string): string | null {
  let d = digitsOf(phone).replace(/^0+/, ""); // "0" de operadora na frente do DDD
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  // DDD (2) + fixo (8) ou celular (9); DDD nunca começa com 0
  if (d.length !== 10 && d.length !== 11) return null;
  return `https://wa.me/55${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
