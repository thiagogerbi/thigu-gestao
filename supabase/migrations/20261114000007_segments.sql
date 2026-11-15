-- Thigu Gestão — um sistema que muda conforme o ramo da empresa
-- Espelha src/lib/domain/segments.ts e permissions.ts (tests/db.test.ts compara os dois catálogos).
--
-- Toda ação passa por quatro perguntas:
--   1. o ramo da empresa tem o módulo?        2. o plano inclui o módulo?      -> module_enabled()
--   3. o papel da pessoa permite?             4. o registro é dela?            -> políticas RLS
--
-- Nesta migração: ramo, plano e módulos extras da empresa; permissões de clientes separadas das de
-- negociações (para os papéis novos); campos extras na ficha do cliente; e os itens do cliente (pets).

-- ---------------------------------------------------------------- 1. Ramo, plano e módulos

create type public.company_segment as enum ('geral', 'clinica', 'beleza', 'pet', 'turmas', 'veiculos', 'balcao', 'pedidos');
-- a ordem importa: cada plano inclui o que os anteriores têm
create type public.company_plan as enum ('essencial', 'equipe', 'empresa');

-- Empresas que já existem ficam no ramo "geral" e continuam exatamente como estão.
-- Enquanto não existe cobrança, toda empresa nasce no plano "empresa" (nada fica bloqueado por plano).
alter table public.companies
  add column segment public.company_segment not null default 'geral',
  add column plan public.company_plan not null default 'empresa',
  add column extra_modules text[] not null default '{}' check (
    extra_modules <@ array['itens', 'agenda', 'servicos', 'prontuario', 'lembretes', 'pacotes', 'mensalidades', 'turmas',
                           'comissoes', 'caixa', 'agendamento_online', 'lembrete_automatico', 'ordem_servico', 'estoque', 'pedidos']::text[]
  );

-- O administrador pode trocar o ramo (política companies_update). Plano e módulos extras, não:
-- só o Thigu altera, direto no banco, até existir a tela de cobrança.
grant update (segment) on public.companies to authenticated;

create or replace function public._segment_modules(s public.company_segment) returns text[]
language sql immutable as $$
  select case s
    when 'geral' then array[]::text[]
    when 'clinica' then array['agenda', 'servicos', 'prontuario', 'lembretes', 'pacotes', 'mensalidades', 'agendamento_online', 'lembrete_automatico']
    when 'beleza' then array['agenda', 'servicos', 'lembretes', 'pacotes', 'mensalidades', 'caixa', 'comissoes', 'agendamento_online', 'lembrete_automatico']
    when 'pet' then array['itens', 'agenda', 'servicos', 'lembretes', 'pacotes', 'caixa', 'agendamento_online', 'lembrete_automatico']
    when 'turmas' then array['agenda', 'servicos', 'lembretes', 'turmas', 'mensalidades', 'lembrete_automatico']
    when 'veiculos' then array['ordem_servico', 'servicos', 'lembretes', 'comissoes']
    when 'balcao' then array['caixa', 'estoque']
    when 'pedidos' then array['pedidos', 'lembretes', 'caixa', 'estoque']
  end;
$$;

create or replace function public._module_min_plan(m text) returns public.company_plan
language sql immutable as $$
  select (case when m in ('comissoes', 'agendamento_online', 'lembrete_automatico') then 'equipe' else 'essencial' end)::public.company_plan;
$$;

-- Perguntas 1 e 2. Usada pelas políticas de cada módulo.
create or replace function public.module_enabled(cid uuid, m text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from companies c
    where c.id = cid
      and (m = any (public._segment_modules(c.segment)) or m = any (c.extra_modules))
      and c.plan >= public._module_min_plan(m)
  );
$$;

-- A empresa já nasce com o ramo escolhido no cadastro.
drop function if exists public.create_company(text);
create function public.create_company(p_name text, p_segment public.company_segment default 'geral') returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); cid uuid;
begin
  insert into companies (name, created_by, segment) values (trim(p_name), me, coalesce(p_segment, 'geral')) returning id into cid;
  insert into memberships (company_id, user_id, roles) values (cid, me, array['admin']::app_role[]);
  return cid;
end $$;

-- ---------------------------------------------------------------- 2. Papéis: até sete por pessoa

