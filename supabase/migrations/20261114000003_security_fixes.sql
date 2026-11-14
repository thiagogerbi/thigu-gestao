-- Thigu Gestão — correções de permissão no banco
-- Quatro brechas que só apareciam para quem chama o banco direto (PostgREST) com a própria sessão,
-- sem passar pela interface. Cada uma tem um teste em tests/db.test.ts.

-- ---------------------------------------------------------------- 1. E-mail do perfil
-- Antes: o usuário podia alterar profiles.email, e add_member_by_email procurava por esse campo.
-- Bastava gravar no próprio perfil o e-mail de quem seria convidado para receber o papel no lugar.
-- Agora: o usuário só altera o próprio nome; o e-mail do perfil é cópia do e-mail do Auth
-- (sincronizado por gatilho), e a busca do convite usa o e-mail do Auth.

revoke insert, update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- desfaz qualquer e-mail de perfil que tenha sido alterado antes desta correção
update public.profiles p set email = coalesce(u.email, '')
from auth.users u
where u.id = p.user_id and p.email is distinct from coalesce(u.email, '');

create or replace function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = coalesce(new.email, '') where user_id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (new.email is distinct from old.email) execute function public.sync_profile_email();

create or replace function public.add_member_by_email(p_company uuid, p_email text, p_roles public.app_role[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := public._uid(); target uuid;
begin
  perform public._require_role(p_company, array['admin']::app_role[], 'Somente o administrador gerencia membros.');
  -- o e-mail vem do Auth (não do perfil, que é só uma cópia para exibição)
  select u.id into target from auth.users u join profiles p on p.user_id = u.id
  where lower(u.email) = lower(trim(p_email));
  if target is null then
    raise exception 'Não encontramos uma conta com este e-mail. Peça para a pessoa criar a conta primeiro.' using errcode = 'P0002';
  end if;
  insert into memberships (company_id, user_id, roles) values (p_company, target, p_roles)
  on conflict (company_id, user_id) do update set roles = excluded.roles, active = true;
  return target;
end $$;

-- ---------------------------------------------------------------- 2. Plano de parcelas incompleto
-- Antes: uma parcela sem número, valor ou vencimento passava, porque comparações com null não
-- disparam o erro (null <= 0 e null <> total não são verdadeiros). close_sale gravava a venda.
-- Agora: os três campos são obrigatórios em cada parcela.

create or replace function public._check_plan(p_plan jsonb, p_total bigint) returns void language plpgsql immutable as $$
declare
  n int;
  s bigint := 0;
  item jsonb;
  i int := 0;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'array' then raise exception 'Parcelas inválidas' using errcode = '22023'; end if;
  n := jsonb_array_length(p_plan);
  if n < 1 or n > 36 then raise exception 'Use entre 1 e 36 parcelas' using errcode = '22023'; end if;
  for item in select * from jsonb_array_elements(p_plan) loop
    i := i + 1;
    if jsonb_typeof(item) <> 'object' or item ->> 'number' is null or item ->> 'amount_cents' is null or item ->> 'due_date' is null then
      raise exception 'Cada parcela precisa ter número, valor e vencimento' using errcode = '22023';
    end if;
    if (item ->> 'number')::int <> i then raise exception 'Numeração das parcelas fora de ordem' using errcode = '22023'; end if;
    if (item ->> 'amount_cents')::bigint <= 0 then raise exception 'Cada parcela precisa ter valor maior que zero' using errcode = '22023'; end if;
    perform (item ->> 'due_date')::date;
    s := s + (item ->> 'amount_cents')::bigint;
  end loop;
  if s is distinct from p_total then
    raise exception 'A soma das parcelas (%) não confere com o valor da venda (%)', public._fmt_brl(s), public._fmt_brl(p_total) using errcode = '22023';
  end if;
end $$;

-- ---------------------------------------------------------------- 3. Negociação apontada para cliente alheio
-- Antes: ao editar a própria negociação, o vendedor podia trocar client_id para um cliente que não
-- via; como "ter negociação com o cliente" dá acesso à ficha, ele passava a ler nome, e-mail e telefone.
-- Agora: a edição exige o mesmo que a criação — enxergar o cliente de destino.

alter policy deals_update on public.deals with check (
  (public.has_role(company_id, array['admin', 'gestor']::app_role[])
   or (public.has_role(company_id, array['vendedor']::app_role[]) and owner_id = auth.uid()))
  and public.can_see_client(client_id)
);

-- ---------------------------------------------------------------- 4. Proposta editada direto na tabela
-- Antes: quem podia editar a negociação gravava direto em proposals e proposal_items, pulando as
-- validações de save_proposal (desconto maior que o subtotal, número, datas de envio e aceite).
-- O app nunca escreve nessas tabelas diretamente: tudo passa por save_proposal, proposal_mark_sent,
-- proposal_accept e proposal_reject. Agora a escrita direta deixa de existir, como já era em vendas,
-- contas (exceto despesas) e movimentações.

drop policy proposals_insert on public.proposals;
drop policy proposals_update on public.proposals;
drop policy proposal_items_write on public.proposal_items;
revoke insert, update on public.proposals from authenticated;
revoke insert, update, delete on public.proposal_items from authenticated;
