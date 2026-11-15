-- Thigu Gestão — estoque, venda no balcão, devolução e crediário (Fase 4, parte A).
-- Espelha src/lib/domain/stock.ts e o motor da prévia; tests/db.test.ts testa as mesmas regras.
--
--   cadastram produtos e preços ...... admin, gestor
--   dão entrada e ajustam estoque .... admin, gestor, financeiro
--   vendem, devolvem e recebem ....... quem opera o caixa (admin, financeiro, recepção, caixa, vendedor)
--   desconto ......................... admin e gestor à vontade; os demais até 10% da venda
--   limite de crediário .............. admin, financeiro
--
-- O estoque de cada produto é a soma das movimentações (entrada, venda, devolução, ajuste, perda),
-- que nunca são apagadas. Venda no crediário vira parcelas a receber (origem 'crediario'), dentro do limite
-- do cliente. Devolução volta o item para o estoque e devolve o dinheiro pelo caixa aberto.

-- ---------------------------------------------------------------- 1. Produto completo

alter table public.products
  add column sku text not null default '' check (length(sku) <= 40),
  add column barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z-]{4,40}$'),
  add column cost_cents bigint not null default 0 check (cost_cents between 0 and 10000000000),
  add column track_stock boolean not null default false,
  add column stock_qty integer not null default 0,
  add column min_stock integer not null default 0 check (min_stock between 0 and 1000000),
  add column size text not null default '' check (length(size) <= 20),
  add column color text not null default '' check (length(color) <= 30),
  -- autopeças: em quais carros a peça serve (aplicação)
  add column fits text not null default '' check (length(fits) <= 300);
create unique index products_barcode_unique on public.products (company_id, barcode) where barcode is not null;
-- o saldo do estoque só muda pelas movimentações
grant update (sku, barcode, cost_cents, track_stock, min_stock, size, color, fits) on public.products to authenticated;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null,
  kind text not null check (kind in ('entrada', 'venda', 'devolucao', 'ajuste', 'perda')),
  quantity integer not null check (quantity <> 0 and quantity between -1000000 and 1000000),
  unit_cost_cents bigint check (unit_cost_cents between 0 and 10000000000),
  sale_id uuid,
  reason text not null default '' check (length(reason) <= 200),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, product_id) references public.products (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id)
);
create index stock_movements_product_idx on public.stock_movements (company_id, product_id, created_at);
create trigger stock_movements_no_delete before delete on public.stock_movements for each row execute function public.forbid_delete();

create or replace function public.apply_stock_movement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update products set stock_qty = stock_qty + new.quantity where id = new.product_id;
  return new;
end $$;
create trigger stock_movements_apply after insert on public.stock_movements for each row execute function public.apply_stock_movement();

alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from anon;
grant select on public.stock_movements to authenticated;
create policy stock_movements_select on public.stock_movements for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'estoque')
);

-- ---------------------------------------------------------------- 2. Venda no balcão

create table public.counter_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  session_id uuid not null,
  client_id uuid,
  subtotal_cents bigint not null check (subtotal_cents > 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  payment text not null check (payment in ('avista', 'crediario')),
  method public.payment_method,
  request_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, request_id),
  foreign key (company_id, session_id) references public.cash_sessions (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  check (discount_cents <= subtotal_cents and total_cents = subtotal_cents - discount_cents)
);
create trigger counter_sales_no_delete before delete on public.counter_sales for each row execute function public.forbid_delete();

alter table public.cash_sale_items
  add column sale_id uuid,
  add column returned_qty integer not null default 0,
  add foreign key (company_id, sale_id) references public.counter_sales (company_id, id),
  add constraint cash_sale_items_returned check (returned_qty between 0 and quantity);
alter table public.accounts
  add column counter_sale_id uuid,
  add foreign key (company_id, counter_sale_id) references public.counter_sales (company_id, id);
alter table public.stock_movements
  add foreign key (company_id, sale_id) references public.counter_sales (company_id, id);

alter table public.counter_sales enable row level security;
revoke all on public.counter_sales from anon;
grant select on public.counter_sales to authenticated;
create policy counter_sales_select on public.counter_sales for select to authenticated using (
  public.is_member(company_id) and (public.operates_cash(company_id) or public.has_role(company_id, array['admin', 'financeiro']::app_role[]))
);

