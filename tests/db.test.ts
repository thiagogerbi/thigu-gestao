/**
 * Testa as migrações SQL num Postgres real (PGlite = Postgres compilado para WebAssembly).
 * O esquema "auth" do Supabase é simulado aqui com o mínimo necessário (auth.users e auth.uid()).
 * Limitação: PGlite tem uma única conexão, então concorrência real (duas sessões ao mesmo tempo)
 * NÃO é exercitada; testamos reenvio/idempotência e as travas FOR UPDATE ficam documentadas.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const db = new PGlite({ extensions: { pgcrypto } });
const U = {
  ana: randomUUID(),
  vend: randomUUID(),
  fin: randomUUID(),
  outro: randomUUID(),
  equipe: randomUUID(), // equipe Thigu: gera códigos de ativação
  novo: randomUUID(), // cliente novo, usado nos testes de ativação
};
let A = ""; // empresa Aurora
let B = ""; // empresa de outro dono

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.exec("set role authenticated");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows;
/** A equipe Thigu gera um código (como depois da compra) e devolve o texto que iria por e-mail. */
async function issueCode(
  email: string | null,
  accessDays = 365,
  validDays = 30,
): Promise<{ id: string; code: string }> {
  return (
    await as(U.equipe, () =>
      one<{ r: { id: string; code: string } }>(
        "select public.generate_activation_code('Cliente de teste', $1, $2, $3) as r",
        [email, accessDays, validDays],
      ),
    )
  ).r;
}

type Redeem = { ok: boolean; company_id?: string; access_until?: string; field?: string; message?: string };
const createCompany = (user: string, name: string, code: string) =>
  as(user, async () => (await one<{ r: Redeem }>("select public.create_company($1, $2) as r", [name, code])).r);

