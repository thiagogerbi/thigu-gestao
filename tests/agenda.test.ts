/**
 * Agenda, serviços e ficha de atendimento: regras puras (agenda.ts) e o MOTOR DA PRÉVIA.
 * As mesmas regras são testadas no banco em tests/db.test.ts ("agenda no banco").
 */
import {
  conflictsFor,
  fromLocal,
  localParts,
  overlaps,
  reminderText,
  seriesStarts,
  slotError,
} from "@/lib/domain/agenda";
import { whatsappUrl } from "@/lib/domain/phone";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date(2026, 10, 14, 8, 0, 0);
const today = "2026-11-14";
const ctx = (): EngineContext => ({ now, newId: () => randomUUID(), processed: new Map() });

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
    karina: who(pet, "u-karina"),
    marcos: who(pet, "u-marcos"),
  };
}

function runner(start: CompanyData) {
  const c = ctx();
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

/** Horário novo, hoje, com duração em minutos. */
const booking = (over: Record<string, unknown> & { time?: string; minutes?: number; date?: string }) => {
  const { time = "16:00", minutes = 50, date = today, ...rest } = over;
  const startsAt = fromLocal(date, time);
  return {
    type: "appointment.save",
    clientId: "p-beatriz",
    resourceId: "r-helena",
    serviceId: "s-psico",
    itemId: null,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + minutes * 60_000).toISOString(),
    priceCents: 20000,
    notes: "",
    repeat: "nao",
    times: 1,
    allowOverlap: false,
    ...rest,
  };
};

describe("regras da agenda", () => {
  it("encostar um horário no outro não é choque; sobrepor é", () => {
    const a = { startsAt: fromLocal(today, "09:00"), endsAt: fromLocal(today, "10:00") };
    expect(overlaps(a, { startsAt: fromLocal(today, "10:00"), endsAt: fromLocal(today, "11:00") })).toBe(false);
    expect(overlaps(a, { startsAt: fromLocal(today, "09:30"), endsAt: fromLocal(today, "09:40") })).toBe(true);
    const base = { id: "x", resourceId: "r", status: "cancelado" as const, ...a };
    // cancelado não ocupa a agenda
    expect(conflictsFor([base], { resourceId: "r", ...a })).toHaveLength(0);
    expect(conflictsFor([{ ...base, status: "agendado" }], { resourceId: "r", ...a })).toHaveLength(1);
    expect(conflictsFor([{ ...base, status: "agendado" }], { resourceId: "r", ...a, ignoreId: "x" })).toHaveLength(0);
  });

  it("repetição mantém o horário local e respeita o limite de 12", () => {
    const starts = seriesStarts(fromLocal(today, "09:00"), "semanal", 4);
    expect(starts.map((s) => localParts(s))).toEqual([
      { date: "2026-11-14", time: "09:00" },
      { date: "2026-11-21", time: "09:00" },
      { date: "2026-11-28", time: "09:00" },
      { date: "2026-12-05", time: "09:00" },
    ]);
    expect(seriesStarts(fromLocal(today, "09:00"), "quinzenal", 2).map((s) => localParts(s).date)).toEqual([
      "2026-11-14",
      "2026-11-28",
    ]);
    expect(seriesStarts(fromLocal(today, "09:00"), "semanal", 40)).toHaveLength(12);
    expect(seriesStarts(fromLocal(today, "09:00"), "nao", 5)).toHaveLength(1);
  });

  it("início e fim conferidos", () => {
    expect(slotError(fromLocal(today, "10:00"), fromLocal(today, "09:00"))).toMatch(/depois do início/);
    expect(slotError(fromLocal(today, "08:00"), fromLocal("2026-11-15", "08:00"))).toMatch(/12 horas/);
    expect(slotError(fromLocal(today, "08:00"), fromLocal(today, "09:00"))).toBeNull();
  });

  it("lembrete no jeito de falar de cada ramo, pronto para o WhatsApp", () => {
    const base = {
      companyName: "Clínica Bem Viver",
      clientName: "Beatriz Nunes",
      startsAt: fromLocal("2026-11-15", "09:00"),
      resourceName: "Helena Prado",
      serviceName: "Banho (porte grande)",
      itemName: "Thor",
      today,
    };
    expect(reminderText({ ...base, segment: "clinica" })).toBe(
      "Olá, Beatriz! Lembrete da sua consulta na Clínica Bem Viver amanhã às 09:00, com Helena Prado. Pode confirmar respondendo esta mensagem?",
    );
    expect(reminderText({ ...base, segment: "pet", companyName: "Amigo Fiel" })).toContain(
      "Thor tem banho (porte grande) na Amigo Fiel amanhã às 09:00",
    );
    expect(reminderText({ ...base, segment: "beleza", startsAt: fromLocal("2026-11-20", "14:30") })).toContain(
      "no dia 20/11 às 14:30",
    );
    expect(whatsappUrl("(11) 90000-2001", "Olá, tudo bem?")).toBe(
      "https://wa.me/5511900002001?text=Ol%C3%A1%2C%20tudo%20bem%3F",
    );
  });
});

