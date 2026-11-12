-- Thigu Gestão — estrutura principal
-- Valores em dinheiro: bigint em centavos. Nada é apagado: histórico preservado por cancelamento/desfazer.
-- Isolamento entre empresas: toda tabela tem company_id e as relações usam chaves estrangeiras
-- compostas (company_id, id), impedindo no próprio banco ligar registros de empresas diferentes.

create type public.app_role as enum ('admin', 'gestor', 'vendedor', 'financeiro');
create type public.deal_stage as enum ('novo_contato', 'qualificacao', 'negociacao', 'proposta', 'ganha', 'perdida');
create type public.task_status as enum ('aberta', 'concluida');
create type public.proposal_status as enum ('rascunho', 'enviada', 'aceita', 'recusada');
create type public.sale_status as enum ('aguardando_conferencia', 'confirmada', 'cancelada');
create type public.payment_mode as enum ('avista', 'parcelado');
create type public.account_kind as enum ('receber', 'pagar');
create type public.account_origin as enum ('venda', 'despesa', 'avulsa');
create type public.movement_direction as enum ('entrada', 'saida');
create type public.payment_method as enum ('pix', 'dinheiro', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'outro');

-- ---------------------------------------------------------------- Pessoas e empresas

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  email text not null,
  created_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  created_by uuid references public.profiles (user_id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  roles public.app_role[] not null check (cardinality(roles) between 1 and 4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where active;

-- ---------------------------------------------------------------- CRM

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 120),
  email text not null default '' check (length(email) <= 200),
  phone text not null default '' check (length(phone) <= 30),
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, owner_id) references public.memberships (company_id, user_id)
);
create index clients_company_idx on public.clients (company_id);

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  title text not null check (length(trim(title)) between 2 and 120),
  value_cents bigint not null default 0 check (value_cents >= 0),
  owner_id uuid not null,
  stage public.deal_stage not null default 'novo_contato',
  expected_close date,
  stage_changed_at timestamptz not null default now(),
  next_action text check (length(next_action) <= 200),
  next_action_date date,
  lost_reason text check (length(lost_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, id, client_id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, owner_id) references public.memberships (company_id, user_id),
  check (stage <> 'perdida' or (lost_reason is not null and length(trim(lost_reason)) > 0))
);
create index deals_company_idx on public.deals (company_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (length(trim(title)) between 2 and 200),
  client_id uuid,
  deal_id uuid,
  assignee_id uuid not null,
  due_date date not null,
  status public.task_status not null default 'aberta',
  completed_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, deal_id, client_id) references public.deals (company_id, id, client_id),
  foreign key (company_id, assignee_id) references public.memberships (company_id, user_id),
  check (deal_id is null or client_id is not null)
);
create index tasks_company_idx on public.tasks (company_id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid not null,
  deal_id uuid,
  body text not null check (length(trim(body)) between 1 and 2000),
  author_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, deal_id, client_id) references public.deals (company_id, id, client_id),
  foreign key (company_id, author_id) references public.memberships (company_id, user_id)
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  client_id uuid,
  deal_id uuid,
  kind text not null,
  description text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, deal_id) references public.deals (company_id, id)
);
create index activities_company_idx on public.activities (company_id, created_at desc);

-- ---------------------------------------------------------------- Propostas

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number integer not null,
  client_id uuid not null,
  deal_id uuid not null,
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  valid_until date not null,
  terms text not null default '' check (length(terms) <= 2000),
  status public.proposal_status not null default 'rascunho',
  sent_at timestamptz,
  accepted_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  foreign key (company_id, deal_id, client_id) references public.deals (company_id, id, client_id)
);

create table public.proposal_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  proposal_id uuid not null,
  position smallint not null check (position between 0 and 49),
  description text not null check (length(trim(description)) between 1 and 200),
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_cents bigint not null check (unit_cents >= 0),
  unique (proposal_id, position),
  foreign key (company_id, proposal_id) references public.proposals (company_id, id) on delete cascade
);