-- ---------------------------------------------------------------- 3. Crediário: limite por cliente

alter table public.clients add column credit_limit_cents bigint check (credit_limit_cents between 0 and 10000000000);

-- Quem cobra no balcão (recepção, caixa e, no comércio, o vendedor) vê as contas do balcão e do crediário.
create or replace function public.can_see_account(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a
    where a.id = aid and public.is_member(a.company_id)
      and (public.has_role(a.company_id, array['admin', 'financeiro']::app_role[])
           or (a.kind = 'receber' and a.sale_id is not null
               and exists (select 1 from sales s where s.id = a.sale_id and public.can_see_deal(s.deal_id)))
           or (a.kind = 'receber' and a.origin in ('atendimento', 'pacote', 'mensalidade', 'caixa', 'crediario')
               and public.module_enabled(a.company_id, 'caixa')
               and public.has_role(a.company_id, array['recepcao', 'caixa', 'vendedor']::app_role[])))
  );
$$;

alter policy accounts_select on public.accounts using (
  public.is_member(company_id) and (public.has_role(company_id, array['admin', 'financeiro']::app_role[])
    or (kind = 'receber' and sale_id is not null and exists (select 1 from sales s where s.id = accounts.sale_id and public.can_see_deal(s.deal_id)))
    or (kind = 'receber' and origin in ('atendimento', 'pacote', 'mensalidade', 'caixa', 'crediario')
        and public.module_enabled(company_id, 'caixa') and public.has_role(company_id, array['recepcao', 'caixa', 'vendedor']::app_role[])))
);

-- O que o cliente ainda deve no crediário (parcelas não canceladas, menos o que já pagou).
create or replace function public.credit_used(p_client uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(a.amount_cents - coalesce((select sum(m.amount_cents) from movements m where m.account_id = a.id and m.undone_at is null), 0)), 0)::bigint
  from accounts a where a.client_id = p_client and a.origin = 'crediario' and a.canceled_at is null;
$$;

create or replace function public.set_credit_limit(p_client uuid, p_limit bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); c clients%rowtype;
begin
  select * into c from clients where id = p_client;
  if not found or not public.can_see_client(c.id) then raise exception 'Cliente não encontrado' using errcode = 'P0002'; end if;
  if not public.module_enabled(c.company_id, 'estoque') then
    raise exception 'Este recurso não está disponível para o ramo ou o plano da empresa.' using errcode = '42501';
  end if;
  perform public._require_role(c.company_id, array['admin', 'financeiro']::app_role[], 'Somente o financeiro ou o dono definem o limite de crediário.');
  if p_limit is not null and (p_limit < 0 or p_limit > 10000000000) then raise exception 'Limite inválido.' using errcode = '22023'; end if;
  update clients set credit_limit_cents = p_limit where id = c.id;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (c.company_id, c.id, 'crediario',
          case when p_limit is null then 'Crediário desligado' else 'Limite de crediário: ' || public._fmt_brl(p_limit) end, me);
end $$;

-- ---------------------------------------------------------------- 4. Funções do estoque

create or replace function public.stock_entry(p_product uuid, p_quantity integer, p_unit_cost bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); p products%rowtype;
begin
  select * into p from products where id = p_product for update;
  if not found or not public.is_member(p.company_id) then raise exception 'Produto não encontrado' using errcode = 'P0002'; end if;
  if not public.module_enabled(p.company_id, 'estoque') then
    raise exception 'Este recurso não está disponível para o ramo ou o plano da empresa.' using errcode = '42501';
  end if;
  perform public._require_role(p.company_id, array['admin', 'gestor', 'financeiro']::app_role[], 'Seu papel nesta empresa não permite mexer no estoque.');
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then raise exception 'Quantidade inválida.' using errcode = '22023'; end if;
  insert into stock_movements (company_id, product_id, kind, quantity, unit_cost_cents, reason, created_by)
  values (p.company_id, p.id, 'entrada', p_quantity, p_unit_cost, coalesce(trim(p_reason), ''), me);
  -- quem dá entrada passa a controlar o estoque do produto; o custo fica o da última compra
  update products set track_stock = true, cost_cents = coalesce(p_unit_cost, cost_cents) where id = p.id;
