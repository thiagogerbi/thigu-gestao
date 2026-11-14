/**
 * Pacotes de sessões e mensalidades: regras puras (recurring.ts) e o MOTOR DA PRÉVIA.
 * As mesmas regras são testadas no banco em tests/db.test.ts ("pacotes e mensalidades no banco").
 */
import { fromLocal } from "@/lib/domain/agenda";
import { packageError, packageView, subscriptionPeriods, subscriptionState } from "@/lib/domain/recurring";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date(2026, 10, 14, 8, 0, 0);
const today = "2026-11-14";

function setup() {
  const [aurora, , clinica, pet] = buildPreviewSeed(now);
  const who = (d: CompanyData, userId: string) => d.members.find((m) => m.userId === userId)!;
  return {
    aurora,
    clinica,
    pet,
    dona: who(clinica, "u-ana"),
    helena: who(clinica, "u-helena"),
    igor: who(clinica, "u-igor"),
    julia: who(clinica, "u-julia"),
  };
}

function runner(start: CompanyData) {
  const c: EngineContext = { now, newId: () => randomUUID(), processed: new Map() };
  let data = start;
  return {
    step(actor: Member, action: unknown) {
      const r = applyAction(data, actor, action, c);
      data = r.data;
      return r.result;
    },
    get data() {
      return data;
    },
  };
}

const sell = (over: Record<string, unknown> = {}) => ({
  type: "package.sell",
  clientId: "p-denise",
  serviceId: "s-nutri",
  itemId: null,
  name: "5 consultas de nutrição",
  sessions: 5,
  priceCents: 100000,
  validUntil: "2027-03-01",
  plan: [
    { number: 1, amountCents: 50000, dueDate: "2026-11-14" },
    { number: 2, amountCents: 50000, dueDate: "2026-12-14" },
  ],
  requestId: randomUUID(),
  ...over,
});

const booking = (over: Record<string, unknown> & { time?: string; date?: string } = {}) => {
  const { time = "17:00", date = today, ...rest } = over;
  const startsAt = fromLocal(date, time);
  return {
    type: "appointment.save",
    clientId: "p-caio",
    resourceId: "r-helena",
    serviceId: "s-psico",
    itemId: null,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 50 * 60_000).toISOString(),
    priceCents: 20000,
    notes: "",
    repeat: "nao",
    times: 1,
    allowOverlap: false,
    packageId: "pk-caio",
    ...rest,
  };
};

describe("regras de pacotes e mensalidades", () => {
  it("o pacote de exemplo: 2 usadas, 1 marcada, 7 livres", () => {
    const { clinica } = setup();
    const v = packageView(
      clinica.packages.find((p) => p.id === "pk-caio")!,
      clinica.appointments,
      today,
    );
    expect(v).toMatchObject({ used: 2, booked: 1, remaining: 8, free: 7, usable: true, endingSoon: false });
    expect(packageError(v, 7)).toBeNull();
    expect(packageError(v, 8)).toMatch(/só tem 7 sessões livres/);
    expect(packageError({ ...v, expired: true }, 1)).toMatch(/venceu/);
    expect(packageError({ ...v, closed: true }, 1)).toMatch(/encerrado/);
    expect(packageError(undefined)).toMatch(/não encontrado/);
  });

  it("mensalidade cobra todo mês no dia escolhido, desde o início e até o fim", () => {
    const sub = { dayOfMonth: 10, startsOn: "2026-09-15", endsOn: null, canceledAt: null };
    // 10/09 é antes do início: a primeira cobrança é 10/10
    expect(subscriptionPeriods(sub, today)).toEqual([
      { period: "2026-10-01", dueDate: "2026-10-10" },
      { period: "2026-11-01", dueDate: "2026-11-10" },
    ]);
    expect(subscriptionPeriods({ ...sub, endsOn: "2026-10-31" }, today)).toHaveLength(1);
    expect(subscriptionPeriods({ ...sub, canceledAt: "2026-11-01T10:00:00Z" }, today)).toEqual([]);
    expect(subscriptionPeriods({ ...sub, startsOn: "2026-12-01" }, today)).toEqual([]);
    // a cobrança do mês aparece mesmo antes de vencer (vence dia 20, hoje é 14)
    expect(subscriptionPeriods({ ...sub, dayOfMonth: 20, startsOn: "2026-11-01" }, today)).toEqual([
      { period: "2026-11-01", dueDate: "2026-11-20" },
    ]);
  });

  it("a mensalidade de exemplo tem uma cobrança atrasada", () => {
    const { clinica } = setup();
    const sub = clinica.subscriptions[0];
    const s = subscriptionState(sub, clinica.accounts, clinica.movements, today);
    expect(s.state).toBe("atrasada");
    expect(s.overdue.length).toBeGreaterThanOrEqual(1);
  });
});

