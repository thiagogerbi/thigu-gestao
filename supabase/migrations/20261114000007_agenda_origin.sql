-- Thigu Gestão — conta a receber que nasce de um atendimento da agenda
-- Arquivo separado pelo mesmo motivo de 20261114000005: o valor novo do enum só pode ser usado
-- depois que a transação que o criou termina. Quem usa está no arquivo seguinte.

alter type public.account_origin add value if not exists 'atendimento';
