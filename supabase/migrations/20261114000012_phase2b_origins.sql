-- Thigu Gestão — contas que nascem de uma venda no caixa e do fechamento de comissões
-- Separado dos arquivos seguintes pelo mesmo motivo de 20261114000006, 000008 e 000010.

alter type public.account_origin add value if not exists 'caixa';
alter type public.account_origin add value if not exists 'comissao';