describe("pacotes (prévia)", () => {
  it("a recepção vende em parcelas; as cobranças vão para o financeiro; repetir o pedido não duplica", () => {
    const { clinica, julia, dona, igor } = setup();
    const r = runner(clinica);
    const req = sell();
    const res = r.step(julia, req);
    expect(res).toMatchObject({ ok: true, message: "Pacote vendido. As 2 parcelas foram para o financeiro." });
    const pkgId = (res as { id: string }).id;
    const accs = r.data.accounts.filter((a) => a.packageId === pkgId);
    expect(accs.map((a) => [a.origin, a.amountCents, a.installmentNumber, a.installmentCount])).toEqual([
      ["pacote", 50000, 1, 2],
      ["pacote", 50000, 2, 2],
    ]);
    expect(r.step(julia, req)).toMatchObject({ id: pkgId }); // mesmo pedido de novo
    expect(r.data.packages.filter((p) => p.clientId === "p-denise")).toHaveLength(1);
    expect(visibleData(r.data, dona).accounts.some((a) => a.packageId === pkgId)).toBe(true);
    expect(visibleData(r.data, julia).accounts).toHaveLength(0);
    // o profissional vê o pacote do próprio paciente, mas não vende
    expect(visibleData(r.data, igor).packages.map((p) => p.id)).toEqual([pkgId]);
    expect(r.step(igor, sell()).ok).toBe(false);
    // parcelas que não somam o total: recusado
    const bad = r.step(julia, sell({ plan: [{ number: 1, amountCents: 90000, dueDate: today }] }));
    expect(!bad.ok && bad.message).toMatch(/abaixo do valor/);
  });

  it("atendido com pacote usa uma sessão e não gera cobrança; desfazer devolve a sessão", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const accountsBefore = r.data.accounts.length;
    expect(
      r.step(julia, { type: "appointment.setStatus", id: "ag-6", status: "compareceu", charge: false }),
    ).toMatchObject({
      ok: true,
      message: "Atendimento registrado. Uma sessão do pacote foi usada.",
    });
    expect(r.data.accounts).toHaveLength(accountsBefore);
    const view = () =>
      packageView(
        r.data.packages.find((p) => p.id === "pk-caio")!,
        r.data.appointments,
        today,
      );
    expect(view()).toMatchObject({ used: 3, booked: 0 });
    r.step(julia, { type: "appointment.setStatus", id: "ag-6", status: "agendado", charge: false });
    expect(view()).toMatchObject({ used: 2, booked: 1 });
    // falta cobrada também usa a sessão
    r.step(julia, { type: "appointment.setStatus", id: "ag-6", status: "faltou", charge: true });
    expect(view().used).toBe(3);
    expect(r.data.accounts).toHaveLength(accountsBefore);
  });

  it("não marca mais sessões do que o pacote tem livres", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const one = r.step(julia, sell({ clientId: "p-caio", serviceId: "s-psico", sessions: 1, priceCents: 0, plan: [] }));
    const pkgId = (one as { id: string }).id;
    expect(r.step(julia, booking({ packageId: pkgId, time: "17:00" })).ok).toBe(true);
    const second = r.step(julia, booking({ packageId: pkgId, time: "18:00" }));
    expect(!second.ok && second.fieldErrors?.packageId).toMatch(/não tem mais sessões livres/);
    // série de 8 semanas com 7 livres no pacote do Caio
    const series = r.step(julia, booking({ time: "19:00", repeat: "semanal", times: 8 }));
    expect(!series.ok && series.message).toMatch(/só tem 7 sessões livres/);
    // pacote de outro paciente
    expect(r.step(julia, booking({ clientId: "p-beatriz", time: "20:00" })).ok).toBe(false);
  });

  it("encerrar o pacote exige não ter horário marcado com ele; encerrado não serve mais", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const blocked = r.step(julia, { type: "package.close", id: "pk-caio" });
    expect(!blocked.ok && blocked.message).toMatch(/horários marcados/);
    r.step(julia, { type: "appointment.setStatus", id: "ag-6", status: "cancelado", charge: false });
    expect(r.step(julia, { type: "package.close", id: "pk-caio" }).ok).toBe(true);
    expect(r.step(julia, booking({})).ok).toBe(false);
  });

  it("pacote vencido não serve para marcar", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const old = r.step(
      julia,
      sell({ clientId: "p-caio", serviceId: "s-psico", validUntil: "2026-11-01", priceCents: 0, plan: [] }),
    );
    const res = r.step(julia, booking({ packageId: (old as { id: string }).id }));
    expect(!res.ok && res.message).toMatch(/venceu/);
  });
});