end $$;

-- Ajuste (contagem) ou perda: o banco recebe a diferença; a perda sempre tira do estoque.
create or replace function public.stock_adjust(p_product uuid, p_delta integer, p_kind text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); p products%rowtype;
begin
  select * into p from products where id = p_product for update;
  if not found or not public.is_member(p.company_id) then raise exception 'Produto não encontrado' using errcode = 'P0002'; end if;
  if not public.module_enabled(p.company_id, 'estoque') then
    raise exception 'Este recurso não está disponível para o ramo ou o plano da empresa.' using errcode = '42501';
  end if;
  perform public._require_role(p.company_id, array['admin', 'gestor', 'financeiro']::app_role[], 'Seu papel nesta empresa não permite mexer no estoque.');
  if p_kind not in ('ajuste', 'perda') or p_delta is null or p_delta = 0 or (p_kind = 'perda' and p_delta > 0) then
    raise exception 'Ajuste inválido.' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escreva o motivo do ajuste.' using errcode = '22023'; end if;
  if p.stock_qty + p_delta < 0 then raise exception 'O estoque não pode ficar negativo.' using errcode = '22023'; end if;
  insert into stock_movements (company_id, product_id, kind, quantity, reason, created_by)
  values (p.company_id, p.id, p_kind, p_delta, trim(p_reason), me);
  update products set track_stock = true where id = p.id;
end $$;

-- ---------------------------------------------------------------- 5. Venda no balcão (à vista ou no crediário)

