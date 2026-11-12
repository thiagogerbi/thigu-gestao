-- Thigu Gestão — permissões no banco (Row Level Security)
-- Espelha src/lib/domain/permissions.ts e src/lib/domain/visibility.ts.
-- Operações sensíveis (fechar/conferir venda, registrar/desfazer recebimento, cancelar conta,
-- aceitar proposta) NÃO têm política de escrita direta: só acontecem pelas funções de
-- 20261110000003_functions.sql, que validam papel, empresa e valores dentro de uma transação.

-- ---------------------------------------------------------------- Funções auxiliares
-- security definer + search_path fixo: leem memberships sem recursão de RLS.

create or replace function public.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.company_id = cid and m.user_id = auth.uid() and m.active);
$$;

create or replace function public.has_role(cid uuid, wanted public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.company_id = cid and m.user_id = auth.uid() and m.active and m.roles && wanted);
$$;

-- Quem vê todo o CRM da empresa: admin, gestor e financeiro (financeiro precisa ver clientes das parcelas)
create or replace function public.sees_all_crm(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(cid, array['admin', 'gestor', 'financeiro']::app_role[]);
$$;

create or replace function public.can_see_deal(did uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from deals d
    where d.id = did and public.is_member(d.company_id)
      and (public.sees_all_crm(d.company_id) or d.owner_id = auth.uid())
  );
$$;

create or replace function public.can_edit_deal(did uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from deals d
    where d.id = did
      and (public.has_role(d.company_id, array['admin', 'gestor']::app_role[])
           or (public.has_role(d.company_id, array['vendedor']::app_role[]) and d.owner_id = auth.uid()))
  );
$$;

create or replace function public.can_see_client(clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = clid and public.is_member(c.company_id)
      and (public.sees_all_crm(c.company_id) or c.owner_id = auth.uid()
           or exists (select 1 from deals d where d.client_id = c.id and d.owner_id = auth.uid()))
  );
$$;

create or replace function public.can_edit_client(clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c
    where c.id = clid
      and (public.has_role(c.company_id, array['admin', 'gestor']::app_role[])
           or (public.has_role(c.company_id, array['vendedor']::app_role[]) and c.owner_id = auth.uid()))
  );
$$;

create or replace function public.can_see_account(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from accounts a
    where a.id = aid and public.is_member(a.company_id)
      and (public.has_role(a.company_id, array['admin', 'financeiro']::app_role[])
           or (a.kind = 'receber' and a.sale_id is not null
               and exists (select 1 from sales s where s.id = a.sale_id and public.can_see_deal(s.deal_id))))
  );
$$;

-- ---------------------------------------------------------------- Privilégios

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update on public.clients, public.deals, public.tasks, public.notes, public.activities,
  public.proposals, public.proposal_items, public.accounts, public.companies, public.profiles to authenticated;
grant delete on public.proposal_items to authenticated;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.memberships enable row level security;
alter table public.clients enable row level security;
alter table public.deals enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.activities enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;
alter table public.sales enable row level security;
alter table public.accounts enable row level security;
alter table public.movements enable row level security;

-- ---------------------------------------------------------------- Políticas

-- Perfis: o próprio e quem compartilha alguma empresa
create policy profiles_select on public.profiles for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from memberships a join memberships b on a.company_id = b.company_id
    where a.user_id = auth.uid() and a.active and b.user_id = profiles.user_id
  )
);
create policy profiles_update on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Empresas
create policy companies_select on public.companies for select to authenticated using (public.is_member(id));
create policy companies_update on public.companies for update to authenticated
  using (public.has_role(id, array['admin']::app_role[])) with check (public.has_role(id, array['admin']::app_role[]));

-- Vínculos (escrita só por funções add_member/set_member_roles)
create policy memberships_select on public.memberships for select to authenticated using (public.is_member(company_id));

-- Clientes
-- (as políticas de leitura usam as colunas da própria linha para funcionar também em INSERT ... RETURNING)
create policy clients_select on public.clients for select to authenticated using (
  public.is_member(company_id) and (public.sees_all_crm(company_id) or owner_id = auth.uid()
    or exists (select 1 from deals d where d.client_id = clients.id and d.owner_id = auth.uid()))
);
create policy clients_insert on public.clients for insert to authenticated with check (
  public.has_role(company_id, array['admin', 'gestor']::app_role[])
  or (public.has_role(company_id, array['vendedor']::app_role[]) and owner_id = auth.uid())
);
create policy clients_update on public.clients for update to authenticated using (public.can_edit_client(id)) with check (
  public.has_role(company_id, array['admin', 'gestor']::app_role[])
  or (public.has_role(company_id, array['vendedor']::app_role[]) and owner_id = auth.uid())
);

