/**
 * Caso de aceitação obrigatório executado no MOTOR DA PRÉVIA (em memória).
 * O mesmo roteiro é repetido contra o banco em tests/db.test.ts.
 */
import { accountStatus, balanceCents } from "@/lib/domain/accounts";
import { buildPlan } from "@/lib/domain/installments";
import { computeOverview } from "@/lib/domain/overview";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date(2026, 10, 10, 9, 0, 0);
const ctx = (): EngineContext => ({ now, newId: () => randomUUID(), processed: new Map() });

function setup() {
  const [aurora, horizonte] = buildPreviewSeed(now);
  const byRole = (d: CompanyData, role: string) => d.members.find((m) => m.roles.includes(role as never))!;
  return {
    aurora,
    horizonte,
    dono: byRole(horizonte, "admin"),
    vendedor: byRole(horizonte, "vendedor"),
    financeiro: byRole(horizonte, "financeiro"),
  };
}

describe("caso de aceitação (prévia)", () => {
  it("venda de R$ 1.500 em 3 parcelas, recebimento parcial e indicadores", () => {
    const { horizonte, vendedor, financeiro } = setup();
    const c = ctx();
    let data = horizonte;
    const step = (actor: Member, action: unknown) => {
      const r = applyAction(data, actor, action, c);
      data = r.data;
      return r.result;
    };

    const cli = step(vendedor, {
      type: "client.save",
      name: "Marina Costa",
      email: "",
      phone: "",
      ownerId: vendedor.userId,
    });
    expect(cli.ok).toBe(true);
    const clientId = (cli as { id: string }).id;
    const deal = step(vendedor, {
      type: "deal.save",
      clientId,
      title: "Identidade visual",
      valueCents: 150000,
      ownerId: vendedor.userId,
      expectedClose: null,
      nextAction: null,
      nextActionDate: null,
    });
    const dealId = (deal as { id: string }).id;

    // 1–2. Venda de R$ 1.500,00 proposta em 3 parcelas de R$ 500,00 pelo vendedor
    const plan = buildPlan(150000, 3, "2026-11-20");
    const closed = step(vendedor, {
      type: "sale.close",
      dealId,
      proposalId: null,
      totalCents: 150000,
      paymentMode: "parcelado",
      plan,
      requestId: randomUUID(),
    });
    expect(closed.ok).toBe(true);
    const saleId = (closed as { id: string }).id;

    // Antes da conferência: vendido aparece, mas NÃO há contas a receber
    let ov = computeOverview(data, "2026-11-10");
    expect(ov.soldCents).toBe(150000);
    expect(ov.awaitingReviewCents).toBe(150000);
    expect(ov.toReceiveCents).toBe(0);

    // 9. Vendedor não confirma parcelas
    const denied = step(vendedor, { type: "sale.confirm", saleId, plan });
    expect(denied.ok).toBe(false);
    expect(data.accounts).toHaveLength(0);

    // 3. Financeiro confere e cria 3 contas vinculadas à venda
    expect(step(financeiro, { type: "sale.confirm", saleId, plan }).ok).toBe(true);
    const accs = data.accounts.filter((a) => a.saleId === saleId);
    expect(accs.map((a) => a.amountCents)).toEqual([50000, 50000, 50000]);
    expect(accs.every((a) => a.clientId === clientId && a.installmentCount === 3)).toBe(true);

    // 7. Repetir a confirmação não cria novas parcelas
    const again = step(financeiro, { type: "sale.confirm", saleId, plan });
    expect(again.ok).toBe(true);
    expect(data.accounts.filter((a) => a.saleId === saleId)).toHaveLength(3);

    // Recebimento acima do saldo é recusado
    const first = accs.find((a) => a.installmentNumber === 1)!;
    const over = step(financeiro, {
      type: "movement.register",
      accountId: first.id,
      amountCents: 60000,
      paidOn: "2026-11-10",
      method: "pix",
      requestId: randomUUID(),
    });
    expect(over.ok).toBe(false);

    // 4–5. Recebimento de R$ 200 na 1ª parcela → parcial com saldo de R$ 300
    const reqId = randomUUID();
    const rec = step(financeiro, {
      type: "movement.register",
      accountId: first.id,
      amountCents: 20000,
      paidOn: "2026-11-10",
      method: "pix",
      requestId: reqId,
    });
    expect(rec.ok).toBe(true);
    expect(rec.message).toBe("Recebimento de R$ 200,00 registrado. Faltam R$ 300,00.");
    // reenvio do mesmo pedido (duplo clique) não duplica
    step(financeiro, {
      type: "movement.register",
      accountId: first.id,
      amountCents: 20000,
      paidOn: "2026-11-10",
      method: "pix",
      requestId: reqId,
    });
    expect(data.movements).toHaveLength(1);
    const firstNow = data.accounts.find((a) => a.id === first.id)!;
    expect(balanceCents(firstNow, data.movements)).toBe(30000);
    expect(accountStatus(firstNow, data.movements, "2026-11-10")).toBe("parcial");

    // 6. Painel: R$ 1.500 vendidos, R$ 200 recebidos, R$ 1.300 a receber
    ov = computeOverview(data, "2026-11-10");
    expect(ov.soldCents).toBe(150000);
    expect(ov.receivedCents).toBe(20000);
    expect(ov.toReceiveCents).toBe(130000);
    expect(ov.awaitingReviewCents).toBe(0);
  });

  it("8. dados de uma empresa não aparecem para quem é de outra (simulação)", () => {
    const { aurora, horizonte } = setup();
    const eduardo = horizonte.members.find((m) => m.userId === "u-eduardo")!;
    // Eduardo não é membro da Aurora: a prévia só entrega dados da empresa selecionada,
    // e o motor recusa responsáveis de fora da empresa.
    expect(aurora.members.some((m) => m.userId === eduardo.userId)).toBe(false);
    const r = applyAction(
      aurora,
      eduardo,
      { type: "client.save", name: "Teste", email: "", phone: "", ownerId: eduardo.userId },
      ctx(),
    );
    expect(r.result.ok).toBe(false);
  });

  it("vendedor vê apenas os próprios clientes e não vê contas a pagar", () => {
    const { aurora } = setup();
    const bruno = aurora.members.find((m) => m.userId === "u-bruno")!;
    const v = visibleData(aurora, bruno);
    expect(v.clients.every((c) => c.ownerId === "u-bruno" || v.deals.some((d) => d.clientId === c.id))).toBe(true);
    expect(v.clients.some((c) => c.id === "c-luciana")).toBe(false);
    expect(v.accounts.some((a) => a.kind === "pagar")).toBe(false);
  });

  it("aceitar proposta só altera dados quando a ação é confirmada, e desfazer preserva histórico", () => {
    const { aurora } = setup();
    const ana = aurora.members.find((m) => m.userId === "u-ana")!;
    const c = ctx();
    const before = aurora.deals.find((d) => d.id === "d-joao-cardapio")!.valueCents;
    // (abrir a janela não chama o motor; nada muda até a ação)
    const r = applyAction(aurora, ana, { type: "proposal.accept", id: "p-2", updateDealValue: true }, c);
    expect(r.result.ok).toBe(true);
    expect(aurora.deals.find((d) => d.id === "d-joao-cardapio")!.valueCents).toBe(before); // estado anterior intacto
    expect(r.data.proposals.find((p) => p.id === "p-2")!.status).toBe("aceita");

    const mv = applyAction(
      aurora,
      ana,
      { type: "movement.undo", movementId: "m-joao", reason: "Lançado em duplicidade" },
      c,
    );
    expect(mv.result.ok).toBe(true);
    const m = mv.data.movements.find((x) => x.id === "m-joao")!;
    expect(m.undoneAt).not.toBeNull();
    expect(mv.data.movements).toHaveLength(aurora.movements.length);
  });

  it("registrar envio pode criar tarefa de retorno para dois dias depois", () => {
    const { aurora } = setup();
    const bruno = aurora.members.find((m) => m.userId === "u-bruno")!;
    const r = applyAction(aurora, bruno, { type: "proposal.markSent", id: "p-2", followUpTask: true }, ctx());
    expect(r.result.ok).toBe(true);
    const t = r.data.tasks.at(-1)!;
    expect(t.dueDate).toBe("2026-11-12");
    expect(t.dealId).toBe("d-joao-cardapio");
  });
});