create or replace function public.counter_sale(
  p_session uuid, p_client uuid, p_items jsonb, p_discount bigint, p_method public.payment_method, p_plan jsonb, p_request uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid(); s cash_sessions%rowtype; item jsonb; n int; v_sub bigint := 0; v_total bigint; v_disc bigint := coalesce(p_discount, 0);
  v_sale counter_sales%rowtype; v_acc uuid; v_first_acc uuid; v_first text; pr products%rowtype; inst jsonb; k int;
  v_credit boolean := p_plan is not null and jsonb_typeof(p_plan) = 'array' and jsonb_array_length(p_plan) > 0;
  v_limit bigint; v_stock boolean;
begin
  s := public._open_session(p_session);
  select * into v_sale from counter_sales where company_id = s.company_id and request_id = p_request;
  if found then return jsonb_build_object('sale_id', v_sale.id, 'duplicate', true); end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Itens inválidos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 30 then raise exception 'Use de 1 a 30 itens.' using errcode = '22023'; end if;
  if p_client is not null and not public.can_see_client(p_client) then raise exception 'Cliente não encontrado' using errcode = 'P0002'; end if;
  v_stock := public.module_enabled(s.company_id, 'estoque');
  for item in select * from jsonb_array_elements(p_items) loop
    if coalesce((item ->> 'quantity')::int, 0) < 1 or (item ->> 'quantity')::int > 999 or coalesce((item ->> 'unit_cents')::bigint, 0) < 1 then
      raise exception 'Cada item precisa ter quantidade e valor.' using errcode = '22023';
    end if;
    if length(trim(coalesce(item ->> 'description', ''))) not between 1 and 120 then
      raise exception 'Descreva cada item.' using errcode = '22023';
    end if;
    v_sub := v_sub + (item ->> 'quantity')::int * (item ->> 'unit_cents')::bigint;
  end loop;
  -- estoque: trava os produtos e confere o saldo (somando o mesmo produto em linhas diferentes)
  if v_stock then
    for item in
      select jsonb_build_object('product_id', x ->> 'product_id', 'quantity', sum((x ->> 'quantity')::int))
      from jsonb_array_elements(p_items) x where nullif(x ->> 'product_id', '') is not null group by x ->> 'product_id'
    loop
      select * into pr from products where id = (item ->> 'product_id')::uuid and company_id = s.company_id for update;
      if not found then raise exception 'Produto não encontrado' using errcode = 'P0002'; end if;
      if pr.track_stock and pr.stock_qty < (item ->> 'quantity')::int then
        raise exception 'Estoque insuficiente de % (tem %).', pr.name, pr.stock_qty using errcode = 'P0001';
      end if;
    end loop;
  end if;
  if v_disc < 0 or v_disc >= v_sub then raise exception 'O desconto precisa ser menor que o valor da venda.' using errcode = '22023'; end if;
  if not public.has_role(s.company_id, array['admin', 'gestor']::app_role[]) and v_disc * 10 > v_sub then
    raise exception 'Você pode dar até 10%% de desconto. Acima disso, peça ao dono.' using errcode = '42501';
  end if;
  v_total := v_sub - v_disc;

  if v_credit then
    if p_client is null then raise exception 'Escolha o cliente do crediário.' using errcode = '22023'; end if;
    if not public.module_enabled(s.company_id, 'estoque') then
      raise exception 'O crediário não está disponível para o ramo da empresa.' using errcode = '42501';
    end if;
    perform 1 from clients where id = p_client for update;
    select credit_limit_cents into v_limit from clients where id = p_client;
    if v_limit is null then raise exception 'Este cliente não tem crediário liberado.' using errcode = 'P0001'; end if;
    if public.credit_used(p_client) + v_total > v_limit then
      raise exception 'Passa do limite do crediário (disponível %).', public._fmt_brl(greatest(0, v_limit - public.credit_used(p_client))) using errcode = 'P0001';
    end if;
    perform public._check_plan(p_plan, v_total);
  elsif p_method is null then
    raise exception 'Escolha a forma de pagamento.' using errcode = '22023';
  end if;

  insert into counter_sales (company_id, session_id, client_id, subtotal_cents, discount_cents, total_cents, payment, method, request_id, created_by)
  values (s.company_id, s.id, p_client, v_sub, v_disc, v_total, case when v_credit then 'crediario' else 'avista' end,
          case when v_credit then null else p_method end, p_request, me)
  returning * into v_sale;

  v_first := trim(p_items -> 0 ->> 'description') || case when n > 1 then ' e mais ' || (n - 1) else '' end;
  if v_credit then
    k := jsonb_array_length(p_plan);
    for inst in select * from jsonb_array_elements(p_plan) loop
      insert into accounts (company_id, kind, client_id, description, origin, counter_sale_id, installment_number, installment_count,
                            amount_cents, due_date, created_by)
      values (s.company_id, 'receber', p_client, 'Crediário: ' || v_first, 'crediario', v_sale.id,
              (inst ->> 'number')::smallint, k, (inst ->> 'amount_cents')::bigint, (inst ->> 'due_date')::date, me)
      returning id into v_acc;
      v_first_acc := coalesce(v_first_acc, v_acc);
    end loop;
  else
    insert into accounts (company_id, kind, client_id, description, origin, counter_sale_id, amount_cents, due_date, created_by)
    values (s.company_id, 'receber', p_client, 'Venda no caixa: ' || v_first, 'caixa', v_sale.id, v_total, current_date, me)
    returning id into v_first_acc;
    insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
    values (s.company_id, v_first_acc, 'entrada', v_total, current_date, p_method, me, p_request, s.id);
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    insert into cash_sale_items (company_id, account_id, sale_id, product_id, service_id, description, quantity, unit_cents)
    values (s.company_id, v_first_acc, v_sale.id, nullif(item ->> 'product_id', '')::uuid, nullif(item ->> 'service_id', '')::uuid,
            trim(item ->> 'description'), (item ->> 'quantity')::int, (item ->> 'unit_cents')::bigint);
    if v_stock and nullif(item ->> 'product_id', '') is not null
       and (select track_stock from products where id = (item ->> 'product_id')::uuid) then
      insert into stock_movements (company_id, product_id, kind, quantity, sale_id, created_by)
      values (s.company_id, (item ->> 'product_id')::uuid, 'venda', -(item ->> 'quantity')::int, v_sale.id, me);
    end if;
  end loop;
  if p_client is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (s.company_id, p_client, 'caixa',
            case when v_credit then 'Compra no crediário: ' else 'Compra no caixa: ' end || public._fmt_brl(v_total), me);
  end if;
  return jsonb_build_object('sale_id', v_sale.id, 'account_id', v_first_acc, 'total_cents', v_total, 'duplicate', false);
end $$;

-- A venda simples do caixa (Fase 2) passa a usar a mesma regra, com estoque.
create or replace function public.cash_sale(p_session uuid, p_client uuid, p_items jsonb, p_method public.payment_method, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  r := public.counter_sale(p_session, p_client, p_items, 0, p_method, null, p_request);
  if (r ->> 'duplicate')::boolean then
    return jsonb_build_object('account_id', (select a.id from accounts a where a.counter_sale_id = (r ->> 'sale_id')::uuid order by a.installment_number limit 1), 'duplicate', true);
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------- 6. Devolução

-- Devolve itens de uma venda paga na hora: voltam para o estoque e o dinheiro sai pelo caixa aberto
-- (proporcional ao desconto da venda). Venda no crediário é resolvida no financeiro (cancelar parcelas).
create or replace function public.counter_return(p_sale uuid, p_items jsonb, p_method public.payment_method, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid(); v counter_sales%rowtype; s cash_sessions%rowtype; item jsonb; it cash_sale_items%rowtype;
  v_lines bigint := 0; v_refund bigint; v_acc uuid; q int; m movements%rowtype; v_count int := 0;
begin
  select * into v from counter_sales where id = p_sale for update;
  if not found or not public.is_member(v.company_id) or not public.operates_cash(v.company_id) then
    raise exception 'Venda não encontrada' using errcode = 'P0002';
  end if;
  select * into m from movements where company_id = v.company_id and request_id = p_request;
  if found then return jsonb_build_object('duplicate', true); end if;
  if v.payment <> 'avista' then
    raise exception 'Venda no crediário: cancele as parcelas no financeiro e dê entrada do item no estoque.' using errcode = 'P0001';
  end if;
  select * into s from cash_sessions where company_id = v.company_id and closed_at is null;
  if not found then raise exception 'Abra o caixa para devolver o dinheiro.' using errcode = 'P0001'; end if;
  if p_method is null then raise exception 'Escolha como o dinheiro volta para o cliente.' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha o que está sendo devolvido.' using errcode = '22023';
  end if;
  for item in select * from jsonb_array_elements(p_items) loop
    q := coalesce((item ->> 'quantity')::int, 0);
    select * into it from cash_sale_items where id = (item ->> 'item_id')::uuid and sale_id = v.id for update;
    if not found then raise exception 'Item não encontrado nesta venda' using errcode = 'P0002'; end if;
    if q < 1 or q > it.quantity - it.returned_qty then
      raise exception 'Só dá para devolver % de %.', it.quantity - it.returned_qty, it.description using errcode = '22023';
    end if;
    update cash_sale_items set returned_qty = returned_qty + q where id = it.id;
    v_lines := v_lines + q * it.unit_cents;
    v_count := v_count + q;
    if it.product_id is not null and public.module_enabled(v.company_id, 'estoque')
       and (select track_stock from products where id = it.product_id) then
      insert into stock_movements (company_id, product_id, kind, quantity, sale_id, reason, created_by)
      values (v.company_id, it.product_id, 'devolucao', q, v.id, 'Devolução', me);
    end if;
  end loop;
  v_refund := round(v_lines::numeric * v.total_cents / v.subtotal_cents)::bigint;
  insert into accounts (company_id, kind, client_id, supplier, description, origin, counter_sale_id, amount_cents, due_date, category, created_by)
  values (v.company_id, 'pagar', v.client_id, coalesce((select name from clients where id = v.client_id), 'Cliente do balcão'),
          'Devolução de ' || v_count || case when v_count = 1 then ' item' else ' itens' end, 'devolucao', v.id, v_refund, current_date,
          'Devoluções', me)
  returning id into v_acc;
  insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
  values (v.company_id, v_acc, 'saida', v_refund, current_date, p_method, me, p_request, s.id);
  if v.client_id is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (v.company_id, v.client_id, 'caixa', 'Devolução: ' || public._fmt_brl(v_refund), me);
  end if;
  return jsonb_build_object('duplicate', false, 'refund_cents', v_refund);
end $$;

-- ---------------------------------------------------------------- 7. Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('apply_stock_movement')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'can_see_account', 'credit_used', 'set_credit_limit', 'stock_entry', 'stock_adjust', 'counter_sale', 'cash_sale',
             'counter_return')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