const plan3 = JSON.stringify([
  { number: 1, amount_cents: 50000, due_date: "2026-11-20" },
  { number: 2, amount_cents: 50000, due_date: "2026-12-20" },
  { number: 3, amount_cents: 50000, due_date: "2027-01-20" },
]);

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
  `);
  const dir = path.resolve(__dirname, "../supabase/migrations");
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  for (const [k, id] of Object.entries(U)) {
    await db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
      id,
      `${k}@exemplo.test`,
      JSON.stringify({ full_name: k }),
    ]);
  }
  await db.query("insert into public.platform_admins (user_id) values ($1)", [U.equipe]);
  A = (await createCompany(U.ana, "Aurora Estúdio", (await issueCode("ana@exemplo.test")).code)).company_id!;
  B = (await createCompany(U.outro, "Horizonte Serviços", (await issueCode(null)).code)).company_id!;
  await as(U.ana, async () => {
    await db.query("select public.add_member_by_email($1, 'vend@exemplo.test', array['vendedor']::app_role[])", [A]);
    await db.query("select public.add_member_by_email($1, 'fin@exemplo.test', array['financeiro']::app_role[])", [A]);
  });
}, 120_000);

describe("caso de aceitação no banco", () => {
  let clientId = "";
  let dealId = "";
  let saleId = "";
  let firstAccount = "";

  it("perfil criado automaticamente e empresa com dono administrador", async () => {
    expect((await one<{ c: number }>("select count(*)::int c from profiles")).c).toBe(Object.keys(U).length);
    const m = await one<{ roles: string }>(
      "select roles::text from memberships where company_id = $1 and user_id = $2",
      [A, U.ana],
    );
    expect(m.roles).toBe("{admin}");
  });

  it("1–2. vendedor cadastra cliente, negociação e propõe 3 parcelas de R$ 500", async () => {
    await as(U.vend, async () => {
      clientId = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Marina Costa', $2) returning id",
          [A, U.vend],
        )
      ).id;
      dealId = (
        await one<{ id: string }>(
          "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Identidade visual', 150000, $3) returning id",
          [A, clientId, U.vend],
        )
      ).id;
      // não pode marcar "ganha" direto, sem passar pelo fechamento
      await expect(db.query("update deals set stage = 'ganha' where id = $1", [dealId])).rejects.toThrow(
        /fechamento de venda/,
      );
      const req = randomUUID();
      const r = await one<{ r: { sale_id: string } }>(
        "select public.close_sale($1, null, 150000, 'parcelado', $2::jsonb, $3) as r",
        [dealId, plan3, req],
      );
      saleId = r.r.sale_id;
      // reenvio do mesmo pedido não cria segunda venda
      const again = await one<{ r: { sale_id: string; duplicate: boolean } }>(
        "select public.close_sale($1, null, 150000, 'parcelado', $2::jsonb, $3) as r",
        [dealId, plan3, req],
      );
      expect(again.r).toMatchObject({ sale_id: saleId, duplicate: true });
    });
    expect((await one<{ stage: string }>("select stage::text from deals where id = $1", [dealId])).stage).toBe("ganha");
  });

  it("soma das parcelas diferente do total é recusada", async () => {
    await as(U.ana, async () => {
      const c = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Teste Soma', $2) returning id",
          [A, U.ana],
        )
      ).id;
      const d = (
        await one<{ id: string }>(
          "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Teste de soma', 10000, $3) returning id",
          [A, c, U.ana],
        )
      ).id;
      const bad = JSON.stringify([
        { number: 1, amount_cents: 3333, due_date: "2026-12-01" },
        { number: 2, amount_cents: 3333, due_date: "2027-01-01" },
        { number: 3, amount_cents: 3333, due_date: "2027-02-01" },
      ]);
      await expect(
        db.query("select public.close_sale($1, null, 10000, 'parcelado', $2::jsonb, $3)", [d, bad, randomUUID()]),
      ).rejects.toThrow(/soma das parcelas/);
    });
  });

  it("9. vendedor NÃO confirma parcelas", async () => {
    await as(U.vend, async () => {
      await expect(db.query("select public.confirm_sale($1, $2::jsonb)", [saleId, plan3])).rejects.toThrow(
        /financeiro ou o dono/,
      );
    });
    expect((await one<{ c: number }>("select count(*)::int c from accounts where sale_id = $1", [saleId])).c).toBe(0);
  });

  it("3 e 7. financeiro cria 3 contas vinculadas; repetir não duplica", async () => {
    await as(U.fin, async () => {
      const r = await one<{ r: { created: number } }>("select public.confirm_sale($1, $2::jsonb) as r", [
        saleId,
        plan3,
      ]);
      expect(r.r.created).toBe(3);
      const again = await one<{ r: { created: number; duplicate: boolean } }>(
        "select public.confirm_sale($1, $2::jsonb) as r",
        [saleId, plan3],
      );
      expect(again.r).toMatchObject({ created: 0, duplicate: true });
      const accs = await rows<{ id: string; amount_cents: number; installment_number: number; client_id: string }>(
        "select id, amount_cents::int, installment_number, client_id from accounts where sale_id = $1 order by installment_number",
        [saleId],
      );
      expect(accs.map((a) => a.amount_cents)).toEqual([50000, 50000, 50000]);
      expect(accs.every((a) => a.client_id === clientId)).toBe(true);
      firstAccount = accs[0].id;
    });
    // índice único impede parcela duplicada mesmo por inserção direta privilegiada
    await expect(
      db.query(
        "insert into accounts (company_id, kind, client_id, description, origin, sale_id, installment_number, installment_count, amount_cents, due_date, created_by) values ($1,'receber',$2,'dup','venda',$3,1,3,50000,'2026-11-20',$4)",
        [A, clientId, saleId, U.fin],
      ),
    ).rejects.toThrow();
  });

  it("4–5. recebimento de R$ 200 deixa a 1ª parcela parcial com R$ 300 de saldo; acima do saldo é recusado", async () => {
    await as(U.fin, async () => {
      await expect(
        db.query("select public.register_movement($1, 60000, '2026-11-10', 'pix', $2)", [firstAccount, randomUUID()]),
      ).rejects.toThrow(/R\$ 500,00/);
      const req = randomUUID();
      const r = await one<{ r: { remaining_cents: number } }>(
        "select public.register_movement($1, 20000, '2026-11-10', 'pix', $2) as r",
        [firstAccount, req],
      );
      expect(r.r.remaining_cents).toBe(30000);
      const dup = await one<{ r: { duplicate: boolean } }>(
        "select public.register_movement($1, 20000, '2026-11-10', 'pix', $2) as r",
        [firstAccount, req],
      );
      expect(dup.r.duplicate).toBe(true);
      expect(
        (await one<{ c: number }>("select count(*)::int c from movements where account_id = $1", [firstAccount])).c,
      ).toBe(1);
    });
  });

  it("6. painel: R$ 1.500 vendidos, R$ 200 recebidos, R$ 1.300 a receber", async () => {
    await as(U.fin, async () => {
      const r = await one<{ sold: number; received: number; open: number }>(
        `
        select
          (select coalesce(sum(total_cents),0)::int from sales where company_id = $1 and status <> 'cancelada') as sold,
          (select coalesce(sum(amount_cents),0)::int from movements where company_id = $1 and direction = 'entrada' and undone_at is null) as received,
          (select coalesce(sum(a.amount_cents - coalesce((select sum(m.amount_cents) from movements m where m.account_id = a.id and m.undone_at is null),0)),0)::int
             from accounts a where a.company_id = $1 and a.kind = 'receber' and a.canceled_at is null) as open`,
        [A],
      );
      expect(r).toEqual({ sold: 150000, received: 20000, open: 130000 });
    });
  });

  it("8. usuário de outra empresa não consulta nem altera", async () => {
    await as(U.outro, async () => {
      expect(await rows("select * from clients where company_id = $1", [A])).toHaveLength(0);
      expect(await rows("select * from accounts where company_id = $1", [A])).toHaveLength(0);
      expect(await rows("select * from sales where company_id = $1", [A])).toHaveLength(0);
      expect(await rows("select * from movements")).toHaveLength(0);
      const upd = await db.query("update clients set name = 'invadido' where id = $1", [clientId]);
      expect(upd.affectedRows ?? 0).toBe(0);
      await expect(
        db.query("select public.register_movement($1, 100, '2026-11-10', 'pix', $2)", [firstAccount, randomUUID()]),
      ).rejects.toThrow();
      await expect(db.query("select public.confirm_sale($1, $2::jsonb)", [saleId, plan3])).rejects.toThrow();
      await expect(
        db.query("insert into clients (company_id, name, owner_id) values ($1, 'Intruso', $2)", [A, U.outro]),
      ).rejects.toThrow();
      // relacionar registro da própria empresa com cliente de outra empresa: barrado
      await expect(
        db.query(
          "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'cruzado', 1, $3)",
          [B, clientId, U.outro],
        ),
      ).rejects.toThrow();
    });
    expect((await one<{ name: string }>("select name from clients where id = $1", [clientId])).name).toBe(
      "Marina Costa",
    );
  });

  it("chave composta impede misturar empresas mesmo sem RLS", async () => {
    const bClient = (
      await one<{ id: string }>(
        "insert into clients (company_id, name, owner_id) values ($1, 'Cliente B', $2) returning id",
        [B, U.outro],
      )
    ).id;
    await expect(
      db.query(
        "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Cruzado', 1, $3)",
        [A, bClient, U.vend],
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("vendedor não vê contas a pagar, não lança despesas nem registra recebimento", async () => {
    await as(U.ana, () =>
      db.query(
        "insert into accounts (company_id, kind, description, origin, amount_cents, due_date, created_by, category) values ($1, 'pagar', 'Aluguel', 'despesa', 180000, '2026-11-15', $2, 'Aluguel')",
        [A, U.ana],
      ),
    );
    await as(U.vend, async () => {
      const visible = await rows<{ kind: string }>("select kind::text from accounts where company_id = $1", [A]);
      expect(visible.length).toBe(3);
      expect(visible.every((a) => a.kind === "receber")).toBe(true);
      await expect(
        db.query(
          "insert into accounts (company_id, kind, description, origin, amount_cents, due_date, created_by) values ($1, 'pagar', 'x', 'despesa', 100, '2026-11-15', $2)",
          [A, U.vend],
        ),
      ).rejects.toThrow();
      await expect(
        db.query("select public.register_movement($1, 100, '2026-11-10', 'pix', $2)", [firstAccount, randomUUID()]),
      ).rejects.toThrow(/financeiro ou o dono/);
    });
  });

  it("histórico preservado: desfazer mantém o registro; não é possível apagar", async () => {
    const mv = (await one<{ id: string }>("select id from movements where account_id = $1", [firstAccount])).id;
    await as(U.fin, async () => {
      await db.query("select public.undo_movement($1, 'Lançado em duplicidade')", [mv]);
      await expect(db.query("delete from movements where id = $1", [mv])).rejects.toThrow();
      await expect(db.query("update movements set amount_cents = 1 where id = $1", [mv])).rejects.toThrow();
    });
    const m = await one<{ undone_at: string | null; amount_cents: number }>(
      "select undone_at, amount_cents::int from movements where id = $1",
      [mv],
    );
    expect(m.undone_at).not.toBeNull();
    expect(m.amount_cents).toBe(20000);
    await expect(db.query("delete from movements where id = $1", [mv])).rejects.toThrow(/não pode ser apagado/);
  });

  it("dono faz o fluxo inteiro sozinho com a mesma conta", async () => {
    await as(U.ana, async () => {
      const c = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Pedro', $2) returning id",
          [A, U.ana],
        )
      ).id;
      const d = (
        await one<{ id: string }>(
          "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Logo', 10000, $3) returning id",
          [A, c, U.ana],
        )
      ).id;
      const p = JSON.stringify([{ number: 1, amount_cents: 10000, due_date: "2026-11-30" }]);
      const s = (
        await one<{ r: { sale_id: string } }>(
          "select public.close_sale($1, null, 10000, 'avista', $2::jsonb, $3) as r",
          [d, p, randomUUID()],
        )
      ).r.sale_id;
      expect(
        (await one<{ r: { created: number } }>("select public.confirm_sale($1, $2::jsonb) as r", [s, p])).r.created,
      ).toBe(1);
      const acc = (await one<{ id: string }>("select id from accounts where sale_id = $1", [s])).id;
      expect(
        (
          await one<{ r: { remaining_cents: number } }>(
            "select public.register_movement($1, 10000, '2026-11-10', 'dinheiro', $2) as r",
            [acc, randomUUID()],
          )
        ).r.remaining_cents,
      ).toBe(0);
    });
  });

  it("propostas: numeração, aceite atualiza valor só quando pedido", async () => {
    await as(U.vend, async () => {
      const c = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'João', $2) returning id",
          [A, U.vend],
        )
      ).id;
      const d = (
        await one<{ id: string }>(
          "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Cardápio', 200000, $3) returning id",
          [A, c, U.vend],
        )
      ).id;
      const items = JSON.stringify([
        { description: "Design", quantity: 1, unit_cents: 180000 },
        { description: "Fotos", quantity: 8, unit_cents: 10000 },
      ]);
      const pid = (
        await one<{ id: string }>(
          "select public.save_proposal($1, null, $2, $3, $4::jsonb, 20000, '2026-12-01', 'Prazo 15 dias') as id",
          [A, d, c, items],
        )
      ).id;
      expect((await one<{ number: number }>("select number from proposals where id = $1", [pid])).number).toBe(1);
      const sent = await one<{ r: { task_id: string } }>("select public.proposal_mark_sent($1, true) as r", [pid]);
      expect(sent.r.task_id).toBeTruthy();
      await db.query("select public.proposal_accept($1, true)", [pid]);
      expect((await one<{ v: number }>("select value_cents::int v from deals where id = $1", [d])).v).toBe(240000);
      // proposta aceita não pode mais ser editada diretamente
      const upd = await db.query("update proposals set discount_cents = 0 where id = $1", [pid]);
      expect(upd.affectedRows ?? 0).toBe(0);
    });
  });
  it("dados da empresa: só o administrador altera, e só as colunas permitidas", async () => {
    await as(U.ana, async () => {
      await db.query(
        "update companies set legal_name = 'Aurora Ltda.', document = '12ABC34501DE35', brand_color = '#0f766e', logo_data_url = 'data:image/png;base64,iVBORw0KGgo=' where id = $1",
        [A],
      );
      // created_by não pode ser trocado pelo administrador
      await expect(db.query("update companies set created_by = $2 where id = $1", [A, U.outro])).rejects.toThrow();
      // formatos inválidos barrados pelo banco
      await expect(db.query("update companies set brand_color = 'red' where id = $1", [A])).rejects.toThrow();
      await db.query("update companies set menu_color = '#1f2937' where id = $1", [A]);
      await expect(db.query("update companies set menu_color = 'blue' where id = $1", [A])).rejects.toThrow();
      await expect(
        db.query("update companies set logo_data_url = 'data:image/svg+xml;base64,PHN2Zz4=' where id = $1", [A]),
      ).rejects.toThrow();
      await expect(db.query("update companies set document = '12.345' where id = $1", [A])).rejects.toThrow();
    });
    await as(U.vend, async () => {
      const upd = await db.query("update companies set name = 'Invadida' where id = $1", [A]);
      expect(upd.affectedRows ?? 0).toBe(0);
    });
    await as(U.outro, async () => {
      expect(await rows("select * from companies where id = $1", [A])).toHaveLength(0);
    });
    const co = await one<{ name: string; legal_name: string; brand_color: string }>(
      "select name, legal_name, brand_color from companies where id = $1",
      [A],
    );
    expect(co).toMatchObject({ name: "Aurora Estúdio", legal_name: "Aurora Ltda.", brand_color: "#0f766e" });
  });
});

describe("ativação por código (empresa só existe depois da compra)", () => {
  it("sem código válido não é possível criar empresa", async () => {
    const r = await createCompany(U.novo, "Loja Nova", "THIGU-AAAA-BBBB-CCCC");
    expect(r.ok).toBe(false);
    expect(r.field).toBe("code");
    expect(r.message).toMatch(/não encontrado/);
    const n = await one<{ c: number }>("select count(*)::int c from companies where name = 'Loja Nova'");
    expect(n.c).toBe(0);
  });

  it("código válido cria a empresa, com o comprador como administrador e prazo de acesso", async () => {
    const { code } = await issueCode("novo@exemplo.test", 30);
    // a pessoa pode digitar com espaços e minúsculas
    const typed = code.toLowerCase().replaceAll("-", " ");
    const r = await createCompany(U.novo, "Loja Nova", typed);
    expect(r.ok).toBe(true);
    const co = await one<{ access_until: string; days: number }>(
      "select access_until::text, (access_until - public._today())::int as days from companies where id = $1",
      [r.company_id],
    );
    expect(co.days).toBe(30);
    const m = await one<{ roles: string }>(
      "select roles::text from memberships where company_id = $1 and user_id = $2",
      [r.company_id, U.novo],
    );
    expect(m.roles).toBe("{admin}");

    // uso único
    const again = await createCompany(U.novo, "Outra Loja", code);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/já foi usado/);
  });

  it("o código fica preso ao e-mail do comprador", async () => {
    const { code } = await issueCode("comprador@empresa.test");
    const r = await createCompany(U.outro, "Empresa Errada", code);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/c\*\*\*@empresa\.test/);
  });

  it("código vencido ou cancelado não funciona", async () => {
    const venc = await issueCode(null);
    await db.query("update activation_codes set valid_until = public._today() - 1 where id = $1", [venc.id]);
    expect((await createCompany(U.vend, "X Ltda", venc.code)).message).toMatch(/venceu/);

    const canc = await issueCode(null);
    await as(U.equipe, () => db.query("select public.revoke_activation_code($1)", [canc.id]));
    expect((await createCompany(U.vend, "X Ltda", canc.code)).message).toMatch(/cancelado/);
  });

  it("após 5 erros em 15 minutos, bloqueia novas tentativas (mesmo com código certo)", async () => {
    const quem = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, 'tentativas@exemplo.test')", [quem]);
    for (let i = 0; i < 5; i++) await createCompany(quem, "Tentativa", `THIGU-ERRA-DO00-000${i}`);
    const { code } = await issueCode(null);
    const r = await createCompany(quem, "Tentativa", code);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Muitas tentativas/);
    // as 5 tentativas erradas ficam registradas (não são desfeitas com o erro);
    // a tentativa feita durante o bloqueio não conta de novo, para o bloqueio não se estender sem fim
    const n = await one<{ c: number }>(
      "select count(*)::int c from activation_attempts where user_id = $1 and not succeeded",
      [quem],
    );
    expect(n.c).toBe(5);
  });

  it("só a equipe Thigu gera e enxerga códigos; o código não fica guardado", async () => {
    await as(U.ana, async () => {
      await expect(db.query("select public.generate_activation_code('X', null, 30)")).rejects.toThrow(/equipe Thigu/);
      expect(await rows("select * from activation_codes")).toHaveLength(0);
      expect(await rows("select * from platform_admins")).toHaveLength(0);
    });
    const { id, code } = await issueCode(null);
    const saved = await one<{ code_hash: string; code_hint: string }>(
      "select code_hash, code_hint from activation_codes where id = $1",
      [id],
    );
    expect(saved.code_hash).not.toContain(code.replaceAll("-", ""));
    expect(code.endsWith(saved.code_hint)).toBe(true);
    // painel: a equipe vê a lista com o nome da empresa que usou cada código; clientes não
    const list = await as(U.equipe, () =>
      rows<{ company_name: string | null }>("select * from public.list_activation_codes()"),
    );
    expect(list.some((r) => r.company_name === "Aurora Estúdio")).toBe(true);
    await as(U.ana, async () => {
      await expect(db.query("select * from public.list_activation_codes()")).rejects.toThrow(/equipe Thigu/);
    });
    expect(code).toMatch(/^THIGU-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("empresa vencida fica somente leitura; renovar com novo código libera de novo", async () => {
    await db.query("update companies set access_until = public._today() - 1 where id = $1", [A]);
    await as(U.ana, async () => {
      // consultar continua funcionando
      expect((await rows("select id from clients where company_id = $1", [A])).length).toBeGreaterThan(0);
      // registrar algo novo é bloqueado, inclusive dentro das funções do sistema
      await expect(
        db.query("insert into clients (company_id, name, owner_id) values ($1, 'Bloqueado', $2)", [A, U.ana]),
      ).rejects.toThrow(/acesso desta empresa venceu/);
      // o cliente não consegue estender o próprio prazo editando a empresa
      await expect(db.query("update companies set access_until = '2099-01-01' where id = $1", [A])).rejects.toThrow();
    });
    await as(U.fin, async () => {
      const acc = await one<{ id: string }>(
        "select id from accounts where company_id = $1 and kind = 'receber' and canceled_at is null limit 1",
        [A],
      );
      await expect(
        db.query("select public.register_movement($1, 100, public._today(), 'pix', $2)", [acc.id, randomUUID()]),
      ).rejects.toThrow(/venceu/);
    });

    // só o administrador renova
    const { code } = await issueCode(null, 365);
    await as(U.vend, async () => {
      await expect(db.query("select public.apply_activation_code($1, $2)", [A, code])).rejects.toThrow(/administrador/);
    });
    const r = await as(
      U.ana,
      async () => (await one<{ r: Redeem }>("select public.apply_activation_code($1, $2) as r", [A, code])).r,
    );
    expect(r.ok).toBe(true);
    const days = await one<{ d: number }>(
      "select (access_until - public._today())::int d from companies where id = $1",
      [A],
    );
    expect(days.d).toBe(365);
    await as(U.ana, () =>
      db.query("insert into clients (company_id, name, owner_id) values ($1, 'Liberado', $2)", [A, U.ana]),
    );
  });
});