describe("agenda na clínica (prévia)", () => {
  it("a recepção marca para a profissional; horário ocupado pede confirmação (encaixe)", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const busy = r.step(julia, booking({ time: "09:20" })); // Helena atende Beatriz das 9h às 9h50
    expect(busy.ok).toBe(false);
    expect(!busy.ok && busy.fieldErrors?.overlap).toMatch(/Helena Prado já tem um horário/);
    expect(r.step(julia, booking({ time: "09:20", allowOverlap: true })).ok).toBe(true);
    expect(r.step(julia, booking({ time: "16:00" }))).toMatchObject({ ok: true, message: "Horário marcado." });
    // em outra agenda o mesmo horário está livre
    expect(r.step(julia, booking({ time: "09:20", resourceId: "r-igor", clientId: "p-denise" })).ok).toBe(true);
  });

  it("atendimento que se repete cria todos os horários de uma vez, na mesma série", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const res = r.step(julia, booking({ time: "17:00", repeat: "semanal", times: 4 }));
    expect(res).toMatchObject({ ok: true, message: "4 horários marcados." });
    const created = r.data.appointments.filter(
      (a) => a.clientId === "p-beatriz" && localParts(a.startsAt).time === "17:00",
    );
    expect(created).toHaveLength(4);
    expect(new Set(created.map((a) => a.seriesId)).size).toBe(1);
    // uma das datas bate com outro horário: avisa quantas
    const clash = r.step(julia, booking({ time: "09:30", date: "2026-11-07", repeat: "semanal", times: 3 }));
    expect(!clash.ok && clash.fieldErrors?.overlap).toMatch(/em 2 das datas/);
  });

  it("cada profissional vê e marca só na própria agenda", () => {
    const { clinica, igor, helena } = setup();
    expect(visibleData(clinica, igor).appointments.every((a) => a.resourceId === "r-igor")).toBe(true);
    expect(visibleData(clinica, helena).appointments.every((a) => a.resourceId === "r-helena")).toBe(true);
    expect(applyAction(clinica, igor, booking({ clientId: "p-denise" }), ctx()).result.ok).toBe(false); // agenda da Helena
    expect(applyAction(clinica, igor, booking({ clientId: "p-denise", resourceId: "r-igor" }), ctx()).result.ok).toBe(
      true,
    );
    // Igor não vê a Beatriz (paciente da Helena, sem horário com ele), então não marca para ela
    expect(applyAction(clinica, igor, booking({ resourceId: "r-igor" }), ctx()).result.ok).toBe(false);
  });

  it("quem atende um paciente do colega passa a vê-lo, mas não edita a ficha", () => {
    const { clinica, julia, igor } = setup();
    const r = runner(clinica);
    expect(visibleData(r.data, igor).clients.map((c) => c.id)).toEqual(["p-denise"]);
    r.step(julia, booking({ resourceId: "r-igor", time: "18:00" })); // Beatriz (da Helena) com Igor
    expect(
      visibleData(r.data, igor)
        .clients.map((c) => c.id)
        .sort(),
    ).toEqual(["p-beatriz", "p-denise"]);
    const edit = { type: "client.save", id: "p-beatriz", name: "Beatriz", email: "", phone: "", ownerId: "u-helena" };
    expect(r.step(igor, edit).ok).toBe(false);
  });

  it("atendido gera a conta a receber; desfazer cancela a conta; com pagamento registrado, não desfaz", () => {
    const { clinica, julia, dona } = setup();
    const r = runner(clinica);
    const done = r.step(julia, { type: "appointment.setStatus", id: "ag-2", status: "compareceu", charge: false });
    expect(done).toMatchObject({
      ok: true,
      message: "Atendimento registrado. A conta a receber foi para o financeiro.",
    });
    const ap = r.data.appointments.find((a) => a.id === "ag-2")!;
    const acc = r.data.accounts.find((a) => a.id === ap.accountId)!;
    expect(acc).toMatchObject({
      origin: "atendimento",
      kind: "receber",
      amountCents: 20000,
      clientId: "p-caio",
      dueDate: today,
    });
    // a recepção não vê o financeiro; a dona vê
    expect(visibleData(r.data, julia).accounts).toHaveLength(0);
    expect(visibleData(r.data, dona).accounts.some((a) => a.id === acc.id)).toBe(true);
    // não pula de atendido para cancelado sem desfazer
    expect(r.step(julia, { type: "appointment.setStatus", id: "ag-2", status: "cancelado", charge: false }).ok).toBe(
      false,
    );
    // desfazer
    expect(r.step(julia, { type: "appointment.setStatus", id: "ag-2", status: "agendado", charge: false }).ok).toBe(
      true,
    );
    expect(r.data.accounts.find((a) => a.id === acc.id)!.canceledAt).not.toBeNull();
    expect(r.data.appointments.find((a) => a.id === "ag-2")!.accountId).toBeNull();
    // atende de novo, a dona registra o pagamento, e aí não dá mais para desfazer
    r.step(julia, { type: "appointment.setStatus", id: "ag-2", status: "compareceu", charge: false });
    const acc2 = r.data.appointments.find((a) => a.id === "ag-2")!.accountId!;
    const paid = r.step(dona, {
      type: "movement.register",
      accountId: acc2,
      amountCents: 20000,
      paidOn: today,
      method: "pix",
      requestId: randomUUID(),
    });
    expect(paid.ok).toBe(true);
    const undo = r.step(julia, { type: "appointment.setStatus", id: "ag-2", status: "agendado", charge: false });
    expect(!undo.ok && undo.message).toMatch(/pagamento registrado/);
  });

  it("falta cobrada vira conta a receber; sem cobrança, não", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    const before = r.data.accounts.length;
    expect(r.step(julia, { type: "appointment.setStatus", id: "ag-3", status: "faltou", charge: false })).toMatchObject(
      {
        ok: true,
        message: "Falta registrada.",
      },
    );
    expect(r.data.accounts).toHaveLength(before);
    r.step(julia, { type: "appointment.setStatus", id: "ag-3", status: "agendado", charge: false });
    r.step(julia, { type: "appointment.setStatus", id: "ag-3", status: "faltou", charge: true });
    expect(r.data.accounts.at(-1)).toMatchObject({ description: "Falta: Consulta de nutrição", amountCents: 25000 });
  });

  it("horário encerrado não se remarca; o lembrete fica anotado", () => {
    const { clinica, julia } = setup();
    const r = runner(clinica);
    expect(r.step(julia, { ...booking({}), id: "ag-7" }).ok).toBe(false); // ag-7 já foi atendido
    expect(r.step(julia, { type: "appointment.markReminded", id: "ag-6" }).ok).toBe(true);
    expect(r.data.appointments.find((a) => a.id === "ag-6")!.remindedAt).not.toBeNull();
  });

  it("serviços e agendas: só administrador ou gestor cadastram; uma agenda por pessoa", () => {
    const { clinica, dona, julia, helena } = setup();
    const r = runner(clinica);
    const service = { type: "service.save", name: "Avaliação", durationMin: 40, priceCents: 15000, active: true };
    expect(r.step(julia, service).ok).toBe(false);
    expect(r.step(dona, service).ok).toBe(true);
    expect(r.step(helena, { type: "resource.save", name: "Sala 3", userId: null, active: true }).ok).toBe(false);
    expect(r.step(dona, { type: "resource.save", name: "Sala 3", userId: null, active: true }).ok).toBe(true);
    const dup = r.step(dona, { type: "resource.save", name: "Outra", userId: "u-helena", active: true });
    expect(!dup.ok && dup.fieldErrors?.userId).toMatch(/já tem uma agenda/);
  });
});