describe("dados e aparência da empresa (prévia)", () => {
  const profile = {
    type: "company.saveProfile",
    name: "Horizonte Serviços",
    legalName: "Horizonte Serviços Ltda.",
    document: "12.ABC.345/01de-35",
    phone: "(11) 99999-0000",
    email: "contato@horizonte.exemplo",
    address: "Av. Brasil, 100",
    defaultTerms: "Pagamento em 30 dias.",
    logoDataUrl: "data:image/png;base64,iVBORw0KGgo=",
    brandColor: "#0F766E",
    menuColor: null,
  };

  it("administrador salva; CNPJ e cor são normalizados", () => {
    const { horizonte, dono } = setup();
    const r = applyAction(horizonte, dono, profile, ctx());
    expect(r.result.ok).toBe(true);
    expect(r.data.company).toMatchObject({
      id: horizonte.company.id,
      legalName: "Horizonte Serviços Ltda.",
      document: "12ABC34501DE35",
      brandColor: "#0f766e",
      defaultTerms: "Pagamento em 30 dias.",
    });
  });

  it("outros papéis não alteram; dados inválidos são recusados com o campo indicado", () => {
    const { horizonte, vendedor, dono } = setup();
    expect(applyAction(horizonte, vendedor, profile, ctx()).result.ok).toBe(false);
    const badDoc = applyAction(horizonte, dono, { ...profile, document: "12.345.678/0001-00" }, ctx()).result;
    expect(badDoc.ok).toBe(false);
    expect(!badDoc.ok && badDoc.fieldErrors?.document).toBeTruthy();
    const svg = applyAction(horizonte, dono, { ...profile, logoDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }, ctx());
    expect(svg.result.ok).toBe(false);
    expect(applyAction(horizonte, dono, { ...profile, brandColor: "red" }, ctx()).result.ok).toBe(false);
  });
});
