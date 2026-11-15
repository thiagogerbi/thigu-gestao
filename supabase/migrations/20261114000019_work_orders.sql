-- Thigu Gestão — ordem de serviço para oficinas (Fase 3).
-- Espelha src/lib/domain/work-orders.ts e o motor da prévia; tests/db.test.ts testa as mesmas regras.
--
-- O carro entra (ordem de serviço com reclamação, km, combustível, itens de entrada e fotos), recebe
-- o orçamento (peças e mão de obra), o cliente aprova tudo ou parte (pelo link ou na oficina), o mecânico
-- trabalha e move a etapa, e na entrega o valor aprovado vira conta a receber.
--
--   veem todas ............. admin, gestor, recepção (atendente), financeiro
--   abrem e orçam .......... admin, gestor, recepção
--   desconto ............... admin e gestor à vontade; a recepção até 10% do orçamento
--   o mecânico ............. vê só as OS dele, adiciona itens e fotos, escreve o diagnóstico e move entre
--                            "aguardando peça", "em serviço" e "pronto". Não dá desconto nem entrega.
--   entregam e cobram ...... admin, gestor, recepção, financeiro
--
-- Nada é apagado: só itens ainda não decididos saem do orçamento; o resto fica no histórico.

-- ---------------------------------------------------------------- 1. Catálogo: oficina ganha veículos

create or replace function public._segment_modules(s public.company_segment) returns text[]
language sql immutable as $$
  select case s
    when 'geral' then array[]::text[]
    when 'clinica' then array['agenda', 'servicos', 'prontuario', 'lembretes', 'pacotes', 'mensalidades', 'agendamento_online', 'lembrete_automatico']
    when 'beleza' then array['agenda', 'servicos', 'lembretes', 'pacotes', 'mensalidades', 'caixa', 'comissoes', 'agendamento_online', 'lembrete_automatico']
    when 'pet' then array['itens', 'agenda', 'servicos', 'lembretes', 'pacotes', 'caixa', 'agendamento_online', 'lembrete_automatico']
    when 'turmas' then array['agenda', 'servicos', 'lembretes', 'turmas', 'mensalidades', 'lembrete_automatico']
    when 'veiculos' then array['itens', 'ordem_servico', 'servicos', 'lembretes', 'comissoes']
    when 'balcao' then array['caixa', 'estoque']
    when 'pedidos' then array['pedidos', 'lembretes', 'caixa', 'estoque']
  end;
$$;

-- ---------------------------------------------------------------- 2. Veículo = item do cliente com placa