describe("ficha de atendimento (prévia)", () => {
  it("só quem escreveu lê — nem a dona, nem a recepção, nem o colega", () => {
    const { clinica, helena, igor, dona, julia } = setup();
    expect(visibleData(clinica, helena).clinicalNotes.map((n) => n.id)).toEqual(["cn-1"]);
    for (const other of [igor, dona, julia]) expect(visibleData(clinica, other).clinicalNotes).toHaveLength(0);
  });

  it("só o profissional escreve; corrigir cria outra anotação ligada à original", () => {
    const { clinica, helena, igor, julia, dona } = setup();
    const r = runner(clinica);
    const note = {
      type: "clinicalNote.add",
      clientId: "p-caio",
      appointmentId: null,
      body: "Nova evolução.",
      correctsId: null,
    };
    expect(r.step(julia, note).ok).toBe(false);
    expect(r.step(dona, note).ok).toBe(false);
    expect(r.step(helena, note)).toMatchObject({ ok: true, message: "Anotação salva." });
    expect(r.step(helena, { ...note, correctsId: "cn-1", body: "Correção." })).toMatchObject({
      message: "Correção salva.",
    });
    expect(r.data.clinicalNotes.find((n) => n.correctsId === "cn-1")).toMatchObject({ authorId: "u-helena" });
    // o original continua lá
    expect(r.data.clinicalNotes.find((n) => n.id === "cn-1")!.body).toMatch(/respiração/);
    // Igor não vê o Caio, e não corrige anotação de outra pessoa
    expect(r.step(igor, note).ok).toBe(false);
    expect(r.step(igor, { ...note, clientId: "p-denise", correctsId: "cn-1" }).ok).toBe(false);
  });
});