describe("mensalidades (prévia)", () => {
  const create = (over: Record<string, unknown> = {}) => ({
    type: "subscription.save",
    clientId: "p-denise",
    name: "Acompanhamento nutricional",
    amountCents: 30000,
    dayOfMonth: 5,
    startsOn: "2026-10-01",
    endsOn: null,
    ...over,
  });

  it("criar gera as cobranças até o mês atual; atualizar vale para as próximas", () => {
    const { clinica, julia, dona } = setup();
    const r = runner(clinica);
    const res = r.step(julia, create());
    expect(res).toMatchObject({ ok: true, message: "Mensalidade criada. 2 cobranças já estão no financeiro." });
    const id = (res as { id: string }).id;
    const charges = r.data.accounts.filter((a) => a.subscriptionId === id);
    expect(charges.map((a) => [a.description, a.dueDate, a.amountCents])).toEqual([
      ["Mensalidade: Acompanhamento nutricional (10/2026)", "2026-10-05", 30000],
      ["Mensalidade: Acompanhamento nutricional (11/2026)", "2026-11-05", 30000],
    ]);
    // as duas já venceram: para a dona, aparece atrasada
    const sub = r.data.subscriptions.find((s) => s.id === id)!;
    expect(subscriptionState(sub, visibleData(r.data, dona).accounts, r.data.movements, today).overdue).toHaveLength(2);
    // mudar o valor não mexe nas cobranças que já existem
    r.step(julia, { ...create({ amountCents: 35000 }), id });
    expect(r.data.accounts.filter((a) => a.subscriptionId === id).map((a) => a.amountCents)).toEqual([30000, 30000]);
  });

  it("início muito antigo é recusado; fim antes do início também", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const old = r.step(julia, create({ startsOn: "2024-01-01" }));
    expect(!old.ok && old.fieldErrors?.startsOn).toMatch(/até um ano/);
    const wrong = r.step(julia, create({ endsOn: "2026-09-01" }));
    expect(!wrong.ok && wrong.fieldErrors?.endsOn).toBeTruthy();
  });

  it("cancelar para as cobranças novas; só quem vende pode", () => {
    const { clinica, julia, helena } = setup();
    const r = runner(clinica);
    expect(r.step(helena, create({ clientId: "p-caio" })).ok).toBe(false);
    expect(r.step(helena, { type: "subscription.cancel", id: "sub-beatriz" }).ok).toBe(false);
    expect(r.step(julia, { type: "subscription.cancel", id: "sub-beatriz" }).ok).toBe(true);
    expect(subscriptionPeriods(r.data.subscriptions[0], "2027-06-01")).toEqual([]);
  });

  it("empresa do ramo geral não tem pacotes nem mensalidades", () => {
    const { aurora } = setup();
    const ana = aurora.members.find((m) => m.userId === "u-ana")!;
    const c: EngineContext = { now, newId: () => randomUUID(), processed: new Map() };
    expect(applyAction(aurora, ana, sell({ clientId: "c-marina", serviceId: null }), c).result.ok).toBe(false);
    expect(applyAction(aurora, ana, create({ clientId: "c-marina" }), c).result.ok).toBe(false);
  });
});
