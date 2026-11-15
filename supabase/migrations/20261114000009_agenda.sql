-- Thigu Gestão — agenda, serviços e ficha de atendimento (Fase 1, parte B)
-- Espelha src/lib/domain/agenda.ts, permissions.ts e visibility.ts.
--
-- Quem faz o quê:
--   marca e vê a agenda de todos .......... admin, gestor, recepção
--   marca e vê só as próprias agendas ..... profissional (agenda ligada à pessoa: resources.user_id)
--   cadastra serviços e quem atende ....... admin, gestor
--   escreve e lê a ficha de atendimento ... profissional, e só as próprias anotações (nem o dono lê)
-- E tudo só com o módulo ligado para a empresa (module_enabled).

-- ---------------------------------------------------------------- Quem atende

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  user_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, user_id) references public.memberships (company_id, user_id)
);
-- uma agenda por pessoa da equipe
create unique index resources_one_per_user on public.resources (company_id, user_id) where user_id is not null;

create table public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  duration_min integer not null check (duration_min between 5 and 720),
  price_cents bigint not null default 0 check (price_cents between 0 and 10000000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

-- ---------------------------------------------------------------- Atendimentos

create type public.appointment_status as enum ('agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  resource_id uuid not null,
  service_id uuid,
  item_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'agendado',
  price_cents bigint not null default 0 check (price_cents between 0 and 10000000000),
  notes text not null default '' check (length(notes) <= 500),
  series_id uuid,
  account_id uuid,
  reminded_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, resource_id) references public.resources (company_id, id),
  foreign key (company_id, service_id) references public.services (company_id, id),
  foreign key (company_id, item_id) references public.client_items (company_id, id),
  foreign key (company_id, account_id) references public.accounts (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '12 hours')
);
create index appointments_resource_time_idx on public.appointments (company_id, resource_id, starts_at);
create index appointments_client_idx on public.appointments (company_id, client_id);
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();
create trigger appointments_no_delete before delete on public.appointments for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------- Ficha de atendimento (prontuário)
-- Dado de saúde (dado sensível na LGPD). Só quem escreveu lê; nada é alterado nem apagado.
-- Corrigir é escrever outra anotação apontando para a anterior (corrects_id).

create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  appointment_id uuid,
  author_id uuid not null,
  body text not null check (length(trim(body)) between 1 and 5000),
  corrects_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, appointment_id) references public.appointments (company_id, id),
  foreign key (company_id, author_id) references public.memberships (company_id, user_id),
  foreign key (company_id, corrects_id) references public.clinical_notes (company_id, id)
);
create index clinical_notes_client_idx on public.clinical_notes (company_id, client_id);
create trigger clinical_notes_no_delete before delete on public.clinical_notes for each row execute function public.forbid_delete();

-- ---------------------------------------------------------------- Funções auxiliares

-- Pode marcar e ver na agenda deste recurso?
create or replace function public.can_manage_resource(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from resources r
    where r.id = rid and public.module_enabled(r.company_id, 'agenda')
      and (public.has_role(r.company_id, array['admin', 'gestor', 'recepcao']::app_role[])
           or (public.has_role(r.company_id, array['profissional']::app_role[]) and r.user_id = auth.uid()))
  );
$$;

-- Quem atende um paciente de um colega precisa ver o nome dele na própria agenda.
create or replace function public.attends_client(cid uuid, clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'agenda') and exists (
    select 1 from appointments a join resources r on r.id = a.resource_id
    where a.client_id = clid and r.user_id = auth.uid()
  );
$$;

create or replace function public.can_see_client(clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = clid and public.is_member(c.company_id)
      and (public.sees_all_clients(c.company_id) or c.owner_id = auth.uid()
           or exists (select 1 from deals d where d.client_id = c.id and d.owner_id = auth.uid())
           or public.attends_client(c.company_id, c.id))
  );
$$;

alter policy clients_select on public.clients using (
  public.is_member(company_id) and (public.sees_all_clients(company_id) or owner_id = auth.uid()
    or exists (select 1 from deals d where d.client_id = clients.id and d.owner_id = auth.uid())
    or public.attends_client(company_id, id))
);