describe("agenda em outros ramos (prévia)", () => {
  it("pet shop: o pet precisa ser do tutor; o caixa não usa a agenda", () => {
    const { pet, karina, marcos } = setup();
    const banho = (itemId: string) =>
      booking({
        clientId: "t-simone",
        resourceId: "r-mesa2",
        serviceId: "s-banho-p",
        itemId,
        priceCents: 6000,
        time: "15:00",
      });
    expect(applyAction(pet, karina, banho("i-thor"), ctx()).result.ok).toBe(false); // Thor é da Paula
    expect(applyAction(pet, karina, { ...banho("i-thor"), clientId: "t-paula" }, ctx()).result.ok).toBe(true);
    // agenda sem login (mesa de tosa) também recebe horários
    expect(visibleData(pet, karina).appointments.some((a) => a.resourceId === "r-mesa2")).toBe(true);
    expect(visibleData(pet, marcos).appointments).toHaveLength(0);
    expect(applyAction(pet, marcos, { ...banho("i-thor"), clientId: "t-paula" }, ctx()).result.ok).toBe(false);
  });

  it("empresa do ramo geral não tem agenda", () => {
    const { aurora } = setup();
    const ana = aurora.members.find((m) => m.userId === "u-ana")!;
    const res = applyAction(aurora, ana, { type: "resource.save", name: "Sala", userId: null, active: true }, ctx());
    expect(!res.result.ok && res.result.message).toMatch(/não está disponível/);
    expect(visibleData(aurora, ana).appointments).toHaveLength(0);
  });
});
