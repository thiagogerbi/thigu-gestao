/**
 * Testa as migrações SQL num Postgres real (PGlite = Postgres compilado para WebAssembly).
 * O esquema "auth" do Supabase é simulado aqui com o mínimo necessário (auth.users e auth.uid()).
 * No Supabase, email_confirmed_at só é preenchido quando o e-mail é confirmado; aqui o padrão é "confirmado"
 * para os usuários de teste, e os testes de convite criam um usuário sem confirmação de propósito.
 * Limitação: PGlite tem uma única conexão, então concorrência real (duas sessões ao mesmo tempo)
 * NÃO é exercitada; testamos reenvio/idempotência e as travas FOR UPDATE ficam documentadas.
 */
import { MODULE_IDS, MODULES, SEGMENT_IDS, SEGMENTS } from "@/lib/domain/segments";
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
/** O administrador convida e a pessoa aceita: o vínculo com a empresa só existe depois do aceite. */
async function invite(company: string, admin: string, email: string, roles: string) {
  return (
    await as(admin, () =>
      one<{ id: string }>("select public.invite_member($1, $2, $3::app_role[]) as id", [company, email, roles]),
    )
  ).id;
}
async function inviteAndAccept(company: string, admin: string, email: string, roles: string, user: string) {
  const id = await invite(company, admin, email, roles);
  await as(user, () => db.query("select public.respond_invite($1, true)", [id]));
  return id;
}
async function newUser(email: string, confirmed = true) {
  const id = randomUUID();
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, $2, '{}', case when $3 then now() end)",
    [id, email, confirmed],
  );
  return id;
}
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
const createCompany = (user: string, name: string, code: string, segment = "geral") =>
  as(
    user,
    async () =>
      (
        await one<{ r: Redeem }>("select public.create_company($1, $2, $3::company_segment) as r", [
          name,
          code,
          segment,
        ])
      ).r,
  );
/** Empresa de teste já ativada: a equipe Thigu gera o código e a pessoa cria a empresa no ramo pedido. */
async function newCompany(user: string, name: string, segment = "geral") {
  const r = await createCompany(user, name, (await issueCode(null)).code, segment);
  if (!r.ok) throw new Error(r.message);
  return r.company_id!;
}

const plan3 = JSON.stringify([
  { number: 1, amount_cents: 50000, due_date: "2026-11-20" },
  { number: 2, amount_cents: 50000, due_date: "2026-12-20" },
  { number: 3, amount_cents: 50000, due_date: "2027-01-20" },
]);

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz default now());
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    -- No Supabase, tudo o que nasce no schema public vem aberto para anon e authenticated.
    -- O teste imita isso para as migrações serem testadas no mesmo ponto de partida do banco real.
    grant usage on schema public to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on sequences to anon, authenticated;
    alter default privileges in schema public grant execute on functions to anon, authenticated;
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
  await inviteAndAccept(A, U.ana, "vend@exemplo.test", "{vendedor}", U.vend);
  await inviteAndAccept(A, U.ana, "fin@exemplo.test", "{financeiro}", U.fin);
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
      // proposta não é editada diretamente na tabela (só pelas funções)
      await expect(db.query("update proposals set discount_cents = 0 where id = $1", [pid])).rejects.toThrow(
        /permission denied/i,
      );
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

