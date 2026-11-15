-- Thigu Gestão — turmas e presença (Fase 2, parte B)
-- Espelha src/lib/domain/classes.ts.
--
--   criam turmas ................................ admin, gestor
--   matriculam .................................. admin, gestor, recepção
--   marcam presença ............................. admin, gestor, recepção e o instrutor da turma
-- O instrutor passa a ver os alunos das próprias turmas. Só com o módulo 'turmas'.

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  resource_id uuid,
  -- dias da semana: 0 = domingo … 6 = sábado
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]),
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_min integer not null check (duration_min between 5 and 720),
  capacity integer not null check (capacity between 1 and 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, resource_id) references public.resources (company_id, id)
);

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  class_id uuid not null,
  client_id uuid not null,
  started_on date not null default current_date,
  ended_on date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, class_id) references public.classes (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  check (ended_on is null or ended_on >= started_on)
);
create unique index enrollments_one_active on public.enrollments (class_id, client_id) where ended_on is null;

create type public.attendance_status as enum ('presente', 'falta', 'reposicao');

create table public.attendance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  class_id uuid not null,
  client_id uuid not null,
  class_date date not null,
  status public.attendance_status not null,
  marked_by uuid not null,
  marked_at timestamptz not null default now(),
  unique (company_id, id),
  unique (class_id, client_id, class_date),
  foreign key (company_id, class_id) references public.classes (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, marked_by) references public.memberships (company_id, user_id)
);

-- Lotação: matrícula nova só se a turma tiver vaga.
create or replace function public.guard_enrollment_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cap int; v_used int;
begin
  if new.ended_on is not null then return new; end if;
  select capacity into v_cap from classes where id = new.class_id for update;
  select count(*) into v_used from enrollments where class_id = new.class_id and ended_on is null and id <> new.id;
  if v_used >= v_cap then raise exception 'A turma está cheia (% vagas).', v_cap using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger enrollments_capacity before insert on public.enrollments for each row execute function public.guard_enrollment_capacity();

-- Instrutor da turma (agenda ligada à pessoa).
create or replace function public.teaches_class(clsid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes c join resources r on r.id = c.resource_id where c.id = clsid and r.user_id = auth.uid());
$$;

-- Quem atende (agenda) ou dá aula para o cliente passa a vê-lo.
create or replace function public.attends_client(cid uuid, clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.module_enabled(cid, 'agenda') and exists (
            select 1 from appointments a join resources r on r.id = a.resource_id
            where a.client_id = clid and r.user_id = auth.uid()))
      or (public.module_enabled(cid, 'turmas') and exists (
            select 1 from enrollments e join classes c on c.id = e.class_id join resources r on r.id = c.resource_id
            where e.client_id = clid and e.ended_on is null and r.user_id = auth.uid()));
$$;

alter table public.classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.attendance enable row level security;
revoke all on public.classes, public.enrollments, public.attendance from anon;
grant select, insert on public.classes, public.enrollments, public.attendance to authenticated;
grant update (name, resource_id, weekdays, start_time, duration_min, capacity, active) on public.classes to authenticated;
grant update (ended_on) on public.enrollments to authenticated;
grant update (status, marked_by, marked_at) on public.attendance to authenticated;
grant delete on public.attendance to authenticated;

create policy classes_select on public.classes for select to authenticated using (
  public.is_member(company_id) and public.module_enabled(company_id, 'turmas')
);
create policy classes_write on public.classes for insert to authenticated with check (
  public.module_enabled(company_id, 'turmas') and public.has_role(company_id, array['admin', 'gestor']::app_role[])
);
create policy classes_update on public.classes for update to authenticated
  using (public.module_enabled(company_id, 'turmas') and public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  with check (public.module_enabled(company_id, 'turmas') and public.has_role(company_id, array['admin', 'gestor']::app_role[]));

create policy enrollments_select on public.enrollments for select to authenticated using (
  public.module_enabled(company_id, 'turmas') and (public.can_see_client(client_id) or public.teaches_class(class_id))
);
create policy enrollments_insert on public.enrollments for insert to authenticated with check (
  public.module_enabled(company_id, 'turmas') and public.has_role(company_id, array['admin', 'gestor', 'recepcao']::app_role[])
  and public.can_see_client(client_id) and created_by = auth.uid()
);
create policy enrollments_update on public.enrollments for update to authenticated
  using (public.module_enabled(company_id, 'turmas') and public.has_role(company_id, array['admin', 'gestor', 'recepcao']::app_role[]))
  with check (public.module_enabled(company_id, 'turmas') and public.has_role(company_id, array['admin', 'gestor', 'recepcao']::app_role[]));

create or replace function public.marks_attendance(cid uuid, clsid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'turmas')
     and (public.has_role(cid, array['admin', 'gestor', 'recepcao']::app_role[]) or public.teaches_class(clsid));
$$;

create policy attendance_select on public.attendance for select to authenticated using (
  public.module_enabled(company_id, 'turmas') and (public.can_see_client(client_id) or public.teaches_class(class_id))
);
create policy attendance_insert on public.attendance for insert to authenticated with check (
  public.marks_attendance(company_id, class_id) and public.can_see_client(client_id) and marked_by = auth.uid()
);
create policy attendance_update on public.attendance for update to authenticated
  using (public.marks_attendance(company_id, class_id))
  with check (public.marks_attendance(company_id, class_id) and marked_by = auth.uid());
create policy attendance_delete on public.attendance for delete to authenticated using (
  public.marks_attendance(company_id, class_id)
);

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('teaches_class', 'attends_client', 'marks_attendance', 'guard_enrollment_capacity')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
