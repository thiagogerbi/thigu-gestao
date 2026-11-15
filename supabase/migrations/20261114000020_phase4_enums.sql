-- Thigu Gestão — valores novos de tipos (Fase 4, parte A: balcão e estoque).
-- Arquivo próprio porque um valor novo de enum não pode ser usado na mesma transação em que foi criado.

alter type public.account_origin add value if not exists 'crediario';
alter type public.account_origin add value if not exists 'devolucao';
