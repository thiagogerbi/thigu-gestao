-- Thigu Gestão — convite com aceite
-- Antes: o administrador colocava qualquer conta existente na empresa (add_member_by_email), sem a
-- pessoa concordar, e a resposta da função dizia se o e-mail tinha ou não conta no sistema.
-- Agora: o administrador cria um convite para um e-mail. Ele aparece para a pessoa quando ela entra
-- com esse e-mail (já confirmado no Auth), e o vínculo só existe depois que ela aceita.
-- Vale também para quem ainda não tem conta: o convite espera a pessoa se cadastrar.
-- Nenhum e-mail é enviado: o administrador avisa a pessoa por conta própria.

create type public.invite_status as enum ('pendente', 'aceito', 'recusado', 'cancelado');

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null check (email = lower(trim(email)) and length(email) between 3 and 200 and position('@' in email) > 1),
  roles public.app_role[] not null check (cardinality(roles) between 1 and 4),
  status public.invite_status not null default 'pendente',
  invited_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references public.profiles (user_id)
);
-- no máximo um convite em aberto por e-mail em cada empresa (convidar de novo só atualiza os papéis)
create unique index invites_one_pending on public.invites (company_id, email) where status = 'pendente';
create index invites_pending_email_idx on public.invites (email) where status = 'pendente';

-- O administrador lê os convites da própria empresa. Quem foi convidado não lê a tabela:
-- usa my_invites(), que devolve só os convites do próprio e-mail. Escrita, só pelas funções.
alter table public.invites enable row level security;
grant select on public.invites to authenticated;
create policy invites_select on public.invites for select to authenticated
  using (public.has_role(company_id, array['admin']::app_role[]));

-- E-mail de quem está logado, e só se já foi confirmado no Auth. Sem confirmação, qualquer um
-- poderia criar uma conta com o e-mail de outra pessoa e aceitar o convite dela.
create or replace function public._my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(u.email) from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
$$;

create or replace function public.invite_member(p_company uuid, p_email text, p_roles public.app_role[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); v_email text := lower(trim(coalesce(p_email, ''))); iid uuid;
begin
  perform public._require_role(p_company, array['admin']::app_role[], 'Somente o administrador gerencia membros.');
  if position('@' in v_email) <= 1 then raise exception 'E-mail inválido.' using errcode = '22023'; end if;
  if p_roles is null or cardinality(p_roles) = 0 then raise exception 'Escolha pelo menos um papel.' using errcode = '22023'; end if;
  if exists (
    select 1 from memberships m join auth.users u on u.id = m.user_id
    where m.company_id = p_company and m.active and lower(u.email) = v_email
  ) then
    raise exception 'Esta pessoa já faz parte da empresa.' using errcode = 'P0001';
  end if;
  insert into invites (company_id, email, roles, invited_by) values (p_company, v_email, p_roles, me)
  on conflict (company_id, email) where status = 'pendente'
  do update set roles = excluded.roles, invited_by = excluded.invited_by, created_at = now()
  returning id into iid;
  return iid;
end $$;

create or replace function public.cancel_invite(p_invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); i invites%rowtype;
begin
  select * into i from invites where id = p_invite for update;
  if not found or not public.is_member(i.company_id) then raise exception 'Convite não encontrado' using errcode = 'P0002'; end if;
  perform public._require_role(i.company_id, array['admin']::app_role[], 'Somente o administrador gerencia membros.');
  if i.status <> 'pendente' then raise exception 'Este convite já foi respondido ou cancelado.' using errcode = 'P0001'; end if;
  update invites set status = 'cancelado', responded_at = now(), responded_by = me where id = i.id;
end $$;

-- Aceitar ou recusar: só a pessoa dona do e-mail convidado, com o e-mail confirmado.
create or replace function public.respond_invite(p_invite uuid, p_accept boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); v_email text := public._my_email(); i invites%rowtype;
begin
  if v_email is null then
    raise exception 'Confirme seu e-mail antes de responder ao convite.' using errcode = '42501';
  end if;
  select * into i from invites where id = p_invite for update;
  if not found or i.email <> v_email then raise exception 'Convite não encontrado' using errcode = 'P0002'; end if;
  if i.status <> 'pendente' then raise exception 'Este convite já foi respondido ou cancelado.' using errcode = 'P0001'; end if;
  if p_accept then
    insert into memberships (company_id, user_id, roles) values (i.company_id, me, i.roles)
    on conflict (company_id, user_id) do update set roles = excluded.roles, active = true;
  end if;
  update invites set status = case when p_accept then 'aceito' else 'recusado' end::invite_status,
    responded_at = now(), responded_by = me
  where id = i.id;
  return i.company_id;
end $$;

-- Convites em aberto para o e-mail de quem está logado, com o nome da empresa e de quem convidou
-- (a pessoa ainda não é membro, então não lê companies nem profiles diretamente).
create or replace function public.my_invites()
returns table (id uuid, company_id uuid, company_name text, roles public.app_role[], invited_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, i.company_id, c.name, i.roles, p.full_name, i.created_at
  from invites i
  join companies c on c.id = i.company_id
  join profiles p on p.user_id = i.invited_by
  where i.status = 'pendente' and i.email = public._my_email()
  order by i.created_at;
$$;

-- A entrada direta na empresa deixa de existir.
drop function public.add_member_by_email(uuid, text, public.app_role[]);

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_my_email', 'invite_member', 'cancel_invite', 'respond_invite', 'my_invites')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
