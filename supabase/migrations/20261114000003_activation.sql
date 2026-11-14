-- Thigu Gestão — ativação de empresas por código (venda fora do sistema, código enviado por e-mail)
--
-- Fluxo: o cliente paga → a equipe Thigu gera um código no painel /admin/codigos → envia por e-mail →
-- o cliente cria a conta e digita o código para cadastrar a empresa (ou renovar o acesso).
--
-- Segurança:
--  * o código nunca é guardado: só o hash SHA-256 (e os 4 últimos caracteres, para reconhecer);
--  * uso único, com prazo para ser usado e, opcionalmente, vinculado ao e-mail do comprador;
--  * limite de 5 tentativas erradas a cada 15 minutos por usuário (impede adivinhação);
--  * empresa com acesso vencido fica somente leitura — garantido por gatilhos, que valem
--    inclusive dentro das funções security definer.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- Estrutura

create table public.platform_admins (
  user_id uuid primary key references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  customer_name text not null check (length(trim(customer_name)) between 2 and 120),
  customer_email text check (customer_email is null or customer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  access_days integer not null check (access_days between 1 and 1100),
  valid_until date not null,
  note text check (length(note) <= 300),
  created_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references public.profiles (user_id),
  company_id uuid references public.companies (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (user_id),
  check ((used_at is null) = (company_id is null)),
  check (not (used_at is not null and revoked_at is not null))
);

create table public.activation_attempts (
  id bigserial primary key,
  user_id uuid not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);
create index activation_attempts_user_idx on public.activation_attempts (user_id, created_at desc);

-- Empresas existentes ganham 30 dias de acesso para não serem bloqueadas pela migração
alter table public.companies add column access_until date;
alter table public.companies add column activated_by_code uuid references public.activation_codes (id);
update public.companies set access_until = (now() at time zone 'America/Sao_Paulo')::date + 30 where access_until is null;
alter table public.companies alter column access_until set not null;

-- ---------------------------------------------------------------- Auxiliares

create or replace function public._today() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

-- Normaliza o que a pessoa digitou: ignora espaços, traços e maiúsculas/minúsculas
create or replace function public._normalize_code(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public._hash_code(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(public._normalize_code(p), 'sha256'), 'hex');
$$;

create or replace function public._mask_email(e text) returns text language sql immutable as $$
  select left(split_part(e, '@', 1), 1) || '***@' || split_part(e, '@', 2);
$$;

-- Verifica um código sem gastá-lo. Devolve a linha travada (FOR UPDATE) ou uma mensagem de erro.
-- Tentativas erradas são registradas e NÃO desfeitas (por isso devolvemos erro em vez de exceção).
create or replace function public._take_code(p_code text, out code public.activation_codes, out error text)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid();
  failures int;
  my_email text;
begin
  select count(*) into failures from activation_attempts
   where user_id = me and not succeeded and created_at > now() - interval '15 minutes';
  if failures >= 5 then
    error := 'Muitas tentativas com código errado. Aguarde 15 minutos e tente de novo.';
    return;
  end if;

  select * into code from activation_codes where code_hash = public._hash_code(p_code) for update;
  if not found then
    error := 'Código não encontrado. Confira se digitou igual ao e-mail que você recebeu.';
  elsif code.revoked_at is not null then
    error := 'Este código foi cancelado. Fale com a equipe do Thigu.';
  elsif code.used_at is not null then
    error := 'Este código já foi usado. Cada código ativa uma única vez.';
  elsif code.valid_until < public._today() then
    error := 'Este código venceu em ' || to_char(code.valid_until, 'DD/MM/YYYY') || '. Peça um novo à equipe do Thigu.';
  elsif code.customer_email is not null then
    select email into my_email from profiles where user_id = me;
    if lower(coalesce(my_email, '')) <> lower(code.customer_email) then
      error := 'Este código foi enviado para ' || public._mask_email(code.customer_email)
        || '. Entre no Thigu com a conta desse e-mail para usá-lo.';
    end if;
  end if;

  insert into activation_attempts (user_id, succeeded) values (me, error is null);
  if error is not null then code := null; end if;
end $$;

-- ---------------------------------------------------------------- Criar empresa com código

drop function if exists public.create_company(text);

create or replace function public.create_company(p_name text, p_code text) returns jsonb
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

  insert into companies (name, created_by, access_until, activated_by_code)
  values (trim(p_name), me, public._today() + (t.code).access_days, (t.code).id)
  returning id into cid;
  insert into memberships (company_id, user_id, roles) values (cid, me, array['admin']::app_role[]);
  update activation_codes set used_at = now(), used_by = me, company_id = cid where id = (t.code).id;
  return jsonb_build_object('ok', true, 'company_id', cid, 'access_until', public._today() + (t.code).access_days);
end $$;

-- ---------------------------------------------------------------- Renovar acesso com novo código

create or replace function public.apply_activation_code(p_company uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); t record; new_until date;
begin
  perform public._require_role(p_company, array['admin']::app_role[], 'Somente o administrador da empresa pode renovar o acesso.');
  select * into t from public._take_code(p_code);
  if t.error is not null then
    return jsonb_build_object('ok', false, 'field', 'code', 'message', t.error);
  end if;
  update companies set access_until = greatest(access_until, public._today()) + (t.code).access_days
   where id = p_company returning access_until into new_until;
  update activation_codes set used_at = now(), used_by = me, company_id = p_company where id = (t.code).id;
  return jsonb_build_object('ok', true, 'access_until', new_until);
end $$;

-- ---------------------------------------------------------------- Painel da equipe Thigu

-- Alfabeto sem letras/números parecidos (sem 0/O, 1/I/L): 31 símbolos, ~59 bits por código.
create or replace function public.generate_activation_code(
  p_customer_name text, p_customer_email text, p_access_days integer, p_valid_days integer default 30, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := public._uid();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw bytea;
  body text;
  code text;
  cid uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Somente a equipe Thigu pode gerar códigos de ativação.' using errcode = '42501';
  end if;
  if p_valid_days is null or p_valid_days not between 1 and 365 then
    raise exception 'O prazo para usar o código deve ser de 1 a 365 dias.' using errcode = '22023';
  end if;
  loop
    raw := extensions.gen_random_bytes(12);
    body := '';
    for i in 0..11 loop
      body := body || substr(alphabet, (get_byte(raw, i) % 31) + 1, 1);
    end loop;
    code := 'THIGU-' || substr(body, 1, 4) || '-' || substr(body, 5, 4) || '-' || substr(body, 9, 4);
    begin
      insert into activation_codes (code_hash, code_hint, customer_name, customer_email, access_days, valid_until, note, created_by)
      values (public._hash_code(code), right(body, 4), trim(p_customer_name), nullif(lower(trim(p_customer_email)), ''),
              p_access_days, public._today() + p_valid_days, nullif(trim(p_note), ''), me)
      returning id into cid;
      exit;
    exception when unique_violation then
      -- colisão de hash (raríssima): tenta outro código
    end;
  end loop;
  -- o código em texto só existe nesta resposta; não fica guardado em lugar nenhum
  return jsonb_build_object('id', cid, 'code', code);
end $$;

create or replace function public.revoke_activation_code(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); c activation_codes%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Somente a equipe Thigu pode cancelar códigos.' using errcode = '42501';
  end if;
  select * into c from activation_codes where id = p_id for update;
  if not found then raise exception 'Código não encontrado.' using errcode = 'P0002'; end if;
  if c.used_at is not null then raise exception 'Este código já foi usado e não pode ser cancelado.' using errcode = 'P0001'; end if;
  update activation_codes set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, me) where id = p_id;
end $$;

-- Lista para o painel da equipe: inclui o nome da empresa que usou o código (a equipe não é membro
-- das empresas, então não enxergaria esse nome pelas regras normais).
create or replace function public.list_activation_codes()
returns table (
  id uuid, code_hint text, customer_name text, customer_email text, access_days integer, valid_until date,
  note text, created_at timestamptz, used_at timestamptz, company_name text, company_access_until date,
  revoked_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Somente a equipe Thigu pode ver os códigos.' using errcode = '42501';
  end if;
  return query
    select c.id, c.code_hint, c.customer_name, c.customer_email, c.access_days, c.valid_until, c.note, c.created_at,
           c.used_at, co.name, co.access_until, c.revoked_at
      from activation_codes c left join companies co on co.id = c.company_id
     order by c.created_at desc
     limit 500;
end $$;

-- ---------------------------------------------------------------- Empresa vencida = somente leitura

create or replace function public.guard_company_active() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from companies where id = new.company_id and access_until >= public._today()) then
    raise exception 'O acesso desta empresa venceu. Você ainda pode consultar tudo, mas para registrar algo novo é preciso renovar.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['clients', 'deals', 'tasks', 'notes', 'activities', 'proposals', 'proposal_items', 'sales', 'accounts', 'movements']
  loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.guard_company_active()',
                   t || '_guard_active', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- Permissões

alter table public.platform_admins enable row level security;
alter table public.activation_codes enable row level security;
alter table public.activation_attempts enable row level security;

-- cada pessoa só consegue ver se ela mesma é da equipe Thigu
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());
-- códigos: só a equipe Thigu lê (e só vê hash e os 4 últimos caracteres); ninguém grava direto
create policy activation_codes_admin_read on public.activation_codes for select to authenticated using (public.is_platform_admin());
-- tentativas: nenhuma política — só as funções acessam

grant select on public.platform_admins, public.activation_codes to authenticated;
revoke all on public.activation_attempts from authenticated, anon;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('create_company', 'apply_activation_code', 'generate_activation_code', 'revoke_activation_code', 'list_activation_codes', '_take_code')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if f.sig::text not like '%_take_code%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
grant execute on function public.is_platform_admin() to authenticated;
