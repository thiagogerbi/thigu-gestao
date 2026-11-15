-- Thigu Gestão — papéis dos ramos com atendimento
-- Recepção (ou atendente), profissional (psicóloga, cabeleireira, banhista, mecânico…) e caixa.
-- Fica num arquivo só dele porque o Postgres não deixa usar um valor novo de enum na mesma
-- transação em que ele foi criado: as regras que usam estes papéis estão no arquivo seguinte.

alter type public.app_role add value if not exists 'recepcao';
alter type public.app_role add value if not exists 'profissional';
alter type public.app_role add value if not exists 'caixa';
