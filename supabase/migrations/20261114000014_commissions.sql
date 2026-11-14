-- Thigu Gestão — comissões (Fase 2, parte B)
-- Espelha src/lib/domain/commissions.ts (tests/db.test.ts compara o fechamento com o cálculo do aplicativo).
--
-- Regra: porcentagem ou valor fixo, por profissional (agenda) e/ou por serviço. Vale a mais específica:
--   profissional + serviço  >  só o serviço  >  só o profissional  >  regra geral
-- Base: atendimentos com situação "atendido" no mês (horário de Brasília). Com pacote, a base é o valor
-- de uma sessão (preço do pacote ÷ sessões). Fechar o mês cria a conta a pagar da comissão.
--
--   configuram as regras ..... admin
--   fecham o mês .............. admin, financeiro
--   veem ...................... admin, gestor, financeiro; o profissional, só as próprias

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  resource_id uuid,
  service_id uuid,
  -- centésimos de porcentagem: 4000 = 40%
  percent_bp integer check (percent_bp between 0 and 10000),
  fixed_cents bigint check (fixed_cents between 0 and 10000000000),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, resource_id) references public.resources (company_id, id),
  foreign key (company_id, service_id) references public.services (company_id, id),
  check (num_nonnulls(percent_bp, fixed_cents) = 1)
);
create unique index commission_rules_one_per_scope on public.commission_rules (
  company_id, coalesce(resource_id, '00000000-0000-0000-0000-000000000000'), coalesce(service_id, '00000000-0000-0000-0000-000000000000')
);

create table public.commission_closings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  resource_id uuid not null,
  month date not null check (extract(day from month) = 1),
  appointments integer not null,
  base_cents bigint not null,
  amount_cents bigint not null check (amount_cents >= 0),
  account_id uuid,
  closed_by uuid not null,
  closed_at timestamptz not null default now(),
  unique (company_id, resource_id, month),
  foreign key (company_id, resource_id) references public.resources (company_id, id),
  foreign key (company_id, account_id) references public.accounts (company_id, id)
);
create trigger commission_closings_no_delete before delete on public.commission_closings for each row execute function public.forbid_delete();

create or replace function public._my_resource(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from resources r where r.id = rid and r.user_id = auth.uid());
$$;

alter table public.commission_rules enable row level security;
alter table public.commission_closings enable row level security;
revoke all on public.commission_rules, public.commission_closings from anon;
grant select, insert, delete on public.commission_rules to authenticated;
grant update (percent_bp, fixed_cents) on public.commission_rules to authenticated;
grant select on public.commission_closings to authenticated;

create policy commission_rules_select on public.commission_rules for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'comissoes')
  and (public.has_role(company_id, array['admin', 'gestor', 'financeiro']::app_role[])
       or resource_id is null or public._my_resource(resource_id))
);
create policy commission_rules_write on public.commission_rules for all to authenticated
  using (public.module_enabled(company_id, 'comissoes') and public.has_role(company_id, array['admin']::app_role[]))
  with check (public.module_enabled(company_id, 'comissoes') and public.has_role(company_id, array['admin']::app_role[]));

create policy commission_closings_select on public.commission_closings for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'comissoes')
  and (public.has_role(company_id, array['admin', 'gestor', 'financeiro']::app_role[]) or public._my_resource(resource_id))
);

-- Comissão de um atendimento, pela regra mais específica (null quando não há regra).
create or replace function public._commission_of(p_company uuid, p_resource uuid, p_service uuid, p_base bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select case when r.percent_bp is not null then round(p_base * r.percent_bp / 10000.0)::bigint else r.fixed_cents end
  from commission_rules r
  where r.company_id = p_company
    and (r.resource_id = p_resource or r.resource_id is null)
    and (r.service_id = p_service or r.service_id is null)
  order by (r.resource_id is not null and r.service_id is not null) desc, (r.service_id is not null) desc, (r.resource_id is not null) desc
  limit 1;
$$;

create or replace function public.close_commissions(p_resource uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid(); res resources%rowtype; v_from timestamptz; v_to timestamptz;
  v_count int := 0; v_base bigint := 0; v_amount bigint := 0; v_acc uuid; v_label text; ap record; b bigint;
begin
  select * into res from resources where id = p_resource;
  if not found or not public.is_member(res.company_id) then raise exception 'Agenda não encontrada' using errcode = 'P0002'; end if;
  if not public.module_enabled(res.company_id, 'comissoes') then
    raise exception 'Este recurso não está disponível para o ramo ou o plano da empresa.' using errcode = '42501';
  end if;
  perform public._require_role(res.company_id, array['admin', 'financeiro']::app_role[], 'Somente o financeiro ou o dono fecham comissões.');
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Mês inválido' using errcode = '22023'; end if;
  if p_month >= date_trunc('month', current_date)::date then
    raise exception 'Só dá para fechar um mês que já terminou.' using errcode = 'P0001';
  end if;
  if exists (select 1 from commission_closings where resource_id = p_resource and month = p_month) then
    raise exception 'As comissões deste mês já foram fechadas.' using errcode = 'P0001';
  end if;
  -- mês no horário de Brasília (UTC−3, sem horário de verão)
  v_from := (p_month::timestamp + interval '3 hours') at time zone 'UTC';
  v_to := ((p_month + interval '1 month')::timestamp + interval '3 hours') at time zone 'UTC';
  for ap in
    select a.service_id, a.price_cents, a.consumes_package, p.price_cents as pkg_price, p.sessions_total
    from appointments a left join packages p on p.id = a.package_id
    where a.resource_id = p_resource and a.status = 'compareceu' and a.starts_at >= v_from and a.starts_at < v_to
  loop
    b := case when ap.consumes_package and ap.sessions_total > 0 then round(ap.pkg_price::numeric / ap.sessions_total)::bigint
              else ap.price_cents end;
    v_count := v_count + 1;
    v_base := v_base + b;
    v_amount := v_amount + coalesce(public._commission_of(res.company_id, p_resource, ap.service_id, b), 0);
  end loop;
  v_label := to_char(p_month, 'MM/YYYY');
  if v_amount > 0 then
    insert into accounts (company_id, kind, supplier, description, origin, amount_cents, due_date, category, created_by)
    values (res.company_id, 'pagar', res.name, 'Comissão ' || v_label || ' — ' || res.name, 'comissao', v_amount,
            (p_month + interval '1 month' + interval '4 days')::date, 'Salários', me)
    returning id into v_acc;
  end if;
  insert into commission_closings (company_id, resource_id, month, appointments, base_cents, amount_cents, account_id, closed_by)
  values (res.company_id, p_resource, p_month, v_count, v_base, v_amount, v_acc, me);
  return jsonb_build_object('appointments', v_count, 'base_cents', v_base, 'amount_cents', v_amount, 'account_id', v_acc);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_my_resource', '_commission_of', 'close_commissions')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
