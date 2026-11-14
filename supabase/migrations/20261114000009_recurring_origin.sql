-- Thigu Gestão — contas a receber de pacotes e de mensalidades
-- Separado do arquivo seguinte pelo mesmo motivo de 20261114000005 e 000007.

alter type public.account_origin add value if not exists 'pacote';
alter type public.account_origin add value if not exists 'mensalidade';
