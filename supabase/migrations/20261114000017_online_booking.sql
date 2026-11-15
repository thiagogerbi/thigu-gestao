-- Thigu Gestão — agendamento online pelo link (Fase 2, parte C)
-- Espelha src/lib/domain/booking.ts.
--
-- Página pública /agendar/<endereço da empresa>: o cliente escolhe serviço, quem atende, dia e horário.
-- Quem visita não tem login (papel anon). Por isso NADA aqui lê tabela direto: só estas funções,
-- que devolvem o mínimo (nome da empresa, serviços, horários ocupados sem nome de ninguém) e conferem
-- tudo de novo ao marcar. Só funciona com o módulo 'agendamento_online' (plano Equipe em diante).
-- Horário de Brasília fixo (UTC−3, sem horário de verão desde 2019).

alter table public.companies
  add column booking_slug text unique check (booking_slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  add column booking_enabled boolean not null default false,
  add column booking_auto_confirm boolean not null default false;
-- o administrador liga, escolhe o endereço e se o horário já entra confirmado (política companies_update)
grant update (booking_slug, booking_enabled, booking_auto_confirm) on public.companies to authenticated;

alter table public.appointments
  add column source text not null default 'equipe' check (source in ('equipe', 'online')),
  add column request_id uuid,
  add unique (company_id, request_id);

-- Empresa com o agendamento online ligado, a partir do endereço.
create or replace function public._booking_company(p_slug text) returns public.companies
language sql stable security definer set search_path = public as $$
  select c.* from companies c
  where c.booking_slug = lower(trim(p_slug)) and c.booking_enabled and public.module_enabled(c.id, 'agendamento_online');
$$;

create or replace function public.public_booking_info(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c companies%rowtype;
begin
  c := public._booking_company(p_slug);
  if c.id is null then return null; end if;
  return jsonb_build_object(
    'company', jsonb_build_object('name', c.name, 'logo', c.logo_data_url, 'brand_color', c.brand_color,
                                  'phone', c.phone, 'address', c.address, 'segment', c.segment),
    'services', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration_min', s.duration_min,
                                                              'price_cents', s.price_cents) order by s.name)
                          from services s where s.company_id = c.id and s.active), '[]'::jsonb),
    -- só agendas com horário de trabalho definido aparecem para o público
    'resources', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'work_hours', r.work_hours) order by r.name)
                           from resources r where r.company_id = c.id and r.active and r.work_hours <> '{}'::jsonb), '[]'::jsonb)
  );
end $$;

