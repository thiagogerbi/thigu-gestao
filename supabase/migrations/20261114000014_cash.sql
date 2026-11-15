-- Thigu Gestão — caixa do dia (Fase 2, parte B)
-- Espelha src/lib/domain/cash.ts e permissions.ts.
--
--   abrem o caixa, vendem e recebem ... admin, financeiro, recepção, caixa, vendedor
--   fecham e conferem ................. admin, financeiro
-- Só com o módulo 'caixa' ligado. Uma sessão de caixa aberta por empresa.
-- Toda venda vira conta a receber (origem 'caixa') já com o recebimento registrado, e todo
-- recebimento no caixa é um movimento ligado à sessão: o financeiro continua sendo a fonte da verdade.

create or replace function public.operates_cash(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'caixa')
     and public.has_role(cid, array['admin', 'financeiro', 'recepcao', 'caixa', 'vendedor']::app_role[]);
$$;

-- ---------------------------------------------------------------- Produtos (simples; estoque vem na fase 4)

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  price_cents bigint not null default 0 check (price_cents between 0 and 10000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
alter table public.products enable row level security;
revoke all on public.products from anon;
grant select, insert on public.products to authenticated;
grant update (name, price_cents, active) on public.products to authenticated;
create policy products_select on public.products for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'caixa')
);
create policy products_insert on public.products for insert to authenticated with check (
  public.module_enabled(company_id, 'caixa') and public.has_role(company_id, array['admin', 'gestor']::app_role[])
);
create policy products_update on public.products for update to authenticated
  using (public.module_enabled(company_id, 'caixa') and public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  with check (public.module_enabled(company_id, 'caixa') and public.has_role(company_id, array['admin', 'gestor']::app_role[]));

-- ---------------------------------------------------------------- Sessões de caixa

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  opening_cents bigint not null default 0 check (opening_cents between 0 and 100000000),
  closed_by uuid,
  closed_at timestamptz,
  expected_cents bigint,
  counted_cents bigint check (counted_cents is null or counted_cents between 0 and 1000000000),
  notes text not null default '' check (length(notes) <= 500),
  unique (company_id, id),
  foreign key (company_id, opened_by) references public.memberships (company_id, user_id)
);
create unique index cash_sessions_one_open on public.cash_sessions (company_id) where closed_at is null;
create trigger cash_sessions_no_delete before delete on public.cash_sessions for each row execute function public.forbid_delete();

alter table public.cash_sessions enable row level security;
revoke all on public.cash_sessions from anon;
grant select on public.cash_sessions to authenticated;
create policy cash_sessions_select on public.cash_sessions for select to authenticated using (
  public.is_member(company_id) and public.operates_cash(company_id)
);

alter table public.movements
  add column cash_session_id uuid,
  add foreign key (company_id, cash_session_id) references public.cash_sessions (company_id, id);

-- Itens de uma venda no caixa (o total está na conta a receber).
create table public.cash_sale_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  account_id uuid not null,
  product_id uuid,
  service_id uuid,
  description text not null check (length(trim(description)) between 1 and 120),
  quantity integer not null check (quantity between 1 and 999),
  unit_cents bigint not null check (unit_cents between 1 and 10000000000),
  foreign key (company_id, account_id) references public.accounts (company_id, id),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, service_id) references public.services (company_id, id)
);
create index cash_sale_items_account_idx on public.cash_sale_items (account_id);
alter table public.cash_sale_items enable row level security;
revoke all on public.cash_sale_items from anon;
grant select on public.cash_sale_items to authenticated;

-- ---------------------------------------------------------------- Quem vê as contas a receber
-- A recepção e o caixa recebem o que o cliente deve (atendimentos, pacotes, mensalidades e vendas no
-- caixa), então passam a ver essas contas — só nos ramos com caixa. As demais continuam como estavam.

