-- Thigu Gestão — operações transacionais
-- Cada função: verifica o usuário (auth.uid()), o papel na empresa do registro, trava as linhas
-- envolvidas (FOR UPDATE) e valida valores. Reenvios usam request_id (idempotência) e
-- índices únicos como última barreira contra duplicidade.

create or replace function public._uid() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Faça login para continuar' using errcode = '28000'; end if;
  return u;
end $$;

create or replace function public._require_role(cid uuid, wanted public.app_role[], msg text default null) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(cid, wanted) then
    raise exception '%', coalesce(msg, 'Seu papel nesta empresa não permite esta ação.') using errcode = '42501';
  end if;
end $$;

create or replace function public._fmt_brl(cents bigint) returns text language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(cents / 100.0, 'FM999G999G999G990D00'), ',', '#'), '.', ','), '#', '.');
$$;

-- Valida plano de parcelas: 1..36 itens, numeração 1..n, valores > 0 e soma exata
create or replace function public._check_plan(p_plan jsonb, p_total bigint) returns void language plpgsql immutable as $$
declare
  n int;
  s bigint := 0;
  item jsonb;
  i int := 0;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' then raise exception 'Parcelas inválidas' using errcode = '22023'; end if;
  n := jsonb_array_length(p_plan);
  if n < 1 or n > 36 then raise exception 'Use entre 1 e 36 parcelas' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(p_plan) loop
    i := i + 1;
    if (item ->> 'number')::int <> i then raise exception 'Numeração das parcelas fora de ordem' using errcode = '22023'; end if;
    if (item ->> 'amount_cents')::bigint <= 0 then raise exception 'Cada parcela precisa ter valor maior que zero' using errcode = '22023'; end if;
    perform (item ->> 'due_date')::date;
    s := s + (item ->> 'amount_cents')::bigint;
  end loop;
  if s <> p_total then
    raise exception 'A soma das parcelas (%) não confere com o valor da venda (%)', public._fmt_brl(s), public._fmt_brl(p_total) using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------- Empresa e membros

create or replace function public.create_company(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); cid uuid;
begin
  insert into companies (name, created_by) values (trim(p_name), me) returning id into cid;
  insert into memberships (company_id, user_id, roles) values (cid, me, array['admin']::app_role[]);
  return cid;
end $$;

