/**
 * CPF e CNPJ. Guardamos sem pontuação e em maiúsculas; formatamos só para exibir.
 * O CNPJ alfanumérico (Receita Federal, a partir de julho de 2026) tem 12 caracteres
 * de letras ou números e 2 dígitos verificadores numéricos. O cálculo usa o valor
 * do caractere menos 48 ("0" = 0 … "9" = 9, "A" = 17 … "Z" = 42), o que mantém
 * o resultado idêntico ao do CNPJ só com números.
 */

export function normalizeDocument(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

const val = (ch: string) => ch.charCodeAt(0) - 48;

function allSame(s: string) {
  return /^(.)\1*$/.test(s);
}

export function isValidCPF(raw: string): boolean {
  const d = normalizeDocument(raw);
  if (!/^\d{11}$/.test(d) || allSame(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    return ((sum * 10) % 11) % 10;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

export function isValidCNPJ(raw: string): boolean {
  const d = normalizeDocument(raw);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(d) || allSame(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    let w = len - 7; // pesos 5,4,3,2,9,8,… (1º dígito) e 6,5,4,3,2,9,… (2º)
    for (let i = 0; i < len; i++) {
      sum += val(d[i]) * w;
      w = w === 2 ? 9 : w - 1;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

/** Vazio é aceito (campo opcional). */
export function isValidDocument(raw: string): boolean {
  const d = normalizeDocument(raw);
  if (d === "") return true;
  return d.length === 11 ? isValidCPF(d) : d.length === 14 ? isValidCNPJ(d) : false;
}

export function formatDocument(raw: string): string {
  const d = normalizeDocument(raw);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return raw;
}

export function documentLabel(raw: string): "CPF" | "CNPJ" {
  return normalizeDocument(raw).length === 11 ? "CPF" : "CNPJ";
}