-- placa sem hífen e em maiúsculas: ABC1234 ou ABC1D23 (Mercosul). Única por empresa.
alter table public.client_items
  add column plate text check (plate is null or plate ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$');
create unique index client_items_plate_unique on public.client_items (company_id, plate) where plate is not null;
grant update (plate) on public.client_items to authenticated;

-- ---------------------------------------------------------------- 3. Quem atende: também na oficina

-- Mecânicos são "agendas" (resources) ligadas ou não a alguém da equipe, como na agenda: assim a comissão
-- funciona igual para os dois ramos.
alter policy resources_select on public.resources using (
  public.is_member(company_id) and (public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico'))
);
alter policy resources_insert on public.resources with check (
  (public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico'))
  and public.has_role(company_id, array['admin', 'gestor']::app_role[])
);
alter policy resources_update on public.resources
  using ((public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico'))
         and public.has_role(company_id, array['admin', 'gestor']::app_role[]))
  with check ((public.module_enabled(company_id, 'agenda') or public.module_enabled(company_id, 'ordem_servico'))
              and public.has_role(company_id, array['admin', 'gestor']::app_role[]));

-- ---------------------------------------------------------------- 4. Tabelas

create type public.work_order_stage as enum ('orcamento', 'aprovacao', 'peca', 'servico', 'pronto', 'entregue', 'cancelada');

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number integer not null check (number > 0),
  client_id uuid not null,
  item_id uuid not null,
  resource_id uuid,
  stage public.work_order_stage not null default 'orcamento',
  complaint text not null default '' check (length(complaint) <= 1000),
  diagnosis text not null default '' check (length(diagnosis) <= 2000),
  km integer check (km between 0 and 3000000),
  fuel text check (fuel in ('reserva', '1/4', '1/2', '3/4', 'cheio')),
  -- itens conferidos na entrada (estepe, macaco, documento…) e avarias anotadas
  checklist jsonb not null default '[]' check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 30 and length(checklist::text) <= 2000),
  promised_on date,
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  share_token uuid unique,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_by_name text check (length(approved_by_name) <= 120),
  approval_channel text check (approval_channel in ('link', 'presencial', 'telefone', 'whatsapp')),
  delivered_at timestamptz,
  total_cents bigint,
  canceled_at timestamptz,
  cancel_reason text check (length(cancel_reason) <= 300),
  next_service_on date,
  next_service_note text not null default '' check (length(next_service_note) <= 200),
  request_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, number),
  unique (company_id, request_id),
  foreign key (company_id, client_id) references public.clients (company_id, id),
  foreign key (company_id, item_id) references public.client_items (company_id, id),
  foreign key (company_id, resource_id) references public.resources (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id)
);
create index work_orders_stage_idx on public.work_orders (company_id, stage);
create index work_orders_item_idx on public.work_orders (company_id, item_id);
create trigger work_orders_no_delete before delete on public.work_orders for each row execute function public.forbid_delete();

create table public.work_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  work_order_id uuid not null,
  kind text not null check (kind in ('peca', 'servico')),
  service_id uuid,
  description text not null check (length(trim(description)) between 1 and 120),
  quantity integer not null check (quantity between 1 and 999),
  unit_cents bigint not null check (unit_cents between 0 and 10000000000),
  warranty_days integer check (warranty_days between 1 and 3650),
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  added_by uuid not null,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, work_order_id) references public.work_orders (company_id, id),
  foreign key (company_id, service_id) references public.services (company_id, id),
  foreign key (company_id, added_by) references public.memberships (company_id, user_id)
);
create index work_order_items_wo_idx on public.work_order_items (company_id, work_order_id);

-- Linha do tempo da OS (abertura, envio, aprovação, etapas, entrega): só as funções escrevem.
create table public.work_order_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  work_order_id uuid not null,
  description text not null check (length(description) <= 300),
  actor_id uuid,
  created_at timestamptz not null default now(),
  foreign key (company_id, work_order_id) references public.work_orders (company_id, id)
);
create index work_order_events_wo_idx on public.work_order_events (company_id, work_order_id, created_at);
create trigger work_order_events_no_delete before delete on public.work_order_events for each row execute function public.forbid_delete();

-- Fotos: o arquivo fica no Supabase Storage (bucket privado "os-fotos", caminho empresa/os/arquivo.webp).
create table public.work_order_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  work_order_id uuid not null,
  path text not null unique check (length(path) <= 300),
  caption text not null default '' check (length(caption) <= 120),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, work_order_id) references public.work_orders (company_id, id),
  foreign key (company_id, created_by) references public.memberships (company_id, user_id)
);
create trigger work_order_photos_no_delete before delete on public.work_order_photos for each row execute function public.forbid_delete();

alter table public.accounts
  add column work_order_id uuid,
  add foreign key (company_id, work_order_id) references public.work_orders (company_id, id);

-- ---------------------------------------------------------------- 5. Quem vê e quem mexe

create or replace function public.sees_all_work_orders(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'ordem_servico') and public.has_role(cid, array['admin', 'gestor', 'recepcao', 'financeiro']::app_role[]);
$$;

