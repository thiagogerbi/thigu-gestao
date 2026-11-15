-- Thigu Gestão — pacotes de sessões e mensalidades (Fase 2, parte A)
-- Espelha src/lib/domain/recurring.ts, permissions.ts e visibility.ts.
--
--   vendem pacotes e criam mensalidades ... admin, gestor, recepção, financeiro
--   veem pacotes e mensalidades ........... quem vê o cliente (o profissional vê os dos seus pacientes)
--   veem as cobranças (contas a receber) .. admin e financeiro, como qualquer conta
-- E só com o módulo ligado: 'pacotes' ou 'mensalidades'.

create or replace function public.sells_recurring(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(cid, array['admin', 'gestor', 'recepcao', 'financeiro']::app_role[]);
$$;

-- ---------------------------------------------------------------- Pacotes

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  service_id uuid,
  item_id uuid,
  name text not null check (length(trim(name)) between 1 and 80),
  sessions_total integer not null check (sessions_total between 1 and 200),
  price_cents bigint not null default 0 check (price_cents between 0 and 10000000000),
  valid_until date,
  closed_at timestamptz,
  closed_by uuid,
  request_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, request_id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, service_id) references public.services (company_id, id),
  foreign key (company_id, item_id) references public.client_items (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id)
);
create index packages_client_idx on public.packages (company_id, client_id);
create trigger packages_no_delete before delete on public.packages for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------- Mensalidades

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 80),
  amount_cents bigint not null check (amount_cents between 1 and 10000000000),
  -- até 28 para existir em todos os meses
  day_of_month smallint not null check (day_of_month between 1 and 28),
  starts_on date not null,
  ends_on date check (ends_on is null or ends_on >= starts_on),
  canceled_at timestamptz,
  canceled_by uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id)
);
create index subscriptions_client_idx on public.subscriptions (company_id, client_id);
create trigger subscriptions_no_delete before delete on public.subscriptions for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------- Ligações nas contas e na agenda

alter table public.accounts
  add column package_id uuid,
  add column subscription_id uuid,
  add column period date,
  add foreign key (company_id, package_id) references public.packages (company_id, id),
  add foreign key (company_id, subscription_id) references public.subscriptions (company_id, id),
  add check (origin <> 'mensalidade' or (subscription_id is not null and period is not null));
-- uma cobrança por mês de cada mensalidade (a última barreira contra gerar duas vezes)
create unique index accounts_subscription_period_uq on public.accounts (subscription_id, period) where subscription_id is not null;

alter table public.appointments
  add column package_id uuid,
  -- true quando o atendimento (ou a falta cobrada) usou uma sessão do pacote
  add column consumes_package boolean not null default false,
  add foreign key (company_id, package_id) references public.packages (company_id, id);
grant update (package_id) on public.appointments to authenticated;

