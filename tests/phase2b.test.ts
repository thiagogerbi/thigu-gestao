/**
 * Horário de trabalho, bloqueios, caixa, comissões, turmas e agendamento online:
 * regras puras e o MOTOR DA PRÉVIA. As mesmas regras são testadas no banco em tests/db.test.ts
 * ("horário, caixa, comissões, turmas e agendamento online no banco").
 */
import { scheduleWarning } from "@/lib/domain/agenda";
import { expectedCash, openSession, totalsByMethod } from "@/lib/domain/cash";
import { stoppedComing } from "@/lib/domain/classes";
import { commissionSummary, monthOf, ruleFor } from "@/lib/domain/commissions";
import { availableSlots, brParts, fromBr, hoursSummary, withinHours, workHoursError } from "@/lib/domain/hours";
import type { Appointment, CommissionRule, CompanyData, Member, WorkHours } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date("2026-11-14T11:00:00Z"); // sábado, 08:00 em Brasília
const ctx = (): EngineContext => ({ now, newId: () => randomUUID(), processed: new Map() });

function runner(start: CompanyData) {
  const c = ctx();
  let data = start;
  return {
    step(actor: Member, action: unknown) {
      const r = applyAction(data, actor, action, c);
      data = r.data;
      return r.result as typeof r.result & { id?: string };
    },
    get data() {
      return data;
    },
  };
}
const companies = () => {
  const all = buildPreviewSeed(now);
  const by = (id: string) => all.find((c) => c.company.id === id)!;
  return { salao: by("empresa-salao"), pilates: by("empresa-pilates"), clinica: by("empresa-clinica") };
};
const member = (d: CompanyData, userId: string) => d.members.find((m) => m.userId === userId)!;

const WEEK: WorkHours = {
  "1": [
    ["09:00", "12:00"],
    ["13:00", "18:00"],
  ],
  "2": [["09:00", "18:00"]],
};

describe("horário de trabalho (regras puras)", () => {
  it("confere formato, ordem e sobreposição", () => {
    expect(workHoursError(WEEK)).toBeNull();
    expect(workHoursError({ "1": [["18:00", "09:00"]] })).toMatch(/depois do início/);
    expect(
      workHoursError({
        "1": [
          ["09:00", "13:00"],
          ["12:00", "18:00"],
        ],
      }),
    ).toMatch(/sobrepõem/);
    expect(workHoursError({ "7": [["09:00", "10:00"]] })).toBe("Horário inválido.");
    expect(workHoursError({ "1": [["9h", "10:00"]] })).toMatch(/09:00/);
  });

  it("dentro do horário usa Brasília, e o almoço fica de fora", () => {
    // segunda 16/11, 10:00–11:00 em Brasília = 13:00–14:00 UTC
    expect(withinHours(WEEK, "2026-11-16T13:00:00Z", "2026-11-16T14:00:00Z")).toBe(true);
    expect(withinHours(WEEK, "2026-11-16T14:30:00Z", "2026-11-16T15:30:00Z")).toBe(false); // 11:30–12:30
    expect(withinHours(WEEK, "2026-11-18T13:00:00Z", "2026-11-18T14:00:00Z")).toBe(false); // quarta não atende
    expect(withinHours({}, "2026-11-18T13:00:00Z", "2026-11-18T14:00:00Z")).toBe(true); // sem horário, tudo cabe
    expect(hoursSummary(WEEK)).toBe("seg, 09:00–12:00 e 13:00–18:00 · ter, 09:00–18:00");
    expect(brParts(fromBr("2026-11-16", "10:00"))).toEqual({ date: "2026-11-16", time: "10:00", weekday: 1 });
  });

  it("horários livres do link: sem ocupados, sem almoço e a partir de 30 minutos", () => {
    const busy = [{ startsAt: fromBr("2026-11-16", "10:00"), endsAt: fromBr("2026-11-16", "11:00") }];
    const slots = availableSlots({ workHours: WEEK, busy, date: "2026-11-16", durationMin: 60, now }).map(
      (s) => brParts(s).time,
    );
    expect(slots).toEqual([
      "09:00",
      "11:00",
      "13:00",
      "13:30",
      "14:00",
      "14:30",
      "15:00",
      "15:30",
      "16:00",
      "16:30",
      "17:00",
    ]);
    // hoje às 08:00: nada antes das 08:30, e sábado não tem horário
    expect(availableSlots({ workHours: WEEK, busy: [], date: "2026-11-14", durationMin: 30, now })).toEqual([]);
    const soon = availableSlots({
      workHours: { "6": [["08:00", "10:00"]] },
      busy: [],
      date: "2026-11-14",
      durationMin: 30,
      now,
    }).map((s) => brParts(s).time);
    expect(soon[0]).toBe("08:30");
  });

  it("aviso ao marcar: conflito, bloqueio e fora do horário, nesta ordem", () => {
    const slot = { resourceId: "r", startsAt: fromBr("2026-11-16", "12:00"), endsAt: fromBr("2026-11-16", "12:30") };
    const base = { resourceId: "r", resourceName: "Lúcia", workHours: WEEK, appointments: [], blocks: [] };
    expect(scheduleWarning({ ...base, slots: [slot] })).toMatch(/Fora do horário de trabalho de Lúcia/);
    const block = {
      id: "b",
      resourceId: "r",
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      reason: "Médico",
      createdBy: "u",
    };
    expect(scheduleWarning({ ...base, blocks: [block], slots: [slot] })).toMatch(/bloque/i);
    const inside = { ...slot, startsAt: fromBr("2026-11-16", "10:00"), endsAt: fromBr("2026-11-16", "10:30") };
    expect(scheduleWarning({ ...base, slots: [inside] })).toBeNull();
  });
});