create or replace function public.can_see_account(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a
    where a.id = aid and public.is_member(a.company_id)
      and (public.has_role(a.company_id, array['admin', 'financeiro']::app_role[])
           or (a.kind = 'receber' and a.sale_id is not null
               and exists (select 1 from sales s where s.id = a.sale_id and public.can_see_deal(s.deal_id)))
           or (a.kind = 'receber' and a.origin in ('atendimento', 'pacote', 'mensalidade', 'caixa')
               and public.module_enabled(a.company_id, 'caixa')
               and public.has_role(a.company_id, array['recepcao', 'caixa']::app_role[])))
  );
$$;

alter policy accounts_select on public.accounts using (
  public.is_member(company_id) and (public.has_role(company_id, array['admin', 'financeiro']::app_role[])
    or (kind = 'receber' and sale_id is not null and exists (select 1 from sales s where s.id = accounts.sale_id and public.can_see_deal(s.deal_id)))
    or (kind = 'receber' and origin in ('atendimento', 'pacote', 'mensalidade', 'caixa')
        and public.module_enabled(company_id, 'caixa') and public.has_role(company_id, array['recepcao', 'caixa']::app_role[])))
);

create policy cash_sale_items_select on public.cash_sale_items for select to authenticated using (
  public.can_see_account(account_id)
);

-- ---------------------------------------------------------------- Abrir, vender, receber, fechar

create or replace function public.open_cash(p_company uuid, p_opening bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); sid uuid;
begin
  if not public.is_member(p_company) or not public.operates_cash(p_company) then
    raise exception 'Seu papel nesta empresa não permite usar o caixa.' using errcode = '42501';
  end if;
  if exists (select 1 from cash_sessions where company_id = p_company and closed_at is null) then
    raise exception 'O caixa já está aberto.' using errcode = 'P0001';
  end if;
  insert into cash_sessions (company_id, opened_by, opening_cents) values (p_company, me, coalesce(p_opening, 0)) returning id into sid;
  return sid;
end $$;

create or replace function public._open_session(p_session uuid) returns public.cash_sessions
language plpgsql security definer set search_path = public as $$
declare s cash_sessions%rowtype;
begin
  select * into s from cash_sessions where id = p_session;
  if not found or not public.is_member(s.company_id) or not public.operates_cash(s.company_id) then
    raise exception 'Caixa não encontrado' using errcode = 'P0002';
  end if;
  if s.closed_at is not null then raise exception 'Este caixa já foi fechado. Abra o caixa de novo.' using errcode = 'P0001'; end if;
  return s;
end $$;

