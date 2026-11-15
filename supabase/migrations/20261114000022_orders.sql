-- Thigu Gestão — pedidos com prazo e receita de óculos (Fase 4, parte B).
-- Espelha src/lib/domain/orders.ts e o motor da prévia; tests/db.test.ts testa as mesmas regras.
--
-- Para ótica, costura, lavanderia, gráfica: o pedido entra com o que será feito, a data prometida e,
-- se houver, o sinal pago na hora (entra no caixa). Passa pelas etapas (recebido, em produção, no
-- laboratório ou fornecedor, pronto) e, na entrega, o restante vira conta a receber.
--
--   veem todos ............. admin, gestor, recepção (atendente), financeiro
--   abrem, mudam e cancelam . admin, gestor, recepção
--   o técnico .............. vê os pedidos dele e move entre em produção, no laboratório e pronto
--   entregam e cobram ...... admin, gestor, recepção, financeiro
--   receita de óculos ...... dado de saúde: lê e escreve quem atende (admin, recepção, técnico), não o caixa nem o financeiro

-- ---------------------------------------------------------------- 1. Catálogo: módulo "receita"

alter table public.companies drop constraint companies_extra_modules_check;
alter table public.companies add constraint companies_extra_modules_check check (
  extra_modules <@ array['itens', 'agenda', 'servicos', 'prontuario', 'lembretes', 'pacotes', 'mensalidades', 'turmas',
                         'comissoes', 'caixa', 'agendamento_online', 'lembrete_automatico', 'ordem_servico', 'estoque', 'pedidos',
                         'receita']::text[]
);

create or replace function public._segment_modules(s public.company_segment) returns text[]
language sql immutable as $$
  select case s
    when 'geral' then array[]::text[]
    when 'clinica' then array['agenda', 'servicos', 'prontuario', 'lembretes', 'pacotes', 'mensalidades', 'agendamento_online', 'lembrete_automatico']
    when 'beleza' then array['agenda', 'servicos', 'lembretes', 'pacotes', 'mensalidades', 'caixa', 'comissoes', 'agendamento_online', 'lembrete_automatico']
    when 'pet' then array['itens', 'agenda', 'servicos', 'lembretes', 'pacotes', 'caixa', 'agendamento_online', 'lembrete_automatico']
    when 'turmas' then array['agenda', 'servicos', 'lembretes', 'turmas', 'mensalidades', 'lembrete_automatico']
    when 'veiculos' then array['itens', 'ordem_servico', 'servicos', 'lembretes', 'comissoes']
    when 'balcao' then array['caixa', 'estoque']
    when 'pedidos' then array['pedidos', 'receita', 'lembretes', 'caixa', 'estoque']
  end;
$$;