-- Períodos ocupados de uma agenda (horários e bloqueios), sem dizer de quem. No máximo 15 dias por consulta.
create or replace function public.public_busy(p_slug text, p_resource uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare c companies%rowtype;
begin
  c := public._booking_company(p_slug);
  if c.id is null or p_to <= p_from or p_to > p_from + interval '15 days' then return; end if;
  return query
    select a.starts_at, a.ends_at from appointments a
    where a.company_id = c.id and a.resource_id = p_resource and a.status <> 'cancelado'
      and a.starts_at < p_to and a.ends_at > p_from
    union all
    select b.starts_at, b.ends_at from resource_blocks b
    where b.company_id = c.id and b.resource_id = p_resource and b.starts_at < p_to and b.ends_at > p_from;
end $$;

-- O horário cabe inteiro num dos períodos de trabalho daquele dia da semana (horário de Brasília)?
create or replace function public._within_hours(p_hours jsonb, p_starts timestamptz, p_ends timestamptz) returns boolean
language plpgsql immutable as $$
declare v_start timestamp := (p_starts at time zone 'UTC') - interval '3 hours';
        v_end timestamp := (p_ends at time zone 'UTC') - interval '3 hours';
        v_from text := to_char(v_start, 'HH24:MI'); v_to text := to_char(v_end, 'HH24:MI'); iv jsonb;
begin
  if v_start::date <> v_end::date and to_char(v_end, 'HH24:MI') <> '00:00' then return false; end if;
  for iv in select * from jsonb_array_elements(coalesce(p_hours -> extract(dow from v_start)::int::text, '[]'::jsonb)) loop
    if iv ->> 0 <= v_from and v_to <= iv ->> 1 then return true; end if;
  end loop;
  return false;
end $$;

create or replace function public.public_book(
  p_slug text, p_service uuid, p_resource uuid, p_starts timestamptz, p_name text, p_phone text, p_request uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c companies%rowtype; s services%rowtype; r resources%rowtype;
  v_ends timestamptz; v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'); v_client uuid; v_owner uuid;
  v_ap uuid; v_status appointment_status;
begin
  c := public._booking_company(p_slug);
  if c.id is null then raise exception 'Agendamento online indisponível.' using errcode = 'P0002'; end if;
  select id into v_ap from appointments where company_id = c.id and request_id = p_request;
  if found then return jsonb_build_object('appointment_id', v_ap, 'duplicate', true); end if;
  select * into s from services where id = p_service and company_id = c.id and active;
  if not found then raise exception 'Serviço não encontrado.' using errcode = 'P0002'; end if;
  select * into r from resources where id = p_resource and company_id = c.id and active and work_hours <> '{}'::jsonb;
  if not found then raise exception 'Profissional não encontrado.' using errcode = 'P0002'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(p_name)) > 120 then
    raise exception 'Digite seu nome.' using errcode = '22023';
  end if;
  if v_digits ~ '^55' and length(v_digits) in (12, 13) then v_digits := substr(v_digits, 3); end if;
  if length(v_digits) not in (10, 11) then raise exception 'Digite o celular com DDD.' using errcode = '22023'; end if;

  v_ends := p_starts + make_interval(mins => s.duration_min);
  if p_starts < now() + interval '30 minutes' or p_starts > now() + interval '60 days' then
    raise exception 'Escolha um horário a partir de 30 minutos daqui e em até 60 dias.' using errcode = '22023';
  end if;
  if not public._within_hours(r.work_hours, p_starts, v_ends) then
    raise exception 'Este horário está fora do atendimento.' using errcode = '22023';
  end if;
  -- trava a agenda: dois pedidos ao mesmo tempo não ficam com o mesmo horário
  perform 1 from resources where id = r.id for update;
  if exists (select 1 from appointments a where a.resource_id = r.id and a.status <> 'cancelado' and a.starts_at < v_ends and a.ends_at > p_starts)
     or exists (select 1 from resource_blocks b where b.resource_id = r.id and b.starts_at < v_ends and b.ends_at > p_starts) then
    raise exception 'Este horário acabou de ser ocupado. Escolha outro.' using errcode = 'P0001';
  end if;
  -- proteção contra abuso: até 3 horários futuros pelo link por celular, e até 20 pedidos por hora na empresa
  if (select count(*) from appointments a join clients cl on cl.id = a.client_id
      where a.company_id = c.id and a.source = 'online' and a.status in ('agendado', 'confirmado') and a.starts_at > now()
        and right(regexp_replace(cl.phone, '\D', '', 'g'), length(v_digits)) = v_digits) >= 3 then
    raise exception 'Você já tem 3 horários marcados pelo link. Para marcar mais, fale com a empresa.' using errcode = 'P0001';
  end if;
  if (select count(*) from appointments where company_id = c.id and source = 'online' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Muitos pedidos agora. Tente de novo em alguns minutos ou fale com a empresa.' using errcode = 'P0001';
  end if;

  -- o cliente é encontrado pelo celular; se for novo, fica com quem vai atender (ou com o dono)
  v_owner := coalesce(
    (select m.user_id from memberships m where m.company_id = c.id and m.user_id = r.user_id and m.active),
    (select m.user_id from memberships m where m.company_id = c.id and m.active and 'admin' = any (m.roles) order by m.created_at limit 1));
  select id into v_client from clients
  where company_id = c.id and length(regexp_replace(phone, '\D', '', 'g')) >= 10
    and right(regexp_replace(phone, '\D', '', 'g'), length(v_digits)) = v_digits
  order by created_at limit 1;
  if v_client is null then
    insert into clients (company_id, name, phone, owner_id) values (c.id, trim(p_name), p_phone, v_owner) returning id into v_client;
  end if;

  v_status := case when c.booking_auto_confirm then 'confirmado' else 'agendado' end::appointment_status;
  insert into appointments (company_id, client_id, resource_id, service_id, starts_at, ends_at, status, price_cents, notes,
                            source, request_id, created_by)
  values (c.id, v_client, r.id, s.id, p_starts, v_ends, v_status, s.price_cents, 'Marcado pelo link por ' || trim(p_name),
          'online', p_request, v_owner)
  returning id into v_ap;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (c.id, v_client, 'agenda', 'Horário marcado pelo link com ' || r.name, v_owner);
  return jsonb_build_object('appointment_id', v_ap, 'status', v_status, 'duplicate', false);
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_booking_company', '_within_hours')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  -- a página pública chama só estas três, sem login
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('public_booking_info', 'public_busy', 'public_book')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