create or replace function public.add_member_by_email(p_company uuid, p_email text, p_roles public.app_role[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); target uuid;
begin
  perform public._require_role(p_company, array['admin']::app_role[], 'Somente o administrador gerencia membros.');
  select user_id into target from profiles where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'Não encontramos uma conta com este e-mail. Peça para a pessoa criar a conta primeiro.' using errcode = 'P0002';
  end if;
  insert into memberships (company_id, user_id, roles) values (p_company, target, p_roles)
  on conflict (company_id, user_id) do update set roles = excluded.roles, active = true;
  return target;
end $$;

create or replace function public.set_member_roles(p_company uuid, p_user uuid, p_roles public.app_role[], p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid();
begin
  perform public._require_role(p_company, array['admin']::app_role[], 'Somente o administrador gerencia membros.');
  perform 1 from companies where id = p_company for update;
  update memberships set roles = p_roles, active = p_active where company_id = p_company and user_id = p_user;
  if not exists (select 1 from memberships where company_id = p_company and active and 'admin' = any (roles)) then
    raise exception 'A empresa precisa ter pelo menos um administrador ativo.' using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------- Propostas

create or replace function public.save_proposal(
  p_company uuid, p_id uuid, p_deal uuid, p_client uuid, p_items jsonb, p_discount bigint, p_valid_until date, p_terms text
) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); pid uuid := p_id; num int; d deals%rowtype; subtotal bigint;
begin
  select * into d from deals where id = p_deal and company_id = p_company;
  if not found or d.client_id <> p_client then raise exception 'Negociação não encontrada para este cliente' using errcode = 'P0002'; end if;
  if not public.can_edit_deal(p_deal) then raise exception 'Seu papel nesta empresa não permite esta ação.' using errcode = '42501'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Adicione entre 1 e 50 itens' using errcode = '22023';
  end if;
  select coalesce(sum(round((i ->> 'quantity')::numeric * (i ->> 'unit_cents')::bigint)), 0) into subtotal from jsonb_array_elements(p_items) i;
  if p_discount < 0 or p_discount > subtotal then raise exception 'O desconto não pode ser maior que o subtotal' using errcode = '22023'; end if;

  if pid is null then
    perform 1 from companies where id = p_company for update; -- numeração sequencial sem colisão
    select coalesce(max(number), 0) + 1 into num from proposals where company_id = p_company;
    insert into proposals (company_id, number, client_id, deal_id, discount_cents, valid_until, terms, created_by)
    values (p_company, num, p_client, p_deal, p_discount, p_valid_until, coalesce(p_terms, ''), me) returning id into pid;
  else
    update proposals set discount_cents = p_discount, valid_until = p_valid_until, terms = coalesce(p_terms, '')
    where id = pid and company_id = p_company and deal_id = p_deal and status in ('rascunho', 'enviada');
    if not found then raise exception 'Proposta não encontrada ou já respondida pelo cliente' using errcode = 'P0002'; end if;
    delete from proposal_items where proposal_id = pid;
  end if;
  insert into proposal_items (company_id, proposal_id, position, description, quantity, unit_cents)
  select p_company, pid, (ord - 1)::smallint, trim(i ->> 'description'), (i ->> 'quantity')::numeric, (i ->> 'unit_cents')::bigint
  from jsonb_array_elements(p_items) with ordinality as t(i, ord);
  insert into activities (company_id, client_id, deal_id, kind, description, actor_id)
  values (p_company, p_client, p_deal, 'proposta', 'Proposta salva (' || public._fmt_brl(subtotal - p_discount) || ')', me);
  return pid;
end $$;

create or replace function public.proposal_mark_sent(p_proposal uuid, p_follow_up boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); p proposals%rowtype; d deals%rowtype; due date; tid uuid; cname text;
begin
  select * into p from proposals where id = p_proposal for update;
  if not found or not public.can_edit_deal(p.deal_id) then raise exception 'Proposta não encontrada' using errcode = 'P0002'; end if;
  if p.status in ('aceita', 'recusada') then raise exception 'Esta proposta já foi respondida pelo cliente' using errcode = 'P0001'; end if;
  update proposals set status = 'enviada', sent_at = now() where id = p.id;
  select * into d from deals where id = p.deal_id for update;
  update deals set stage = 'proposta' where id = d.id and stage not in ('proposta', 'ganha', 'perdida');
  insert into activities (company_id, client_id, deal_id, kind, description, actor_id)
  values (p.company_id, p.client_id, p.deal_id, 'proposta', 'Envio da proposta nº ' || p.number || ' registrado', me);
  if p_follow_up then
    due := (now() at time zone 'America/Sao_Paulo')::date + 2;
    select name into cname from clients where id = p.client_id;
    insert into tasks (company_id, title, client_id, deal_id, assignee_id, due_date, created_by)
    values (p.company_id, 'Retornar para ' || cname || ' sobre a proposta nº ' || p.number, p.client_id, p.deal_id, d.owner_id, due, me)
    returning id into tid;
    update deals set next_action = 'Retornar sobre a proposta nº ' || p.number, next_action_date = due where id = d.id;
  end if;
  return jsonb_build_object('task_id', tid);
end $$;

create or replace function public.proposal_accept(p_proposal uuid, p_update_value boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); p proposals%rowtype; total bigint;
begin
  select * into p from proposals where id = p_proposal for update;
  if not found or not public.can_edit_deal(p.deal_id) then raise exception 'Proposta não encontrada' using errcode = 'P0002'; end if;
  if p.status = 'aceita' then return jsonb_build_object('already', true); end if;
  if p.status = 'recusada' then raise exception 'Esta proposta foi recusada. Prepare uma nova proposta.' using errcode = 'P0001'; end if;
  select coalesce(sum(round(quantity * unit_cents)), 0) - p.discount_cents into total from proposal_items where proposal_id = p.id;
  update proposals set status = 'aceita', accepted_at = now() where id = p.id;
  if p_update_value then
    update deals set value_cents = total where id = p.deal_id and stage <> 'ganha';
  end if;
  insert into activities (company_id, client_id, deal_id, kind, description, actor_id)
  values (p.company_id, p.client_id, p.deal_id, 'proposta', 'Cliente aceitou a proposta nº ' || p.number || ' (' || public._fmt_brl(total) || ')', me);
  return jsonb_build_object('already', false, 'total_cents', total);
end $$;

create or replace function public.proposal_reject(p_proposal uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); p proposals%rowtype;
begin
  select * into p from proposals where id = p_proposal for update;
  if not found or not public.can_edit_deal(p.deal_id) then raise exception 'Proposta não encontrada' using errcode = 'P0002'; end if;
  if p.status = 'aceita' then raise exception 'Esta proposta já foi aceita.' using errcode = 'P0001'; end if;
  update proposals set status = 'recusada' where id = p.id;
  insert into activities (company_id, client_id, deal_id, kind, description, actor_id)
  values (p.company_id, p.client_id, p.deal_id, 'proposta', 'Proposta nº ' || p.number || ' recusada' || coalesce(': ' || nullif(trim(p_reason), ''), ''), me);
end $$;

-- ---------------------------------------------------------------- Venda: fechar (vendedor) e conferir (financeiro)

create or replace function public.close_sale(
  p_deal uuid, p_proposal uuid, p_total bigint, p_mode public.payment_mode, p_plan jsonb, p_request uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); d deals%rowtype; sid uuid;
begin
  select * into d from deals where id = p_deal for update;
  if not found then raise exception 'Negociação não encontrada' using errcode = 'P0002'; end if;
  -- reenvio do mesmo pedido: devolve a venda já criada
  select id into sid from sales where company_id = d.company_id and request_id = p_request;
  if sid is not null then return jsonb_build_object('sale_id', sid, 'duplicate', true); end if;

  perform public._require_role(d.company_id, array['admin', 'gestor', 'vendedor']::app_role[]);
  if not public.can_edit_deal(d.id) then raise exception 'Você só pode fechar vendas das suas negociações.' using errcode = '42501'; end if;
  if d.stage = 'perdida' then raise exception 'Reabra a negociação antes de fechar a venda.' using errcode = 'P0001'; end if;
  if exists (select 1 from sales where deal_id = d.id and status <> 'cancelada') then
    raise exception 'Esta negociação já tem uma venda fechada.' using errcode = '23505';
  end if;
  if p_proposal is not null and not exists (select 1 from proposals where id = p_proposal and deal_id = d.id) then
    raise exception 'Proposta não pertence a esta negociação' using errcode = 'P0002';
  end if;
  if p_mode = 'avista' and jsonb_array_length(p_plan) <> 1 then raise exception 'Pagamento à vista tem uma única parcela' using errcode = '22023'; end if;
  perform public._check_plan(p_plan, p_total);

  insert into sales (company_id, deal_id, client_id, proposal_id, total_cents, payment_mode, proposed_plan, request_id, closed_by)
  values (d.company_id, d.id, d.client_id, p_proposal, p_total, p_mode, p_plan, p_request, me) returning id into sid;
  perform set_config('thigu.closing_sale', 'on', true);
  update deals set stage = 'ganha', value_cents = p_total, next_action = null, next_action_date = null where id = d.id;
  perform set_config('thigu.closing_sale', 'off', true);
  insert into activities (company_id, client_id, deal_id, kind, description, actor_id)
  values (d.company_id, d.client_id, d.id, 'venda',
    'Venda fechada: ' || public._fmt_brl(p_total) || ' em ' || jsonb_array_length(p_plan) || ' parcela(s). Aguardando conferência do financeiro.', me);
  return jsonb_build_object('sale_id', sid, 'duplicate', false);
end $$;

create or replace function public.confirm_sale(p_sale uuid, p_plan jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); s sales%rowtype; item jsonb; n int; cname text; dtitle text;
begin
  -- trava a venda: confirmações simultâneas esperam aqui e encontram o status já atualizado
  select * into s from sales where id = p_sale for update;
  if not found or not public.is_member(s.company_id) then raise exception 'Venda não encontrada' using errcode = 'P0002'; end if;
  perform public._require_role(s.company_id, array['admin', 'financeiro']::app_role[], 'Somente o financeiro ou o dono podem confirmar as parcelas.');
  if s.status = 'confirmada' then
    return jsonb_build_object('created', 0, 'duplicate', true);
  end if;
  if s.status = 'cancelada' then raise exception 'Esta venda foi cancelada.' using errcode = 'P0001'; end if;
  perform public._check_plan(p_plan, s.total_cents);
  n := jsonb_array_length(p_plan);
  select name into cname from clients where id = s.client_id;
  select title into dtitle from deals where id = s.deal_id;
  for item in select * from jsonb_array_elements(p_plan) loop
    insert into accounts (company_id, kind, client_id, description, origin, sale_id, installment_number, installment_count, amount_cents, due_date, created_by)
    values (s.company_id, 'receber', s.client_id, dtitle || ' — ' || cname, 'venda', s.id,
      (item ->> 'number')::smallint, n, (item ->> 'amount_cents')::bigint, (item ->> 'due_date')::date, me);
  end loop;
  update sales set status = 'confirmada', reviewed_by = me, reviewed_at = now(), proposed_plan = p_plan where id = s.id;
  insert into activities (company_id, client_id, deal_id, kind, description, actor_id)
  values (s.company_id, s.client_id, s.deal_id, 'venda', 'Financeiro conferiu a venda e criou ' || n || ' conta(s) a receber.', me);
  return jsonb_build_object('created', n, 'duplicate', false);
end $$;

-- ---------------------------------------------------------------- Recebimentos e pagamentos

create or replace function public.register_movement(
  p_account uuid, p_amount bigint, p_paid_on date, p_method public.payment_method, p_request uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); a accounts%rowtype; settled bigint; balance bigint; mid uuid;
begin
  -- trava a conta: dois registros simultâneos não conseguem ultrapassar o saldo
  select * into a from accounts where id = p_account for update;
  if not found or not public.is_member(a.company_id) then raise exception 'Conta não encontrada' using errcode = 'P0002'; end if;
  perform public._require_role(a.company_id, array['admin', 'financeiro']::app_role[], 'Somente o financeiro ou o dono podem registrar recebimentos e pagamentos.');
  select id into mid from movements where company_id = a.company_id and request_id = p_request;
  if mid is not null then
    select a.amount_cents - coalesce(sum(amount_cents), 0) into balance from movements where account_id = a.id and undone_at is null;
    return jsonb_build_object('movement_id', mid, 'remaining_cents', balance, 'duplicate', true);
  end if;
  if a.canceled_at is not null then raise exception 'Esta conta foi cancelada e não aceita novos registros.' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'O valor precisa ser maior que zero.' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into settled from movements where account_id = a.id and undone_at is null;
  balance := a.amount_cents - settled;
  if p_amount > balance then
    raise exception 'O valor passa do saldo. O máximo que ainda falta é %.', public._fmt_brl(balance) using errcode = '22023';
  end if;
  insert into movements (company_id, account_id, direction, amount_cents, paid_on, method, registered_by, request_id)
  values (a.company_id, a.id, case when a.kind = 'receber' then 'entrada' else 'saida' end::movement_direction, p_amount, p_paid_on, p_method, me, p_request)
  returning id into mid;
  if a.client_id is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (a.company_id, a.client_id, 'financeiro',
      case when a.kind = 'receber' then 'Recebimento' else 'Pagamento' end || ' de ' || public._fmt_brl(p_amount)
      || ' registrado (parcela ' || a.installment_number || ' de ' || a.installment_count || ')', me);
  end if;
  return jsonb_build_object('movement_id', mid, 'remaining_cents', balance - p_amount, 'duplicate', false);
end $$;

create or replace function public.undo_movement(p_movement uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); m movements%rowtype; a accounts%rowtype;
begin
  select * into m from movements where id = p_movement;
  if not found or not public.is_member(m.company_id) then raise exception 'Registro não encontrado' using errcode = 'P0002'; end if;
  perform public._require_role(m.company_id, array['admin', 'financeiro']::app_role[]);
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Explique por que está desfazendo.' using errcode = '22023'; end if;
  select * into a from accounts where id = m.account_id for update;
  select * into m from movements where id = p_movement for update;
  if m.undone_at is not null then return jsonb_build_object('already', true); end if;
  update movements set undone_at = now(), undone_by = me, undo_reason = trim(p_reason) where id = m.id;
  if a.client_id is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (a.company_id, a.client_id, 'financeiro', 'Registro de ' || public._fmt_brl(m.amount_cents) || ' desfeito. Motivo: ' || trim(p_reason), me);
  end if;
  return jsonb_build_object('already', false, 'amount_cents', m.amount_cents);
end $$;

create or replace function public.cancel_account(p_account uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); a accounts%rowtype;
begin
  select * into a from accounts where id = p_account for update;
  if not found or not public.is_member(a.company_id) then raise exception 'Conta não encontrada' using errcode = 'P0002'; end if;
  perform public._require_role(a.company_id, array['admin', 'financeiro']::app_role[]);
  if a.canceled_at is not null then return jsonb_build_object('already', true); end if;
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Explique o motivo do cancelamento.' using errcode = '22023'; end if;
  if exists (select 1 from movements where account_id = a.id and undone_at is null) then
    raise exception 'Esta conta tem valores registrados. Desfaça os registros antes de cancelar.' using errcode = 'P0001';
  end if;
  update accounts set canceled_at = now(), canceled_by = me, cancel_reason = trim(p_reason) where id = a.id;
  if a.client_id is not null then
    insert into activities (company_id, client_id, kind, description, actor_id)
    values (a.company_id, a.client_id, 'financeiro', 'Conta cancelada (parcela ' || a.installment_number || ' de ' || a.installment_count || '). Motivo: ' || trim(p_reason), me);
  end if;
  return jsonb_build_object('already', false);
end $$;

-- ---------------------------------------------------------------- Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'create_company', 'add_member_by_email', 'set_member_roles', 'save_proposal', 'proposal_mark_sent',
             'proposal_accept', 'proposal_reject', 'close_sale', 'confirm_sale', 'register_movement', 'undo_movement', 'cancel_account')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
