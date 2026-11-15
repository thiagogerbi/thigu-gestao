-- Thigu Gestão — horário de trabalho de cada agenda e bloqueios (folga, férias, almoço fora do comum)
-- Espelha src/lib/domain/hours.ts.
--
-- work_hours: {"1": [["09:00","12:00"], ["13:00","18:00"]], "2": [...]}, chaves de "0" (domingo) a "6" (sábado).
-- Vazio ({}) = sem horário definido: a equipe marca em qualquer horário, mas a agenda não aparece no
-- agendamento online. A validação fina do formato fica no aplicativo; o banco confere o tipo e o tamanho.

alter table public.resources
  add column work_hours jsonb not null default '{}' check (jsonb_typeof(work_hours) = 'object' and length(work_hours::text) <= 2000);
grant update (work_hours) on public.resources to authenticated;

create table public.resource_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  resource_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null default '' check (length(reason) <= 120),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, resource_id) references public.resources (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id),
  check (ends_at > starts_at and ends_at <= starts_at + interval '60 days')
);
create index resource_blocks_time_idx on public.resource_blocks (company_id, resource_id, starts_at);

alter table public.resource_blocks enable row level security;
revoke all on public.resource_blocks from anon;
-- bloqueio não é histórico financeiro: quem pode marcar na agenda pode criar e remover
grant select, insert, delete on public.resource_blocks to authenticated;

create policy resource_blocks_select on public.resource_blocks for select to authenticated using (
  public.is_member(company_id) and public.can_manage_resource(resource_id)
);
create policy resource_blocks_insert on public.resource_blocks for insert to authenticated with check (
  public.can_manage_resource(resource_id) and created_by = auth.uid()
);
create policy resource_blocks_delete on public.resource_blocks for delete to authenticated using (
  public.can_manage_resource(resource_id)
);
