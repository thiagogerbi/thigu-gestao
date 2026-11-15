/**
 * Ramos, módulos, nomes e papéis por ramo: regras puras (segments.ts, permissions.ts) e o mesmo
 * comportamento no MOTOR DA PRÉVIA. As mesmas regras são testadas no banco em tests/db.test.ts.
 */
import { can, canEditClient, usesClients, usesCrm } from "@/lib/domain/permissions";
import {
  cleanFields,
  ITEM_KINDS,
  itemKindFor,
  mergeFields,
  MODULE_IDS,
  moduleAvailable,
  moduleEnabled,
  roleLabel,
  rolesFor,
  SEGMENT_IDS,
  SEGMENTS,
  termsFor,
} from "@/lib/domain/segments";
import type { CompanyData, Member } from "@/lib/domain/types";
import { visibleData } from "@/lib/domain/visibility";
import { applyAction, type EngineContext } from "@/lib/preview/engine";
import { buildPreviewSeed } from "@/lib/preview/seed";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

const now = new Date(2026, 10, 14, 9, 0, 0);
const ctx = (): EngineContext => ({ now, newId: () => randomUUID(), processed: new Map() });

function setup() {
  const [aurora, , clinica, pet] = buildPreviewSeed(now);
  const who = (d: CompanyData, userId: string) => d.members.find((m) => m.userId === userId)!;
  return {
    aurora,
    clinica,
    pet,
    dona: who(clinica, "u-ana"),
    helena: who(clinica, "u-helena"), // profissional
    igor: who(clinica, "u-igor"), // profissional
    julia: who(clinica, "u-julia"), // recepção
    karina: who(pet, "u-karina"), // atendente (recepção)
    leandro: who(pet, "u-leandro"), // banhista (profissional)
    marcos: who(pet, "u-marcos"), // caixa
  };
}

/** Aplica ações em sequência sobre a mesma empresa. */
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

describe("catálogo de ramos", () => {
  it("todo ramo tem módulos válidos, administrador entre os papéis e nome para o cliente", () => {
    for (const id of SEGMENT_IDS) {
      const s = SEGMENTS[id];
      expect(s.modules.every((m) => MODULE_IDS.includes(m))).toBe(true);
      expect(new Set(s.modules).size).toBe(s.modules.length);
      expect(s.roles).toContain("admin");
      expect(s.client[0]).not.toBe("");
      expect(s.client[1]).not.toBe("");
      expect(new Set(s.clientFields.map((f) => f.key)).size).toBe(s.clientFields.length);
    }
  });

  it("módulo ligado depende do ramo (ou de um extra) e do plano", () => {
    const co = (segment: (typeof SEGMENT_IDS)[number], plan = "empresa" as const, extraModules = [] as never[]) => ({
      segment,
      plan,
      extraModules,
    });
    expect(moduleEnabled(co("pet"), "itens")).toBe(true);
    expect(moduleEnabled(co("geral"), "itens")).toBe(false);
    expect(moduleEnabled({ segment: "geral", plan: "empresa", extraModules: ["itens"] }, "itens")).toBe(true);
    // o agendamento online é do plano Equipe em diante
    expect(moduleEnabled({ segment: "clinica", plan: "essencial", extraModules: [] }, "agendamento_online")).toBe(
      false,
    );
    expect(moduleEnabled({ segment: "clinica", plan: "equipe", extraModules: [] }, "agendamento_online")).toBe(true);
    expect(moduleEnabled({ segment: "clinica", plan: "essencial", extraModules: [] }, "agenda")).toBe(true);
  });

  it("módulo ainda não construído não aparece, mesmo ligado", () => {
    const clinica = { segment: "clinica", plan: "empresa", extraModules: [] } as const;
    const pedidos = { segment: "pedidos", plan: "empresa", extraModules: [] } as const;
    expect(moduleEnabled(pedidos, "pedidos")).toBe(true);
    expect(moduleAvailable(pedidos, "pedidos")).toBe(false);
    expect(moduleAvailable(clinica, "agenda")).toBe(true);
    expect(itemKindFor({ segment: "pet", plan: "empresa", extraModules: [] })).toBe("pet");
    expect(itemKindFor({ segment: "clinica", plan: "empresa", extraModules: [] })).toBeNull();
  });

  it("cada ramo chama o cliente e os papéis do seu jeito", () => {
    expect(termsFor("clinica")).toMatchObject({ cliente: "paciente", Clientes: "Pacientes" });
    expect(termsFor("pet").Clientes).toBe("Tutores");
    expect(termsFor("geral").Cliente).toBe("Cliente");
    expect(roleLabel("veiculos", "profissional")).toBe("Mecânico");
    expect(roleLabel("turmas", "profissional")).toBe("Instrutor(a)");
    expect(roleLabel("geral", "profissional")).toBe("Profissional");
    // quem já tem um papel de outro ramo continua vendo esse papel para poder desmarcar
    expect(rolesFor("clinica", ["vendedor", "admin"])).toEqual([
      "admin",
      "recepcao",
      "profissional",
      "financeiro",
      "vendedor",
    ]);
  });

  it("campos do ramo: descarta vazios e recusa campo desconhecido, data e opção inválidas", () => {
    const fields = SEGMENTS.clinica.clientFields;
    expect(cleanFields(fields, { nascimento: "1990-05-20", convenio: "  ", responsavel: " Rita " }, "extra")).toEqual({
      ok: true,
      value: { nascimento: "1990-05-20", responsavel: "Rita" },
    });
    const bad = cleanFields(fields, { nascimento: "20/05/1990", placa: "ABC1D23" }, "extra");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(["extra.nascimento", "extra.placa"]);
    const pet = cleanFields(ITEM_KINDS.pet.fields, { especie: "Dragão" }, "details");
    expect(!pet.ok && pet.fieldErrors["details.especie"]).toBeTruthy();
  });

  it("trocar de ramo não apaga os campos do ramo anterior", () => {
    const merged = mergeFields(SEGMENTS.pet.clientFields, { nascimento: "1990-05-20", endereco: "Rua A" }, {});
    expect(merged).toEqual({ nascimento: "1990-05-20" });
  });
});

