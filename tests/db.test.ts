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
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const db = new PGlite();
const U = { ana: randomUUID(), vend: randomUUID(), fin: randomUUID(), outro: randomUUID() };
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
  A = (await as(U.ana, () => one<{ id: string }>("select public.create_company('Aurora Estúdio') as id"))).id;
  B = (await as(U.outro, () => one<{ id: string }>("select public.create_company('Horizonte Serviços') as id"))).id;
  await inviteAndAccept(A, U.ana, "vend@exemplo.test", "{vendedor}", U.vend);
  await inviteAndAccept(A, U.ana, "fin@exemplo.test", "{financeiro}", U.fin);
}, 120_000);

describe("caso de aceitação no banco", () => {
  let clientId = "";
  let dealId = "";
  let saleId = "";
  let firstAccount = "";

  it("perfil criado automaticamente e empresa com dono administrador", async () => {
    expect((await one<{ c: number }>("select count(*)::int c from profiles")).c).toBe(4);
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

// Brechas fechadas em 20261114000003_security_fixes.sql. Todas valiam para quem chama o banco
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

// 20261114000004_invites.sql: ninguém entra numa empresa sem aceitar o convite.
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
// (20261114000005_segment_roles.sql e 20261114000006_segments.sql).
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
    P = (await as(U.ana, () => one<{ id: string }>("select public.create_company('Amigo Fiel', 'pet') as id"))).id;
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
