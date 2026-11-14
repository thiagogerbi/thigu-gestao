-- Thigu Gestão — cor do menu lateral da empresa
-- null = automático (tom escuro da cor da marca). A interface escurece a cor escolhida quando
-- necessário para manter contraste ≥ 7:1 com o texto branco do menu (src/lib/domain/branding.ts).

alter table public.companies
  add column menu_color text check (menu_color ~ '^#[0-9a-f]{6}$');

grant update (menu_color) on public.companies to authenticated;