describe("agenda com horário e bloqueios (prévia)", () => {
  it("o profissional bloqueia só a própria agenda; marcar no bloqueio pede confirmação", () => {
    const { salao } = companies();
    const run = runner(salao);
    const lucia = member(salao, "u-lucia");
    const recep = member(salao, "u-renata");
    const from = fromBr("2026-11-17", "12:00");
    const to = fromBr("2026-11-17", "14:00");
    expect(
      run.step(lucia, { type: "block.create", resourceId: "r-tiago", startsAt: from, endsAt: to, reason: "" }).ok,
    ).toBe(false);
    const b = run.step(lucia, {
      type: "block.create",
      resourceId: "r-lucia",
      startsAt: from,
      endsAt: to,
      reason: "Médico",
    });
    expect(b.ok).toBe(true);
    const book = (allowOverlap: boolean) =>
      run.step(recep, {
        type: "appointment.save",
        clientId: salao.clients[0].id,
        resourceId: "r-lucia",
        serviceId: "s-escova",
        itemId: null,
        packageId: null,
        startsAt: fromBr("2026-11-17", "12:30"),
        endsAt: fromBr("2026-11-17", "13:15"),
        priceCents: 6000,
        notes: "",
        repeat: "nao",
        times: 1,
        allowOverlap,
      });
    const warned = book(false);
    expect(warned.ok).toBe(false);
    expect(warned.message).toMatch(/bloque/i);
    expect(book(true).ok).toBe(true);
    expect(run.step(lucia, { type: "block.delete", id: b.id }).ok).toBe(true);
  });

  it("horário de trabalho inválido não é salvo", () => {
    const { salao } = companies();
    const run = runner(salao);
    const ana = member(salao, "u-ana");
    const r = run.step(ana, {
      type: "resource.save",
      id: "r-lucia",
      name: "Lúcia Prado",
      userId: "u-lucia",
      active: true,
      workHours: { "1": [["18:00", "09:00"]] },
    });
    expect(r.ok).toBe(false);
    expect(run.data.resources.find((x) => x.id === "r-lucia")!.workHours["1"]).not.toEqual([["18:00", "09:00"]]);
  });
});