create or replace function public.edits_work_orders(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.module_enabled(cid, 'ordem_servico') and public.has_role(cid, array['admin', 'gestor', 'recepcao']::app_role[]);
$$;

-- O mecânico responsável pela OS (agenda ligada a ele).
create or replace function public.works_on(woid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from work_orders w join resources r on r.id = w.resource_id
    where w.id = woid and r.user_id = auth.uid() and public.module_enabled(w.company_id, 'ordem_servico')
  );
$$;

create or replace function public.can_see_work_order(woid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from work_orders w where w.id = woid and public.sees_all_work_orders(w.company_id))
      or public.works_on(woid);
$$;

-- Quem atende (agenda), dá aula (turmas) ou cuida do carro (oficina) passa a ver o cliente.
create or replace function public.attends_client(cid uuid, clid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (public.module_enabled(cid, 'agenda') and exists (
            select 1 from appointments a join resources r on r.id = a.resource_id
            where a.client_id = clid and r.user_id = auth.uid()))
      or (public.module_enabled(cid, 'turmas') and exists (
            select 1 from enrollments e join classes c on c.id = e.class_id join resources r on r.id = c.resource_id
            where e.client_id = clid and e.ended_on is null and r.user_id = auth.uid()))
      or (public.module_enabled(cid, 'ordem_servico') and exists (
            select 1 from work_orders w join resources r on r.id = w.resource_id
            where w.client_id = clid and r.user_id = auth.uid()));
$$;

alter table public.work_orders enable row level security;
alter table public.work_order_items enable row level security;
alter table public.work_order_events enable row level security;
alter table public.work_order_photos enable row level security;
revoke all on public.work_orders, public.work_order_items, public.work_order_events, public.work_order_photos from anon;
-- tudo é gravado pelas funções abaixo; a tabela de fotos aceita insert direto (depois do envio do arquivo)
grant select on public.work_orders, public.work_order_items, public.work_order_events to authenticated;
grant select, insert on public.work_order_photos to authenticated;

create policy work_orders_select on public.work_orders for select to authenticated using (public.can_see_work_order(id));
create policy work_order_items_select on public.work_order_items for select to authenticated using (public.can_see_work_order(work_order_id));
create policy work_order_events_select on public.work_order_events for select to authenticated using (public.can_see_work_order(work_order_id));
create policy work_order_photos_select on public.work_order_photos for select to authenticated using (public.can_see_work_order(work_order_id));

-- Limite de fotos por OS conforme o plano (igual a PHOTO_LIMIT em work-orders.ts).
create or replace function public._photo_limit(cid uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case c.plan when 'essencial' then 4 when 'equipe' then 8 else 12 end from companies c where c.id = cid;
$$;

create policy work_order_photos_insert on public.work_order_photos for insert to authenticated with check (
  created_by = auth.uid()
  and (public.edits_work_orders(company_id) or public.works_on(work_order_id))
  and exists (select 1 from work_orders w where w.id = work_order_id and w.stage not in ('entregue', 'cancelada'))
  and path like company_id::text || '/' || work_order_id::text || '/%'
);

create or replace function public.guard_photo_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_limit int := public._photo_limit(new.company_id);
begin
  perform 1 from work_orders where id = new.work_order_id for update;
  if (select count(*) from work_order_photos where work_order_id = new.work_order_id) >= v_limit then
    raise exception 'Esta OS já tem % fotos, o limite do plano.', v_limit using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger work_order_photos_limit before insert on public.work_order_photos for each row execute function public.guard_photo_limit();

-- Storage (só existe no Supabase; nos testes locais o esquema "storage" não existe e esta parte é pulada).
create or replace function public._photo_wo(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 2)::uuid;
exception when others then
  return null;
end $$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('os-fotos', 'os-fotos', false) on conflict (id) do nothing;
    execute $p$create policy os_fotos_select on storage.objects for select to authenticated using (
      bucket_id = 'os-fotos' and public.can_see_work_order(public._photo_wo(name)))$p$;
    execute $p$create policy os_fotos_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'os-fotos'
      and exists (select 1 from public.work_orders w
                  where w.id = public._photo_wo(name) and split_part(name, '/', 1) = w.company_id::text
                    and w.stage not in ('entregue', 'cancelada')
                    and (public.edits_work_orders(w.company_id) or public.works_on(w.id))))$p$;
    -- só o arquivo que a própria pessoa enviou e que não chegou a virar foto da OS (envio que falhou no meio)
    execute $p$create policy os_fotos_delete on storage.objects for delete to authenticated using (
      bucket_id = 'os-fotos' and owner = auth.uid()
      and not exists (select 1 from public.work_order_photos p where p.path = name))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------- 6. Funções

create or replace function public._wo_event(w public.work_orders, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into work_order_events (company_id, work_order_id, description, actor_id) values (w.company_id, w.id, p_text, auth.uid());
$$;

-- Carrega a OS travada e confere que a pessoa pode mexer: 'editar' (atendente), 'mecanico' (editar ou ser o
-- mecânico dela) ou 'entregar' (atendente ou financeiro).
create or replace function public._wo_for(p_wo uuid, p_mode text) returns public.work_orders
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  select * into w from work_orders where id = p_wo for update;
  if not found or not public.can_see_work_order(w.id) then raise exception 'Ordem de serviço não encontrada' using errcode = 'P0002'; end if;
  if p_mode = 'editar' and not public.edits_work_orders(w.company_id) then
    raise exception 'Seu papel nesta empresa não permite alterar ordens de serviço.' using errcode = '42501';
  elsif p_mode = 'mecanico' and not (public.edits_work_orders(w.company_id) or public.works_on(w.id)) then
    raise exception 'Só o mecânico responsável ou o atendimento mexem nesta OS.' using errcode = '42501';
  elsif p_mode = 'entregar' and not (public.edits_work_orders(w.company_id) or public.has_role(w.company_id, array['financeiro']::app_role[])) then
    raise exception 'Seu papel nesta empresa não permite entregar ordens de serviço.' using errcode = '42501';
  end if;
  if w.stage in ('entregue', 'cancelada') and p_mode <> 'ler' then
    raise exception 'Esta OS já foi %.', case w.stage when 'entregue' then 'entregue' else 'cancelada' end using errcode = 'P0001';
  end if;
  return w;
end $$;

create or replace function public.open_work_order(
  p_client uuid, p_item uuid, p_resource uuid, p_complaint text, p_km integer, p_fuel text, p_checklist jsonb,
  p_promised date, p_request uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); c clients%rowtype; v_num int; w work_orders%rowtype;
begin
  select * into c from clients where id = p_client;
  if not found or not public.can_see_client(c.id) then raise exception 'Cliente não encontrado' using errcode = 'P0002'; end if;
  if not public.edits_work_orders(c.company_id) then
    raise exception 'Seu papel nesta empresa não permite abrir ordens de serviço.' using errcode = '42501';
  end if;
  select * into w from work_orders where company_id = c.company_id and request_id = p_request;
  if found then return jsonb_build_object('id', w.id, 'number', w.number, 'duplicate', true); end if;
  if not exists (select 1 from client_items i where i.id = p_item and i.client_id = c.id and i.kind = 'veiculo') then
    raise exception 'Este veículo não é deste cliente.' using errcode = '22023';
  end if;
  if p_resource is not null and not exists (select 1 from resources where id = p_resource and company_id = c.company_id and active) then
    raise exception 'Mecânico não encontrado' using errcode = 'P0002';
  end if;
  -- numeração sem buracos por empresa: trava a linha da empresa enquanto calcula
  perform 1 from companies where id = c.company_id for update;
  select coalesce(max(number), 0) + 1 into v_num from work_orders where company_id = c.company_id;
  insert into work_orders (company_id, number, client_id, item_id, resource_id, complaint, km, fuel, checklist, promised_on, request_id, created_by)
  values (c.company_id, v_num, c.id, p_item, p_resource, coalesce(trim(p_complaint), ''), p_km, p_fuel, coalesce(p_checklist, '[]'::jsonb),
          p_promised, p_request, me)
  returning * into w;
  perform public._wo_event(w, 'OS aberta');
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (c.company_id, c.id, 'os', 'OS nº ' || v_num || ' aberta', me);
  return jsonb_build_object('id', w.id, 'number', v_num, 'duplicate', false);
end $$;

create or replace function public.save_work_order(
  p_wo uuid, p_resource uuid, p_complaint text, p_km integer, p_fuel text, p_checklist jsonb, p_promised date
) returns void
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_for(p_wo, 'editar');
  if p_resource is not null and not exists (select 1 from resources where id = p_resource and company_id = w.company_id) then
    raise exception 'Mecânico não encontrado' using errcode = 'P0002';
  end if;
  update work_orders set resource_id = p_resource, complaint = coalesce(trim(p_complaint), ''), km = p_km, fuel = p_fuel,
    checklist = coalesce(p_checklist, '[]'::jsonb), promised_on = p_promised
  where id = w.id;
  if p_resource is distinct from w.resource_id then
    perform public._wo_event(w, 'Mecânico: ' || coalesce((select name from resources where id = p_resource), 'nenhum'));
  end if;
end $$;

create or replace function public.set_work_order_diagnosis(p_wo uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_for(p_wo, 'mecanico');
  update work_orders set diagnosis = coalesce(trim(p_text), '') where id = w.id;
end $$;

create or replace function public.add_work_order_item(
  p_wo uuid, p_kind text, p_service uuid, p_description text, p_quantity integer, p_unit bigint, p_warranty integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); w work_orders%rowtype; v_id uuid;
begin
  w := public._wo_for(p_wo, 'mecanico');
  if p_service is not null and not exists (select 1 from services where id = p_service and company_id = w.company_id) then
    raise exception 'Serviço não encontrado' using errcode = 'P0002';
  end if;
  insert into work_order_items (company_id, work_order_id, kind, service_id, description, quantity, unit_cents, warranty_days, added_by)
  values (w.company_id, w.id, p_kind, p_service, trim(p_description), p_quantity, p_unit, p_warranty, me)
  returning id into v_id;
  return v_id;
end $$;

-- Só item ainda não decidido pelo cliente sai do orçamento (quem pode mexer na OS).
create or replace function public.remove_work_order_item(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
declare it work_order_items%rowtype; w work_orders%rowtype;
begin
  select * into it from work_order_items where id = p_item;
  if not found then raise exception 'Item não encontrado' using errcode = 'P0002'; end if;
  w := public._wo_for(it.work_order_id, 'mecanico');
  if it.status <> 'pendente' then
    raise exception 'O cliente já decidiu sobre este item; ele fica no histórico.' using errcode = 'P0001';
  end if;
  delete from work_order_items where id = it.id;
end $$;

create or replace function public._wo_quote_total(p_wo uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(quantity * unit_cents), 0)::bigint from work_order_items where work_order_id = p_wo and status <> 'recusado';
$$;

create or replace function public.set_work_order_discount(p_wo uuid, p_discount bigint) returns void
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype; v_total bigint;
begin
  w := public._wo_for(p_wo, 'editar');
  v_total := public._wo_quote_total(w.id);
  if p_discount is null or p_discount < 0 or p_discount > v_total then
    raise exception 'O desconto precisa ficar entre zero e o valor do orçamento.' using errcode = '22023';
  end if;
  if not public.has_role(w.company_id, array['admin', 'gestor']::app_role[]) and p_discount * 10 > v_total then
    raise exception 'O atendimento dá até 10%% de desconto. Acima disso, peça ao dono.' using errcode = '42501';
  end if;
  update work_orders set discount_cents = p_discount where id = w.id;
  perform public._wo_event(w, 'Desconto: ' || public._fmt_brl(p_discount));
end $$;

-- Envia o orçamento: cria o link (se ainda não houver) e, se a OS estava em orçamento, passa a aguardar aprovação.
create or replace function public.send_work_order(p_wo uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype; v_token uuid;
begin
  w := public._wo_for(p_wo, 'editar');
  if not exists (select 1 from work_order_items where work_order_id = w.id and status = 'pendente') then
    raise exception 'Não há itens aguardando aprovação no orçamento.' using errcode = 'P0001';
  end if;
  v_token := coalesce(w.share_token, gen_random_uuid());
  update work_orders set share_token = v_token, sent_at = now(),
    stage = case when stage = 'orcamento' then 'aprovacao'::work_order_stage else stage end
  where id = w.id;
  perform public._wo_event(w, 'Orçamento enviado ao cliente');
  return v_token;
end $$;

-- Decide os itens pendentes: os escolhidos ficam aprovados e o resto, recusado. Com algo aprovado, a OS vai
-- para "em serviço" (se estava no orçamento); sem nada aprovado, fica "pronto" para o cliente buscar.
create or replace function public._wo_decide(w public.work_orders, p_approved uuid[], p_channel text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_yes int; v_no int;
begin
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Informe o nome de quem aprovou.' using errcode = '22023'; end if;
  if not exists (select 1 from work_order_items where work_order_id = w.id and status = 'pendente') then
    raise exception 'Não há itens aguardando aprovação.' using errcode = 'P0001';
  end if;
  update work_order_items set status = case when id = any (coalesce(p_approved, '{}')) then 'aprovado' else 'recusado' end
  where work_order_id = w.id and status = 'pendente';
  select count(*) filter (where status = 'aprovado'), count(*) filter (where status = 'recusado') into v_yes, v_no
  from work_order_items where work_order_id = w.id;
  update work_orders set approved_at = now(), approved_by_name = trim(p_name), approval_channel = p_channel,
    stage = case when stage in ('orcamento', 'aprovacao') then
                   (case when exists (select 1 from work_order_items where work_order_id = w.id and status = 'aprovado')
                         then 'servico' else 'pronto' end)::work_order_stage
                 else stage end
  where id = w.id;
  insert into work_order_events (company_id, work_order_id, description, actor_id)
  values (w.company_id, w.id,
          'Orçamento decidido por ' || trim(p_name) || ' (' || case p_channel when 'link' then 'pelo link' when 'presencial' then 'na oficina'
            when 'telefone' then 'por telefone' else 'pelo WhatsApp' end || ')', auth.uid());
  return jsonb_build_object('approved', v_yes, 'refused', v_no);
end $$;

create or replace function public.approve_work_order(p_wo uuid, p_approved uuid[], p_channel text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_for(p_wo, 'editar');
  if p_channel not in ('presencial', 'telefone', 'whatsapp') then raise exception 'Como o cliente aprovou?' using errcode = '22023'; end if;
  return public._wo_decide(w, p_approved, p_channel, p_name);
end $$;

-- Etapas: o atendimento move entre todas (menos entregue e cancelada, que têm função própria);
-- o mecânico, só entre aguardando peça, em serviço e pronto.
create or replace function public.move_work_order(p_wo uuid, p_stage public.work_order_stage) returns void
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_for(p_wo, 'mecanico');
  if p_stage in ('entregue', 'cancelada') then raise exception 'Use entregar ou cancelar.' using errcode = '22023'; end if;
  if not public.edits_work_orders(w.company_id)
     and not (p_stage in ('peca', 'servico', 'pronto') and w.stage in ('peca', 'servico', 'pronto')) then
    raise exception 'O mecânico move a OS entre aguardando peça, em serviço e pronto.' using errcode = '42501';
  end if;
  if p_stage = w.stage then return; end if;
  update work_orders set stage = p_stage where id = w.id;
  perform public._wo_event(w, 'Etapa: ' || case p_stage when 'orcamento' then 'aguardando orçamento' when 'aprovacao' then 'aguardando aprovação'
    when 'peca' then 'aguardando peça' when 'servico' then 'em serviço' else 'pronto' end);
end $$;

-- Entrega: o valor aprovado menos o desconto vira conta a receber (à vista ou parcelado).
create or replace function public.deliver_work_order(p_wo uuid, p_plan jsonb, p_next_service date, p_next_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); w work_orders%rowtype; v_total bigint; item jsonb; n int; v_plate text;
begin
  w := public._wo_for(p_wo, 'entregar');
  if exists (select 1 from work_order_items where work_order_id = w.id and status = 'pendente') then
    raise exception 'Há itens aguardando a decisão do cliente. Registre a aprovação ou tire os itens antes de entregar.' using errcode = 'P0001';
  end if;
  v_total := greatest(0, public._wo_quote_total(w.id) - w.discount_cents);
  if v_total > 0 then perform public._check_plan(p_plan, v_total); end if;
  select coalesce(i.plate, i.name) into v_plate from client_items i where i.id = w.item_id;
  if v_total > 0 then
    n := jsonb_array_length(p_plan);
    for item in select * from jsonb_array_elements(p_plan) loop
      insert into accounts (company_id, kind, client_id, description, origin, work_order_id, installment_number, installment_count,
                            amount_cents, due_date, created_by)
      values (w.company_id, 'receber', w.client_id, 'OS nº ' || w.number || ' — ' || v_plate, 'os', w.id,
              (item ->> 'number')::smallint, n, (item ->> 'amount_cents')::bigint, (item ->> 'due_date')::date, me);
    end loop;
  end if;
  update work_orders set stage = 'entregue', delivered_at = now(), total_cents = v_total,
    next_service_on = p_next_service, next_service_note = coalesce(trim(p_next_note), '')
  where id = w.id;
  perform public._wo_event(w, 'Entregue ao cliente — ' || public._fmt_brl(v_total));
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (w.company_id, w.client_id, 'os', 'OS nº ' || w.number || ' entregue: ' || public._fmt_brl(v_total), me);
  return jsonb_build_object('total_cents', v_total);
end $$;

create or replace function public.cancel_work_order(p_wo uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_for(p_wo, 'editar');
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Escreva o motivo do cancelamento.' using errcode = '22023'; end if;
  update work_orders set stage = 'cancelada', canceled_at = now(), cancel_reason = trim(p_reason) where id = w.id;
  perform public._wo_event(w, 'Cancelada: ' || trim(p_reason));
end $$;

-- O carro mudou de dono: o histórico continua com a placa.
create or replace function public.transfer_vehicle(p_item uuid, p_client uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); it client_items%rowtype;
begin
  select * into it from client_items where id = p_item and kind = 'veiculo' for update;
  if not found or not public.can_see_client(it.client_id) then raise exception 'Veículo não encontrado' using errcode = 'P0002'; end if;
  if not public.edits_work_orders(it.company_id) then
    raise exception 'Seu papel nesta empresa não permite transferir veículos.' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client and company_id = it.company_id) or not public.can_see_client(p_client) then
    raise exception 'Cliente não encontrado' using errcode = 'P0002';
  end if;
  if exists (select 1 from work_orders where item_id = it.id and stage not in ('entregue', 'cancelada')) then
    raise exception 'Este veículo tem OS em andamento. Entregue ou cancele antes de transferir.' using errcode = 'P0001';
  end if;
  update client_items set client_id = p_client where id = it.id;
  insert into activities (company_id, client_id, kind, description, actor_id)
  values (it.company_id, p_client, 'os', 'Veículo ' || coalesce(it.plate, it.name) || ' transferido para este cliente', me);
end $$;

-- ---------------------------------------------------------------- 7. Orçamento pelo link (sem login)

create or replace function public._wo_by_token(p_token uuid) returns public.work_orders
language sql stable security definer set search_path = public as $$
  select w.* from work_orders w
  where w.share_token = p_token and w.sent_at > now() - interval '30 days' and public.module_enabled(w.company_id, 'ordem_servico');
$$;

create or replace function public.public_work_order(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare w work_orders%rowtype; c companies%rowtype;
begin
  w := public._wo_by_token(p_token);
  if w.id is null then return null; end if;
  select * into c from companies where id = w.company_id;
  return jsonb_build_object(
    'company', jsonb_build_object('name', c.name, 'logo', c.logo_data_url, 'brand_color', c.brand_color, 'phone', c.phone),
    'number', w.number, 'stage', w.stage, 'complaint', w.complaint, 'diagnosis', w.diagnosis,
    'discount_cents', w.discount_cents, 'approved_at', w.approved_at, 'approved_by_name', w.approved_by_name,
    'promised_on', w.promised_on,
    'client_name', (select split_part(name, ' ', 1) from clients where id = w.client_id),
    'vehicle', (select jsonb_build_object('name', i.name, 'plate', i.plate) from client_items i where i.id = w.item_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'kind', it.kind, 'description', it.description,
                                                          'quantity', it.quantity, 'unit_cents', it.unit_cents,
                                                          'warranty_days', it.warranty_days, 'status', it.status)
                                        order by it.kind, it.created_at)
                       from work_order_items it where it.work_order_id = w.id), '[]'::jsonb)
  );
end $$;

create or replace function public.public_approve_work_order(p_token uuid, p_approved uuid[], p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w work_orders%rowtype;
begin
  w := public._wo_by_token(p_token);
  if w.id is null then raise exception 'Este link não está mais ativo. Fale com a oficina.' using errcode = 'P0002'; end if;
  select * into w from work_orders where id = w.id for update;
  if w.stage in ('entregue', 'cancelada') then raise exception 'Esta OS já foi encerrada.' using errcode = 'P0001'; end if;
  return public._wo_decide(w, p_approved, 'link', p_name);
end $$;

-- ---------------------------------------------------------------- 8. Comissão também sobre a mão de obra da OS

-- Base: itens de mão de obra aprovados das OS entregues no mês (horário de Brasília), pela regra mais específica
-- (mecânico + serviço > serviço > mecânico > geral). Igual a commissionSummary em commissions.ts.
create or replace function public.close_commissions(p_resource uuid, p_month date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public._uid(); res resources%rowtype; v_from timestamptz; v_to timestamptz;
  v_count int := 0; v_base bigint := 0; v_amount bigint := 0; v_acc uuid; v_label text; ap record; b bigint;
begin
  select * into res from resources where id = p_resource;
  if not found or not public.is_member(res.company_id) then raise exception 'Agenda não encontrada' using errcode = 'P0002'; end if;
  if not public.module_enabled(res.company_id, 'comissoes') then
    raise exception 'Este recurso não está disponível para o ramo ou o plano da empresa.' using errcode = '42501';
  end if;
  perform public._require_role(res.company_id, array['admin', 'financeiro']::app_role[], 'Somente o financeiro ou o dono fecham comissões.');
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'Mês inválido' using errcode = '22023'; end if;
  if p_month >= date_trunc('month', current_date)::date then
    raise exception 'Só dá para fechar um mês que já terminou.' using errcode = 'P0001';
  end if;
  if exists (select 1 from commission_closings where resource_id = p_resource and month = p_month) then
    raise exception 'As comissões deste mês já foram fechadas.' using errcode = 'P0001';
  end if;
  v_from := (p_month::timestamp + interval '3 hours') at time zone 'UTC';
  v_to := ((p_month + interval '1 month')::timestamp + interval '3 hours') at time zone 'UTC';
  for ap in
    select a.service_id, a.price_cents, a.consumes_package, p.price_cents as pkg_price, p.sessions_total
    from appointments a left join packages p on p.id = a.package_id
    where a.resource_id = p_resource and a.status = 'compareceu' and a.starts_at >= v_from and a.starts_at < v_to
  loop
    b := case when ap.consumes_package and ap.sessions_total > 0 then round(ap.pkg_price::numeric / ap.sessions_total)::bigint
              else ap.price_cents end;
    v_count := v_count + 1;
    v_base := v_base + b;
    v_amount := v_amount + coalesce(public._commission_of(res.company_id, p_resource, ap.service_id, b), 0);
  end loop;
  for ap in
    select it.service_id, it.quantity * it.unit_cents as base
    from work_order_items it join work_orders w on w.id = it.work_order_id
    where w.resource_id = p_resource and w.stage = 'entregue' and w.delivered_at >= v_from and w.delivered_at < v_to
      and it.kind = 'servico' and it.status = 'aprovado'
  loop
    v_count := v_count + 1;
    v_base := v_base + ap.base;
    v_amount := v_amount + coalesce(public._commission_of(res.company_id, p_resource, ap.service_id, ap.base), 0);
  end loop;
  v_label := to_char(p_month, 'MM/YYYY');
  if v_amount > 0 then
    insert into accounts (company_id, kind, supplier, description, origin, amount_cents, due_date, category, created_by)
    values (res.company_id, 'pagar', res.name, 'Comissão ' || v_label || ' — ' || res.name, 'comissao', v_amount,
            (p_month + interval '1 month' + interval '4 days')::date, 'Salários', me)
    returning id into v_acc;
  end if;
  insert into commission_closings (company_id, resource_id, month, appointments, base_cents, amount_cents, account_id, closed_by)
  values (res.company_id, p_resource, p_month, v_count, v_base, v_amount, v_acc, me);
  return jsonb_build_object('appointments', v_count, 'base_cents', v_base, 'amount_cents', v_amount, 'account_id', v_acc);
end $$;

-- ---------------------------------------------------------------- 9. Quem pode chamar

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('_wo_event', '_wo_for', '_wo_decide', '_wo_quote_total', '_wo_by_token',
                                                        'guard_photo_limit', '_photo_limit')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in (
             'sees_all_work_orders', 'edits_work_orders', 'works_on', 'can_see_work_order', 'attends_client', '_photo_wo',
             'open_work_order', 'save_work_order', 'set_work_order_diagnosis', 'add_work_order_item', 'remove_work_order_item',
             'set_work_order_discount', 'send_work_order', 'approve_work_order', 'move_work_order', 'deliver_work_order',
             'cancel_work_order', 'transfer_vehicle', 'close_commissions', '_segment_modules')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
  -- a página do orçamento chama só estas duas, sem login
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('public_work_order', 'public_approve_work_order')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
