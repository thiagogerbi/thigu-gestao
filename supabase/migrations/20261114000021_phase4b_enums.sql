-- Thigu Gestão — valores novos de tipos (Fase 4, parte B: pedidos com prazo).
-- Arquivo próprio porque um valor novo de enum não pode ser usado na mesma transação em que foi criado.

alter type public.account_origin add value if not exists 'pedido';