describe("caixa (prévia)", () => {
  it("abre, vende, recebe e fecha; esperado = troco + dinheiro", () => {
    const { salao } = companies();
    const run = runner(salao);
    const bruna = member(salao, "u-bruna"); // caixa
    const ana = member(salao, "u-ana");
    const lucia = member(salao, "u-lucia");
    expect(run.step(lucia, { type: "cash.open", openingCents: 0 }).ok).toBe(false);
    const open = run.step(bruna, { type: "cash.open", openingCents: 10000 });
    expect(open.ok).toBe(true);
    expect(run.step(bruna, { type: "cash.open", openingCents: 0 }).ok).toBe(false);
    const sale = (method: string, unitCents: number, quantity = 1) =>
      run.step(bruna, {
        type: "cash.sale",
        sessionId: open.id,
        clientId: null,
        items: [{ productId: "pr-shampoo", serviceId: null, description: "Shampoo", quantity, unitCents }],
        method,
        requestId: randomUUID(),
      });
    expect(sale("dinheiro", 4500, 2).ok).toBe(true);
    expect(sale("pix", 3000).ok).toBe(true);
    const session = openSession(run.data.cashSessions)!;
    expect(expectedCash(session, run.data.movements)).toBe(19000);
    expect(totalsByMethod(session, run.data.movements)).toEqual({ dinheiro: 9000, pix: 3000 });
    expect(run.step(bruna, { type: "cash.close", sessionId: open.id, countedCents: 19000, notes: "" }).ok).toBe(false);
    const closed = run.step(ana, { type: "cash.close", sessionId: open.id, countedCents: 18500, notes: "troco" });
    expect(closed.message).toMatch(/Faltaram R\$\s5,00/);
    expect(sale("pix", 100).ok).toBe(false);
  });

  it("o caixa vê as contas a cobrar do balcão, mas não as contas a pagar", () => {
    const { salao } = companies();
    const bruna = member(salao, "u-bruna");
    const v = visibleData(salao, bruna);
    expect(v.accounts.some((a) => a.kind === "receber" && a.origin === "atendimento")).toBe(true);
    expect(v.accounts.some((a) => a.kind === "pagar")).toBe(false);
  });
});

describe("comissões", () => {
  const rules: CommissionRule[] = [
    { id: "g", resourceId: null, serviceId: null, percentBp: 4000, fixedCents: null },
    { id: "s", resourceId: null, serviceId: "barba", percentBp: null, fixedCents: 1000 },
    { id: "t", resourceId: "tiago", serviceId: null, percentBp: 4500, fixedCents: null },
    { id: "tb", resourceId: "tiago", serviceId: "barba", percentBp: 5000, fixedCents: null },
  ];
  it("vale a regra mais específica", () => {
    expect(ruleFor(rules, "tiago", "barba")!.id).toBe("tb");
    expect(ruleFor(rules, "lucia", "barba")!.id).toBe("s");
    expect(ruleFor(rules, "tiago", "corte")!.id).toBe("t");
    expect(ruleFor(rules, "lucia", "corte")!.id).toBe("g");
    expect(ruleFor([], "lucia", "corte")).toBeUndefined();
  });

  it("mês pelo horário de Brasília e mesmo resultado do banco (R$ 112,00)", () => {
    expect(monthOf("2026-11-01T02:30:00Z")).toBe("2026-10-01");
    const ap = (id: string, startsAt: string, priceCents: number): Appointment =>
      ({
        id,
        resourceId: "lucia",
        serviceId: "corte",
        status: "compareceu",
        startsAt,
        priceCents,
        packageId: null,
        consumesPackage: false,
      }) as Appointment;
    const sum = commissionSummary({
      resourceId: "lucia",
      month: "2026-10-01",
      appointments: [
        ap("1", "2026-10-05T13:00:00Z", 10000),
        ap("2", "2026-10-31T23:30:00Z", 8000),
        ap("3", "2026-11-01T02:30:00Z", 9999),
        ap("4", "2026-11-01T03:30:00Z", 5000), // já é novembro em Brasília
      ],
      packages: [],
      rules,
    });
    expect(sum).toMatchObject({ baseCents: 27999, amountCents: 11200 });
    expect(sum.lines).toHaveLength(3);
  });

  it("na prévia: só mês encerrado, uma vez, e vira conta a pagar", () => {
    const { salao } = companies();
    const run = runner(salao);
    const ana = member(salao, "u-ana");
    const lucia = member(salao, "u-lucia");
    expect(run.step(ana, { type: "commission.close", resourceId: "r-lucia", month: "2026-11-01" }).ok).toBe(false);
    expect(run.step(lucia, { type: "commission.close", resourceId: "r-lucia", month: "2026-10-01" }).ok).toBe(false);
    const r = run.step(ana, { type: "commission.close", resourceId: "r-lucia", month: "2026-10-01" });
    expect(r.ok).toBe(true);
    expect(run.step(ana, { type: "commission.close", resourceId: "r-lucia", month: "2026-10-01" }).ok).toBe(false);
    const acc = run.data.accounts.find((a) => a.origin === "comissao")!;
    expect(acc).toMatchObject({ kind: "pagar", dueDate: "2026-11-05", category: "Salários" });
    // a profissional vê só a própria comissão; não vê a do colega
    const v = visibleData(run.data, lucia);
    expect(v.commissionClosings.every((c) => c.resourceId === "r-lucia")).toBe(true);
    expect(visibleData(run.data, member(salao, "u-tiago")).commissionClosings).toHaveLength(0);
  });
});

