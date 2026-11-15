const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Formata centavos como "R$ 1.500,00" (com espaço comum, para leitura e testes estáveis). */
export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("Valor em centavos precisa ser inteiro");
  return BRL.format(cents / 100).replace(/ /g, " ");
}

const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const BRL_WHOLE = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/**
 * Versão curta para rótulos de gráfico, onde o valor exato não cabe:
 * 150000 → "R$ 1,5 mil"; abaixo de mil reais, sem centavos (61010 → "R$ 610").
 */
export function formatBRLCompact(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("Valor em centavos precisa ser inteiro");
  const fmt = Math.abs(cents) < 100_000 ? BRL_WHOLE : BRL_COMPACT;
  return fmt.format(cents / 100).replace(/ /g, " ");
}

/** Centavos → texto para campo de formulário: 20000 → "200,00". */
export function centsToInput(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100).toString();
  const cent = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${reais},${cent}`;
}

/**
 * Converte o que a pessoa digitou em centavos inteiros, sem usar ponto flutuante.
 * Aceita "200", "200,5", "1.500,00", "R$ 1.500", "1500.50".
 * Retorna null quando o texto não é um valor válido.
 */
export function parseBRLToCents(input: string): number | null {
  let s = input.replace(/R\$/gi, "").replace(/[\s ]/g, "");
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  let intPart: string;
  let decPart = "";
  if (s.includes(",")) {
    const [i, d, ...rest] = s.split(",");
    if (rest.length) return null;
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(i)) return null;
    intPart = i.replace(/\./g, "");
    decPart = d;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    intPart = s.replace(/\./g, "");
  } else if (/^\d+(\.\d{1,2})?$/.test(s)) {
    [intPart, decPart = ""] = s.split(".");
  } else {
    return null;
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}
