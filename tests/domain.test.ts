import { accountStatus, balanceCents, validateSettlement } from "@/lib/domain/accounts";
import { addMonths, formatDateBR } from "@/lib/domain/dates";
import { buildPlan, checkPlan, splitEvenly } from "@/lib/domain/installments";
import { formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { hasProposalErrors, proposalTotalCents, validateProposal } from "@/lib/domain/proposals";
import type { Account, Movement } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";

describe("dinheiro", () => {
  it("formata em reais", () => {
    expect(formatBRL(150000)).toBe("R$ 1.500,00");
    expect(formatBRL(20000)).toBe("R$ 200,00");
    expect(formatBRL(5)).toBe("R$ 0,05");
  });
  it("interpreta o que a pessoa digita sem ponto flutuante", () => {
    expect(parseBRLToCents("200")).toBe(20000);
    expect(parseBRLToCents("200,5")).toBe(20050);
    expect(parseBRLToCents("1.500,00")).toBe(150000);
    expect(parseBRLToCents("R$ 1.500")).toBe(150000);
    expect(parseBRLToCents("1500.50")).toBe(150050);
    expect(parseBRLToCents("0,10")).toBe(10);
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("1,234")).toBeNull();
    expect(parseBRLToCents("")).toBeNull();
  });
});

describe("datas", () => {
  it("formata no padrão brasileiro", () => expect(formatDateBR("2026-11-06")).toBe("06/11/2026"));
  it("data com horário usa o dia local (22h não vira o dia seguinte)", () => {
    const lateNight = new Date(2026, 10, 13, 22, 30).toISOString();
    expect(formatDateBR(lateNight)).toBe("13/11/2026");
  });
  it("soma meses sem pular para o mês seguinte", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-06", 2)).toBe("2027-01-06");
  });
});

describe("parcelas", () => {
  it("divide com soma exata, inclusive arredondamentos", () => {
    expect(splitEvenly(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEvenly(150000, 3)).toEqual([50000, 50000, 50000]);
    for (let total = 1; total < 2000; total += 37) {
      for (let n = 1; n <= 12; n++) {
        if (total < n) continue;
        expect(splitEvenly(total, n).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
  it("monta plano mensal e valida a soma", () => {
    const plan = buildPlan(150000, 3, "2026-11-06");
    expect(plan.map((p) => p.dueDate)).toEqual(["2026-11-06", "2026-12-06", "2027-01-06"]);
    expect(checkPlan(plan, 150000).ok).toBe(true);
    const wrong = plan.map((p, i) => (i === 0 ? { ...p, amountCents: 40000 } : p));
    const c = checkPlan(wrong, 150000);
    expect(c.ok).toBe(false);
    expect(c.errors[0]).toContain("R$ 100,00 abaixo");
  });
});

describe("recebimentos", () => {
  const acc: Account = {
    id: "a1",
    kind: "receber",
    clientId: "c1",
    supplier: null,
    description: "x",
    origin: "venda",
    saleId: "s1",
    installmentNumber: 1,
    installmentCount: 3,
    amountCents: 50000,
    dueDate: "2026-11-06",
    category: null,
    canceledAt: null,
    canceledBy: null,
    cancelReason: null,
    createdAt: "2026-10-01T00:00:00Z",
  };
  const mv = (amount: number, undone = false): Movement => ({
    id: Math.random().toString(),
    accountId: "a1",
    direction: "entrada",
    amountCents: amount,
    paidOn: "2026-11-05",
    method: "pix",
    registeredBy: "u",
    createdAt: "",
    undoneAt: undone ? "x" : null,
    undoneBy: null,
    undoReason: null,
  });
  it("bloqueia valor acima do saldo e explica como corrigir", () => {
    expect(validateSettlement(acc, [], 60000)).toContain("R$ 500,00");
    expect(validateSettlement(acc, [], 20000)).toBeNull();
    expect(validateSettlement(acc, [mv(20000)], 30001)).toContain("R$ 300,00");
  });
  it("calcula saldo e situação, ignorando registros desfeitos", () => {
    expect(balanceCents(acc, [mv(20000)])).toBe(30000);
    expect(accountStatus(acc, [mv(20000)], "2026-11-01")).toBe("parcial");
    expect(accountStatus(acc, [mv(20000)], "2026-11-10")).toBe("atrasada");
    expect(accountStatus(acc, [mv(50000)], "2026-11-10")).toBe("quitada");
    expect(accountStatus(acc, [mv(50000, true)], "2026-11-01")).toBe("pendente");
    expect(accountStatus({ ...acc, canceledAt: "x" }, [], "2026-11-01")).toBe("cancelada");
  });
});

describe("propostas", () => {
  it("calcula total com quantidade, preço e desconto", () => {
    expect(
      proposalTotalCents(
        [
          { description: "a", quantity: 8, unitCents: 10000 },
          { description: "b", quantity: 1, unitCents: 180000 },
        ],
        20000,
      ),
    ).toBe(240000);
    expect(proposalTotalCents([{ description: "h", quantity: 1.5, unitCents: 15000 }], 0)).toBe(22500);
  });
  it("não aceita desconto maior que o subtotal", () => {
    expect(
      hasProposalErrors(validateProposal([{ description: "a", quantity: 1, unitCents: 100 }], 200, "2026-12-01")),
    ).toBe(true);
  });
});

describe("permissões", () => {
  it("vendedor fecha venda mas não confere parcelas", () => {
    expect(can(["vendedor"], "venda.fechar")).toBe(true);
    expect(can(["vendedor"], "venda.conferir")).toBe(false);
    expect(can(["financeiro"], "venda.conferir")).toBe(true);
    expect(can(["admin"], "venda.conferir")).toBe(true);
    expect(can(["vendedor", "financeiro"], "financeiro.registrar")).toBe(true);
  });
});