-- O pacote usado precisa ser do mesmo cliente e estar em uso.
create or replace function public._package_of_client(p_package uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_package is null or exists (
    select 1 from packages p where p.id = p_package and p.client_id = p_client and p.closed_at is null
  );
$$;

alter policy appointments_insert on public.appointments with check (
  public.can_manage_resource(resource_id) and public.can_see_client(client_id) and public._item_of_client(item_id, client_id)
  and public._package_of_client(package_id, client_id)
  and status = 'agendado' and account_id is null and not consumes_package and created_by = auth.uid()
);
alter policy appointments_update on public.appointments
  using (public.can_manage_resource(resource_id) and status in ('agendado', 'confirmado'))
  with check (public.can_manage_resource(resource_id) and public.can_see_client(client_id)
              and public._item_of_client(item_id, client_id) and public._package_of_client(package_id, client_id)
              and status in ('agendado', 'confirmado'));

-- ---------------------------------------------------------------- Privilégios e políticas

alter table public.packages enable row level security;
alter table public.subscriptions enable row level security;
revoke all on public.packages, public.subscriptions from anon;
-- pacotes só nascem e terminam pelas funções (junto com as contas a receber)
grant select on public.packages to authenticated;
grant select, insert on public.subscriptions to authenticated;
grant update (name, amount_cents, day_of_month, ends_on) on public.subscriptions to authenticated;

create policy packages_select on public.packages for select to authenticated using (
  public.module_enabled(company_id, 'pacotes') and public.can_see_client(client_id)
);

create policy subscriptions_select on public.subscriptions for select to authenticated using (
  public.module_enabled(company_id, 'mensalidades') and public.can_see_client(client_id)
);
create policy subscriptions_insert on public.subscriptions for insert to authenticated with check (
  public.module_enabled(company_id, 'mensalidades') and public.sells_recurring(company_id) and public.can_see_client(client_id)
  and created_by = auth.uid() and canceled_at is null
);
create policy subscriptions_update on public.subscriptions for update to authenticated
  using (public.module_enabled(company_id, 'mensalidades') and public.sells_recurring(company_id) and canceled_at is null)
  with check (public.module_enabled(company_id, 'mensalidades') and public.sells_recurring(company_id) and canceled_at is null);

-- ---------------------------------------------------------------- Vender e encerrar pacote

create or replace function public.sell_package(
  p_client uuid, p_service uuid, p_item uuid, p_name text, p_sessions integer, p_price bigint,
  p_valid_until date, p_plan jsonb, p_request uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); c clients%rowtype; v_pkg uuid; item jsonb; n int;
begin
  select * into c from clients where id = p_client;
  if not found or not public.is_member(c.company_id) or not public.can_see_client(c.id) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if not public.module_enabled(c.company_id, 'pacotes') then
    raise exception 'Este recurso não está disponível para o ramo ou o plano da empresa.' using errcode = '42501';
  end if;
  perform public._require_role(c.company_id, array['admin', 'gestor', 'recepcao', 'financeiro']::app_role[],
    'Seu papel nesta empresa não permite vender pacotes.');
  -- reenvio do mesmo pedido devolve o pacote já criado
  select id into v_pkg from packages where company_id = c.company_id and request_id = p_request;
  if found then return jsonb_build_object('package_id', v_pkg, 'duplicate', true); end if;
  if not public._item_of_client(p_item, c.id) then raise exception 'Este pet não é deste cliente.' using errcode = '22023'; end if;
  if p_service is not null and not exists (select 1 from services where id = p_service and company_id = c.company_id) then
    raise exception 'Serviço não encontrado' using errcode = 'P0002';
  end if;
  if coalesce(p_price, 0) > 0 then perform public._check_plan(p_plan, p_price); end if;

  insert into packages (company_id, client_id, service_id, item_id, name, sessions_total, price_cents, valid_until, request_id, created_by)
  values (c.company_id, c.id, p_service, p_item, trim(p_name), p_sessions, coalesce(p_price, 0), p_valid_until, p_request, me)
  returning id into v_pkg;

  if coalesce(p_price, 0) > 0 then
    n := jsonb_array_length(p_plan);
    for item in select * from jsonb_array_elements(p_plan) loop
      insert into accounts (company_id, kind, client_id, description, origin, package_id, installment_number, installment_count,
                            amount_cents, due_date, created_by)
      values (c.company_id, 'receber', c.id, 'Pacote: ' || trim(p_name), 'pacote', v_pkg,
              (item ->> 'number')::smallint, n, (item ->> 'amount_cents')::bigint, (item ->> 'due_date')::date, me);
    end loop;
  end if;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (c.company_id, c.id, 'pacote', 'Pacote vendido: ' || trim(p_name) || ' (' || p_sessions || ' sessões)', me);
  return jsonb_build_object('package_id', v_pkg, 'duplicate', false);
end $$;

create or replace function public.close_package(p_package uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); p packages%rowtype;
begin
  select * into p from packages where id = p_package for update;
  if not found or not public.is_member(p.company_id) or not public.can_see_client(p.client_id) then
    raise exception 'Pacote não encontrado' using errcode = 'P0002';
  end if;
  perform public._require_role(p.company_id, array['admin', 'gestor', 'recepcao', 'financeiro']::app_role[],
    'Seu papel nesta empresa não permite encerrar pacotes.');
  if p.closed_at is not null then return; end if;
  if exists (select 1 from appointments where package_id = p.id and status in ('agendado', 'confirmado')) then
    raise exception 'Há horários marcados usando este pacote. Remarque-os sem o pacote ou cancele antes de encerrar.' using errcode = 'P0001';
  end if;
  update packages set closed_at = now(), closed_by = me where id = p.id;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (p.company_id, p.client_id, 'pacote', 'Pacote encerrado: ' || p.name, me);
end $$;

-- ---------------------------------------------------------------- Mensalidades: cancelar e gerar cobranças

create or replace function public.cancel_subscription(p_subscription uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); s subscriptions%rowtype;
begin
  select * into s from subscriptions where id = p_subscription for update;
  if not found or not public.is_member(s.company_id) or not public.can_see_client(s.client_id) then
    raise exception 'Mensalidade não encontrada' using errcode = 'P0002';
  end if;
  perform public._require_role(s.company_id, array['admin', 'gestor', 'recepcao', 'financeiro']::app_role[],
    'Seu papel nesta empresa não permite cancelar mensalidades.');
  if s.canceled_at is not null then return; end if;
  update subscriptions set canceled_at = now(), canceled_by = me where id = s.id;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (s.company_id, s.client_id, 'mensalidade', 'Mensalidade cancelada: ' || s.name, me);
end $$;

-- Cria as cobranças que faltam até o mês atual (vencimento no dia escolhido). Pode ser chamada
-- quantas vezes for preciso: o índice único por mês impede duplicar. O aplicativo chama ao carregar
-- os dados da empresa; não depende de tarefa agendada no servidor.
create or replace function public.generate_subscription_charges(cid uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare s subscriptions%rowtype; p date; v_due date; n int := 0; k int; v_last date := date_trunc('month', current_date)::date;
begin
  if not public.is_member(cid) or not public.module_enabled(cid, 'mensalidades') then return 0; end if;
  for s in select * from subscriptions where company_id = cid and canceled_at is null and starts_on <= current_date loop
    p := date_trunc('month', s.starts_on)::date;
    while p <= v_last loop
      v_due := make_date(extract(year from p)::int, extract(month from p)::int, s.day_of_month);
      if v_due >= s.starts_on and (s.ends_on is null or v_due <= s.ends_on) then
        insert into accounts (company_id, kind, client_id, description, origin, subscription_id, period, amount_cents, due_date, created_by)
        values (s.company_id, 'receber', s.client_id, 'Mensalidade: ' || s.name || ' (' || to_char(p, 'MM/YYYY') || ')',
                'mensalidade', s.id, p, s.amount_cents, v_due, s.created_by)
        on conflict (subscription_id, period) where subscription_id is not null do nothing;
        get diagnostics k = row_count;
        n := n + k;
      end if;
      p := (p + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- Situação do atendimento, agora com pacote
-- Igual à versão de 20261114000009, mais: atendimento com pacote não gera conta (já foi pago no pacote);
-- usa uma sessão ao ser atendido (ou na falta cobrada), e não passa do total de sessões.

create or replace function public.set_appointment_status(p_appointment uuid, p_status public.appointment_status, p_charge boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid();
  ap appointments%rowtype;
  pk packages%rowtype;
  v_service text;
  v_account uuid;
  v_consume boolean := false;
  v_charge boolean := (p_status = 'compareceu' or (p_status = 'faltou' and coalesce(p_charge, false)));
begin
  select * into ap from appointments where id = p_appointment for update;
  if not found or not public.is_member(ap.company_id) or not public.can_manage_resource(ap.resource_id) then
    raise exception 'Atendimento não encontrado' using errcode = 'P0002';
  end if;
  if ap.status = p_status then return jsonb_build_object('already', true); end if;
  if ap.status in ('compareceu', 'faltou', 'cancelado') and p_status <> 'agendado' then
    raise exception 'Para mudar, primeiro desfaça: o atendimento volta para "agendado".' using errcode = 'P0001';
  end if;

  if ap.account_id is not null then
    if exists (select 1 from movements where account_id = ap.account_id and undone_at is null) then
      raise exception 'Já há pagamento registrado para este atendimento. Desfaça o recebimento no financeiro antes.' using errcode = 'P0001';
    end if;
    update accounts set canceled_at = now(), canceled_by = me, cancel_reason = 'Atendimento desfeito na agenda'
    where id = ap.account_id and canceled_at is null;
  end if;

  if v_charge and ap.package_id is not null then
    -- trava o pacote: dois atendimentos ao mesmo tempo não passam do total
    select * into pk from packages where id = ap.package_id for update;
    if pk.closed_at is not null then
      raise exception 'Este pacote foi encerrado. Remarque o horário sem o pacote.' using errcode = 'P0001';
    end if;
    if (select count(*) from appointments where package_id = pk.id and consumes_package and id <> ap.id) >= pk.sessions_total then
      raise exception 'Todas as sessões deste pacote já foram usadas. Remarque o horário sem o pacote.' using errcode = 'P0001';
    end if;
    v_consume := true;
  elsif v_charge and ap.price_cents > 0 then
    select name into v_service from services where id = ap.service_id;
    insert into accounts (company_id, kind, client_id, description, origin, amount_cents, due_date, created_by)
    values (ap.company_id, 'receber', ap.client_id,
            case when p_status = 'faltou' then 'Falta: ' else '' end || coalesce(v_service, 'Atendimento'),
            'atendimento', ap.price_cents, current_date, me)
    returning id into v_account;
  end if;

  update appointments set status = p_status, account_id = v_account, consumes_package = v_consume where id = ap.id;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (ap.company_id, ap.client_id, 'agenda',
          case p_status
            when 'confirmado' then 'Horário confirmado'
            when 'compareceu' then case when v_consume then 'Atendimento realizado (sessão do pacote)' else 'Atendimento realizado' end
            when 'faltou' then case when v_consume then 'Faltou (sessão do pacote usada)'
                                    when v_account is not null then 'Faltou (falta cobrada)' else 'Faltou' end
            when 'cancelado' then 'Horário cancelado'
            else 'Atendimento voltou para agendado'
          end, me);
  return jsonb_build_object('already', false, 'account_id', v_account, 'package_session', v_consume);
end $$;

-- ---------------------------------------------------------------- Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'sells_recurring', '_package_of_client', 'sell_package', 'close_package', 'cancel_subscription',
             'generate_subscription_charges', 'set_appointment_status')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
