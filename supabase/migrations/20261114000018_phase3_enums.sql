-- Thigu Gestão — valores novos de tipos (Fase 3: oficinas).
-- Ficam num arquivo próprio porque um valor novo de enum não pode ser usado na mesma transação em que foi criado.

alter type public.item_kind add value if not exists 'veiculo';
alter type public.account_origin add value if not exists 'os';