// Brechas fechadas em 20261114000004_security_fixes.sql. Todas valiam para quem chama o banco
// direto com a própria sessão, sem passar pela interface.
describe("correções de permissão", () => {
  const newClientAndDeal = (owner: string, clientOwner = owner) =>
    as(U.ana, async () => {
      const c = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, email, phone, owner_id) values ($1, 'Cliente', 'cliente@exemplo.test', '11999990000', $2) returning id",
          [A, clientOwner],
        )
      ).id;
      const d = (
        await one<{ id: string }>(
          "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Projeto', 150000, $3) returning id",
          [A, c, owner],
        )
      ).id;
      return { c, d };
    });

  it("ninguém recebe o convite de outra pessoa trocando o e-mail do próprio perfil", async () => {
    const intruso = await newUser("intruso@exemplo.test");
    await as(intruso, async () => {
      await expect(
        db.query("update profiles set email = 'paula@aurora.test' where user_id = $1", [intruso]),
      ).rejects.toThrow(/permission denied/i);
      // o próprio nome continua editável
      await db.query("update profiles set full_name = 'Intruso' where user_id = $1", [intruso]);
    });
    const paulaInvite = await invite(A, U.ana, "paula@aurora.test", "{financeiro}");
    await as(intruso, async () => {
      expect(await rows("select * from public.my_invites()")).toHaveLength(0);
      await expect(db.query("select public.respond_invite($1, true)", [paulaInvite])).rejects.toThrow(
        /Convite não encontrado/,
      );
    });
    expect(await rows("select 1 from memberships where user_id = $1", [intruso])).toHaveLength(0);

    // troca de e-mail feita pelo Auth chega ao perfil
    await db.query("update auth.users set email = 'novo@exemplo.test' where id = $1", [intruso]);
    expect((await one<{ email: string }>("select email from profiles where user_id = $1", [intruso])).email).toBe(
      "novo@exemplo.test",
    );
  });

  it("venda não é fechada com parcela sem número, valor ou vencimento", async () => {
    const { d } = await newClientAndDeal(U.vend);
    const incomplete = [
      [{ number: 1, due_date: "2026-12-01" }],
      [{ amount_cents: 150000, due_date: "2026-12-01" }],
      [{ number: 1, amount_cents: 150000 }],
      [{ number: 1, amount_cents: null, due_date: "2026-12-01" }],
      [150000],
    ];
    await as(U.vend, async () => {
      for (const p of incomplete) {
        await expect(
          db.query("select public.close_sale($1, null, 150000, 'avista', $2::jsonb, $3)", [
            d,
            JSON.stringify(p),
            randomUUID(),
          ]),
        ).rejects.toThrow(/número, valor e vencimento/);
      }
    });
    expect(await rows("select 1 from sales where deal_id = $1", [d])).toHaveLength(0);
  });

  it("vendedor não aponta a própria negociação para um cliente que não vê", async () => {
    const mine = await newClientAndDeal(U.vend);
    const hidden = await newClientAndDeal(U.ana);
    await as(U.vend, async () => {
      expect(await rows("select 1 from clients where id = $1", [hidden.c])).toHaveLength(0);
      await expect(db.query("update deals set client_id = $1 where id = $2", [hidden.c, mine.d])).rejects.toThrow(
        /row-level security/i,
      );
      expect(await rows("select 1 from clients where id = $1", [hidden.c])).toHaveLength(0);
    });
    // continua editando a negociação quando só enxerga o cliente por causa dela
    const shared = await newClientAndDeal(U.vend, U.ana);
    await as(U.vend, async () => {
      const upd = await db.query("update deals set title = 'Projeto revisado' where id = $1", [shared.d]);
      expect(upd.affectedRows).toBe(1);
    });
  });

  it("proposta e itens só são gravados pelas funções", async () => {
    const { c, d } = await newClientAndDeal(U.vend);
    const item = JSON.stringify([{ description: "Item", quantity: 1, unit_cents: 10000 }]);
    await as(U.vend, async () => {
      const pid = (
        await one<{ id: string }>(
          "select public.save_proposal($1, null, $2, $3, $4::jsonb, 0, '2027-01-01', '') as id",
          [A, d, c, item],
        )
      ).id;
      await expect(db.query("update proposals set discount_cents = 500000 where id = $1", [pid])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        db.query(
          "insert into proposals (company_id, number, client_id, deal_id, valid_until, created_by) values ($1, 999, $2, $3, '2027-01-01', $4)",
          [A, c, d, U.vend],
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(db.query("delete from proposal_items where proposal_id = $1", [pid])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(db.query("update proposal_items set unit_cents = 1 where proposal_id = $1", [pid])).rejects.toThrow(
        /permission denied/i,
      );
      // pela função, o desconto acima do subtotal continua recusado e a edição normal funciona
      await expect(
        db.query("select public.save_proposal($1, $2, $3, $4, $5::jsonb, 500000, '2027-01-01', '')", [
          A,
          pid,
          d,
          c,
          item,
        ]),
      ).rejects.toThrow(/desconto/);
      await db.query("select public.save_proposal($1, $2, $3, $4, $5::jsonb, 2000, '2027-01-01', '')", [
        A,
        pid,
        d,
        c,
        item,
      ]);
      expect((await one<{ v: number }>("select discount_cents::int v from proposals where id = $1", [pid])).v).toBe(
        2000,
      );
    });
  });
});

// 20261114000005_invites.sql: ninguém entra numa empresa sem aceitar o convite.
describe("convites", () => {
  let carla = "";
  const member = (user: string) =>
    one<{ roles: string; active: boolean }>(
      "select roles::text, active from memberships where company_id = $1 and user_id = $2",
      [A, user],
    );

  beforeAll(async () => {
    carla = await newUser("carla@aurora.test");
  });

  it("o vínculo só existe depois que a pessoa aceita", async () => {
    // maiúsculas e espaços no e-mail digitado não atrapalham
    const id = await invite(A, U.ana, "  Carla@Aurora.test ", "{financeiro}");
    expect(await member(carla)).toBeUndefined();

    // o administrador vê o convite em aberto; quem não é administrador não lê a tabela
    expect(await as(U.ana, () => rows("select 1 from invites where id = $1", [id]))).toHaveLength(1);
    expect(await as(U.vend, () => rows("select 1 from invites where id = $1", [id]))).toHaveLength(0);
    expect(await as(carla, () => rows("select 1 from invites where id = $1", [id]))).toHaveLength(0);

    await as(carla, async () => {
      const mine = await rows<{ id: string; company_name: string; roles: string; invited_by_name: string }>(
        "select id, company_name, roles::text, invited_by_name from public.my_invites()",
      );
      expect(mine).toEqual([{ id, company_name: "Aurora Estúdio", roles: "{financeiro}", invited_by_name: "ana" }]);
      // antes de aceitar, a empresa não aparece para ela
      expect(await rows("select 1 from companies where id = $1", [A])).toHaveLength(0);
      await db.query("select public.respond_invite($1, true)", [id]);
      expect(await rows("select 1 from companies where id = $1", [A])).toHaveLength(1);
      expect(await rows("select * from public.my_invites()")).toHaveLength(0);
      await expect(db.query("select public.respond_invite($1, true)", [id])).rejects.toThrow(/já foi respondido/);
    });
    expect(await member(carla)).toEqual({ roles: "{financeiro}", active: true });
  });

  it("convidar de novo só atualiza os papéis do convite em aberto", async () => {
    const first = await invite(A, U.ana, "duda@exemplo.test", "{vendedor}");
    const second = await invite(A, U.ana, "duda@exemplo.test", "{vendedor,gestor}");
    expect(second).toBe(first);
    const pending = await rows<{ roles: string }>(
      "select roles::text from invites where company_id = $1 and email = 'duda@exemplo.test' and status = 'pendente'",
      [A],
    );
    expect(pending).toEqual([{ roles: "{vendedor,gestor}" }]);
  });

  it("o convite espera quem ainda não tem conta", async () => {
    const id = await invite(A, U.ana, "novato@exemplo.test", "{vendedor}");
    const novato = await newUser("novato@exemplo.test");
    await as(novato, async () => {
      expect(await rows("select * from public.my_invites()")).toHaveLength(1);
      await db.query("select public.respond_invite($1, true)", [id]);
    });
    expect(await member(novato)).toEqual({ roles: "{vendedor}", active: true });
  });

  it("e-mail não confirmado não vê nem aceita convite", async () => {
    const id = await invite(A, U.ana, "pendente@exemplo.test", "{financeiro}");
    // alguém cria uma conta com o e-mail convidado, mas não confirma que o e-mail é dele
    const impostor = await newUser("pendente@exemplo.test", false);
    await as(impostor, async () => {
      expect(await rows("select * from public.my_invites()")).toHaveLength(0);
      await expect(db.query("select public.respond_invite($1, true)", [id])).rejects.toThrow(/Confirme seu e-mail/);
    });
    expect(await member(impostor)).toBeUndefined();
    // depois de confirmar, o convite vale
    await db.query("update auth.users set email_confirmed_at = now() where id = $1", [impostor]);
    await as(impostor, () => db.query("select public.respond_invite($1, true)", [id]));
    expect(await member(impostor)).toEqual({ roles: "{financeiro}", active: true });
  });

  it("recusar e cancelar não criam vínculo", async () => {
    const rita = await newUser("rita@exemplo.test");
    const refused = await invite(A, U.ana, "rita@exemplo.test", "{vendedor}");
    await as(rita, () => db.query("select public.respond_invite($1, false)", [refused]));
    expect(await member(rita)).toBeUndefined();
    expect((await one<{ status: string }>("select status::text from invites where id = $1", [refused])).status).toBe(
      "recusado",
    );

    const canceled = await invite(A, U.ana, "rita@exemplo.test", "{vendedor}");
    expect(canceled).not.toBe(refused);
    await as(U.ana, () => db.query("select public.cancel_invite($1)", [canceled]));
    await as(rita, async () => {
      expect(await rows("select * from public.my_invites()")).toHaveLength(0);
      await expect(db.query("select public.respond_invite($1, true)", [canceled])).rejects.toThrow(
        /já foi respondido ou cancelado/,
      );
    });
    expect(await member(rita)).toBeUndefined();
  });

  it("só o administrador convida e cancela; quem já é membro não recebe convite", async () => {
    const id = await invite(A, U.ana, "sol@exemplo.test", "{vendedor}");
    await as(U.vend, async () => {
      await expect(
        db.query("select public.invite_member($1, 'amigo@exemplo.test', '{admin}'::app_role[])", [A]),
      ).rejects.toThrow(/administrador/);
      await expect(db.query("select public.cancel_invite($1)", [id])).rejects.toThrow(/administrador/);
    });
    // administrador de outra empresa não convida para esta nem cancela convites daqui
    await as(U.outro, async () => {
      await expect(
        db.query("select public.invite_member($1, 'amigo@exemplo.test', '{admin}'::app_role[])", [A]),
      ).rejects.toThrow(/administrador/);
      await expect(db.query("select public.cancel_invite($1)", [id])).rejects.toThrow(/Convite não encontrado/);
    });
    await expect(invite(A, U.ana, "vend@exemplo.test", "{gestor}")).rejects.toThrow(/já faz parte/);
    await expect(invite(A, U.ana, "sem-arroba", "{gestor}")).rejects.toThrow(/E-mail inválido/);
  });

  it("quem teve o acesso removido volta só aceitando um novo convite", async () => {
    await as(U.ana, () =>
      db.query("select public.set_member_roles($1, $2, '{financeiro}'::app_role[], false)", [A, carla]),
    );
    expect(await as(carla, () => rows("select 1 from companies where id = $1", [A]))).toHaveLength(0);
    const id = await invite(A, U.ana, "carla@aurora.test", "{gestor}");
    expect((await member(carla))?.active).toBe(false);
    await as(carla, () => db.query("select public.respond_invite($1, true)", [id]));
    expect(await member(carla)).toEqual({ roles: "{gestor}", active: true });
  });

  it("a entrada direta na empresa não existe mais", async () => {
    await as(U.ana, async () => {
      await expect(
        db.query("select public.add_member_by_email($1, 'rita@exemplo.test', '{vendedor}'::app_role[])", [A]),
      ).rejects.toThrow(/does not exist/);
      await expect(
        db.query("insert into memberships (company_id, user_id, roles) values ($1, $2, '{admin}')", [A, U.outro]),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});

// Ramo, plano, módulos e os papéis recepção, profissional e caixa
// (20261114000006_segment_roles.sql e 20261114000007_segments.sql).
describe("ramos, módulos e papéis por ramo", () => {
  let P = ""; // pet shop da Ana
  let recep = "";
  let prof = "";
  let prof2 = "";
  let caixa = "";
  let tutor = ""; // cliente do profissional 1, cadastrado pela recepção
  let tutor2 = ""; // cliente do profissional 2
  let thor = "";
  let clienteA = ""; // cliente da Aurora (ramo geral)

  const count = async (sql: string, params: unknown[] = []) =>
    (await one<{ c: number }>(`select count(*)::int c from (${sql}) q`, params)).c;

  beforeAll(async () => {
    recep = await newUser("recep@pet.test");
    prof = await newUser("prof@pet.test");
    prof2 = await newUser("prof2@pet.test");
    caixa = await newUser("caixa@pet.test");
    P = await newCompany(U.ana, "Amigo Fiel", "pet");
    await inviteAndAccept(P, U.ana, "recep@pet.test", "{recepcao}", recep);
    await inviteAndAccept(P, U.ana, "prof@pet.test", "{profissional}", prof);
    await inviteAndAccept(P, U.ana, "prof2@pet.test", "{profissional}", prof2);
    await inviteAndAccept(P, U.ana, "caixa@pet.test", "{caixa}", caixa);
    clienteA = (
      await as(U.ana, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Cliente geral', $2) returning id",
          [A, U.ana],
        ),
      )
    ).id;
  });

  it("o catálogo do banco é igual ao do aplicativo", async () => {
    for (const s of SEGMENT_IDS) {
      const r = await one<{ m: string[] }>("select public._segment_modules($1::company_segment) as m", [s]);
      expect([...r.m].sort(), `módulos do ramo ${s}`).toEqual([...SEGMENTS[s].modules].sort());
    }
    for (const m of MODULE_IDS) {
      const r = await one<{ p: string }>("select public._module_min_plan($1)::text as p", [m]);
      expect(r.p, `plano mínimo de ${m}`).toBe(MODULES[m].minPlan);
    }
    // a lista de módulos extras aceita exatamente os módulos do catálogo
    await db.query("update companies set extra_modules = $2 where id = $1", [B, MODULE_IDS]);
    await expect(db.query("update companies set extra_modules = '{inexistente}' where id = $1", [B])).rejects.toThrow();
    await db.query("update companies set extra_modules = '{}' where id = $1", [B]);
  });

  it("a empresa nasce com o ramo escolhido; só o administrador troca o ramo e ninguém troca o plano", async () => {
    const co = (id: string) =>
      one<{ segment: string; plan: string }>("select segment::text, plan::text from companies where id = $1", [id]);
    expect(await co(P)).toEqual({ segment: "pet", plan: "empresa" });
    // empresas criadas sem informar o ramo (e as que já existiam) ficam no ramo geral
    expect(await co(A)).toEqual({ segment: "geral", plan: "empresa" });
    await as(U.ana, async () => {
      await db.query("update companies set segment = 'clinica' where id = $1", [P]);
      await db.query("update companies set segment = 'pet' where id = $1", [P]);
      await expect(db.query("update companies set plan = 'essencial' where id = $1", [P])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(db.query("update companies set extra_modules = '{agenda}' where id = $1", [P])).rejects.toThrow(
        /permission denied/i,
      );
    });
    for (const user of [recep, prof, caixa]) {
      const upd = await as(user, () => db.query("update companies set segment = 'geral' where id = $1", [P]));
      expect(upd.affectedRows ?? 0).toBe(0);
    }
    expect((await co(P)).segment).toBe("pet");
  });

  it("módulo ligado depende do ramo, dos extras e do plano", async () => {
    const on = async (cid: string, m: string) =>
      (await one<{ on: boolean }>("select public.module_enabled($1, $2) as on", [cid, m])).on;
    expect(await on(P, "itens")).toBe(true);
    expect(await on(A, "itens")).toBe(false);
    expect(await on(P, "agendamento_online")).toBe(true);
    await db.query("update companies set plan = 'essencial' where id = $1", [P]);
    expect(await on(P, "agendamento_online")).toBe(false); // plano Equipe em diante
    expect(await on(P, "itens")).toBe(true);
    await db.query("update companies set plan = 'empresa' where id = $1", [P]);
    expect(await on(P, "inexistente")).toBe(false);
  });

  it("recepção e caixa cuidam dos clientes de todos; o profissional, só dos próprios", async () => {
    const insertClient = (name: string, owner: string) =>
      one<{ id: string }>("insert into clients (company_id, name, owner_id) values ($1, $2, $3) returning id", [
        P,
        name,
        owner,
      ]);
    tutor = (await as(recep, () => insertClient("Paula Vieira", prof))).id;
    await as(prof2, async () => {
      // não cadastra para o colega
      await expect(insertClient("De outro", prof)).rejects.toThrow(/row-level security/);
      tutor2 = (await insertClient("Rogério Sato", prof2)).id;
      expect(await count("select 1 from clients where company_id = $1", [P])).toBe(1);
      const upd = await db.query("update clients set name = 'invadido' where id = $1", [tutor]);
      expect(upd.affectedRows ?? 0).toBe(0);
      // nem passa o próprio cliente para o colega
      await expect(db.query("update clients set owner_id = $2 where id = $1", [tutor2, prof])).rejects.toThrow(
        /row-level security/,
      );
    });
    await as(prof, async () => {
      expect(await rows<{ id: string }>("select id from clients where company_id = $1", [P])).toEqual([{ id: tutor }]);
      await db.query("update clients set phone = '(11) 90000-0001' where id = $1", [tutor]);
    });
    for (const user of [recep, caixa]) {
      await as(user, async () => {
        expect(await count("select 1 from clients where company_id = $1", [P])).toBe(2);
        const upd = await db.query("update clients set email = 'tutor@correio.test' where id = $1", [tutor2]);
        expect(upd.affectedRows).toBe(1);
        // anotação na ficha de qualquer cliente
        await db.query(
          "insert into notes (company_id, client_id, body, author_id) values ($1, $2, 'Ligou para remarcar', $3)",
          [P, tutor2, user],
        );
      });
    }
    // o financeiro continua vendo os clientes sem poder cadastrar (regra que já existia)
    await as(U.fin, async () => {
      expect(await count("select 1 from clients where company_id = $1", [A])).toBeGreaterThan(0);
      await expect(
        db.query("insert into clients (company_id, name, owner_id) values ($1, 'Pelo financeiro', $2)", [A, U.fin]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("recepção, profissional e caixa não veem negociações, vendas nem o financeiro", async () => {
    const deal = await as(U.ana, () =>
      one<{ id: string }>(
        "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Pacote de banhos', 40000, $3) returning id",
        [P, tutor, U.ana],
      ),
    );
    await as(U.ana, () =>
      db.query(
        "insert into accounts (company_id, kind, description, origin, amount_cents, due_date, category, created_by) values ($1, 'pagar', 'Aluguel', 'despesa', 300000, '2026-12-05', 'Aluguel', $2)",
        [P, U.ana],
      ),
    );
    for (const user of [recep, prof, caixa]) {
      await as(user, async () => {
        expect(await count("select 1 from deals where company_id = $1", [P])).toBe(0);
        expect(await count("select 1 from sales where company_id = $1", [P])).toBe(0);
        expect(await count("select 1 from accounts where company_id = $1", [P])).toBe(0);
        await expect(
          db.query(
            "insert into deals (company_id, client_id, title, value_cents, owner_id) values ($1, $2, 'Minha', 1, $3)",
            [P, tutor, user],
          ),
        ).rejects.toThrow(/row-level security/);
        await expect(
          db.query("select public.close_sale($1, null, 40000, 'avista', $2::jsonb, $3)", [
            deal.id,
            JSON.stringify([{ number: 1, amount_cents: 40000, due_date: "2026-12-01" }]),
            randomUUID(),
          ]),
        ).rejects.toThrow();
      });
    }
  });

  it("pets: lê quem vê o tutor, grava quem edita o tutor", async () => {
    const insertPet = (client: string, name: string, by: string) =>
      one<{ id: string }>(
        "insert into client_items (company_id, client_id, kind, name, details, created_by) values ($1, $2, 'pet', $3, '{\"especie\":\"Cão\"}', $4) returning id",
        [P, client, name, by],
      );
    thor = (await as(recep, () => insertPet(tutor, "Thor", recep))).id;
    await as(recep, async () => {
      // não grava em nome de outra pessoa
      await expect(insertPet(tutor, "Falso", prof)).rejects.toThrow(/row-level security/);
    });
    await as(prof, async () => {
      expect(await count("select 1 from client_items")).toBe(1);
      await db.query("update client_items set alert = 'Idoso' where id = $1", [thor]);
      await insertPet(tutor, "Mia", prof);
    });
    await as(prof2, async () => {
      // tutor de outro profissional: não vê, não cadastra, não altera
      expect(await count("select 1 from client_items")).toBe(0);
      await expect(insertPet(tutor, "Intruso", prof2)).rejects.toThrow(/row-level security/);
      const upd = await db.query("update client_items set name = 'invadido' where id = $1", [thor]);
      expect(upd.affectedRows ?? 0).toBe(0);
    });
    await as(caixa, async () => {
      expect(await count("select 1 from client_items")).toBe(2);
    });
    await as(recep, async () => {
      // nada é apagado, e o pet não muda de tutor nem de autor
      await expect(db.query("delete from client_items where id = $1", [thor])).rejects.toThrow(/permission denied/i);
      await expect(db.query("update client_items set client_id = $2 where id = $1", [thor, tutor2])).rejects.toThrow(
        /permission denied/i,
      );
      await db.query("update client_items set active = false where id = $1", [thor]);
      await db.query("update client_items set active = true where id = $1", [thor]);
      // formato dos detalhes conferido pelo banco
      await expect(db.query("update client_items set details = '[]' where id = $1", [thor])).rejects.toThrow();
      await expect(db.query("update client_items set name = '  ' where id = $1", [thor])).rejects.toThrow();
    });
    expect(
      await one<{ alert: string; name: string }>("select alert, name from client_items where id = $1", [thor]),
    ).toEqual({
      alert: "Idoso",
      name: "Thor",
    });
  });

  it("pets: só com o módulo ligado para a empresa, e nunca misturando empresas", async () => {
    const insertIn = (company: string, client: string) =>
      db.query(
        "insert into client_items (company_id, client_id, kind, name, created_by) values ($1, $2, 'pet', 'Rex', $3)",
        [company, client, U.ana],
      );
    await as(U.ana, async () => {
      // a Aurora é do ramo geral: o módulo não existe para ela, nem para a administradora
      await expect(insertIn(A, clienteA)).rejects.toThrow(/row-level security/);
      // cliente de uma empresa com item de outra: a chave composta barra
      await expect(insertIn(P, clienteA)).rejects.toThrow();
    });
    // ligado à parte pelo Thigu, passa a valer; desligado, os dados ficam guardados mas ninguém lê
    await db.query("update companies set extra_modules = '{itens}' where id = $1", [A]);
    await as(U.ana, async () => {
      await insertIn(A, clienteA);
      expect(await count("select 1 from client_items where company_id = $1", [A])).toBe(1);
    });
    await db.query("update companies set extra_modules = '{}' where id = $1", [A]);
    await as(U.ana, async () => {
      expect(await count("select 1 from client_items where company_id = $1", [A])).toBe(0);
      const upd = await db.query("update client_items set name = 'Rex 2' where company_id = $1", [A]);
      expect(upd.affectedRows ?? 0).toBe(0);
    });
    expect(await count("select 1 from client_items where company_id = $1", [A])).toBe(1);
    // quem é de outra empresa não lê os pets do pet shop
    await as(U.outro, async () => {
      expect(await count("select 1 from client_items")).toBe(0);
    });
    await as(U.vend, async () => {
      expect(await count("select 1 from client_items where company_id = $1", [P])).toBe(0);
    });
  });

  it("campos extras do cliente: o banco confere o formato", async () => {
    await as(recep, async () => {
      await db.query('update clients set extra = \'{"endereco":"Rua das Acácias, 45"}\' where id = $1', [tutor]);
      await expect(db.query("update clients set extra = '[]' where id = $1", [tutor])).rejects.toThrow();
      await expect(
        db.query("update clients set extra = $2::jsonb where id = $1", [
          tutor,
          JSON.stringify({ x: "a".repeat(5000) }),
        ]),
      ).rejects.toThrow();
    });
    expect((await one<{ extra: unknown }>("select extra from clients where id = $1", [tutor])).extra).toEqual({
      endereco: "Rua das Acácias, 45",
    });
  });

  it("uma pessoa pode acumular papéis antigos e novos", async () => {
    await as(U.ana, () =>
      db.query(
        "select public.set_member_roles($1, $2, '{recepcao,caixa,profissional,financeiro,gestor}'::app_role[], true)",
        [P, recep],
      ),
    );
    await as(recep, async () => {
      expect(await count("select 1 from deals where company_id = $1", [P])).toBe(1); // agora também é gestor
    });
    await as(U.ana, () =>
      db.query("select public.set_member_roles($1, $2, '{recepcao}'::app_role[], true)", [P, recep]),
    );
  });
});

// Agenda, serviços e ficha de atendimento (20261114000008 e 20261114000009).
describe("agenda no banco", () => {
  let C = ""; // clínica da Ana
  let recep = "";
  let prof1 = "";
  let prof2 = "";
  let r1 = ""; // agenda do prof1
  let r2 = ""; // agenda do prof2
  let sala = ""; // agenda sem login
  let svc = "";
  let pac2 = ""; // paciente do prof2
  let ap = ""; // horário do pac2 com o prof1

  const count = async (sql: string, params: unknown[] = []) =>
    (await one<{ c: number }>(`select count(*)::int c from (${sql}) q`, params)).c;
  const insertAppointment = (resource: string, client: string, by: string, start = "2026-11-20 13:00+00", extra = "") =>
    one<{ id: string }>(
      `insert into appointments (company_id, client_id, resource_id, service_id, starts_at, ends_at, price_cents, created_by${extra ? ", status" : ""})
       values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '50 minutes', 20000, $6${extra ? ", " + extra : ""}) returning id`,
      [C, client, resource, svc, start, by],
    );

  beforeAll(async () => {
    recep = await newUser("recep@clinica.test");
    prof1 = await newUser("prof1@clinica.test");
    prof2 = await newUser("prof2@clinica.test");
    C = await newCompany(U.ana, "Bem Viver", "clinica");
    await inviteAndAccept(C, U.ana, "recep@clinica.test", "{recepcao}", recep);
    await inviteAndAccept(C, U.ana, "prof1@clinica.test", "{profissional}", prof1);
    await inviteAndAccept(C, U.ana, "prof2@clinica.test", "{profissional}", prof2);
  });

  it("só administrador ou gestor cadastram agendas e serviços, e só com o módulo ligado", async () => {
    const insertResource = (company: string, name: string, user: string | null) =>
      one<{ id: string }>("insert into resources (company_id, name, user_id) values ($1, $2, $3) returning id", [
        company,
        name,
        user,
      ]);
    await as(U.ana, async () => {
      r1 = (await insertResource(C, "Profissional 1", prof1)).id;
      r2 = (await insertResource(C, "Profissional 2", prof2)).id;
      sala = (await insertResource(C, "Sala 3", null)).id;
      // uma agenda por pessoa
      await expect(insertResource(C, "De novo", prof1)).rejects.toThrow(/duplicate key/);
      svc = (
        await one<{ id: string }>(
          "insert into services (company_id, name, duration_min, price_cents) values ($1, 'Sessão', 50, 20000) returning id",
          [C],
        )
      ).id;
      // a Aurora é do ramo geral: não tem agenda
      await expect(insertResource(A, "Sala", null)).rejects.toThrow(/row-level security/);
    });
    for (const user of [recep, prof1]) {
      await as(user, async () => {
        await expect(insertResource(C, "Minha", null)).rejects.toThrow(/row-level security/);
        await expect(
          db.query("insert into services (company_id, name, duration_min) values ($1, 'X', 30)", [C]),
        ).rejects.toThrow(/row-level security/);
        // mas toda a equipe lê os nomes
        expect(await count("select 1 from resources where company_id = $1", [C])).toBe(3);
        expect(await count("select 1 from services where company_id = $1", [C])).toBe(1);
      });
    }
  });

  it("a recepção marca em qualquer agenda; o profissional, só na dele", async () => {
    pac2 = (
      await as(recep, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Paciente 2', $2) returning id",
          [C, prof2],
        ),
      )
    ).id;
    ap = (await as(recep, () => insertAppointment(r1, pac2, recep))).id;
    await as(recep, () => insertAppointment(sala, pac2, recep, "2026-11-20 15:00+00"));
    await as(prof2, async () => {
      await insertAppointment(r2, pac2, prof2, "2026-11-21 13:00+00");
      // na agenda do colega, não
      await expect(insertAppointment(r1, pac2, prof2, "2026-11-22 13:00+00")).rejects.toThrow(/row-level security/);
      // horário em nome de outra pessoa, não
      await expect(insertAppointment(r2, pac2, recep, "2026-11-22 13:00+00")).rejects.toThrow(/row-level security/);
      // já nasce "atendido"? não: a situação só muda pela função
      await expect(insertAppointment(r2, pac2, prof2, "2026-11-23 13:00+00", "'compareceu'")).rejects.toThrow(
        /row-level security/,
      );
    });
    await as(prof1, async () => {
      // não vê a Paciente 2 por ser do colega... até ter horário com ela: aí vê, mas não edita
      expect(await rows<{ id: string }>("select id from clients where company_id = $1", [C])).toEqual([{ id: pac2 }]);
      const upd = await db.query("update clients set name = 'x' where id = $1", [pac2]);
      expect(upd.affectedRows ?? 0).toBe(0);
      // e vê só os horários da própria agenda
      expect(await rows<{ id: string }>("select id from appointments where company_id = $1", [C])).toEqual([
        { id: ap },
      ]);
    });
    await as(recep, async () => {
      expect(await count("select 1 from appointments where company_id = $1", [C])).toBe(3);
    });
    await as(U.vend, async () => {
      expect(await count("select 1 from appointments where company_id = $1", [C])).toBe(0);
    });
  });

  it("remarcar só enquanto está em aberto; a situação não muda direto na tabela", async () => {
    await as(prof1, async () => {
      await db.query(
        "update appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = $1",
        [ap],
      );
      await expect(db.query("update appointments set status = 'compareceu' where id = $1", [ap])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(db.query("update appointments set account_id = null where id = $1", [ap])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(db.query("delete from appointments where id = $1", [ap])).rejects.toThrow(/permission denied/i);
      // fim antes do início: barrado
      await expect(
        db.query("update appointments set ends_at = starts_at - interval '1 minute' where id = $1", [ap]),
      ).rejects.toThrow();
    });
  });

  it("atendido gera a conta a receber; desfazer cancela; com pagamento, não desfaz", async () => {
    const status = (user: string, s: string, charge = false) =>
      as(user, () =>
        one<{ r: { account_id: string | null } }>(
          "select public.set_appointment_status($1, $2::appointment_status, $3) as r",
          [ap, s, charge],
        ),
      );
    // o outro profissional não mexe no horário do colega
    await expect(status(prof2, "compareceu")).rejects.toThrow(/não encontrado/);
    const done = await status(recep, "compareceu");
    const acc = done.r.account_id!;
    expect(acc).toBeTruthy();
    const account = await one<{ origin: string; amount_cents: string; client_id: string; kind: string }>(
      "select origin::text, amount_cents::text, client_id, kind::text from accounts where id = $1",
      [acc],
    );
    expect(account).toEqual({ origin: "atendimento", amount_cents: "20000", client_id: pac2, kind: "receber" });
    // a recepção não vê o financeiro; a administradora vê
    expect(await as(recep, () => count("select 1 from accounts where id = $1", [acc]))).toBe(0);
    expect(await as(U.ana, () => count("select 1 from accounts where id = $1", [acc]))).toBe(1);
    // de atendido não vai direto para cancelado
    await expect(status(recep, "cancelado")).rejects.toThrow(/desfaça/);
    await status(recep, "agendado");
    expect(
      (await one<{ c: string | null }>("select canceled_at::text c from accounts where id = $1", [acc])).c,
    ).not.toBeNull();
    // falta cobrada: nova conta; a administradora registra o pagamento e aí não desfaz
    const noShow = await status(recep, "faltou", true);
    const acc2 = noShow.r.account_id!;
    expect((await one<{ d: string }>("select description d from accounts where id = $1", [acc2])).d).toBe(
      "Falta: Sessão",
    );
    await as(U.ana, () =>
      db.query("select public.register_movement($1, 20000, '2026-11-20', 'pix', $2)", [acc2, randomUUID()]),
    );
    await expect(status(recep, "agendado")).rejects.toThrow(/pagamento registrado/);
    // a linha de histórico fica na ficha do paciente
    expect(
      await count("select 1 from activities where client_id = $1 and kind = 'agenda'", [pac2]),
    ).toBeGreaterThanOrEqual(3);
  });

  it("ficha de atendimento: só quem escreveu lê; nada muda nem some", async () => {
    const write = (user: string, body: string, corrects: string | null = null) =>
      as(user, () =>
        one<{ id: string }>(
          "insert into clinical_notes (company_id, client_id, author_id, body, corrects_id) values ($1, $2, $3, $4, $5) returning id",
          [C, pac2, user, body, corrects],
        ),
      );
    const n1 = (await write(prof1, "Evolução do atendimento.")).id;
    const n2 = (await write(prof2, "Anotação do outro profissional.")).id;
    await write(prof1, "Correção.", n1);
    // corrigir anotação de outra pessoa: barrado
    await expect(write(prof1, "Invasão.", n2)).rejects.toThrow(/row-level security/);
    // quem não atende não escreve, nem a administradora
    await expect(write(recep, "Recepção.")).rejects.toThrow(/row-level security/);
    await expect(write(U.ana, "Dona.")).rejects.toThrow(/row-level security/);
    expect(await as(prof1, () => count("select 1 from clinical_notes"))).toBe(2);
    expect(await as(prof2, () => count("select 1 from clinical_notes"))).toBe(1);
    for (const user of [U.ana, recep]) expect(await as(user, () => count("select 1 from clinical_notes"))).toBe(0);
    await as(prof1, async () => {
      await expect(db.query("update clinical_notes set body = 'mudou' where id = $1", [n1])).rejects.toThrow(
        /permission denied/i,
      );
      await expect(db.query("delete from clinical_notes where id = $1", [n1])).rejects.toThrow(/permission denied/i);
    });
    // a clínica troca de ramo: o prontuário fica guardado, mas some das telas
    await as(U.ana, () => db.query("update companies set segment = 'beleza' where id = $1", [C]));
    expect(await as(prof1, () => count("select 1 from clinical_notes"))).toBe(0);
    await as(U.ana, () => db.query("update companies set segment = 'clinica' where id = $1", [C]));
    expect(await as(prof1, () => count("select 1 from clinical_notes"))).toBe(2);
  });
});

// Pacotes de sessões e mensalidades (20261114000010 e 20261114000011).
describe("pacotes e mensalidades no banco", () => {
  let P = ""; // clínica da Ana
  let recep = "";
  let prof = "";
  let res = "";
  let svc = "";
  let pac = "";

  const count = async (sql: string, params: unknown[] = []) =>
    (await one<{ c: number }>(`select count(*)::int c from (${sql}) q`, params)).c;
  const plan2 = JSON.stringify([
    { number: 1, amount_cents: 30000, due_date: "2026-11-20" },
    { number: 2, amount_cents: 30000, due_date: "2026-12-20" },
  ]);
  const sell = (user: string, sessions: number, price: number, planJson: string, req = randomUUID()) =>
    as(user, () =>
      one<{ r: { package_id: string; duplicate: boolean } }>(
        "select public.sell_package($1, $2, null, 'Pacote teste', $3, $4, null, $5::jsonb, $6) as r",
        [pac, svc, sessions, price, planJson, req],
      ),
    );
  const book = (user: string, pkg: string | null, start: string) =>
    as(user, () =>
      one<{ id: string }>(
        `insert into appointments (company_id, client_id, resource_id, service_id, package_id, starts_at, ends_at, price_cents, created_by)
         values ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz + interval '50 minutes', 20000, $7) returning id`,
        [P, pac, res, svc, pkg, start, user],
      ),
    );
  const status = (user: string, ap: string, s: string, charge = false) =>
    as(user, () =>
      one<{ r: { account_id: string | null; package_session: boolean } }>(
        "select public.set_appointment_status($1, $2::appointment_status, $3) as r",
        [ap, s, charge],
      ),
    );

  beforeAll(async () => {
    recep = await newUser("recep@pacotes.test");
    prof = await newUser("prof@pacotes.test");
    P = await newCompany(U.ana, "Pacotes", "clinica");
    await inviteAndAccept(P, U.ana, "recep@pacotes.test", "{recepcao}", recep);
    await inviteAndAccept(P, U.ana, "prof@pacotes.test", "{profissional}", prof);
    await as(U.ana, async () => {
      res = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Prof', $2) returning id",
          [P, prof],
        )
      ).id;
      svc = (
        await one<{ id: string }>(
          "insert into services (company_id, name, duration_min, price_cents) values ($1, 'Sessão', 50, 20000) returning id",
          [P],
        )
      ).id;
    });
    pac = (
      await as(recep, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Paciente', $2) returning id",
          [P, prof],
        ),
      )
    ).id;
  });

  it("a recepção vende em parcelas; repetir o pedido não duplica; o profissional não vende", async () => {
    const req = randomUUID();
    const first = await sell(recep, 10, 60000, plan2, req);
    expect(first.r.duplicate).toBe(false);
    const again = await sell(recep, 10, 60000, plan2, req);
    expect(again.r).toEqual({ package_id: first.r.package_id, duplicate: true });
    const accs = await rows<{
      origin: string;
      amount_cents: string;
      installment_number: number;
      installment_count: number;
    }>(
      "select origin::text, amount_cents::text, installment_number, installment_count from accounts where package_id = $1 order by installment_number",
      [first.r.package_id],
    );
    expect(accs).toEqual([
      { origin: "pacote", amount_cents: "30000", installment_number: 1, installment_count: 2 },
      { origin: "pacote", amount_cents: "30000", installment_number: 2, installment_count: 2 },
    ]);
    // parcelas que não somam o total
    await expect(sell(recep, 10, 70000, plan2)).rejects.toThrow(/não confere/);
    await expect(sell(prof, 10, 60000, plan2)).rejects.toThrow(/não permite vender/);
    // o pacote só nasce pela função
    await as(recep, async () => {
      await expect(
        db.query(
          "insert into packages (company_id, client_id, name, sessions_total, request_id, created_by) values ($1, $2, 'X', 1, $3, $4)",
          [P, pac, randomUUID(), recep],
        ),
      ).rejects.toThrow(/permission denied/i);
    });
    // o profissional vê o pacote do próprio paciente; a recepção não vê as cobranças
    expect(await as(prof, () => count("select 1 from packages where company_id = $1", [P]))).toBe(1);
    expect(await as(recep, () => count("select 1 from accounts where package_id = $1", [first.r.package_id]))).toBe(0);
    expect(await as(U.ana, () => count("select 1 from accounts where package_id = $1", [first.r.package_id]))).toBe(2);
  });

  it("atendido com pacote usa sessão sem gerar conta, e não passa do total", async () => {
    const pkg = (await sell(recep, 1, 0, "[]")).r.package_id;
    const ap1 = (await book(recep, pkg, "2026-11-20 13:00+00")).id;
    const ap2 = (await book(recep, pkg, "2026-11-27 13:00+00")).id;
    const done = await status(prof, ap1, "compareceu");
    expect(done.r).toMatchObject({ account_id: null, package_session: true });
    expect(await count("select 1 from appointments where package_id = $1 and consumes_package", [pkg])).toBe(1);
    // a única sessão já foi usada
    await expect(status(prof, ap2, "compareceu")).rejects.toThrow(/Todas as sessões/);
    // desfazer devolve a sessão, e aí o segundo pode usar
    await status(prof, ap1, "agendado");
    expect((await status(prof, ap2, "faltou", true)).r.package_session).toBe(true);
    // o horário não marca "usou o pacote" direto na tabela
    await as(recep, async () => {
      await expect(db.query("update appointments set consumes_package = true where id = $1", [ap1])).rejects.toThrow(
        /permission denied/i,
      );
    });
    // pacote de outro cliente não entra no horário
    const outro = (
      await as(recep, () =>
        one<{ id: string }>("insert into clients (company_id, name, owner_id) values ($1, 'Outro', $2) returning id", [
          P,
          prof,
        ]),
      )
    ).id;
    await as(recep, async () => {
      await expect(
        db.query(
          `insert into appointments (company_id, client_id, resource_id, package_id, starts_at, ends_at, created_by)
           values ($1, $2, $3, $4, '2026-11-21 13:00+00', '2026-11-21 14:00+00', $5)`,
          [P, outro, res, pkg, recep],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("encerrar o pacote: só sem horário marcado; depois, não entra em horário novo", async () => {
    const pkg = (await sell(recep, 5, 0, "[]")).r.package_id;
    const ap = (await book(recep, pkg, "2026-11-22 13:00+00")).id;
    await expect(as(recep, () => db.query("select public.close_package($1)", [pkg]))).rejects.toThrow(
      /horários marcados/,
    );
    await status(recep, ap, "cancelado");
    await as(recep, () => db.query("select public.close_package($1)", [pkg]));
    await expect(book(recep, pkg, "2026-11-23 13:00+00")).rejects.toThrow(/row-level security/);
    await expect(as(prof, () => db.query("select public.close_package($1)", [pkg]))).rejects.toThrow(/não permite/);
  });

  it("mensalidade: cobranças até o mês atual, sem duplicar; cancelada para de gerar", async () => {
    const start = await one<{ d: string }>(
      "select (date_trunc('month', current_date) - interval '2 months')::date::text d",
    );
    const sub = (
      await as(recep, () =>
        one<{ id: string }>(
          "insert into subscriptions (company_id, client_id, name, amount_cents, day_of_month, starts_on, created_by) values ($1, $2, 'Mensal', 28000, 1, $3, $4) returning id",
          [P, pac, start.d, recep],
        ),
      )
    ).id;
    const gen = () => as(recep, () => one<{ n: number }>("select public.generate_subscription_charges($1) as n", [P]));
    expect((await gen()).n).toBe(3); // dois meses atrás, mês passado e este
    expect((await gen()).n).toBe(0);
    const charges = await rows<{ origin: string; period: string; amount_cents: string }>(
      "select origin::text, period::text, amount_cents::text from accounts where subscription_id = $1 order by period",
      [sub],
    );
    expect(charges).toHaveLength(3);
    expect(charges.every((c) => c.origin === "mensalidade" && c.amount_cents === "28000")).toBe(true);
    // uma cobrança por mês, mesmo tentando direto
    await as(U.ana, async () => {
      await expect(
        db.query(
          "insert into accounts (company_id, kind, client_id, description, origin, amount_cents, due_date, created_by, subscription_id, period) values ($1, 'receber', $2, 'Duplicada', 'avulsa', 1, current_date, $3, $4, $5)",
          [P, pac, U.ana, sub, charges[0].period],
        ),
      ).rejects.toThrow();
    });
    // o profissional não cria mensalidade; a recepção não cancela direto na tabela
    await as(prof, async () => {
      await expect(
        db.query(
          "insert into subscriptions (company_id, client_id, name, amount_cents, day_of_month, starts_on, created_by) values ($1, $2, 'X', 100, 1, current_date, $3)",
          [P, pac, prof],
        ),
      ).rejects.toThrow(/row-level security/);
    });
    await as(recep, async () => {
      await expect(db.query("update subscriptions set canceled_at = now() where id = $1", [sub])).rejects.toThrow(
        /permission denied/i,
      );
      await db.query("select public.cancel_subscription($1)", [sub]);
      // cancelada não se edita
      const upd = await db.query("update subscriptions set amount_cents = 1 where id = $1", [sub]);
      expect(upd.affectedRows ?? 0).toBe(0);
    });
    expect((await gen()).n).toBe(0);
  });

  it("empresa do ramo geral não tem pacotes nem mensalidades", async () => {
    const cliente = (
      await as(U.ana, () =>
        one<{ id: string }>("insert into clients (company_id, name, owner_id) values ($1, 'Geral', $2) returning id", [
          A,
          U.ana,
        ]),
      )
    ).id;
    await as(U.ana, async () => {
      await expect(
        db.query("select public.sell_package($1, null, null, 'X', 1, 0, null, '[]'::jsonb, $2)", [
          cliente,
          randomUUID(),
        ]),
      ).rejects.toThrow(/não está disponível/);
      await expect(
        db.query(
          "insert into subscriptions (company_id, client_id, name, amount_cents, day_of_month, starts_on, created_by) values ($1, $2, 'X', 100, 1, current_date, $3)",
          [A, cliente, U.ana],
        ),
      ).rejects.toThrow(/row-level security/);
      expect((await one<{ n: number }>("select public.generate_subscription_charges($1) as n", [A])).n).toBe(0);
    });
  });
});

describe("horário, caixa, comissões, turmas e agendamento online no banco", () => {
  let S = ""; // salão da Ana
  let recep = "";
  let prof = "";
  let prof2 = "";
  let cx = "";
  let fin = "";
  let res = "";
  let res2 = "";
  let svc = "";
  let cli = "";
  const hours = JSON.stringify({
    "1": [["09:00", "18:00"]],
    "2": [["09:00", "18:00"]],
    "3": [["09:00", "18:00"]],
    "4": [["09:00", "18:00"]],
    "5": [["09:00", "18:00"]],
  });
  const items = (cents: number, qty = 1) =>
    JSON.stringify([{ product_id: null, service_id: null, description: "Shampoo", quantity: qty, unit_cents: cents }]);

  beforeAll(async () => {
    recep = await newUser("recep@salao.test");
    prof = await newUser("prof@salao.test");
    prof2 = await newUser("prof2@salao.test");
    cx = await newUser("cx@salao.test");
    fin = await newUser("fin@salao.test");
    S = await newCompany(U.ana, "Salão", "beleza");
    await inviteAndAccept(S, U.ana, "recep@salao.test", "{recepcao}", recep);
    await inviteAndAccept(S, U.ana, "prof@salao.test", "{profissional}", prof);
    await inviteAndAccept(S, U.ana, "prof2@salao.test", "{profissional}", prof2);
    await inviteAndAccept(S, U.ana, "cx@salao.test", "{caixa}", cx);
    await inviteAndAccept(S, U.ana, "fin@salao.test", "{financeiro}", fin);
    await as(U.ana, async () => {
      res = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Lúcia', $2) returning id",
          [S, prof],
        )
      ).id;
      res2 = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Tiago', $2) returning id",
          [S, prof2],
        )
      ).id;
      svc = (
        await one<{ id: string }>(
          "insert into services (company_id, name, duration_min, price_cents) values ($1, 'Corte', 60, 10000) returning id",
          [S],
        )
      ).id;
      cli = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, phone, owner_id) values ($1, 'Joana', '(11) 98888-7777', $2) returning id",
          [S, U.ana],
        )
      ).id;
    });
  });

  it("horário de trabalho: só quem configura a agenda grava; bloqueio só na agenda que a pessoa cuida", async () => {
    await as(U.ana, () => db.query("update resources set work_hours = $1::jsonb where id = $2", [hours, res]));
    const r = await one<{ work_hours: Record<string, unknown> }>("select work_hours from resources where id = $1", [
      res,
    ]);
    expect(Object.keys(r.work_hours)).toHaveLength(5);
    // o profissional não muda o próprio horário (quem configura é o administrador ou o gestor)
    await as(prof, () => db.query("update resources set work_hours = '{}'::jsonb where id = $1", [res]));
    expect(
      Object.keys(
        (await one<{ work_hours: object }>("select work_hours from resources where id = $1", [res])).work_hours,
      ),
    ).toHaveLength(5);

    const block = (user: string, resource: string, from: string, to: string) =>
      as(user, () =>
        one<{ id: string }>(
          "insert into resource_blocks (company_id, resource_id, starts_at, ends_at, reason, created_by) values ($1, $2, $3::timestamptz, $4::timestamptz, 'Folga', $5) returning id",
          [S, resource, from, to, user],
        ),
      );
    const own = await block(prof, res, "2026-12-01 12:00+00", "2026-12-01 15:00+00");
    expect(own.id).toBeTruthy();
    await expect(block(prof, res2, "2026-12-01 12:00+00", "2026-12-01 15:00+00")).rejects.toThrow(/row-level security/);
    await block(recep, res2, "2026-12-02 12:00+00", "2026-12-02 15:00+00");
    await expect(block(U.ana, res, "2026-12-01 00:00+00", "2027-03-01 00:00+00")).rejects.toThrow(/check constraint/);
    // o colega não vê nem apaga o bloqueio da Lúcia
    expect(await as(prof2, () => rows("select id from resource_blocks where id = $1", [own.id]))).toHaveLength(0);
    await as(prof, () => db.query("delete from resource_blocks where id = $1", [own.id]));
    expect(await rows("select id from resource_blocks where id = $1", [own.id])).toHaveLength(0);
  });

  it("caixa: abre uma vez, vende e recebe sem duplicar; o profissional não usa; só financeiro ou dono fecham", async () => {
    await expect(as(prof, () => db.query("select public.open_cash($1, 10000)", [S]))).rejects.toThrow(
      /não permite usar o caixa/,
    );
    const session = (await as(cx, () => one<{ id: string }>("select public.open_cash($1, 10000) as id", [S]))).id;
    await expect(as(recep, () => db.query("select public.open_cash($1, 0)", [S]))).rejects.toThrow(/já está aberto/);

    const req = randomUUID();
    const sale = (user: string, method: string, json: string, request = randomUUID()) =>
      as(user, () =>
        one<{ r: { account_id: string; duplicate: boolean; total_cents?: number } }>(
          "select public.cash_sale($1, $2, $3::jsonb, $4::payment_method, $5) as r",
          [session, cli, json, method, request],
        ),
      );
    const first = await sale(cx, "dinheiro", items(4500, 2), req);
    expect(first.r).toMatchObject({ total_cents: 9000, duplicate: false });
    expect((await sale(cx, "dinheiro", items(4500, 2), req)).r).toEqual({
      account_id: first.r.account_id,
      duplicate: true,
    });
    await sale(recep, "pix", items(3000));
    await expect(sale(cx, "pix", items(0))).rejects.toThrow(/quantidade e valor/);
    const acc = await one<{ origin: string; amount_cents: number }>(
      "select origin, amount_cents from accounts where id = $1",
      [first.r.account_id],
    );
    expect(acc).toMatchObject({ origin: "caixa", amount_cents: 9000 });
    expect(await rows("select id from cash_sale_items where account_id = $1", [first.r.account_id])).toHaveLength(1);

    // recebe no caixa um atendimento atendido (conta de origem atendimento)
    const ap = (
      await as(U.ana, () =>
        one<{ id: string }>(
          `insert into appointments (company_id, client_id, resource_id, service_id, starts_at, ends_at, price_cents, created_by)
           values ($1, $2, $3, $4, now() - interval '2 hours', now() - interval '1 hour', 10000, $5) returning id`,
          [S, cli, res, svc, U.ana],
        ),
      )
    ).id;
    const st = await as(U.ana, () =>
      one<{ r: { account_id: string } }>("select public.set_appointment_status($1, 'compareceu', true) as r", [ap]),
    );
    // a recepção e o caixa enxergam a conta do atendimento para cobrar, mas não as contas a pagar
    expect(await as(cx, () => rows("select id from accounts where id = $1", [st.r.account_id]))).toHaveLength(1);
    expect(
      await as(cx, () => rows("select id from accounts where kind = 'pagar' and company_id = $1", [S])),
    ).toHaveLength(0);
    const receive = (amount: number, request = randomUUID()) =>
      as(cx, () =>
        one<{ r: { duplicate: boolean; balance_cents?: number } }>(
          "select public.cash_receive($1, $2, $3, 'dinheiro', $4) as r",
          [session, st.r.account_id, amount, request],
        ),
      );
    await expect(receive(20000)).rejects.toThrow(/passa do que falta/);
    expect((await receive(6000)).r).toMatchObject({ duplicate: false, balance_cents: 4000 });

    await expect(as(cx, () => db.query("select public.close_cash($1, 0, '')", [session]))).rejects.toThrow();
    // esperado na gaveta: 100 de troco + 90 da venda em dinheiro + 60 recebidos em dinheiro (o Pix não conta)
    const closed = await as(fin, () =>
      one<{ r: { expected_cents: number; difference_cents: number } }>(
        "select public.close_cash($1, 24500, 'faltou troco') as r",
        [session],
      ),
    );
    expect(closed.r).toEqual({ expected_cents: 25000, difference_cents: -500 });
    await expect(
      as(cx, () =>
        db.query("select public.cash_sale($1, null, $2::jsonb, 'pix', $3)", [session, items(100), randomUUID()]),
      ),
    ).rejects.toThrow(/já foi fechado/);
    // depois de fechado, abre de novo
    expect((await as(cx, () => one<{ id: string }>("select public.open_cash($1, 0) as id", [S]))).id).not.toBe(session);
  });

  it("comissões: regra mais específica, só mês encerrado, uma vez; gera a conta a pagar", async () => {
    await as(U.ana, async () => {
      await db.query(
        "insert into commission_rules (company_id, resource_id, service_id, percent_bp) values ($1, null, null, 4000)",
        [S],
      );
      await db.query(
        "insert into commission_rules (company_id, resource_id, service_id, percent_bp) values ($1, $2, $3, 5000)",
        [S, res2, svc],
      );
    });
    await expect(
      as(recep, () =>
        db.query(
          "insert into commission_rules (company_id, resource_id, service_id, fixed_cents) values ($1, null, $2, 100)",
          [S, svc],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // atendimentos de outubro (mês encerrado, horário de Brasília): 2 da Lúcia, 1 do Tiago
    const past = async (resource: string, start: string, price: number) => {
      const id = (
        await as(U.ana, () =>
          one<{ id: string }>(
            `insert into appointments (company_id, client_id, resource_id, service_id, starts_at, ends_at, price_cents, created_by)
             values ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz + interval '1 hour', $6, $7) returning id`,
            [S, cli, resource, svc, start, price, U.ana],
          ),
        )
      ).id;
      await as(U.ana, () => db.query("select public.set_appointment_status($1, 'compareceu', false)", [id]));
    };
    await past(res, "2026-10-05 13:00+00", 10000);
    await past(res, "2026-10-31 23:30+00", 8000); // 31/10 20:30 em Brasília: conta em outubro
    await past(res, "2026-11-01 02:30+00", 9999); // 31/10 23:30 em Brasília: também outubro
    await past(res2, "2026-10-10 13:00+00", 10000);

    await expect(as(U.ana, () => db.query("select public.close_commissions($1, '2026-11-01')", [res]))).rejects.toThrow(
      /já terminou/,
    );
    await expect(as(cx, () => db.query("select public.close_commissions($1, '2026-10-01')", [res]))).rejects.toThrow();
    const lucia = await as(fin, () =>
      one<{ r: { appointments: number; base_cents: number; amount_cents: number; account_id: string } }>(
        "select public.close_commissions($1, '2026-10-01') as r",
        [res],
      ),
    );
    expect(lucia.r).toMatchObject({ appointments: 3, base_cents: 27999, amount_cents: 11200 });
    const tiago = await as(U.ana, () =>
      one<{ r: { amount_cents: number } }>("select public.close_commissions($1, '2026-10-01') as r", [res2]),
    );
    expect(tiago.r.amount_cents).toBe(5000);
    await expect(as(U.ana, () => db.query("select public.close_commissions($1, '2026-10-01')", [res]))).rejects.toThrow(
      /já foram fechadas/,
    );
    const acc = await one<{ kind: string; origin: string; due_date: string; amount_cents: number }>(
      "select kind, origin, due_date::text, amount_cents from accounts where id = $1",
      [lucia.r.account_id],
    );
    expect(acc).toEqual({ kind: "pagar", origin: "comissao", due_date: "2026-11-05", amount_cents: 11200 });
    // cada profissional vê só a própria comissão
    expect(
      await as(prof, () => rows("select resource_id from commission_closings where company_id = $1", [S])),
    ).toEqual([{ resource_id: res }]);
  });

  it("agendamento online: só com o link ligado; confere horário, conflito e limite por celular", async () => {
    await as(U.ana, () => db.query("update resources set work_hours = $1::jsonb where id = $2", [hours, res2]));
    const anon = async <T>(fn: () => Promise<T>) => {
      await db.exec("set role anon");
      try {
        return await fn();
      } finally {
        await db.exec("reset role");
      }
    };
    expect(
      (await anon(() => one<{ i: unknown }>("select public.public_booking_info('salao-teste') as i"))).i,
    ).toBeNull();
    await as(U.ana, () =>
      db.query("update companies set booking_slug = 'salao-teste', booking_enabled = true where id = $1", [S]),
    );
    await expect(
      as(recep, () => db.query("update companies set booking_enabled = false where id = $1", [S])),
    ).resolves.toBeTruthy();
    expect(
      (await one<{ booking_enabled: boolean }>("select booking_enabled from companies where id = $1", [S]))
        .booking_enabled,
    ).toBe(true);

    const info = (
      await anon(() =>
        one<{ i: { services: unknown[]; resources: { id: string }[] } }>(
          "select public.public_booking_info('salao-teste') as i",
        ),
      )
    ).i;
    expect(info.services).toHaveLength(1);
    expect(info.resources.map((r) => r.id).sort()).toEqual([res, res2].sort());
    // o público não lê as tabelas
    await expect(anon(() => db.query("select * from appointments"))).rejects.toThrow(/permission denied/);

    // próxima segunda-feira às 10:00 em Brasília (13:00 UTC), com folga de dias para não cair a menos de 30 minutos
    const monday = (
      await one<{ d: string }>(
        "select (date_trunc('week', now() + interval '7 days') + interval '13 hours')::timestamptz::text as d",
      )
    ).d;
    const book = (start: string, phone = "(11) 97777-6666", request = randomUUID(), resource = res2) =>
      anon(() =>
        one<{ r: { appointment_id: string; status?: string; duplicate: boolean } }>(
          "select public.public_book('salao-teste', $1, $2, $3::timestamptz, 'Carla Nova', $4, $5) as r",
          [svc, resource, start, phone, request],
        ),
      );
    const req = randomUUID();
    const first = await book(monday, undefined, req);
    expect(first.r).toMatchObject({ status: "agendado", duplicate: false });
    expect((await book(monday, undefined, req)).r).toEqual({ appointment_id: first.r.appointment_id, duplicate: true });
    await expect(book(monday, "(11) 95555-4444")).rejects.toThrow(/acabou de ser ocupado/);
    await expect(book(monday.replace(" 13:00", " 22:00"))).rejects.toThrow(/fora do atendimento/);
    await expect(book(new Date(Date.now() + 10 * 60_000).toISOString())).rejects.toThrow(/30 minutos/);

    const ap = await one<{ source: string; client_id: string }>(
      "select source, client_id from appointments where id = $1",
      [first.r.appointment_id],
    );
    expect(ap.source).toBe("online");
    const client = await one<{ name: string; owner_id: string }>("select name, owner_id from clients where id = $1", [
      ap.client_id,
    ]);
    expect(client).toEqual({ name: "Carla Nova", owner_id: prof2 });
    // a mesma pessoa (mesmo celular) não vira outro cadastro e não marca mais que 3 horários futuros
    await book(monday.replace(" 13:00", " 14:00"));
    await book(monday.replace(" 13:00", " 15:00"));
    await expect(book(monday.replace(" 13:00", " 16:00"))).rejects.toThrow(/3 horários/);
    expect(await rows("select id from clients where company_id = $1 and name = 'Carla Nova'", [S])).toHaveLength(1);
    // horários ocupados aparecem sem dizer de quem
    const busy = await anon(() =>
      rows<{ starts_at: string }>(
        "select * from public.public_busy('salao-teste', $1, $2::timestamptz, $2::timestamptz + interval '1 day')",
        [res2, monday],
      ),
    );
    expect(busy).toHaveLength(3);
    expect(Object.keys(busy[0]).sort()).toEqual(["ends_at", "starts_at"]);
  });

  it("turmas: vagas, presença pelo instrutor e matrícula pela recepção", async () => {
    const P = await newCompany(U.ana, "Pilates", "turmas");
    const instr = await newUser("instr@pilates.test");
    const rec = await newUser("rec@pilates.test");
    await inviteAndAccept(P, U.ana, "instr@pilates.test", "{profissional}", instr);
    await inviteAndAccept(P, U.ana, "rec@pilates.test", "{recepcao}", rec);
    let cls = "";
    const students: string[] = [];
    await as(U.ana, async () => {
      const r = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Diego', $2) returning id",
          [P, instr],
        )
      ).id;
      cls = (
        await one<{ id: string }>(
          "insert into classes (company_id, name, resource_id, weekdays, start_time, duration_min, capacity) values ($1, 'Iniciante', $2, '{1,3}', '18:00', 60, 2) returning id",
          [P, r],
        )
      ).id;
      for (const n of ["Aluna A", "Aluna B", "Aluna C"])
        students.push(
          (
            await one<{ id: string }>(
              "insert into clients (company_id, name, owner_id) values ($1, $2, $3) returning id",
              [P, n, U.ana],
            )
          ).id,
        );
    });
    await expect(
      as(rec, () =>
        db.query(
          "insert into classes (company_id, name, weekdays, start_time, duration_min, capacity) values ($1, 'X', '{2}', '07:00', 60, 5)",
          [P],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const enroll = (client: string) =>
      as(rec, () =>
        db.query("insert into enrollments (company_id, class_id, client_id, created_by) values ($1, $2, $3, $4)", [
          P,
          cls,
          client,
          rec,
        ]),
      );
    await enroll(students[0]);
    await enroll(students[1]);
    await expect(enroll(students[2])).rejects.toThrow(/cheia/);
    // o instrutor vê os alunos da turma (sem ser dono do cadastro) e marca presença
    expect(await as(instr, () => rows("select id from clients where company_id = $1", [P]))).toHaveLength(2);
    await as(instr, () =>
      db.query(
        "insert into attendance (company_id, class_id, client_id, class_date, status, marked_by) values ($1, $2, $3, '2026-11-09', 'presente', $4)",
        [P, cls, students[0], instr],
      ),
    );
    await expect(
      as(instr, () =>
        db.query(
          "insert into attendance (company_id, class_id, client_id, class_date, status, marked_by) values ($1, $2, $3, '2026-11-09', 'falta', $4)",
          [P, cls, students[0], instr],
        ),
      ),
    ).rejects.toThrow(/duplicate key|unique/);
  });
});

describe("oficina no banco", () => {
  let O = ""; // oficina da Ana
  let atend = "";
  let mec = "";
  let mec2 = "";
  let fin = "";
  let resMec = "";
  let resMec2 = "";
  let cli = "";
  let car = "";

  const open = (user: string, request = randomUUID(), resource: string | null = resMec, item = car, client = cli) =>
    as(user, () =>
      one<{ r: { id: string; number: number; duplicate: boolean } }>(
        "select public.open_work_order($1, $2, $3, 'Barulho no freio', 30000, '1/2', '[\"Estepe\"]'::jsonb, null, $4) as r",
        [client, item, resource, request],
      ),
    );
  const addItem = (user: string, wo: string, kind: string, cents: number, desc = "Item") =>
    as(user, () =>
      one<{ id: string }>("select public.add_work_order_item($1, $2, null, $3, 1, $4, 90) as id", [
        wo,
        kind,
        desc,
        cents,
      ]),
    );

  beforeAll(async () => {
    atend = await newUser("atend@oficina.test");
    mec = await newUser("mec@oficina.test");
    mec2 = await newUser("mec2@oficina.test");
    fin = await newUser("fin@oficina.test");
    O = await newCompany(U.ana, "Oficina", "veiculos");
    await inviteAndAccept(O, U.ana, "atend@oficina.test", "{recepcao}", atend);
    await inviteAndAccept(O, U.ana, "mec@oficina.test", "{profissional}", mec);
    await inviteAndAccept(O, U.ana, "mec2@oficina.test", "{profissional}", mec2);
    await inviteAndAccept(O, U.ana, "fin@oficina.test", "{financeiro}", fin);
    await as(U.ana, async () => {
      resMec = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Rogério', $2) returning id",
          [O, mec],
        )
      ).id;
      resMec2 = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Sérgio', $2) returning id",
          [O, mec2],
        )
      ).id;
    });
    cli = (
      await as(atend, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, phone, owner_id) values ($1, 'Gustavo', '(11) 90000-6001', $2) returning id",
          [O, atend],
        ),
      )
    ).id;
    car = (
      await as(atend, () =>
        one<{ id: string }>(
          "insert into client_items (company_id, client_id, kind, name, plate, created_by) values ($1, $2, 'veiculo', 'Onix', 'FHK2B31', $3) returning id",
          [O, cli, atend],
        ),
      )
    ).id;
  });

  it("placa única por empresa e no formato certo; só a atendente abre OS, numerada sem duplicar", async () => {
    await expect(
      as(atend, () =>
        db.query(
          "insert into client_items (company_id, client_id, kind, name, plate, created_by) values ($1, $2, 'veiculo', 'Outro', 'FHK2B31', $3)",
          [O, cli, atend],
        ),
      ),
    ).rejects.toThrow(/client_items_plate_unique/);
    await expect(
      as(atend, () =>
        db.query(
          "insert into client_items (company_id, client_id, kind, name, plate, created_by) values ($1, $2, 'veiculo', 'Outro', 'fhk-2b31', $3)",
          [O, cli, atend],
        ),
      ),
    ).rejects.toThrow(/check constraint/);
    const req = randomUUID();
    const first = await open(atend, req);
    expect(first.r).toMatchObject({ number: 1, duplicate: false });
    expect((await open(atend, req)).r).toMatchObject({ id: first.r.id, duplicate: true });
    expect((await open(U.ana)).r.number).toBe(2);
    await expect(open(mec)).rejects.toThrow(/não permite abrir/);
    await expect(open(fin)).rejects.toThrow(/não permite abrir/);
    // ninguém grava direto na tabela
    await expect(
      as(U.ana, () => db.query("update work_orders set stage = 'entregue' where company_id = $1", [O])),
    ).rejects.toThrow(/permission denied/);
  });

  it("orçamento, aprovação pelo link (sem login), mecânico, desconto e entrega com parcelas", async () => {
    const wo = (await open(atend, randomUUID(), resMec)).r.id;
    const pads = (await addItem(mec, wo, "peca", 30000, "Pastilhas")).id;
    const labor = (await addItem(mec, wo, "servico", 15000, "Troca")).id;
    const extra = (await addItem(atend, wo, "servico", 40000, "Discos")).id;
    await expect(addItem(mec2, wo, "peca", 100)).rejects.toThrow(/não encontrada/);
    // o mecânico vê só as OS dele; o outro não vê esta
    expect(await as(mec2, () => rows("select id from work_orders where id = $1", [wo]))).toHaveLength(0);
    expect(await as(mec, () => rows("select id from work_orders where id = $1", [wo]))).toHaveLength(1);
    // e passa a ver o cliente do carro, sem ser o responsável pelo cadastro
    expect(await as(mec, () => rows("select id from clients where id = $1", [cli]))).toHaveLength(1);

    await expect(as(atend, () => db.query("select public.set_work_order_discount($1, 9000)", [wo]))).rejects.toThrow(
      /10%/,
    );
    await expect(as(mec, () => db.query("select public.set_work_order_discount($1, 100)", [wo]))).rejects.toThrow(
      /não permite alterar/,
    );
    await as(atend, () => db.query("select public.set_work_order_discount($1, 5000)", [wo]));

    const token = (await as(atend, () => one<{ t: string }>("select public.send_work_order($1) as t", [wo]))).t;
    const anon = async <T>(fn: () => Promise<T>) => {
      await db.exec("set role anon");
      try {
        return await fn();
      } finally {
        await db.exec("reset role");
      }
    };
    const info = (
      await anon(() =>
        one<{ i: { number: number; items: { id: string }[]; vehicle: { plate: string } } }>(
          "select public.public_work_order($1) as i",
          [token],
        ),
      )
    ).i;
    expect(info.items).toHaveLength(3);
    expect(info.vehicle.plate).toBe("FHK2B31");
    expect(
      (await anon(() => one<{ i: unknown }>("select public.public_work_order($1) as i", [randomUUID()]))).i,
    ).toBeNull();
    await expect(anon(() => db.query("select * from work_orders"))).rejects.toThrow(/permission denied/);

    await expect(
      as(atend, () => db.query("select public.deliver_work_order($1, '[]'::jsonb, null, '')", [wo])),
    ).rejects.toThrow(/aguardando a decisão/);
    const decided = await anon(() =>
      one<{ r: { approved: number; refused: number } }>(
        "select public.public_approve_work_order($1, $2::uuid[], 'Gustavo Lima') as r",
        [token, [pads, labor]],
      ),
    );
    expect(decided.r).toEqual({ approved: 2, refused: 1 });
    const after = await one<{ stage: string; approval_channel: string; approved_by_name: string }>(
      "select stage, approval_channel, approved_by_name from work_orders where id = $1",
      [wo],
    );
    expect(after).toEqual({ stage: "servico", approval_channel: "link", approved_by_name: "Gustavo Lima" });
    await expect(
      anon(() => db.query("select public.public_approve_work_order($1, '{}'::uuid[], 'Outro')", [token])),
    ).rejects.toThrow(/Não há itens/);
    await expect(as(atend, () => db.query("select public.remove_work_order_item($1)", [extra]))).rejects.toThrow(
      /já decidiu/,
    );

    await expect(as(mec, () => db.query("select public.move_work_order($1, 'orcamento')", [wo]))).rejects.toThrow(
      /mecânico move/,
    );
    await as(mec, () => db.query("select public.move_work_order($1, 'pronto')", [wo]));
    await expect(
      as(mec, () => db.query("select public.deliver_work_order($1, '[]'::jsonb, null, '')", [wo])),
    ).rejects.toThrow(/não permite entregar/);

    const plan = JSON.stringify([
      { number: 1, amount_cents: 20000, due_date: "2026-11-14" },
      { number: 2, amount_cents: 20000, due_date: "2026-12-14" },
    ]);
    const bad = JSON.stringify([{ number: 1, amount_cents: 20000, due_date: "2026-11-14" }]);
    await expect(
      as(fin, () => db.query("select public.deliver_work_order($1, $2::jsonb, null, '')", [wo, bad])),
    ).rejects.toThrow(/soma das parcelas/);
    const done = await as(fin, () =>
      one<{ r: { total_cents: number } }>(
        "select public.deliver_work_order($1, $2::jsonb, '2027-05-14', 'Troca de óleo') as r",
        [wo, plan],
      ),
    );
    expect(Number(done.r.total_cents)).toBe(40000);
    const accs = await rows<{ origin: string; amount_cents: number }>(
      "select origin, amount_cents from accounts where work_order_id = $1 order by installment_number",
      [wo],
    );
    expect(accs.map((a) => [a.origin, Number(a.amount_cents)])).toEqual([
      ["os", 20000],
      ["os", 20000],
    ]);
    await expect(addItem(atend, wo, "peca", 100)).rejects.toThrow(/já foi entregue/);
    expect(
      (await rows("select id from work_order_events where work_order_id = $1", [wo])).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it("fotos: só quem mexe na OS, no caminho dela e até o limite do plano", async () => {
    const wo = (await open(atend, randomUUID(), resMec)).r.id;
    const photo = (user: string, path: string) =>
      as(user, () =>
        db.query(
          "insert into work_order_photos (company_id, work_order_id, path, created_by) values ($1, $2, $3, $4)",
          [O, wo, path, user],
        ),
      );
    await photo(mec, `${O}/${wo}/a.webp`);
    await expect(photo(mec2, `${O}/${wo}/b.webp`)).rejects.toThrow(/row-level security/);
    await expect(photo(mec, `${O}/outra/c.webp`)).rejects.toThrow(/row-level security/);
    await db.query("update companies set plan = 'essencial' where id = $1", [O]);
    for (const n of ["d", "e", "f"]) await photo(atend, `${O}/${wo}/${n}.webp`);
    await expect(photo(atend, `${O}/${wo}/g.webp`)).rejects.toThrow(/limite do plano/);
    await db.query("update companies set plan = 'empresa' where id = $1", [O]);
    await expect(db.query("delete from work_order_photos where work_order_id = $1", [wo])).rejects.toThrow();
  });

  it("carro muda de dono e o histórico continua com a placa; comissão sobre a mão de obra", async () => {
    const novo = (
      await as(atend, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Novo dono', $2) returning id",
          [O, atend],
        ),
      )
    ).id;
    // há OS em andamento com este carro: não transfere
    await expect(as(atend, () => db.query("select public.transfer_vehicle($1, $2)", [car, novo]))).rejects.toThrow(
      /em andamento/,
    );
    const busy = await rows<{ id: string }>(
      "select id from work_orders where item_id = $1 and stage not in ('entregue', 'cancelada')",
      [car],
    );
    for (const b of busy)
      await as(atend, () => db.query("select public.cancel_work_order($1, 'teste de transferência')", [b.id]));
    await as(atend, () => db.query("select public.transfer_vehicle($1, $2)", [car, novo]));
    expect(
      (await one<{ client_id: string }>("select client_id from client_items where id = $1", [car])).client_id,
    ).toBe(novo);
    expect((await rows("select id from work_orders where item_id = $1", [car])).length).toBeGreaterThan(1);
    await expect(as(mec, () => db.query("select public.transfer_vehicle($1, $2)", [car, cli]))).rejects.toThrow();

    // OS entregue em outubro com mão de obra de R$ 200 (aprovada) e peça de R$ 500: comissão de 30% só sobre a mão de obra
    await as(U.ana, () =>
      db.query(
        "insert into commission_rules (company_id, resource_id, service_id, percent_bp) values ($1, null, null, 3000)",
        [O],
      ),
    );
    const wo = (await open(atend, randomUUID(), resMec2, car, novo)).r.id;
    await addItem(atend, wo, "servico", 20000, "Mão de obra");
    await addItem(atend, wo, "peca", 50000, "Peça");
    await as(atend, async () => {
      const ids = (await rows<{ id: string }>("select id from work_order_items where work_order_id = $1", [wo])).map(
        (r) => r.id,
      );
      await db.query("select public.approve_work_order($1, $2::uuid[], 'presencial', 'Novo dono')", [wo, ids]);
    });
    await as(atend, () =>
      db.query("select public.deliver_work_order($1, $2::jsonb, null, '')", [
        wo,
        JSON.stringify([{ number: 1, amount_cents: 70000, due_date: "2026-10-20" }]),
      ]),
    );
    // simula a entrega no mês passado (horário de Brasília)
    await db.query("alter table work_orders disable trigger all");
    await db.query("update work_orders set delivered_at = '2026-10-20 15:00+00' where id = $1", [wo]);
    await db.query("alter table work_orders enable trigger all");
    const r = await as(fin, () =>
      one<{ r: { appointments: number; base_cents: number; amount_cents: number } }>(
        "select public.close_commissions($1, '2026-10-01') as r",
        [resMec2],
      ),
    );
    expect(r.r).toMatchObject({ appointments: 1, base_cents: 20000, amount_cents: 6000 });
  });
});

describe("loja no banco", () => {
  let L = ""; // loja da Ana
  let vend = "";
  let cx = "";
  let fin = "";
  let prod = "";
  let prod2 = "";
  let cli = "";
  let session = "";

  const items = (productId: string | null, qty: number, cents: number) =>
    JSON.stringify([
      { product_id: productId, service_id: null, description: "Peça", quantity: qty, unit_cents: cents },
    ]);
  const sell = (
    user: string,
    json: string,
    discount = 0,
    method: string | null = "pix",
    plan: string | null = null,
    client: string | null = null,
    req = randomUUID(),
  ) =>
    as(user, () =>
      one<{ r: { sale_id: string; account_id: string; total_cents: number; duplicate: boolean } }>(
        "select public.counter_sale($1, $2, $3::jsonb, $4, $5::payment_method, $6::jsonb, $7) as r",
        [session, client, json, discount, method, plan, req],
      ),
    );
  const stock = async (id: string) =>
    (await one<{ s: number }>("select stock_qty as s from products where id = $1", [id])).s;

  beforeAll(async () => {
    vend = await newUser("vend@loja.test");
    cx = await newUser("cx@loja.test");
    fin = await newUser("fin@loja.test");
    L = await newCompany(U.ana, "Loja", "balcao");
    await inviteAndAccept(L, U.ana, "vend@loja.test", "{vendedor}", vend);
    await inviteAndAccept(L, U.ana, "cx@loja.test", "{caixa}", cx);
    await inviteAndAccept(L, U.ana, "fin@loja.test", "{financeiro}", fin);
    await as(U.ana, async () => {
      prod = (
        await one<{ id: string }>(
          "insert into products (company_id, name, price_cents, barcode, sku) values ($1, 'Filtro', 3000, '7890001', 'F1') returning id",
          [L],
        )
      ).id;
      prod2 = (
        await one<{ id: string }>(
          "insert into products (company_id, name, price_cents) values ($1, 'Lâmpada', 2000) returning id",
          [L],
        )
      ).id;
    });
    cli = (
      await as(vend, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, phone, owner_id) values ($1, 'Zé', '(11) 90000-1', $2) returning id",
          [L, vend],
        ),
      )
    ).id;
    session = (await as(cx, () => one<{ id: string }>("select public.open_cash($1, 10000) as id", [L]))).id;
  });

  it("estoque: só a soma das movimentações muda o saldo; caixa e vendedor não mexem; código de barras único", async () => {
    await expect(as(cx, () => db.query("select public.stock_entry($1, 10, 1500, 'NF')", [prod]))).rejects.toThrow(
      /não permite mexer no estoque/,
    );
    await as(fin, () => db.query("select public.stock_entry($1, 10, 1500, 'NF 1')", [prod]));
    expect(await stock(prod)).toBe(10);
    expect(
      await one<{ cost_cents: number; track_stock: boolean }>(
        "select cost_cents, track_stock from products where id = $1",
        [prod],
      ),
    ).toMatchObject({ track_stock: true });
    await expect(
      as(U.ana, () => db.query("update products set stock_qty = 999 where id = $1", [prod])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(U.ana, () => db.query("select public.stock_adjust($1, -11, 'ajuste', 'contagem')", [prod])),
    ).rejects.toThrow(/negativo/);
    await expect(
      as(U.ana, () => db.query("select public.stock_adjust($1, 1, 'perda', 'avaria')", [prod])),
    ).rejects.toThrow(/inválido/);
    await as(U.ana, () => db.query("select public.stock_adjust($1, -1, 'perda', 'avaria')", [prod]));
    expect(await stock(prod)).toBe(9);
    await expect(db.query("delete from stock_movements where product_id = $1", [prod])).rejects.toThrow();
    await expect(
      as(U.ana, () =>
        db.query("insert into products (company_id, name, price_cents, barcode) values ($1, 'Outro', 100, '7890001')", [
          L,
        ]),
      ),
    ).rejects.toThrow(/products_barcode_unique/);
  });

  it("venda à vista: baixa o estoque, não vende o que não tem, não duplica e limita o desconto", async () => {
    await expect(sell(cx, items(prod, 20, 3000))).rejects.toThrow(/Estoque insuficiente de Filtro \(tem 9\)/);
    await expect(sell(cx, items(prod, 2, 3000), 700)).rejects.toThrow(/10%/);
    const req = randomUUID();
    const r = await sell(cx, items(prod, 2, 3000), 600, "dinheiro", null, null, req);
    expect(r.r).toMatchObject({ total_cents: 5400, duplicate: false });
    expect((await sell(cx, items(prod, 2, 3000), 600, "dinheiro", null, null, req)).r).toMatchObject({
      sale_id: r.r.sale_id,
      duplicate: true,
    });
    expect(await stock(prod)).toBe(7);
    // produto sem controle de estoque vende à vontade
    await sell(cx, items(prod2, 5, 2000));
    expect(await stock(prod2)).toBe(0);
    // a venda antiga do caixa (cash_sale) passa pela mesma regra
    await expect(
      as(cx, () =>
        db.query("select public.cash_sale($1, null, $2::jsonb, 'pix', $3)", [
          session,
          items(prod, 50, 3000),
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/Estoque insuficiente/);
  });

  it("crediário: precisa de limite, respeita o disponível e cria as parcelas; o vendedor cobra no balcão", async () => {
    const plan = (total: number) =>
      JSON.stringify([
        { number: 1, amount_cents: total / 2, due_date: "2026-12-10" },
        { number: 2, amount_cents: total / 2, due_date: "2027-01-10" },
      ]);
    await expect(sell(vend, items(prod2, 1, 2000), 0, null, plan(2000), cli)).rejects.toThrow(/não tem crediário/);
    await expect(as(vend, () => db.query("select public.set_credit_limit($1, 5000)", [cli]))).rejects.toThrow(
      /financeiro ou o dono/,
    );
    await as(fin, () => db.query("select public.set_credit_limit($1, 5000)", [cli]));
    await expect(sell(vend, items(prod2, 3, 2000), 0, null, plan(6000), cli)).rejects.toThrow(
      /limite do crediário \(disponível R\$\s50,00\)/,
    );
    await expect(sell(vend, items(prod2, 1, 2000), 0, null, plan(2000), null)).rejects.toThrow(/cliente do crediário/);
    const r = await sell(vend, items(prod2, 2, 2000), 0, null, plan(4000), cli);
    const accs = await as(vend, () =>
      rows<{ origin: string; amount_cents: number }>(
        "select origin, amount_cents from accounts where counter_sale_id = $1 order by installment_number",
        [r.r.sale_id],
      ),
    );
    expect(accs.map((a) => [a.origin, Number(a.amount_cents)])).toEqual([
      ["crediario", 2000],
      ["crediario", 2000],
    ]);
    expect(Number((await as(vend, () => one<{ u: number }>("select public.credit_used($1) as u", [cli]))).u)).toBe(
      4000,
    );
    // a próxima compra já não cabe (sobra R$ 10)
    await expect(sell(vend, items(prod2, 1, 2000), 0, null, plan(2000), cli)).rejects.toThrow(/disponível R\$\s10,00/);
    // recebe a 1ª parcela no caixa e o limite volta
    const first =
      accs.length &&
      (
        await one<{ id: string }>("select id from accounts where counter_sale_id = $1 and installment_number = 1", [
          r.r.sale_id,
        ])
      ).id;
    await as(vend, () =>
      db.query("select public.cash_receive($1, $2, 2000, 'pix', $3)", [session, first, randomUUID()]),
    );
    expect(Number((await one<{ u: number }>("select public.credit_used($1) as u", [cli])).u)).toBe(2000);
    // crediário não se devolve pelo caixa
    const item = (await one<{ id: string }>("select id from cash_sale_items where sale_id = $1", [r.r.sale_id])).id;
    await expect(
      as(cx, () =>
        db.query("select public.counter_return($1, $2::jsonb, 'dinheiro', $3)", [
          r.r.sale_id,
          JSON.stringify([{ item_id: item, quantity: 1 }]),
          randomUUID(),
        ]),
      ),
    ).rejects.toThrow(/crediário/);
  });

  it("devolução: proporcional ao desconto, volta ao estoque, sai do caixa e não passa do vendido", async () => {
    await as(fin, () => db.query("select public.stock_entry($1, 5, null, '')", [prod]));
    const before = await stock(prod);
    const r = await sell(cx, items(prod, 2, 3000), 600, "dinheiro"); // R$ 54 por R$ 60
    const item = (await one<{ id: string }>("select id from cash_sale_items where sale_id = $1", [r.r.sale_id])).id;
    const ret = (qty: number, req = randomUUID()) =>
      as(cx, () =>
        one<{ r: { refund_cents: number; duplicate: boolean } }>(
          "select public.counter_return($1, $2::jsonb, 'dinheiro', $3) as r",
          [r.r.sale_id, JSON.stringify([{ item_id: item, quantity: qty }]), req],
        ),
      );
    await expect(ret(3)).rejects.toThrow(/Só dá para devolver 2/);
    const req = randomUUID();
    expect((await ret(1, req)).r).toEqual({ duplicate: false, refund_cents: 2700 });
    expect((await ret(1, req)).r).toEqual({ duplicate: true });
    expect(await stock(prod)).toBe(before - 2 + 1);
    await ret(1);
    await expect(ret(1)).rejects.toThrow(/Só dá para devolver 0/);
    // o caixa vê a saída: fechar confere o dinheiro (100 de troco + vendas em dinheiro − devoluções)
    const close = await as(fin, () =>
      one<{ r: { expected_cents: number } }>("select public.close_cash($1, 0, 'conferência') as r", [session]),
    );
    expect(Number(close.r.expected_cents)).toBe(10000 + 5400 + 5400 - 2700 - 2700);
  });
});

describe("pedidos no banco", () => {
  let T = ""; // ótica da Ana
  let atend = "";
  let tec = "";
  let tec2 = "";
  let fin = "";
  let resTec = "";
  let cli = "";
  let cli2 = "";
  let frame = "";
  let session = "";

  const items = (productId: string | null, qty = 1, cents = 30000) =>
    JSON.stringify([{ product_id: productId, description: "Armação", quantity: qty, unit_cents: cents }]);
  const open = (
    user: string,
    extra: {
      items?: string;
      down?: number;
      method?: string | null;
      client?: string;
      promised?: string;
      rx?: string | null;
      req?: string;
    } = {},
  ) =>
    as(user, () =>
      one<{ r: { id: string; number: number; duplicate: boolean } }>(
        "select public.open_order($1, 'Óculos', '', $2::date, $3, $4, $5::jsonb, $6, $7::payment_method, $8) as r",
        [
          extra.client ?? cli,
          extra.promised ?? "2099-01-10",
          resTec,
          extra.rx ?? null,
          extra.items ?? items(null),
          extra.down ?? 0,
          extra.method ?? null,
          extra.req ?? randomUUID(),
        ],
      ),
    );
  const stock = async (id: string) =>
    (await one<{ s: number }>("select stock_qty as s from products where id = $1", [id])).s;

  beforeAll(async () => {
    atend = await newUser("atend@otica.test");
    tec = await newUser("tec@otica.test");
    tec2 = await newUser("tec2@otica.test");
    fin = await newUser("fin@otica.test");
    T = await newCompany(U.ana, "Ótica", "pedidos");
    await inviteAndAccept(T, U.ana, "atend@otica.test", "{recepcao}", atend);
    await inviteAndAccept(T, U.ana, "tec@otica.test", "{profissional}", tec);
    await inviteAndAccept(T, U.ana, "tec2@otica.test", "{profissional}", tec2);
    await inviteAndAccept(T, U.ana, "fin@otica.test", "{financeiro}", fin);
    await as(U.ana, async () => {
      resTec = (
        await one<{ id: string }>(
          "insert into resources (company_id, name, user_id) values ($1, 'Otávio', $2) returning id",
          [T, tec],
        )
      ).id;
      await db.query("insert into resources (company_id, name, user_id) values ($1, 'Outro', $2)", [T, tec2]);
      frame = (
        await one<{ id: string }>(
          "insert into products (company_id, name, price_cents) values ($1, 'Armação', 30000) returning id",
          [T],
        )
      ).id;
    });
    await as(fin, () => db.query("select public.stock_entry($1, 2, 12000, '')", [frame]));
    cli = (
      await as(atend, () =>
        one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Beatriz', $2) returning id",
          [T, atend],
        ),
      )
    ).id;
    cli2 = (
      await as(atend, () =>
        one<{ id: string }>("insert into clients (company_id, name, owner_id) values ($1, 'Carlos', $2) returning id", [
          T,
          atend,
        ]),
      )
    ).id;
    session = (await as(atend, () => one<{ id: string }>("select public.open_cash($1, 0) as id", [T]))).id;
  });

  it("receita: quem atende lança e lê; caixa e financeiro não; valores conferidos; não se apaga", async () => {
    const insert = (user: string, odSph: number, odCyl: number | null, odAxis: number | null, client = cli) =>
      as(user, () =>
        one<{ id: string }>(
          `insert into prescriptions (company_id, client_id, examined_on, valid_until, od_sph, od_cyl, od_axis, oe_sph, created_by)
           values ($1, $2, '2026-11-01', '2027-11-01', $3, $4, $5, -1.00, $6) returning id`,
          [T, client, odSph, odCyl, odAxis, user],
        ),
      );
    const rx = await insert(atend, -1.25, -0.5, 180);
    expect(rx.id).toBeTruthy();
    await insert(tec, 2, null, null).catch(() => null); // o técnico só lança para cliente que ele vê
    await expect(insert(fin, -1, null, null)).rejects.toThrow(/row-level security/);
    await expect(insert(atend, -1.3, null, null)).rejects.toThrow(/check constraint/);
    await expect(insert(atend, -1, -0.5, null)).rejects.toThrow(/check constraint/);
    expect(await as(fin, () => rows("select id from prescriptions where company_id = $1", [T]))).toHaveLength(0);
    expect(
      (await as(atend, () => rows("select id from prescriptions where company_id = $1", [T]))).length,
    ).toBeGreaterThan(0);
    await expect(db.query("delete from prescriptions where id = $1", [rx.id])).rejects.toThrow();
    // receita de outro cliente não entra no pedido
    await expect(open(atend, { client: cli2, rx: rx.id })).rejects.toThrow(/não é deste cliente/);
  });

  it("abrir: sinal no caixa, estoque, numeração sem duplicar; o técnico não abre", async () => {
    await expect(open(tec)).rejects.toThrow(/não encontrado|não permite abrir/);
    await expect(open(atend, { promised: "2020-01-01" })).rejects.toThrow(/hoje ou depois/);
    await expect(open(atend, { items: items(frame, 3) })).rejects.toThrow(/Estoque insuficiente/);
    await expect(open(atend, { items: items(null, 1, 10000), down: 20000, method: "pix" })).rejects.toThrow(
      /sinal não pode passar/,
    );
    const req = randomUUID();
    const r = await open(atend, { items: items(frame, 1), down: 10000, method: "dinheiro", req });
    expect(r.r).toMatchObject({ number: 1, duplicate: false });
    expect((await open(atend, { items: items(frame, 1), down: 10000, method: "dinheiro", req })).r).toMatchObject({
      id: r.r.id,
      duplicate: true,
    });
    expect(await stock(frame)).toBe(1);
    const acc = await one<{ origin: string; amount_cents: number }>(
      "select origin, amount_cents from accounts where order_id = $1",
      [r.r.id],
    );
    expect([acc.origin, Number(acc.amount_cents)]).toEqual(["pedido", 10000]);
    // ninguém grava direto
    await expect(
      as(U.ana, () => db.query("update orders set stage = 'entregue' where id = $1", [r.r.id])),
    ).rejects.toThrow(/permission denied/);
  });

  it("etapas e entrega: técnico move os dele; entrega no caixa ou parcelada; cancelamento devolve estoque e sinal", async () => {
    const o1 = (await open(atend, { items: items(null, 1, 50000), down: 20000, method: "pix" })).r.id;
    expect(await as(tec2, () => rows("select id from orders where id = $1", [o1]))).toHaveLength(0);
    expect(await as(tec, () => rows("select id from clients where id = $1", [cli]))).toHaveLength(1);
    await expect(as(tec2, () => db.query("select public.move_order($1, 'producao')", [o1]))).rejects.toThrow(
      /não encontrado/,
    );
    await as(tec, () => db.query("select public.move_order($1, 'pronto')", [o1]));
    await expect(as(tec, () => db.query("select public.move_order($1, 'recebido')", [o1]))).rejects.toThrow(
      /técnico move/,
    );
    await expect(
      as(tec, () => db.query("select public.deliver_order($1, 'pix', null, $2)", [o1, randomUUID()])),
    ).rejects.toThrow(/não permite entregar/);
    const req = randomUUID();
    const d = await as(atend, () =>
      one<{ r: { rest_cents: number } }>("select public.deliver_order($1, 'dinheiro', null, $2) as r", [o1, req]),
    );
    expect(Number(d.r.rest_cents)).toBe(30000);
    expect(
      (
        await as(atend, () =>
          one<{ r: { duplicate: boolean } }>("select public.deliver_order($1, 'dinheiro', null, $2) as r", [o1, req]),
        )
      ).r.duplicate,
    ).toBe(true);
    await expect(as(atend, () => db.query("select public.move_order($1, 'producao')", [o1]))).rejects.toThrow(
      /já foi entregue/,
    );

    const o2 = (await open(atend, { items: items(null, 1, 40000) })).r.id;
    const plan = JSON.stringify([
      { number: 1, amount_cents: 20000, due_date: "2026-12-10" },
      { number: 2, amount_cents: 20000, due_date: "2027-01-10" },
    ]);
    await as(fin, () => db.query("select public.deliver_order($1, null, $2::jsonb, $3)", [o2, plan, randomUUID()]));
    expect((await rows("select id from accounts where order_id = $1", [o2])).length).toBe(2);

    const before = await stock(frame);
    const o3 = (await open(atend, { items: items(frame, 1), down: 5000, method: "pix" })).r.id;
    expect(await stock(frame)).toBe(before - 1);
    await as(atend, () =>
      db.query("select public.cancel_order($1, 'Cliente desistiu', true, 'pix', $2)", [o3, randomUUID()]),
    );
    expect(await stock(frame)).toBe(before);
    const refund = await one<{ kind: string; origin: string; amount_cents: number }>(
      "select kind, origin, amount_cents from accounts where order_id = $1 and kind = 'pagar'",
      [o3],
    );
    expect([refund.kind, refund.origin, Number(refund.amount_cents)]).toEqual(["pagar", "devolucao", 5000]);
    // o caixa confere: sinais e restante em dinheiro/pix, menos a devolução
    const close = await as(fin, () =>
      one<{ r: { expected_cents: number } }>("select public.close_cash($1, 0, 'conferência') as r", [session]),
    );
    expect(Number(close.r.expected_cents)).toBe(10000 + 30000); // só o que entrou em dinheiro
  });
});

describe("permissões das funções", () => {
  it("visitante sem login só executa as funções das páginas públicas; quem entrou continua executando as dele", async () => {
    const r = await rows<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`,
    );
    expect(r.map((x) => x.proname)).toEqual([
      "public_approve_work_order",
      "public_book",
      "public_booking_info",
      "public_busy",
      "public_work_order",
    ]);
    for (const fn of ["create_company", "register_movement", "is_member", "open_order", "my_invites"]) {
      expect(
        (
          await one<{ ok: boolean }>(
            `select bool_and(has_function_privilege('authenticated', p.oid, 'execute')) as ok
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`,
            [fn],
          )
        ).ok,
      ).toBe(true);
    }
    expect(
      (
        await one<{ ok: boolean }>(
          "select has_function_privilege('authenticated', 'public._order_for(uuid, text)', 'execute') as ok",
        )
      ).ok,
    ).toBe(false);
    expect(
      await rows(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')`,
      ),
    ).toEqual([]);
    const loose = await rows(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(loose).toEqual([]);
  });
});

describe("permissões das tabelas", () => {
  const privs = (grantee: string, priv: string) =>
    rows<{ t: string }>(
      `select table_name as t from information_schema.role_table_grants
       where table_schema = 'public' and grantee = $1 and privilege_type = $2 order by 1`,
      [grantee, priv],
    ).then((r) => r.map((x) => x.t));

  it("visitante não toca em tabela; quem entrou só tem o que as migrações concedem", async () => {
    expect(
      await rows(
        "select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'",
      ),
    ).toEqual([]);
    expect(
      await rows(
        "select 1 from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon'",
      ),
    ).toEqual([]);
    for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await privs("authenticated", p)).toEqual([]);
    expect(await privs("authenticated", "UPDATE")).toEqual(["accounts", "activities", "deals", "notes", "tasks"]);
    expect(await privs("authenticated", "DELETE")).toEqual(["attendance", "commission_rules", "resource_blocks"]);
    // toda tabela é lida por quem entrou (as políticas filtram as linhas), menos as tentativas de
    // código de ativação, que só as funções do sistema acessam
    const readable = await privs("authenticated", "SELECT");
    expect(readable).not.toContain("activation_attempts");
    expect(readable.length).toBe(
      (await rows("select 1 from pg_tables where schemaname = 'public' and tablename <> 'activation_attempts'")).length,
    );
    expect(await privs("authenticated", "INSERT")).not.toContain("activation_codes");
  });

  it("saldo do estoque e limite do crediário não mudam por fora das funções, nem pelo dono", async () => {
    const C = await newCompany(U.ana, "Loja", "balcao");
    const prod = await as(U.ana, () =>
      one<{ id: string }>(
        "insert into products (company_id, name, price_cents) values ($1, 'Camisa', 5000) returning id",
        [C],
      ),
    );
    const cli = await as(U.ana, () =>
      one<{ id: string }>("insert into clients (company_id, name, owner_id) values ($1, 'Davi', $2) returning id", [
        C,
        U.ana,
      ]),
    );
    await expect(
      as(U.ana, () => db.query("update products set stock_qty = 99 where id = $1", [prod.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(U.ana, () =>
        db.query("insert into products (company_id, name, price_cents, stock_qty) values ($1, 'Calça', 9000, 50)", [C]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(U.ana, () => db.query("update clients set credit_limit_cents = 100000 where id = $1", [cli.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      as(U.ana, () =>
        db.query(
          "insert into clients (company_id, name, owner_id, credit_limit_cents) values ($1, 'Eva', $2, 100000)",
          [C, U.ana],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    // pelo caminho certo continua funcionando
    await as(U.ana, () => db.query("select public.stock_entry($1, 3, 2000, '')", [prod.id]));
    await as(U.ana, () => db.query("select public.set_credit_limit($1, 100000)", [cli.id]));
    await as(U.ana, () => db.query("update clients set name = 'Davi Lima' where id = $1", [cli.id]));
    expect(
      await one(
        "select p.stock_qty, c.credit_limit_cents, c.name from products p, clients c where p.id = $1 and c.id = $2",
        [prod.id, cli.id],
      ),
    ).toMatchObject({ stock_qty: 3, name: "Davi Lima" });
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

describe("ativação por código junto com os ramos", () => {
  let O = ""; // ótica criada com código
  let cli = "";
  let prod = "";

  it("a empresa nasce com o código E o ramo; sem código não nasce", async () => {
    const bad = await createCompany(U.novo, "Ótica Sem Código", "THIGU-AAAA-BBBB-CCCC", "pedidos");
    expect(bad).toMatchObject({ ok: false, field: "code" });
    const { code } = await issueCode(null, 90);
    const r = await createCompany(U.ana, "Ótica Central", code, "pedidos");
    expect(r.ok).toBe(true);
    O = r.company_id!;
    const co = await one<{ segment: string; days: number }>(
      "select segment::text, (access_until - public._today())::int as days from companies where id = $1",
      [O],
    );
    expect(co).toEqual({ segment: "pedidos", days: 90 });
    expect(
      (await as(U.ana, () => one<{ ok: boolean }>("select public.module_enabled($1, 'pedidos') as ok", [O]))).ok,
    ).toBe(true);
    // só existe uma forma de criar empresa
    const sigs = await rows<{ sig: string }>(
      "select oid::regprocedure::text as sig from pg_proc where proname = 'create_company' and pronamespace = 'public'::regnamespace",
    );
    expect(sigs.map((x) => x.sig)).toEqual(["create_company(text,text,company_segment)"]);
    // quem está logado não chama o auxiliar que confere o código
    expect(
      (
        await one<{ ok: boolean }>(
          "select bool_or(has_function_privilege('authenticated', oid, 'execute')) as ok from pg_proc where proname = '_take_code'",
        )
      ).ok,
    ).toBe(false);
  });

  it("toda tabela com dados de empresa tem a trava de acesso vencido, menos equipe e convites", async () => {
    const missing = await rows<{ t: string }>(
      `select c.table_name as t from information_schema.columns c
       join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
       where c.table_schema = 'public' and c.column_name = 'company_id'
         and not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', c.table_name)::regclass and g.tgname = c.table_name || '_guard_active')
       order by 1`,
    );
    expect(missing.map((x) => x.t)).toEqual(["activation_codes", "invites", "memberships"]);
  });

  it("vencida: lê tudo, mas não grava nos módulos novos nem pelas páginas públicas; renovar libera", async () => {
    await as(U.ana, async () => {
      cli = (
        await one<{ id: string }>(
          "insert into clients (company_id, name, owner_id) values ($1, 'Rosa', $2) returning id",
          [O, U.ana],
        )
      ).id;
      prod = (
        await one<{ id: string }>(
          "insert into products (company_id, name, price_cents) values ($1, 'Armação', 30000) returning id",
          [O],
        )
      ).id;
      await db.query("select public.stock_entry($1, 2, 12000, '')", [prod]);
    });
    await db.query("update companies set access_until = public._today() - 1 where id = $1", [O]);
    await as(U.ana, async () => {
      // consultar continua funcionando
      expect(await rows("select id from products where company_id = $1", [O])).toHaveLength(1);
      expect(await rows("select id from stock_movements where company_id = $1", [O])).toHaveLength(1);
      // gravar direto ou pelas funções dos módulos novos, não
      await expect(
        db.query("insert into products (company_id, name, price_cents) values ($1, 'Lente', 1000)", [O]),
      ).rejects.toThrow(/acesso desta empresa venceu/);
      await expect(db.query("select public.stock_entry($1, 1, 12000, '')", [prod])).rejects.toThrow(/venceu/);
      await expect(db.query("select public.open_cash($1, 0)", [O])).rejects.toThrow(/venceu/);
      await expect(
        db.query("select public.open_order($1, 'Óculos', '', '2099-01-10', null, null, $2::jsonb, 0, null, $3)", [
          cli,
          JSON.stringify([{ product_id: null, description: "Lente", quantity: 1, unit_cents: 1000 }]),
          randomUUID(),
        ]),
      ).rejects.toThrow(/venceu/);
      // a equipe continua administrável (o dono precisa disso para renovar)
      await db.query("select public.invite_member($1, 'socia@otica.test', '{financeiro}'::app_role[])", [O]);
    });
    expect((await one<{ s: number }>("select stock_qty as s from products where id = $1", [prod])).s).toBe(2);

    const { code } = await issueCode(null, 30);
    await as(U.ana, () => db.query("select public.apply_activation_code($1, $2)", [O, code]));
    await as(U.ana, () => db.query("select public.stock_entry($1, 1, 12000, '')", [prod]));
    expect((await one<{ s: number }>("select stock_qty as s from products where id = $1", [prod])).s).toBe(3);
  });

  it("agendamento online de empresa vencida fica indisponível para o público", async () => {
    const S = await newCompany(U.ana, "Salão Vencido", "beleza");
    await as(U.ana, () =>
      db.query("update companies set booking_slug = 'salao-vencido', booking_enabled = true where id = $1", [S]),
    );
    const info = async () => {
      await db.exec("set role anon");
      try {
        return (await one<{ i: unknown }>("select public.public_booking_info('salao-vencido') as i")).i;
      } finally {
        await db.exec("reset role");
      }
    };
    expect(await info()).not.toBeNull();
    await db.query("update companies set access_until = public._today() - 1 where id = $1", [S]);
    expect(await info()).toBeNull();
  });
});