-- ---------------------------------------------------------------- Vendas e financeiro

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  deal_id uuid not null,
  client_id uuid not null,
  proposal_id uuid,
  total_cents bigint not null check (total_cents > 0),
  payment_mode public.payment_mode not null,
  -- condições propostas pelo vendedor: [{number, amount_cents, due_date}]
  proposed_plan jsonb not null,
  status public.sale_status not null default 'aguardando_conferencia',
  request_id uuid not null,
  closed_by uuid not null,
  closed_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  unique (company_id, id),
  unique (company_id, request_id),
  foreign key (company_id, deal_id, client_id) references public.deals (company_id, id, client_id),
  foreign key (company_id, proposal_id) references public.proposals (company_id, id),
  check (jsonb_typeof(proposed_plan) = 'array')
);
-- no máximo uma venda ativa por negociação
create unique index sales_one_active_per_deal on public.sales (deal_id) where status <> 'cancelada';

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.account_kind not null,
  client_id uuid,
  supplier text check (length(supplier) <= 120),
  description text not null check (length(trim(description)) between 2 and 200),
  origin public.account_origin not null,
  sale_id uuid,
  installment_number smallint not null default 1,
  installment_count smallint not null default 1,
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null,
  category text check (length(category) <= 60),
  canceled_at timestamptz,
  canceled_by uuid,
  cancel_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, sale_id) references public.sales (company_id, id),
  check (installment_number between 1 and installment_count and installment_count <= 36),
  check (origin <> 'venda' or (sale_id is not null and kind = 'receber')),
  check (canceled_at is null or cancel_reason is not null)
);
-- impede parcelas duplicadas de uma mesma venda (última barreira contra reenvio)
create unique index accounts_sale_installment_uq on public.accounts (sale_id, installment_number) where sale_id is not null;
create index accounts_company_due_idx on public.accounts (company_id, due_date);

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  account_id uuid not null,
  direction public.movement_direction not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method public.payment_method not null,
  registered_by uuid not null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  undo_reason text,
  unique (company_id, request_id),
  foreign key (company_id, account_id) references public.accounts (company_id, id),
  check (undone_at is null or undo_reason is not null)
);
create index movements_account_idx on public.movements (account_id);

-- ---------------------------------------------------------------- Gatilhos de integridade

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger deals_touch before update on public.deals for each row execute function public.touch_updated_at();
create trigger proposals_touch before update on public.proposals for each row execute function public.touch_updated_at();

-- Etapa "ganha" só pode ser definida pela função close_sale (que cria a venda na mesma transação),
-- e uma venda ganha não volta de etapa nem muda de valor por edição direta.
create or replace function public.guard_deal_stage() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('thigu.closing_sale', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.stage = 'ganha' then
    raise exception 'Use o fechamento de venda para marcar a negociação como ganha' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if old.stage = 'ganha' and (new.stage <> 'ganha' or new.value_cents <> old.value_cents) then
      raise exception 'Venda fechada não pode mudar de etapa nem de valor por edição' using errcode = 'P0001';
    end if;
    if new.stage = 'ganha' and old.stage <> 'ganha' then
      raise exception 'Use o fechamento de venda para marcar a negociação como ganha' using errcode = 'P0001';
    end if;
    if new.stage <> old.stage then
      new.stage_changed_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger deals_guard_stage before insert or update on public.deals for each row execute function public.guard_deal_stage();

-- Registros financeiros: só campos de cancelamento/desfazer podem mudar; nunca apagar.
create or replace function public.guard_movement_update() returns trigger language plpgsql as $$
begin
  if new.account_id <> old.account_id or new.amount_cents <> old.amount_cents or new.direction <> old.direction
     or new.paid_on <> old.paid_on or new.request_id <> old.request_id or new.company_id <> old.company_id then
    raise exception 'Registros financeiros não podem ser alterados; desfaça e registre novamente' using errcode = 'P0001';
  end if;
  if old.undone_at is not null and new.undone_at is distinct from old.undone_at then
    raise exception 'Registro já desfeito' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger movements_guard before update on public.movements for each row execute function public.guard_movement_update();

create or replace function public.forbid_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Histórico financeiro não pode ser apagado' using errcode = 'P0001';
end $$;
create trigger movements_no_delete before delete on public.movements for each row execute function public.forbid_delete();
create trigger accounts_no_delete before delete on public.accounts for each row execute function public.forbid_delete();
create trigger sales_no_delete before delete on public.sales for each row execute function public.forbid_delete();

-- Perfil criado automaticamente ao cadastrar usuário no Supabase Auth
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, full_name, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