describe("papéis dos ramos com atendimento", () => {
  it("recepção e caixa cuidam dos clientes de todos, sem negociações nem financeiro", () => {
    for (const role of ["recepcao", "caixa"] as const) {
      expect(can([role], "clientes.ver_todos")).toBe(true);
      expect(can([role], "clientes.editar_todos")).toBe(true);
      expect(usesClients([role])).toBe(true);
      expect(usesCrm([role])).toBe(false);
      expect(can([role], "venda.fechar")).toBe(false);
      expect(can([role], "financeiro.ver")).toBe(false);
      expect(can([role], "empresa.gerenciar")).toBe(false);
    }
  });

  it("profissional cuida só dos próprios clientes", () => {
    expect(can(["profissional"], "clientes.ver_todos")).toBe(false);
    expect(canEditClient(["profissional"], "eu", { ownerId: "eu" })).toBe(true);
    expect(canEditClient(["profissional"], "eu", { ownerId: "colega" })).toBe(false);
    expect(usesCrm(["profissional"])).toBe(false);
  });

  it("os papéis que já existiam continuam iguais", () => {
    expect(can(["vendedor"], "clientes.ver_todos")).toBe(false);
    expect(canEditClient(["vendedor"], "eu", { ownerId: "eu" })).toBe(true);
    expect(can(["financeiro"], "clientes.ver_todos")).toBe(true);
    expect(can(["financeiro"], "clientes.editar_proprios")).toBe(false);
    expect(can(["gestor"], "clientes.editar_todos")).toBe(true);
    expect(usesCrm(["vendedor"])).toBe(true);
  });
});

