-- Endurecimento apontado pelo verificador de segurança do Supabase (primeiro teste num projeto real).
--
-- 1. No Supabase, toda função nova no schema public nasce executável por `anon` (visitante sem login).
--    As migrações das fases 2 a 4 já tiravam isso função por função; as do começo, não todas.
--    Aqui: o visitante só executa as funções das páginas públicas (agendamento online e orçamento
--    pelo link). Quem já executava como `authenticated` continua executando (ganha a permissão
--    explícita antes de sair a permissão geral de PUBLIC); quem era só interna continua só interna.
--    Funções de gatilho não ficam chamáveis por ninguém (o gatilho roda sem precisar disso).
-- 2. Funções novas daqui em diante não nascem abertas para `anon`.
-- 3. Funções sem search_path fixo ganham `search_path = public`, como as demais.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname not in ('public_booking_info', 'public_busy', 'public_book', 'public_work_order', 'public_approve_work_order')
  loop
    if has_function_privilege('authenticated', f.sig, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;

  -- funções de gatilho só rodam pelo gatilho; ninguém precisa chamá-las pela API
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
end $$;

alter default privileges in schema public revoke execute on functions from anon;
