-- Junta a ativação por código (20261114000003) com o sistema por ramo (20261114000004 a 000025).
--
-- As duas frentes nasceram em paralelo e mexeram nas mesmas coisas. Esta migração deixa o banco
-- no mesmo estado final, seja qual for a ordem em que as anteriores foram aplicadas:
--   1. criar empresa pede o código de ativação E o ramo;
--   2. empresa com acesso vencido fica somente leitura também nas tabelas dos módulos novos;
--   3. as páginas públicas (agendar e aprovar orçamento) não gravam para empresa vencida;
--   4. permissões das tabelas e funções da ativação no mesmo padrão das demais.

-- ---------------------------------------------------------------- 1. Criar empresa: código + ramo

drop function if exists public.create_company(text);
drop function if exists public.create_company(text, text);
drop function if exists public.create_company(text, public.company_segment);

-- Erros de preenchimento voltam como resposta (e não como exceção) para a tentativa com código
-- errado ficar registrada: é ela que limita as adivinhações.
create function public.create_company(p_name text, p_code text, p_segment public.company_segment default 'geral')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); t record; cid uuid;
begin
  if p_name is null or length(trim(p_name)) < 2 then
    return jsonb_build_object('ok', false, 'field', 'name', 'message', 'Digite o nome da empresa (pelo menos 2 letras).');
  end if;
  select * into t from public._take_code(p_code);
  if t.error is not null then
    return jsonb_build_object('ok', false, 'field', 'code', 'message', t.error);
  end if;

  insert into companies (name, created_by, segment, access_until, activated_by_code)
  values (trim(p_name), me, coalesce(p_segment, 'geral'), public._today() + (t.code).access_days, (t.code).id)
  returning id into cid;
  insert into memberships (company_id, user_id, roles) values (cid, me, array['admin']::app_role[]);
  update activation_codes set used_at = now(), used_by = me, company_id = cid where id = (t.code).id;
  return jsonb_build_object('ok', true, 'company_id', cid, 'access_until', public._today() + (t.code).access_days);
end $$;

-- ---------------------------------------------------------------- 2. Vencida = somente leitura, em tudo
-- Toda tabela com dados de uma empresa ganha a mesma trava. Ficam de fora a equipe e os convites
-- (memberships, invites): o dono precisa conseguir mexer na equipe para renovar.

do $$
declare t text;
begin
  for t in
    select c.table_name::text
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'company_id'
      and c.table_name not in ('memberships', 'invites', 'activation_codes')
      and not exists (
        select 1 from pg_trigger g
        where g.tgrelid = format('public.%I', c.table_name)::regclass and g.tgname = c.table_name || '_guard_active'
      )
    order by 1
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.guard_company_active()',
                   t || '_guard_active', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- 3. Páginas públicas
-- O cliente final não deve ver "o acesso desta empresa venceu". Agendamento online: a página
-- fica indisponível. Orçamento pelo link: dá para ler, mas não para aprovar.

create or replace function public._booking_company(p_slug text) returns public.companies
language sql stable security definer set search_path = public as $$
  select c.* from companies c
  where c.booking_slug = lower(trim(p_slug)) and c.booking_enabled and public.module_enabled(c.id, 'agendamento_online')
    and c.access_until >= public._today();
$$;

create or replace function public.public_approve_work_order(p_token uuid, p_approved uuid[], p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_by_token(p_token);
  if w.id is null
     or not exists (select 1 from companies c where c.id = w.company_id and c.access_until >= public._today()) then
    raise exception 'Este link não está mais ativo. Fale com a oficina.' using errcode = 'P0002';
  end if;
  select * into w from work_orders where id = w.id for update;
  if w.stage in ('entregue', 'cancelada') then raise exception 'Esta OS já foi encerrada.' using errcode = 'P0001'; end if;
  return public._wo_decide(w, p_approved, 'link', p_name);
end $$;

-- ---------------------------------------------------------------- 4. Permissões
-- Tabelas da ativação: a equipe Thigu lê os códigos (só hash e final) e cada pessoa vê se é da
-- equipe; ninguém grava direto. Tentativas: só as funções acessam.

revoke all on public.platform_admins, public.activation_codes, public.activation_attempts from anon, authenticated;
grant select on public.platform_admins, public.activation_codes to authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Funções: mesmo endurecimento de 20261114000024, repetido aqui porque no Supabase toda função nova
-- nasce executável por PUBLIC. Visitante só executa as funções das páginas públicas.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname not in ('public_booking_info', 'public_busy', 'public_book', 'public_work_order', 'public_approve_work_order')
  loop
    if has_function_privilege('authenticated', f.sig, 'execute') and f.proname <> '_take_code' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;

  -- auxiliar da ativação: só as funções do sistema chamam
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = '_take_code'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;

  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;

  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;

  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'public_approve_work_order'
  loop
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