describe("turmas (prévia)", () => {
  it("vaga, presença pelo instrutor e quem parou de vir", () => {
    const { pilates } = companies();
    const run = runner(pilates);
    const carla = member(pilates, "u-carla2"); // recepção
    const diego = member(pilates, "u-diego2"); // instrutor
    const full = pilates.classes.find((c) => c.id === "tu-av")!;
    const fill = () =>
      run.step(carla, {
        type: "class.save",
        id: full.id,
        name: full.name,
        resourceId: full.resourceId,
        weekdays: full.weekdays,
        startTime: full.startTime,
        durationMin: full.durationMin,
        capacity: 2,
        active: true,
      });
    expect(fill().ok).toBe(false); // recepção não edita turma
    const outside = pilates.clients.find(
      (c) => !run.data.enrollments.some((e) => e.clientId === c.id && e.classId === full.id),
    );
    if (outside) {
      const seats = run.data.enrollments.filter((e) => e.classId === full.id && !e.endedOn).length;
      const r = run.step(carla, { type: "enrollment.create", classId: full.id, clientId: outside.id });
      expect(r.ok).toBe(seats < full.capacity);
    }
    const student = run.data.enrollments.find((e) => e.classId === "tu-ini" && !e.endedOn)!;
    expect(
      run.step(diego, {
        type: "attendance.mark",
        classId: "tu-ini",
        clientId: student.clientId,
        date: "2026-11-11",
        status: "presente",
      }).ok,
    ).toBe(true);
    expect(
      run.step(diego, {
        type: "attendance.mark",
        classId: "tu-ini",
        clientId: student.clientId,
        date: "2026-11-11",
        status: "falta",
      }).ok,
    ).toBe(true);
    expect(
      run.data.attendance.filter(
        (a) => a.classId === "tu-ini" && a.clientId === student.clientId && a.classDate === "2026-11-11",
      ),
    ).toHaveLength(1);
    const stopped = stoppedComing({
      enrollments: run.data.enrollments,
      attendance: run.data.attendance,
      today: "2026-11-14",
    });
    expect(stopped.map((e) => e.clientId)).toContain("al-3");
  });
});

describe("agendamento online (prévia)", () => {
  it("só o administrador liga, e precisa de endereço", () => {
    const { salao, clinica } = companies();
    const run = runner(salao);
    const ana = member(salao, "u-ana");
    expect(
      run.step(member(salao, "u-renata"), {
        type: "company.setBooking",
        enabled: false,
        slug: "x-y-z",
        autoConfirm: false,
      }).ok,
    ).toBe(false);
    expect(run.step(ana, { type: "company.setBooking", enabled: true, slug: null, autoConfirm: false }).ok).toBe(false);
    expect(
      run.step(ana, { type: "company.setBooking", enabled: true, slug: "studio-bella", autoConfirm: true }).ok,
    ).toBe(true);
    expect(run.data.company).toMatchObject({
      bookingEnabled: true,
      bookingSlug: "studio-bella",
      bookingAutoConfirm: true,
    });
    // a clínica (plano com o módulo) também pode; o ramo geral, não
    expect(clinica.company.segment).toBe("clinica");
  });
});