-- O pet atendido precisa ser do mesmo cliente.
create or replace function public._item_of_client(p_item uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_item is null or exists (select 1 from client_items i where i.id = p_item and i.client_id = p_client);
$$;

-- ---------------------------------------------------------------- Privilégios e políticas

alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.clinical_notes enable row level security;
revoke all on public.resources, public.services, public.appointments, public.clinical_notes from anon;

grant select, insert on public.resources, public.services, public.appointments, public.clinical_notes to authenticated;
grant update (name, user_id, active) on public.resources to authenticated;
grant update (name, duration_min, price_cents, active) on public.services to authenticated;
-- situação e conta a receber só mudam por set_appointment_status
grant update (client_id, resource_id, service_id, item_id, starts_at, ends_at, price_cents, notes, reminded_at)
  on public.appointments to authenticated;

-- Quem atende e serviços: toda a equipe lê (para mostrar nomes); admin e gestor cadastram.
create policy resources_select on public.resources for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'agenda')
);
create policy resources_insert on public.resources for insert to authenticated with check (
  public.module_enabled(company_id, 'agenda') and public.has_role(company_id, array['admin', 'gestor']::app_role[])
);
create policy resources_update on public.resources for update to authenticated
  using (public.module_enabled(company_id, 'agenda') and public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  with check (public.module_enabled(company_id, 'agenda') and public.has_role(company_id, array['admin', 'gestor']::app_role[]));

create policy services_select on public.services for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'servicos')
);
create policy services_insert on public.services for insert to authenticated with check (
  public.module_enabled(company_id, 'servicos') and public.has_role(company_id, array['admin', 'gestor']::app_role[])
);
create policy services_update on public.services for update to authenticated
  using (public.module_enabled(company_id, 'servicos') and public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  with check (public.module_enabled(company_id, 'servicos') and public.has_role(company_id, array['admin', 'gestor']::app_role[]));

-- Atendimentos: vê e marca quem pode usar a agenda do recurso.
create policy appointments_select on public.appointments for select to authenticated using (
  public.is_member(company_id) and public.can_manage_resource(resource_id)
);
create policy appointments_insert on public.appointments for insert to authenticated with check (
  public.can_manage_resource(resource_id) and public.can_see_client(client_id) and public._item_of_client(item_id, client_id)
  and status = 'agendado' and account_id is null and created_by = auth.uid()
);
-- só enquanto ainda está em aberto; atendido, falta e cancelado não se remarcam
create policy appointments_update on public.appointments for update to authenticated
  using (public.can_manage_resource(resource_id) and status in ('agendado', 'confirmado'))
  with check (public.can_manage_resource(resource_id) and public.can_see_client(client_id)
              and public._item_of_client(item_id, client_id) and status in ('agendado', 'confirmado'));

-- Ficha de atendimento: só quem escreveu lê. Escreve o profissional que vê o paciente.
create policy clinical_notes_select on public.clinical_notes for select to authenticated using (
  author_id = auth.uid() and public.is_member(company_id) and public.module_enabled(company_id, 'prontuario')
);
create policy clinical_notes_insert on public.clinical_notes for insert to authenticated with check (
  author_id = auth.uid() and public.module_enabled(company_id, 'prontuario')
  and public.has_role(company_id, array['profissional']::app_role[]) and public.can_see_client(client_id)
  and (corrects_id is null or exists (
    -- ("clinical_notes." aponta para a linha nova; sem ele, corrects_id seria a coluna de o)
    select 1 from clinical_notes o where o.id = clinical_notes.corrects_id and o.author_id = auth.uid() and o.client_id = clinical_notes.client_id))
);

-- ---------------------------------------------------------------- Situação do atendimento
-- Ao marcar "compareceu" (ou a falta cobrada), nasce a conta a receber, que entra no financeiro.
-- Desfazer volta para "agendado" e cancela a conta, desde que nada tenha sido recebido nela.

create or replace function public.set_appointment_status(p_appointment uuid, p_status public.appointment_status, p_charge boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid();
  ap appointments%rowtype;
  v_service text;
  v_account uuid;
begin
  select * into ap from appointments where id = p_appointment for update;
  if not found or not public.is_member(ap.company_id) or not public.can_manage_resource(ap.resource_id) then
    raise exception 'Atendimento não encontrado' using errcode = 'P0002';
  end if;
  if ap.status = p_status then return jsonb_build_object('already', true); end if;
  if ap.status in ('compareceu', 'faltou', 'cancelado') and p_status <> 'agendado' then
    raise exception 'Para mudar, primeiro desfaça: o atendimento volta para "agendado".' using errcode = 'P0001';
  end if;

  -- desfazer: cancela a conta a receber criada antes, se nada foi recebido nela
  if ap.account_id is not null then
    if exists (select 1 from movements where account_id = ap.account_id and undone_at is null) then
      raise exception 'Já há pagamento registrado para este atendimento. Desfaça o recebimento no financeiro antes.' using errcode = 'P0001';
    end if;
    update accounts set canceled_at = now(), canceled_by = me, cancel_reason = 'Atendimento desfeito na agenda'
    where id = ap.account_id and canceled_at is null;
    ap.account_id := null;
  end if;

  if (p_status = 'compareceu' or (p_status = 'faltou' and coalesce(p_charge, false))) and ap.price_cents > 0 then
    select name into v_service from services where id = ap.service_id;
    insert into accounts (company_id, kind, client_id, description, origin, amount_cents, due_date, created_by)
    values (ap.company_id, 'receber', ap.client_id,
            case when p_status = 'faltou' then 'Falta: ' else '' end || coalesce(v_service, 'Atendimento'),
            'atendimento', ap.price_cents, current_date, me)
    returning id into v_account;
  end if;

  update appointments set status = p_status, account_id = v_account where id = ap.id;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (ap.company_id, ap.client_id, 'agenda',
          case p_status
            when 'confirmado' then 'Horário confirmado'
            when 'compareceu' then 'Atendimento realizado'
            when 'faltou' then case when v_account is not null then 'Faltou (falta cobrada)' else 'Faltou' end
            when 'cancelado' then 'Horário cancelado'
            else 'Atendimento voltou para agendado'
          end, me);
  return jsonb_build_object('already', false, 'account_id', v_account);
end $$;

-- ---------------------------------------------------------------- Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'can_manage_resource', 'attends_client', 'can_see_client', '_item_of_client', 'set_appointment_status')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
