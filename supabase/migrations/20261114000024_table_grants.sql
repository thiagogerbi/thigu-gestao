-- Permissões das tabelas iguais no Supabase e nos testes (achado na validação de 15/11/2026).
--
-- No Supabase, toda tabela nova no schema public nasce com TODAS as permissões para `anon` e
-- `authenticated` (privilégios padrão do projeto). As migrações anteriores só davam `grant` do que
-- era permitido, contando que o resto nascia fechado, como no banco de teste. Resultado no Supabase:
-- quem estava logado e passava na política de UPDATE de uma tabela conseguia alterar QUALQUER coluna
-- dela, por exemplo o saldo do estoque (products.stock_qty) sem movimentação. O isolamento entre
-- empresas continuava valendo (é das políticas RLS), mas as travas por coluna não.
--
-- Aqui: fecha tudo e concede de novo, numa lista só, exatamente o que as migrações pretendiam.
-- Duas travas ficam mais firmes do que eram:
--   * clients.credit_limit_cents só muda por set_credit_limit (financeiro ou dono);
--   * products.stock_qty só muda por movimentação de estoque, inclusive no cadastro do produto.
-- Tabelas novas daqui em diante nascem fechadas; cada migração concede o que precisar.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Leitura: sempre filtrada pelas políticas RLS de cada tabela.
grant select on all tables in schema public to authenticated;

-- Escrita direta na tabela inteira (as políticas RLS dizem quem e em quais linhas).
grant insert, update on public.accounts, public.activities, public.deals, public.notes, public.tasks to authenticated;
grant insert on public.appointments, public.attendance, public.classes, public.client_items, public.clinical_notes,
  public.commission_rules, public.companies, public.enrollments, public.prescriptions, public.resource_blocks,
  public.resources, public.services, public.subscriptions, public.work_order_photos to authenticated;
grant delete on public.attendance, public.commission_rules, public.resource_blocks to authenticated;

-- Escrita só nas colunas listadas.
grant insert (id, company_id, name, email, phone, owner_id, created_at, extra) on public.clients to authenticated;
grant update (name, email, phone, owner_id, extra) on public.clients to authenticated;
grant insert (id, company_id, name, price_cents, active, created_at, sku, barcode, cost_cents, track_stock, min_stock,
              size, color, fits) on public.products to authenticated;
grant update (name, price_cents, active, sku, barcode, cost_cents, track_stock, min_stock, size, color, fits)
  on public.products to authenticated;
grant update (client_id, resource_id, service_id, item_id, package_id, starts_at, ends_at, price_cents, notes, reminded_at)
  on public.appointments to authenticated;
grant update (status, marked_by, marked_at) on public.attendance to authenticated;
grant update (name, resource_id, weekdays, start_time, duration_min, capacity, active) on public.classes to authenticated;
grant update (name, details, alert, active, plate) on public.client_items to authenticated;
grant update (percent_bp, fixed_cents) on public.commission_rules to authenticated;
grant update (name, legal_name, document, phone, email, address, default_terms, logo_data_url, brand_color, menu_color,
              segment, booking_slug, booking_enabled, booking_auto_confirm) on public.companies to authenticated;
grant update (ended_on) on public.enrollments to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (name, user_id, active, work_hours) on public.resources to authenticated;
grant update (name, duration_min, price_cents, active) on public.services to authenticated;
grant update (name, amount_cents, day_of_month, ends_on) on public.subscriptions to authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