describe("clínica (prévia)", () => {
  const paciente = (ownerId: string, extra?: Record<string, string>) => ({
    type: "client.save",
    name: "Olívia Reis",
    email: "",
    phone: "",
    ownerId,
    extra,
  });

  it("a recepção cadastra o paciente para a profissional, com os campos do ramo", () => {
    const { clinica, julia, helena } = setup();
    const r = runner(clinica);
    const saved = r.step(julia, paciente(helena.userId, { nascimento: "1988-02-01", convenio: "Particular" }));
    expect(saved).toMatchObject({ ok: true, message: "Paciente Olívia Reis cadastrado." });
    const created = r.data.clients.find((c) => c.name === "Olívia Reis")!;
    expect(created).toMatchObject({
      ownerId: helena.userId,
      extra: { nascimento: "1988-02-01", convenio: "Particular" },
    });

    const badDate = r.step(julia, paciente(helena.userId, { nascimento: "01/02/1988" }));
    expect(badDate.ok).toBe(false);
    expect(!badDate.ok && badDate.fieldErrors?.["extra.nascimento"]).toBeTruthy();
    // campo de outro ramo não entra na ficha da clínica
    expect(r.step(julia, paciente(helena.userId, { endereco: "Rua A" })).ok).toBe(false);
  });

  it("cada profissional vê e edita só os próprios pacientes", () => {
    const { clinica, helena, igor, julia } = setup();
    expect(
      visibleData(clinica, helena)
        .clients.map((c) => c.id)
        .sort(),
    ).toEqual(["p-beatriz", "p-caio"]);
    expect(visibleData(clinica, igor).clients.map((c) => c.id)).toEqual(["p-denise"]);
    expect(visibleData(clinica, julia).clients).toHaveLength(3);

    const r = runner(clinica);
    // não cadastra para o colega, nem edita o paciente do colega
    expect(r.step(igor, paciente(helena.userId)).ok).toBe(false);
    const edit = { ...paciente(igor.userId), id: "p-beatriz", name: "Beatriz N." };
    expect(r.step(igor, edit).ok).toBe(false);
    expect(r.step(igor, paciente(igor.userId)).ok).toBe(true);
  });

  it("recepção e profissional não criam negociação", () => {
    const { clinica, julia, helena } = setup();
    const deal = (ownerId: string) => ({
      type: "deal.save",
      clientId: "p-beatriz",
      title: "Pacote de sessões",
      valueCents: 80000,
      ownerId,
      expectedClose: null,
      nextAction: null,
      nextActionDate: null,
    });
    expect(applyAction(clinica, julia, deal(julia.userId), ctx()).result.ok).toBe(false);
    expect(applyAction(clinica, helena, deal(helena.userId), ctx()).result.ok).toBe(false);
  });

  it("só o administrador troca o ramo, e os dados do ramo anterior ficam guardados", () => {
    const { clinica, dona, julia } = setup();
    const r = runner(clinica);
    expect(r.step(julia, { type: "company.setSegment", segment: "geral" }).ok).toBe(false);
    expect(r.step(dona, { type: "company.setSegment", segment: "pet" }).ok).toBe(true);
    expect(r.data.company.segment).toBe("pet");
    // editar a ficha no novo ramo não apaga nascimento e convênio gravados pela clínica
    const edit = {
      type: "client.save",
      id: "p-beatriz",
      name: "Beatriz Nunes",
      email: "",
      phone: "",
      ownerId: "u-helena",
      extra: { endereco: "Rua das Flores, 10" },
    };
    expect(r.step(dona, edit)).toMatchObject({ ok: true, message: "Tutor Beatriz Nunes atualizado." });
    expect(r.data.clients.find((c) => c.id === "p-beatriz")!.extra).toEqual({
      nascimento: "1991-03-14",
      convenio: "Particular",
      endereco: "Rua das Flores, 10",
    });
  });
});

describe("pet shop (prévia)", () => {
  const pet = (clientId: string, over: Record<string, unknown> = {}) => ({
    type: "item.save",
    clientId,
    kind: "pet",
    name: "Luna",
    details: { especie: "Cão", porte: "Médio" },
    alert: "",
    ...over,
  });

  it("a atendente cadastra, edita e arquiva o pet de qualquer tutor", () => {
    const { pet: shop, karina } = setup();
    const r = runner(shop);
    const saved = r.step(karina, pet("t-simone"));
    expect(saved.ok).toBe(true);
    const id = (saved as { id: string }).id;
    expect(r.step(karina, pet("t-simone", { id, alert: "Morde ao cortar as unhas." })).ok).toBe(true);
    expect(r.data.items.find((i) => i.id === id)).toMatchObject({
      clientId: "t-simone",
      alert: "Morde ao cortar as unhas.",
      details: { especie: "Cão", porte: "Médio" },
      active: true,
    });
    expect(r.step(karina, { type: "item.setActive", id, active: false }).ok).toBe(true);
    expect(r.data.items.find((i) => i.id === id)!.active).toBe(false);
    // dados inválidos são recusados com o campo indicado
    const bad = r.step(karina, pet("t-simone", { details: { especie: "Dragão" } }));
    expect(!bad.ok && bad.fieldErrors?.["details.especie"]).toBeTruthy();
    expect(r.step(karina, pet("t-simone", { name: "" })).ok).toBe(false);
  });

  it("o banhista só cadastra pets dos próprios tutores; vê os de quem atende; o caixa vê todos", () => {
    const { pet: shop, leandro, marcos } = setup();
    // os três pets são de tutores da atendente, mas Leandro atende Thor e Bob na agenda
    expect(
      visibleData(shop, leandro)
        .clients.map((c) => c.id)
        .sort(),
    ).toEqual(["t-paula", "t-rogerio", "t-simone"]);
    expect(visibleData(shop, leandro).items).toHaveLength(3);
    expect(visibleData(shop, marcos).items).toHaveLength(3);
    expect(applyAction(shop, leandro, pet("t-paula"), ctx()).result.ok).toBe(false);
    expect(applyAction(shop, leandro, pet("t-simone"), ctx()).result.ok).toBe(true);
    expect(applyAction(shop, leandro, { type: "item.setActive", id: "i-thor", active: false }, ctx()).result.ok).toBe(
      false,
    );
  });

  it("empresa de outro ramo não cadastra pet", () => {
    const { clinica, aurora, dona } = setup();
    expect(applyAction(clinica, dona, pet("p-beatriz"), ctx()).result.ok).toBe(false);
    const ana = aurora.members.find((m) => m.userId === "u-ana")!;
    expect(applyAction(aurora, ana, pet("c-marina"), ctx()).result.ok).toBe(false);
  });
});
