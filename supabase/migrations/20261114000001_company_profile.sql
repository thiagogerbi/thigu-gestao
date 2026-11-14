-- Thigu Gestão — dados e identidade visual da empresa
-- Dados que aparecem na proposta (razão social, CNPJ/CPF, contato, endereço, condições padrão),
-- logotipo e cor da marca. Somente o administrador altera (política companies_update já existente).
--
-- Logotipo: guardado como data URL (PNG, WebP ou JPEG), já reduzido no navegador para no máximo
-- 600 × 240 px. SVG não é aceito (pode carregar script). Fica na própria linha da empresa para não
-- depender do Supabase Storage; se um dia os logotipos crescerem, migrar para um bucket.
--
-- Cor da marca: guardamos a cor escolhida (#rrggbb). A interface deriva os tons e escurece a cor
-- quando necessário para manter contraste ≥ 4,5:1 com texto branco (src/lib/domain/branding.ts).

alter table public.companies
  add column legal_name text not null default '' check (length(legal_name) <= 160),
  -- só dígitos (CPF com 11) ou CNPJ com 14 caracteres (o CNPJ alfanumérico vale desde jul/2026)
  add column document text not null default '' check (document ~ '^([0-9]{11}|[0-9A-Z]{12}[0-9]{2})?$'),
  add column phone text not null default '' check (length(phone) <= 30),
  add column email text not null default '' check (length(email) <= 200),
  add column address text not null default '' check (length(address) <= 300),
  add column default_terms text not null default '' check (length(default_terms) <= 2000),
  add column logo_data_url text check (
    length(logo_data_url) <= 400000
    and logo_data_url ~ '^data:image/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$'
  ),
  add column brand_color text check (brand_color ~ '^#[0-9a-f]{6}$');

-- Antes o administrador podia alterar qualquer coluna da empresa (inclusive created_by).
-- Agora só as colunas editáveis na tela "Minha empresa".
revoke update on public.companies from authenticated;
grant update (name, legal_name, document, phone, email, address, default_terms, logo_data_url, brand_color)
  on public.companies to authenticated;
