import {
  activationEmail,
  canonicalCode,
  codeFormatError,
  describeAccess,
  formatCodeInput,
  normalizeCode,
} from "@/lib/domain/activation";
import { describe, expect, it } from "vitest";

describe("código de ativação na tela", () => {
  it("formata enquanto a pessoa digita, sem atrapalhar o prefixo nem o backspace", () => {
    expect(formatCodeInput("thi")).toBe("THI");
    expect(formatCodeInput("thigu")).toBe("THIGU");
    expect(formatCodeInput("thigu7")).toBe("THIGU-7");
    expect(formatCodeInput("THIGU-")).toBe("THIGU"); // apagando o primeiro caractere depois do traço
    expect(formatCodeInput("7kq2ab")).toBe("7KQ2-AB");
    expect(formatCodeInput("thigu 7kq2-abcd efgh")).toBe("THIGU-7KQ2-ABCD-EFGH");
    // colar com texto a mais não passa de 12 caracteres
    expect(formatCodeInput("THIGU-7KQ2-ABCD-EFGH-XYZ")).toBe("THIGU-7KQ2-ABCD-EFGH");
  });

  it("envia ao banco sempre o formato completo, com ou sem prefixo digitado", () => {
    expect(canonicalCode("7kq2abcdefgh")).toBe("THIGU-7KQ2-ABCD-EFGH");
    expect(canonicalCode("thigu-7kq2-abcd-efgh")).toBe("THIGU-7KQ2-ABCD-EFGH");
  });
  it("normaliza igual ao banco (ignora espaços, traços e minúsculas)", () => {
    expect(normalizeCode(" thigu-7kq2 abcd-efgh ")).toBe("THIGU7KQ2ABCDEFGH");
  });

  it("explica o que falta ou o que está errado", () => {
    expect(codeFormatError("")).toMatch(/Digite o código/);
    expect(codeFormatError("THIGU-7KQ2-ABCD")).toMatch(/Faltam 4/);
    expect(codeFormatError("THIGU-7KQ2-ABCD-EFG0")).toMatch(/formato certo/); // 0 não existe no alfabeto
    expect(codeFormatError("THIGU-7KQ2-ABCD-EFGH")).toBeNull();
  });

  it("descreve o prazo em linguagem comum", () => {
    expect(describeAccess(30)).toBe("1 mês");
    expect(describeAccess(90)).toBe("3 meses");
    expect(describeAccess(365)).toBe("1 ano");
    expect(describeAccess(45)).toBe("45 dias");
  });

  it("monta o e-mail com código, prazo, data limite e passo a passo", () => {
    const e = activationEmail({
      customerName: "Marina Costa",
      code: "THIGU-7KQ2-ABCD-EFGH",
      accessDays: 365,
      validUntil: "2026-12-14",
      appUrl: "https://app.exemplo.com.br/",
    });
    expect(e.subject).toMatch(/código de ativação/);
    expect(e.body).toContain("Olá, Marina!");
    expect(e.body).toContain("THIGU-7KQ2-ABCD-EFGH");
    expect(e.body).toContain("1 ano de uso");
    expect(e.body).toContain("até 14/12/2026");
    expect(e.body).toContain("https://app.exemplo.com.br/entrar");
  });
});