-- Negociações
create policy deals_select on public.deals for select to authenticated using (
  public.is_member(company_id) and (public.sees_all_crm(company_id) or owner_id = auth.uid())
);
create policy deals_insert on public.deals for insert to authenticated with check (
  (public.has_role(company_id, array['admin', 'gestor']::app_role[])
   or (public.has_role(company_id, array['vendedor']::app_role[]) and owner_id = auth.uid()))
  and public.can_see_client(client_id)
);
create policy deals_update on public.deals for update to authenticated using (public.can_edit_deal(id)) with check (
  public.has_role(company_id, array['admin', 'gestor']::app_role[])
  or (public.has_role(company_id, array['vendedor']::app_role[]) and owner_id = auth.uid())
);

-- Tarefas
create policy tasks_select on public.tasks for select to authenticated using (
  public.is_member(company_id) and (public.sees_all_crm(company_id) or assignee_id = auth.uid() or (client_id is not null and public.can_see_client(client_id)))
);
create policy tasks_insert on public.tasks for insert to authenticated with check (
  public.is_member(company_id) and created_by = auth.uid()
  and (assignee_id = auth.uid() or public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  and (client_id is null or public.can_see_client(client_id))
);
create policy tasks_update on public.tasks for update to authenticated using (
  public.is_member(company_id) and (assignee_id = auth.uid() or public.has_role(company_id, array['admin', 'gestor']::app_role[]))
) with check (
  assignee_id = auth.uid() or public.has_role(company_id, array['admin', 'gestor']::app_role[])
);

-- Anotações e histórico (somente inclusão; nada é editado ou apagado)
create policy notes_select on public.notes for select to authenticated using (public.can_see_client(client_id));
create policy notes_insert on public.notes for insert to authenticated with check (
  author_id = auth.uid() and (public.can_edit_client(client_id) or public.has_role(company_id, array['financeiro']::app_role[]))
);
create policy activities_select on public.activities for select to authenticated using (
  public.is_member(company_id) and ((client_id is not null and public.can_see_client(client_id)) or (client_id is null and (public.sees_all_crm(company_id) or actor_id = auth.uid())))
);
create policy activities_insert on public.activities for insert to authenticated with check (
  actor_id = auth.uid() and public.is_member(company_id) and (client_id is null or public.can_see_client(client_id))
);

-- Propostas: edição direta só enquanto não respondidas; aceite/recusa via função
create policy proposals_select on public.proposals for select to authenticated using (public.can_see_deal(deal_id));
create policy proposals_insert on public.proposals for insert to authenticated with check (
  public.can_edit_deal(deal_id) and status = 'rascunho' and created_by = auth.uid()
);
create policy proposals_update on public.proposals for update to authenticated
  using (public.can_edit_deal(deal_id) and status in ('rascunho', 'enviada'))
  with check (public.can_edit_deal(deal_id) and status in ('rascunho', 'enviada'));
create policy proposal_items_select on public.proposal_items for select to authenticated using (
  exists (select 1 from proposals p where p.id = proposal_id and public.can_see_deal(p.deal_id))
);
create policy proposal_items_write on public.proposal_items for all to authenticated using (
  exists (select 1 from proposals p where p.id = proposal_id and p.status in ('rascunho', 'enviada') and public.can_edit_deal(p.deal_id))
) with check (
  exists (select 1 from proposals p where p.id = proposal_id and p.company_id = proposal_items.company_id and p.status in ('rascunho', 'enviada') and public.can_edit_deal(p.deal_id))
);

-- Vendas: leitura; escrita somente por close_sale/confirm_sale
create policy sales_select on public.sales for select to authenticated using (
  public.has_role(company_id, array['admin', 'gestor', 'financeiro']::app_role[]) or public.can_see_deal(deal_id)
);

-- Contas: leitura conforme papel; inclusão direta só de despesas/avulsas pelo financeiro
create policy accounts_select on public.accounts for select to authenticated using (
  public.is_member(company_id) and (public.has_role(company_id, array['admin', 'financeiro']::app_role[])
    or (kind = 'receber' and sale_id is not null and exists (select 1 from sales s where s.id = accounts.sale_id and public.can_see_deal(s.deal_id))))
);
create policy accounts_insert on public.accounts for insert to authenticated with check (
  public.has_role(company_id, array['admin', 'financeiro']::app_role[])
  and origin in ('despesa', 'avulsa') and sale_id is null and canceled_at is null and created_by = auth.uid()
);

-- Movimentações: leitura; escrita somente por register_movement/undo_movement
create policy movements_select on public.movements for select to authenticated using (public.can_see_account(account_id));