-- Venda rápida: itens [{product_id?, service_id?, description, quantity, unit_cents}], já paga.
create or replace function public.cash_sale(p_session uuid, p_client uuid, p_items jsonb, p_method public.payment_method, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid(); s cash_sessions%rowtype; item jsonb; v_total bigint := 0; n int; v_acc uuid; v_first text; m movements%rowtype;
begin
  s := public._open_session(p_session);
  select * into m from movements where company_id = s.company_id and request_id = p_request;
  if found then return jsonb_build_object('account_id', m.account_id, 'duplicate', true); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Itens inválidos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 30 then raise exception 'Use de 1 a 30 itens.' using errcode = '22023'; end if;
  if p_client is not null and not public.can_see_client(p_client) then raise exception 'Cliente não encontrado' using errcode = 'P0002'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if coalesce((item ->> 'quantity')::int, 0) < 1 or coalesce((item ->> 'unit_cents')::bigint, 0) < 1 then
      raise exception 'Cada item precisa ter quantidade e valor.' using errcode = '22023';
    end if;
    if length(trim(coalesce(item ->> 'description', ''))) not between 1 and 120 then
      raise exception 'Descreva cada item.' using errcode = '22023';
    end if;
    v_total := v_total + (item ->> 'quantity')::int * (item ->> 'unit_cents')::bigint;
  end loop;
  v_first := trim(p_items -> 0 ->> 'description');
  insert into accounts (company_id, kind, client_id, description, origin, amount_cents, due_date, created_by)
  values (s.company_id, 'receber', p_client,
          'Venda no caixa: ' || v_first || case when n > 1 then ' e mais ' || (n - 1) else '' end,
          'caixa', v_total, current_date, me)
  returning id into v_acc;
  for item in select * from jsonb_array_elements(p_items) loop
    insert into cash_sale_items (company_id, account_id, product_id, service_id, description, quantity, unit_cents)
    values (s.company_id, v_acc, nullif(item ->> 'product_id', '')::uuid, nullif(item ->> 'service_id', '')::uuid,
            trim(item ->> 'description'), (item ->> 'quantity')::int, (item ->> 'unit_cents')::bigint);
  end loop;
  insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
  values (s.company_id, v_acc, 'entrada', v_total, current_date, p_method, me, p_request, s.id);
  if p_client is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (s.company_id, p_client, 'caixa', 'Venda no caixa: ' || public._fmt_brl(v_total), me);
  end if;
  return jsonb_build_object('account_id', v_acc, 'total_cents', v_total, 'duplicate', false);
end $$;

-- Receber, no caixa, uma conta que o cliente deve.
create or replace function public.cash_receive(p_session uuid, p_account uuid, p_amount bigint, p_method public.payment_method, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); s cash_sessions%rowtype; a accounts%rowtype; v_balance bigint; m movements%rowtype;
begin
  s := public._open_session(p_session);
  select * into m from movements where company_id = s.company_id and request_id = p_request;
  if found then return jsonb_build_object('duplicate', true); end if;
  select * into a from accounts where id = p_account for update;
  if not found or a.company_id <> s.company_id or not public.can_see_account(a.id) or a.kind <> 'receber' then
    raise exception 'Conta não encontrada' using errcode = 'P0002';
  end if;
  if a.canceled_at is not null then raise exception 'Esta conta foi cancelada.' using errcode = 'P0001'; end if;
  v_balance := a.amount_cents - coalesce((select sum(amount_cents) from movements where account_id = a.id and undone_at is null), 0);
  if p_amount is null or p_amount <= 0 then raise exception 'Informe um valor maior que zero.' using errcode = '22023'; end if;
  if p_amount > v_balance then
    raise exception 'O valor passa do que falta receber (%).', public._fmt_brl(v_balance) using errcode = '22023';
  end if;
  insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
  values (s.company_id, a.id, 'entrada', p_amount, current_date, p_method, me, p_request, s.id);
  if a.client_id is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (s.company_id, a.client_id, 'caixa', 'Recebido no caixa: ' || public._fmt_brl(p_amount) || ' (' || a.description || ')', me);
  end if;
  return jsonb_build_object('duplicate', false, 'balance_cents', v_balance - p_amount);
end $$;

-- Fechar: o esperado na gaveta é o troco inicial mais o que entrou em dinheiro nesta sessão.
create or replace function public.close_cash(p_session uuid, p_counted bigint, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); s cash_sessions%rowtype; v_expected bigint;
begin
  select * into s from cash_sessions where id = p_session for update;
  if not found or not public.is_member(s.company_id) then raise exception 'Caixa não encontrado' using errcode = 'P0002'; end if;
  perform public._require_role(s.company_id, array['admin', 'financeiro']::app_role[], 'Somente o financeiro ou o dono fecham o caixa.');
  if s.closed_at is not null then raise exception 'Este caixa já foi fechado.' using errcode = 'P0001'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'Informe quanto há em dinheiro na gaveta.' using errcode = '22023'; end if;
  v_expected := s.opening_cents + coalesce((
    select sum(case when direction = 'entrada' then amount_cents else -amount_cents end)
    from movements where cash_session_id = s.id and method = 'dinheiro' and undone_at is null), 0);
  update cash_sessions set closed_at = now(), closed_by = me, expected_cents = v_expected, counted_cents = p_counted,
    notes = coalesce(trim(p_notes), '') where id = s.id;
  return jsonb_build_object('expected_cents', v_expected, 'difference_cents', p_counted - v_expected);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'operates_cash', 'can_see_account', 'open_cash', '_open_session', 'cash_sale', 'cash_receive', 'close_cash')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