alter table public.memberships drop constraint memberships_roles_check;
alter table public.memberships add constraint memberships_roles_check check (cardinality(roles) between 1 and 7);
alter table public.invites drop constraint invites_roles_check;
alter table public.invites add constraint invites_roles_check check (cardinality(roles) between 1 and 7);

-- ---------------------------------------------------------------- 3. Clientes: quem vê e quem edita
-- Antes, ver e editar clientes andava junto com negociações (admin, gestor, vendedor, financeiro).
-- Agora clientes têm regra própria, e as negociações continuam como estavam:
--   veem todos os clientes ...... admin, gestor, financeiro, recepção, caixa
--   editam qualquer cliente ..... admin, gestor, recepção, caixa
--   editam só os próprios ....... vendedor, profissional
-- Recepção, profissional e caixa não veem negociações, vendas nem o financeiro.

create or replace function public.sees_all_clients(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(cid, array['admin', 'gestor', 'financeiro', 'recepcao', 'caixa']::app_role[]);
$$;

create or replace function public.edits_all_clients(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(cid, array['admin', 'gestor', 'recepcao', 'caixa']::app_role[]);
$$;

create or replace function public.edits_own_clients(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(cid, array['vendedor', 'profissional']::app_role[]);
$$;

create or replace function public.can_see_client(clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = clid and public.is_member(c.company_id)
      and (public.sees_all_clients(c.company_id) or c.owner_id = auth.uid()
           or exists (select 1 from deals d where d.client_id = c.id and d.owner_id = auth.uid()))
  );
$$;

create or replace function public.can_edit_client(clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = clid
      and (public.edits_all_clients(c.company_id)
           or (public.edits_own_clients(c.company_id) and c.owner_id = auth.uid()))
  );
$$;

alter policy clients_select on public.clients using (
  public.is_member(company_id) and (public.sees_all_clients(company_id) or owner_id = auth.uid()
    or exists (select 1 from deals d where d.client_id = clients.id and d.owner_id = auth.uid()))
);
alter policy clients_insert on public.clients with check (
  public.edits_all_clients(company_id) or (public.edits_own_clients(company_id) and owner_id = auth.uid())
);
alter policy clients_update on public.clients using (public.can_edit_client(id)) with check (
  public.edits_all_clients(company_id) or (public.edits_own_clients(company_id) and owner_id = auth.uid())
);

-- ---------------------------------------------------------------- 4. Campos extras do cliente
-- Cada ramo tem os seus (nascimento, convênio, endereço…). A lista e a validação ficam no aplicativo;
-- o banco garante só o formato e o tamanho.

alter table public.clients
  add column extra jsonb not null default '{}' check (jsonb_typeof(extra) = 'object' and length(extra::text) <= 4000);

-- ---------------------------------------------------------------- 5. Itens do cliente (pets)
-- Um cliente pode ter vários. Veículos entram depois, com a ordem de serviço, na mesma tabela.
-- Nada é apagado: arquivar (active = false) esconde o item e preserva o histórico.

create type public.item_kind as enum ('pet');

create table public.client_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  kind public.item_kind not null,
  name text not null check (length(trim(name)) between 1 and 80),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and length(details::text) <= 2000),
  alert text not null default '' check (length(alert) <= 200),
  active boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id)
);
create index client_items_client_idx on public.client_items (company_id, client_id);

alter table public.client_items enable row level security;
revoke all on public.client_items from anon;
grant select, insert on public.client_items to authenticated;
-- cliente, tipo e autor não mudam depois de criado
grant update (name, details, alert, active) on public.client_items to authenticated;

-- Lê quem vê o cliente; grava quem pode editar o cliente; e só se o módulo estiver ligado para a empresa.
-- (a chave composta garante que o cliente é da mesma empresa do item)
create policy client_items_select on public.client_items for select to authenticated using (
  public.module_enabled(company_id, 'itens') and public.can_see_client(client_id)
);
create policy client_items_insert on public.client_items for insert to authenticated with check (
  public.module_enabled(company_id, 'itens') and public.can_edit_client(client_id) and created_by = auth.uid()
);
create policy client_items_update on public.client_items for update to authenticated
  using (public.module_enabled(company_id, 'itens') and public.can_edit_client(client_id))
  with check (public.module_enabled(company_id, 'itens') and public.can_edit_client(client_id));

-- ---------------------------------------------------------------- Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'create_company', 'module_enabled', '_segment_modules', '_module_min_plan',
             'sees_all_clients', 'edits_all_clients', 'edits_own_clients')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