-- Quem atende (técnicos) também nos pedidos.
alter policy resources_select on public.resources using (
  public.is_member(company_id) and (public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico')
                                    or public.module_enabled(company_id, 'pedidos'))
);
alter policy resources_insert on public.resources with check (
  (public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico') or public.module_enabled(company_id, 'pedidos'))
  and public.has_role(company_id, array['admin', 'gestor']::app_role[])
);
alter policy resources_update on public.resources
  using ((public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico') or public.module_enabled(company_id, 'pedidos'))
         and public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  with check ((public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico') or public.module_enabled(company_id, 'pedidos'))
              and public.has_role(company_id, array['admin', 'gestor']::app_role[]));

-- ---------------------------------------------------------------- 2. Receita de óculos

create table public.prescriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  examined_on date not null,
  valid_until date not null,
  doctor text not null default '' check (length(doctor) <= 120),
  -- olho direito (OD) e esquerdo (OE): esférico, cilíndrico, eixo e adição
  od_sph numeric(5, 2) check (od_sph between -30 and 30 and mod(od_sph * 100, 25) = 0),
  od_cyl numeric(5, 2) check (od_cyl between -15 and 15 and mod(od_cyl * 100, 25) = 0),
  od_axis smallint check (od_axis between 0 and 180),
  od_add numeric(4, 2) check (od_add between 0 and 5 and mod(od_add * 100, 25) = 0),
  oe_sph numeric(5, 2) check (oe_sph between -30 and 30 and mod(oe_sph * 100, 25) = 0),
  oe_cyl numeric(5, 2) check (oe_cyl between -15 and 15 and mod(oe_cyl * 100, 25) = 0),
  oe_axis smallint check (oe_axis between 0 and 180),
  oe_add numeric(4, 2) check (oe_add between 0 and 5 and mod(oe_add * 100, 25) = 0),
  -- distância naso-pupilar de cada olho, em milímetros
  dnp_od numeric(4, 1) check (dnp_od between 20 and 45),
  dnp_oe numeric(4, 1) check (dnp_oe between 20 and 45),
  notes text not null default '' check (length(notes) <= 500),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  check (valid_until >= examined_on),
  check ((od_cyl is null) = (od_axis is null) or od_cyl = 0),
  check ((oe_cyl is null) = (oe_axis is null) or oe_cyl = 0)
);
create index prescriptions_client_idx on public.prescriptions (company_id, client_id, examined_on desc);
create trigger prescriptions_no_delete before delete on public.prescriptions for each row execute function public.forbid_delete();

create or replace function public.reads_prescriptions(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'receita') and public.has_role(cid, array['admin', 'recepcao', 'profissional']::app_role[]);
$$;

alter table public.prescriptions enable row level security;
revoke all on public.prescriptions from anon;
-- receita não se corrige: lança-se uma nova (o histórico fica)
grant select, insert on public.prescriptions to authenticated;
create policy prescriptions_select on public.prescriptions for select to authenticated using (
  public.reads_prescriptions(company_id) and public.can_see_client(client_id)
);
create policy prescriptions_insert on public.prescriptions for insert to authenticated with check (
  public.reads_prescriptions(company_id) and public.can_see_client(client_id) and created_by = auth.uid()
);

-- ---------------------------------------------------------------- 3. Pedidos

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number integer not null check (number > 0),
  client_id uuid not null,
  resource_id uuid,
  prescription_id uuid,
  title text not null check (length(trim(title)) between 1 and 120),
  details text not null default '' check (length(details) <= 1000),
  stage text not null default 'recebido' check (stage in ('recebido', 'producao', 'terceiro', 'pronto', 'entregue', 'cancelado')),
  promised_on date not null,
  total_cents bigint not null check (total_cents between 0 and 10000000000),
  down_cents bigint not null default 0 check (down_cents >= 0),
  ready_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 300),
  request_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  unique (company_id, request_id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, resource_id) references public.resources (company_id, id),
  foreign key (company_id, prescription_id) references public.prescriptions (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  check (down_cents <= total_cents)
);
create index orders_stage_idx on public.orders (company_id, stage);
create trigger orders_no_delete before delete on public.orders for each row execute function public.forbid_delete();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null,
  product_id uuid,
  description text not null check (length(trim(description)) between 1 and 120),
  quantity integer not null check (quantity between 1 and 999),
  unit_cents bigint not null check (unit_cents between 0 and 10000000000),
  foreign key (company_id, order_id) references public.orders (company_id, id),
  foreign key (company_id, product_id) references public.products (company_id, id)
);
create index order_items_order_idx on public.order_items (company_id, order_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  order_id uuid not null,
  description text not null check (length(description) <= 300),
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (company_id, order_id) references public.orders (company_id, id)
);
create trigger order_events_no_delete before delete on public.order_events for each row execute function public.forbid_delete();

alter table public.accounts
  add column order_id uuid,
  add foreign key (company_id, order_id) references public.orders (company_id, id);
alter table public.stock_movements
  add column order_id uuid,
  add foreign key (company_id, order_id) references public.orders (company_id, id);

create or replace function public.sees_all_orders(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'pedidos') and public.has_role(cid, array['admin', 'gestor', 'recepcao', 'financeiro']::app_role[]);
$$;
create or replace function public.edits_orders(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'pedidos') and public.has_role(cid, array['admin', 'gestor', 'recepcao']::app_role[]);
$$;
create or replace function public.makes_order(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from orders o join resources r on r.id = o.resource_id
    where o.id = oid and r.user_id = auth.uid() and public.module_enabled(o.company_id, 'pedidos')
  );
$$;
create or replace function public.can_see_order(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from orders o where o.id = oid and public.sees_all_orders(o.company_id)) or public.makes_order(oid);
$$;

-- Quem atende (agenda), dá aula, cuida do carro ou faz o pedido passa a ver o cliente.
create or replace function public.attends_client(cid uuid, clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.module_enabled(cid, 'agenda') and exists (
            select 1 from appointments a join resources r on r.id = a.resource_id
            where a.client_id = clid and r.user_id = auth.uid()))
      or (public.module_enabled(cid, 'turmas') and exists (
            select 1 from enrollments e join classes c on c.id = e.class_id join resources r on r.id = c.resource_id
            where e.client_id = clid and e.ended_on is null and r.user_id = auth.uid()))
      or (public.module_enabled(cid, 'ordem_servico') and exists (
            select 1 from work_orders w join resources r on r.id = w.resource_id
            where w.client_id = clid and r.user_id = auth.uid()))
      or (public.module_enabled(cid, 'pedidos') and exists (
            select 1 from orders o join resources r on r.id = o.resource_id
            where o.client_id = clid and r.user_id = auth.uid()));
$$;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
revoke all on public.orders, public.order_items, public.order_events from anon;
grant select on public.orders, public.order_items, public.order_events to authenticated;
create policy orders_select on public.orders for select to authenticated using (public.can_see_order(id));
create policy order_items_select on public.order_items for select to authenticated using (public.can_see_order(order_id));
create policy order_events_select on public.order_events for select to authenticated using (public.can_see_order(order_id));

-- Quem cobra no balcão vê também as contas dos pedidos.
create or replace function public.can_see_account(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a
    where a.id = aid and public.is_member(a.company_id)
      and (public.has_role(a.company_id, array['admin', 'financeiro']::app_role[])
           or (a.kind = 'receber' and a.sale_id is not null
               and exists (select 1 from sales s where s.id = a.sale_id and public.can_see_deal(s.deal_id)))
           or (a.kind = 'receber' and a.origin in ('atendimento', 'pacote', 'mensalidade', 'caixa', 'crediario', 'pedido')
               and public.module_enabled(a.company_id, 'caixa')
               and public.has_role(a.company_id, array['recepcao', 'caixa', 'vendedor']::app_role[])))
  );
$$;
alter policy accounts_select on public.accounts using (
  public.is_member(company_id) and (public.has_role(company_id, array['admin', 'financeiro']::app_role[])
    or (kind = 'receber' and sale_id is not null and exists (select 1 from sales s where s.id = accounts.sale_id and public.can_see_deal(s.deal_id)))
    or (kind = 'receber' and origin in ('atendimento', 'pacote', 'mensalidade', 'caixa', 'crediario', 'pedido')
        and public.module_enabled(company_id, 'caixa') and public.has_role(company_id, array['recepcao', 'caixa', 'vendedor']::app_role[])))
);

-- ---------------------------------------------------------------- 4. Funções dos pedidos

create or replace function public._order_event(o public.orders, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into order_events (company_id, order_id, description, actor_id) values (o.company_id, o.id, p_text, auth.uid());
$$;

create or replace function public._order_for(p_order uuid, p_mode text) returns public.orders
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found or not public.can_see_order(o.id) then raise exception 'Pedido não encontrado' using errcode = 'P0002'; end if;
  if p_mode = 'editar' and not public.edits_orders(o.company_id) then
    raise exception 'Seu papel nesta empresa não permite alterar pedidos.' using errcode = '42501';
  elsif p_mode = 'tecnico' and not (public.edits_orders(o.company_id) or public.makes_order(o.id)) then
    raise exception 'Só o técnico responsável ou o atendimento mexem neste pedido.' using errcode = '42501';
  elsif p_mode = 'entregar' and not (public.edits_orders(o.company_id) or public.has_role(o.company_id, array['financeiro']::app_role[])) then
    raise exception 'Seu papel nesta empresa não permite entregar pedidos.' using errcode = '42501';
  end if;
  if o.stage in ('entregue', 'cancelado') then
    raise exception 'Este pedido já foi %.', case o.stage when 'entregue' then 'entregue' else 'cancelado' end using errcode = 'P0001';
  end if;
  return o;
end $$;

-- Abre o pedido. O sinal (se houver) é recebido na hora pelo caixa aberto; itens de produto saem do estoque.
create or replace function public.open_order(
  p_client uuid, p_title text, p_details text, p_promised date, p_resource uuid, p_prescription uuid,
  p_items jsonb, p_down bigint, p_method public.payment_method, p_request uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid(); c clients%rowtype; o orders%rowtype; v_num int; v_total bigint := 0; item jsonb; n int;
  s cash_sessions%rowtype; v_acc uuid; pr products%rowtype; v_down bigint := coalesce(p_down, 0);
begin
  select * into c from clients where id = p_client;
  if not found or not public.can_see_client(c.id) then raise exception 'Cliente não encontrado' using errcode = 'P0002'; end if;
  if not public.edits_orders(c.company_id) then raise exception 'Seu papel nesta empresa não permite abrir pedidos.' using errcode = '42501'; end if;
  select * into o from orders where company_id = c.company_id and request_id = p_request;
  if found then return jsonb_build_object('id', o.id, 'number', o.number, 'duplicate', true); end if;
  if p_promised is null or p_promised < current_date then raise exception 'A data prometida precisa ser hoje ou depois.' using errcode = '22023'; end if;
  if p_resource is not null and not exists (select 1 from resources where id = p_resource and company_id = c.company_id and active) then
    raise exception 'Técnico não encontrado' using errcode = 'P0002';
  end if;
  if p_prescription is not null and not exists (select 1 from prescriptions where id = p_prescription and client_id = c.id) then
    raise exception 'Esta receita não é deste cliente.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Itens inválidos' using errcode = '22023'; end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 30 then raise exception 'Use de 1 a 30 itens.' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(p_items) loop
    if coalesce((item ->> 'quantity')::int, 0) < 1 or (item ->> 'quantity')::int > 999 or coalesce((item ->> 'unit_cents')::bigint, -1) < 0
       or length(trim(coalesce(item ->> 'description', ''))) not between 1 and 120 then
      raise exception 'Confira os itens: cada um precisa de descrição, quantidade e valor.' using errcode = '22023';
    end if;
    v_total := v_total + (item ->> 'quantity')::int * (item ->> 'unit_cents')::bigint;
  end loop;
  if v_down < 0 or v_down > v_total then raise exception 'O sinal não pode passar do total do pedido.' using errcode = '22023'; end if;
  if v_down > 0 then
    if p_method is null then raise exception 'Escolha como o sinal foi pago.' using errcode = '22023'; end if;
    select * into s from cash_sessions where company_id = c.company_id and closed_at is null;
    if not found then raise exception 'Abra o caixa para receber o sinal.' using errcode = 'P0001'; end if;
    if not public.operates_cash(c.company_id) then raise exception 'Seu papel nesta empresa não permite usar o caixa.' using errcode = '42501'; end if;
  end if;
  -- estoque: confere e trava os produtos
  if public.module_enabled(c.company_id, 'estoque') then
    for item in
      select jsonb_build_object('product_id', x ->> 'product_id', 'quantity', sum((x ->> 'quantity')::int))
      from jsonb_array_elements(p_items) x where nullif(x ->> 'product_id', '') is not null group by x ->> 'product_id'
    loop
      select * into pr from products where id = (item ->> 'product_id')::uuid and company_id = c.company_id for update;
      if not found then raise exception 'Produto não encontrado' using errcode = 'P0002'; end if;
      if pr.track_stock and pr.stock_qty < (item ->> 'quantity')::int then
        raise exception 'Estoque insuficiente de % (tem %).', pr.name, pr.stock_qty using errcode = 'P0001';
      end if;
    end loop;
  end if;

  perform 1 from companies where id = c.company_id for update;
  select coalesce(max(number), 0) + 1 into v_num from orders where company_id = c.company_id;
  insert into orders (company_id, number, client_id, resource_id, prescription_id, title, details, promised_on, total_cents, down_cents,
                      request_id, created_by)
  values (c.company_id, v_num, c.id, p_resource, p_prescription, trim(p_title), coalesce(trim(p_details), ''), p_promised, v_total, v_down,
          p_request, me)
  returning * into o;
  for item in select * from jsonb_array_elements(p_items) loop
    insert into order_items (company_id, order_id, product_id, description, quantity, unit_cents)
    values (c.company_id, o.id, nullif(item ->> 'product_id', '')::uuid, trim(item ->> 'description'), (item ->> 'quantity')::int,
            (item ->> 'unit_cents')::bigint);
    if public.module_enabled(c.company_id, 'estoque') and nullif(item ->> 'product_id', '') is not null
       and (select track_stock from products where id = (item ->> 'product_id')::uuid) then
      insert into stock_movements (company_id, product_id, kind, quantity, order_id, reason, created_by)
      values (c.company_id, (item ->> 'product_id')::uuid, 'venda', -(item ->> 'quantity')::int, o.id, 'Pedido nº ' || v_num, me);
    end if;
  end loop;
  if v_down > 0 then
    insert into accounts (company_id, kind, client_id, description, origin, order_id, amount_cents, due_date, created_by)
    values (c.company_id, 'receber', c.id, 'Pedido nº ' || v_num || ' — sinal', 'pedido', o.id, v_down, current_date, me)
    returning id into v_acc;
    insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
    values (c.company_id, v_acc, 'entrada', v_down, current_date, p_method, me, p_request, s.id);
  end if;
  perform public._order_event(o, 'Pedido aberto' || case when v_down > 0 then ' com sinal de ' || public._fmt_brl(v_down) else '' end);
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (c.company_id, c.id, 'pedido', 'Pedido nº ' || v_num || ': ' || trim(p_title), me);
  return jsonb_build_object('id', o.id, 'number', v_num, 'duplicate', false);
end $$;

create or replace function public.save_order(p_order uuid, p_title text, p_details text, p_promised date, p_resource uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  o := public._order_for(p_order, 'editar');
  if p_promised is null then raise exception 'Informe a data prometida.' using errcode = '22023'; end if;
  if p_resource is not null and not exists (select 1 from resources where id = p_resource and company_id = o.company_id) then
    raise exception 'Técnico não encontrado' using errcode = 'P0002';
  end if;
  update orders set title = trim(p_title), details = coalesce(trim(p_details), ''), promised_on = p_promised, resource_id = p_resource
  where id = o.id;
  if p_promised <> o.promised_on then
    perform public._order_event(o, 'Nova data prometida: ' || to_char(p_promised, 'DD/MM/YYYY'));
  end if;
end $$;

-- Etapas: o atendimento move entre todas (menos entregue e cancelado); o técnico, entre em produção, no laboratório e pronto.
create or replace function public.move_order(p_order uuid, p_stage text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders%rowtype;
begin
  o := public._order_for(p_order, 'tecnico');
  if p_stage not in ('recebido', 'producao', 'terceiro', 'pronto') then raise exception 'Use entregar ou cancelar.' using errcode = '22023'; end if;
  if not public.edits_orders(o.company_id)
     and not (p_stage in ('producao', 'terceiro', 'pronto') and o.stage in ('recebido', 'producao', 'terceiro', 'pronto') and p_stage <> 'recebido') then
    raise exception 'O técnico move o pedido entre em produção, no laboratório e pronto.' using errcode = '42501';
  end if;
  if p_stage = o.stage then return; end if;
  update orders set stage = p_stage, ready_at = case when p_stage = 'pronto' then now() else null end where id = o.id;
  perform public._order_event(o, 'Etapa: ' || case p_stage when 'recebido' then 'recebido' when 'producao' then 'em produção'
    when 'terceiro' then 'no laboratório ou fornecedor' else 'pronto para retirar' end);
end $$;

-- Entrega: o restante (total − sinal) é recebido agora no caixa ou vira parcelas a receber.
create or replace function public.deliver_order(p_order uuid, p_method public.payment_method, p_plan jsonb, p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); o orders%rowtype; v_rest bigint; s cash_sessions%rowtype; v_acc uuid; inst jsonb; k int;
begin
  select * into o from orders where id = p_order;
  if found and exists (select 1 from movements where company_id = o.company_id and request_id = p_request) then
    return jsonb_build_object('duplicate', true);
  end if;
  o := public._order_for(p_order, 'entregar');
  v_rest := o.total_cents - o.down_cents;
  if v_rest > 0 then
    if p_plan is not null and jsonb_typeof(p_plan) = 'array' and jsonb_array_length(p_plan) > 0 then
      perform public._check_plan(p_plan, v_rest);
      k := jsonb_array_length(p_plan);
      for inst in select * from jsonb_array_elements(p_plan) loop
        insert into accounts (company_id, kind, client_id, description, origin, order_id, installment_number, installment_count,
                              amount_cents, due_date, created_by)
        values (o.company_id, 'receber', o.client_id, 'Pedido nº ' || o.number || ' — restante', 'pedido', o.id,
                (inst ->> 'number')::smallint, k, (inst ->> 'amount_cents')::bigint, (inst ->> 'due_date')::date, me);
      end loop;
    else
      if p_method is null then raise exception 'Escolha como o cliente pagou o restante.' using errcode = '22023'; end if;
      select * into s from cash_sessions where company_id = o.company_id and closed_at is null;
      if not found then raise exception 'Abra o caixa para receber o restante.' using errcode = 'P0001'; end if;
      if not public.operates_cash(o.company_id) then raise exception 'Seu papel nesta empresa não permite usar o caixa.' using errcode = '42501'; end if;
      insert into accounts (company_id, kind, client_id, description, origin, order_id, amount_cents, due_date, created_by)
      values (o.company_id, 'receber', o.client_id, 'Pedido nº ' || o.number || ' — restante', 'pedido', o.id, v_rest, current_date, me)
      returning id into v_acc;
      insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
      values (o.company_id, v_acc, 'entrada', v_rest, current_date, p_method, me, p_request, s.id);
    end if;
  end if;
  update orders set stage = 'entregue', delivered_at = now() where id = o.id;
  perform public._order_event(o, 'Entregue ao cliente' || case when v_rest > 0 then ' — restante ' || public._fmt_brl(v_rest) else '' end);
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (o.company_id, o.client_id, 'pedido', 'Pedido nº ' || o.number || ' entregue', me);
  return jsonb_build_object('duplicate', false, 'rest_cents', v_rest);
end $$;

-- Cancelar: os produtos voltam ao estoque; o sinal pode ser devolvido pelo caixa aberto.
create or replace function public.cancel_order(p_order uuid, p_reason text, p_refund boolean, p_method public.payment_method, p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); o orders%rowtype; it record; s cash_sessions%rowtype; v_acc uuid;
begin
  o := public._order_for(p_order, 'editar');
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escreva o motivo do cancelamento.' using errcode = '22023'; end if;
  if coalesce(p_refund, false) and o.down_cents > 0 then
    if p_method is null then raise exception 'Escolha como o sinal volta para o cliente.' using errcode = '22023'; end if;
    select * into s from cash_sessions where company_id = o.company_id and closed_at is null;
    if not found then raise exception 'Abra o caixa para devolver o sinal.' using errcode = 'P0001'; end if;
    insert into accounts (company_id, kind, client_id, supplier, description, origin, order_id, amount_cents, due_date, category, created_by)
    values (o.company_id, 'pagar', o.client_id, (select name from clients where id = o.client_id), 'Pedido nº ' || o.number || ' — sinal devolvido',
            'devolucao', o.id, o.down_cents, current_date, 'Devoluções', me)
    returning id into v_acc;
    insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id, cash_session_id)
    values (o.company_id, v_acc, 'saida', o.down_cents, current_date, p_method, me, p_request, s.id);
  end if;
  for it in
    select oi.product_id, oi.quantity from order_items oi join products p on p.id = oi.product_id
    where oi.order_id = o.id and p.track_stock and public.module_enabled(o.company_id, 'estoque')
  loop
    insert into stock_movements (company_id, product_id, kind, quantity, order_id, reason, created_by)
    values (o.company_id, it.product_id, 'devolucao', it.quantity, o.id, 'Pedido nº ' || o.number || ' cancelado', me);
  end loop;
  update orders set stage = 'cancelado', canceled_at = now(), cancel_reason = trim(p_reason) where id = o.id;
  perform public._order_event(o, 'Cancelado: ' || trim(p_reason) || case when coalesce(p_refund, false) and o.down_cents > 0 then ' (sinal devolvido)' else '' end);
end $$;

-- ---------------------------------------------------------------- 5. Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_order_event', '_order_for')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             '_segment_modules', 'reads_prescriptions', 'sees_all_orders', 'edits_orders', 'makes_order', 'can_see_order', 'attends_client',
             'can_see_account', 'open_order', 'save_order', 'move_order', 'deliver_order', 'cancel_order')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
