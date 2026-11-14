# Thigu Gestão

**Gestão simples. Negócios em movimento.**

SaaS web para pequenas empresas brasileiras com dois módulos integrados — **Thigu CRM** e **Thigu Financeiro** — e um único login. O diferencial é ligar o relacionamento com o cliente ao dinheiro recebido:

> Cadastrar cliente → negociar → preparar proposta → fechar venda → conferir parcelas → registrar recebimento.

---

## Requisitos

| Item     | Versão                                                                                |
| -------- | ------------------------------------------------------------------------------------- |
| Node.js  | **20.9 ou superior** (testado com 20.17.0 — veja `.nvmrc`). Node 22 LTS também serve. |
| npm      | 10+                                                                                   |
| Supabase | Só para a versão real (`/app`). A prévia não precisa.                                 |

As versões de algumas dependências foram fixadas para funcionar no Node 20.17: `@supabase/supabase-js 2.75.0`, `@supabase/ssr 0.7.0`, `tailwindcss 4.2.0` e `vitest 3.2.4`. As versões mais novas dessas bibliotecas exigem Node ≥ 20.19 ou ≥ 22. Se você atualizar o Node, pode atualizá-las.

## Instalação

```bash
npm install
npm run dev
```

Abra <http://localhost:3000>:

- **`/previa`** — prévia navegável, **sem login, sem banco e sem credenciais**, com dados fictícios em memória.
- **`/app`** — versão real (precisa do Supabase configurado).
- **`/entrar`** — login e criação de conta.

### Comandos

| Comando                       | O que faz                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`                 | Servidor de desenvolvimento                                                                |
| `npm run build` / `npm start` | Compilação de produção / servir a compilação                                               |
| `npm run typecheck`           | Verificação de tipos (TypeScript)                                                          |
| `npm run lint`                | ESLint (regras do Next, React, acessibilidade e TypeScript)                                |
| `npm run format`              | Formata o código com Prettier                                                              |
| `npm test`                    | Testes: regras financeiras, motor da prévia e **migrações SQL num Postgres real (PGlite)** |
| `npm run check`               | Tudo acima, antes de enviar código                                                         |

## Configurar a versão real (Supabase)

1. Crie um projeto **de desenvolvimento** no Supabase (o plano gratuito basta). Não use dados reais.
2. Copie `.env.example` para `.env.local` e preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - O app **não usa** a chave `service_role`. Nunca a coloque em variáveis `NEXT_PUBLIC_`.
3. Aplique as migrações em ordem, de uma destas formas:
   - pelo **SQL Editor** do Supabase, colando cada arquivo de `supabase/migrations/` na ordem do nome; ou
   - pela **Supabase CLI**: `supabase link` e depois `supabase db push`.
4. Em _Authentication › Providers_, mantenha **E-mail** ativo. Se a confirmação por e-mail estiver ligada, o usuário confirma pelo link antes de entrar.
5. Rode `npm run dev`, acesse `/entrar`, crie a conta e cadastre a empresa. Você será o administrador.
6. Para adicionar pessoas: o administrador convida pelo e-mail em **Minha empresa**, escolhendo os papéis. O convite aparece para a pessoa quando ela entra no Thigu com esse e-mail (pode criar a conta depois), e ela só passa a fazer parte da empresa quando aceita. Nenhum e-mail é enviado automaticamente: avise a pessoa. Mantenha a confirmação de e-mail ligada no Supabase; sem e-mail confirmado ninguém vê nem aceita convites.

---

## Roteiro de uso (prévia)

1. Abra `/previa`. O **Guia passo a passo** abre sozinho: são 5 passos que contam a história do produto, cada um com um botão **Me mostre** que leva à tela certa e destaca onde clicar. Os passos se marcam como feitos quando a ação acontece.
2. Use **Experimente como** para trocar de papel: Ana (dona), Bruno (vendedor), Carla (financeiro), Diego (gestor).
3. **Fluxo completo na Aurora Estúdio:**
   - Visão geral › _Proposta para João Pereira_ › **Ver proposta** (abre a própria proposta);
   - **Registrar aceite do cliente** › **Fechar venda** (escolha à vista ou parcelado e confira a prévia das parcelas);
   - **Conferir parcelas agora** (como dona ou Carla) › **Criar 3 parcelas a receber**;
   - Financeiro › A receber › **Registrar recebimento** › _Recebi uma parte_ › R$ 200,00.
4. **Primeiro uso:** troque para **Horizonte Serviços** no seletor "Minha empresa". A empresa está vazia e mostra os 4 primeiros passos.
5. **Recomeçar exemplo** volta tudo ao início. Recarregar a página também.

---

## Arquitetura

```
src/
  app/                      só rotas (páginas finas que montam uma tela)
    previa/                 prévia: PreviewBackend + AppShell
    app/                    versão real: RealBackend + AppShell (exige login)
    entrar/                 login e criação de conta
  features/                 uma pasta por funcionalidade; um componente por arquivo
    overview/               visão geral e prioridades do dia
    clients/                lista, cadastro e ficha lateral do cliente
    deals/                  quadro de negociações, mudança de etapa, motivo de perda
    tasks/                  tarefas
    proposals/              proposta (tela/impressão), editor, envio, aceite, recusa
    sales/                  fechar venda, conferir parcelas, editor e etapas
    finance/                a receber, a pagar, caixa, recebimento/pagamento, desfazer, cancelar
    company/                dados da empresa, membros, papéis e convites
    auth/                   formulários de login e de criação de empresa
  components/
    ui/                     componentes genéricos: botão, campos, cartão, janela/painel, aviso, ícones
    layout/                 estrutura (menu, celular, faixa da prévia) e gerenciador de janelas
    brand/                  logotipo e símbolo
  state/                    contexto compartilhado: prévia × real, navegação por URL, seletores
  lib/
    domain/                 regras puras: dinheiro em centavos, datas, parcelas, contas, permissões, painel
    actions/                contrato único das ações (zod), usado pela prévia e pelo servidor
    preview/                PRÉVIA: dados fictícios e motor em memória
    server/                 VERSÃO REAL: ações do servidor, execução e carga de dados (só no servidor)
    supabase/               clientes Supabase (servidor com cookies; navegador só para login)
    utils/                  utilitários pequenos
  proxy.ts                  renova a sessão do Supabase (convenção "proxy" do Next 16)
supabase/migrations/        esquema, RLS e funções transacionais
tests/                      domínio, aceitação na prévia e banco (PGlite)
```

**Convenções**

- Arquivos em `kebab-case`; componentes em `PascalCase`; um componente principal por arquivo.
- Importações sempre com o atalho `@/` (nada de `../../`).
- `features/*` podem usar `components/`, `state/` e `lib/`; `lib/domain` não depende de React nem de nada fora dele.
- Código de servidor fica em `lib/server` e `lib/supabase/server.ts`, protegido por `import "server-only"`.
- Antes de enviar: `npm run check` (tipos, lint, formatação e testes).

As telas usam a mesma interface (`BackendValue`) nas duas versões. Na **prévia**, as ações vão para um motor em memória, sem servidor e sem banco, e esse caminho não importa nada de autenticação. Na **versão real**, cada ação passa por três barreiras:

1. **zod** valida o formato no servidor;
2. **papel do usuário** na empresa é conferido no servidor (`src/lib/server/execute.ts`);
3. **banco**: RLS em todas as tabelas, chaves estrangeiras compostas `(company_id, id)` que impedem relacionar registros de empresas diferentes, e funções `security definer` com checagem de papel para as operações sensíveis.

### Regras financeiras

- Valores em **centavos inteiros** (`bigint`). Parcelas somam exatamente o total: os centavos que sobram vão para as primeiras parcelas (R$ 100 ÷ 3 = 33,34 + 33,33 + 33,33).
- **Venda fechada ≠ dinheiro recebido.** Uma venda aguardando conferência aparece em "Vendido" e "aguardando conferência", **nunca** em "A receber".
- O vendedor **propõe** as parcelas (`close_sale`). O financeiro ou o dono **confere** e cria as contas a receber (`confirm_sale`).
- Proteção contra reenvio e cliques simultâneos: `request_id` único por operação, `SELECT … FOR UPDATE` na venda e na conta, índice único `(sale_id, installment_number)` e botões bloqueados enquanto processam.
- Recebimento acima do saldo é recusado na interface **e** no banco.
- Nada é apagado: desfazer marca o registro como desfeito (com motivo), cancelar mantém a conta no histórico, e gatilhos impedem apagar ou alterar registros financeiros.
- **Caixa realizado** = entradas − saídas registradas. **Previsão** (7/30/90 dias) = caixa + saldos em aberto por vencimento. Negociações em andamento nunca entram.

### Papéis

| Papel              | Pode                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Administrador/dono | Tudo, inclusive membros. Faz o fluxo inteiro sozinho.                                                                   |
| Gestor comercial   | Ver e editar clientes e negociações de todos; fechar vendas; acompanhar parcelas (somente leitura).                     |
| Vendedor           | Os próprios clientes e negociações; fechar vendas e propor parcelas; ver parcelas das próprias vendas.                  |
| Financeiro         | Conferir vendas, criar contas a receber, cadastrar despesas, registrar/desfazer recebimentos e pagamentos. Vê clientes. |

| Recepção | Cadastrar e editar os clientes de toda a equipe, anotar na ficha e marcar na agenda de todos. Não vê negociações, vendas, financeiro nem a ficha de atendimento. |
| Profissional | Os próprios clientes e a própria agenda; vê também quem tem horário com ele. Escreve a ficha de atendimento, que só ele lê. |
| Caixa | Cadastrar e consultar os clientes de toda a equipe. Não usa a agenda (o caixa do dia ainda não existe). |

Uma pessoa pode ter vários papéis e participar de várias empresas (seletor "Minha empresa").

### Ramos: o sistema muda conforme o tipo de empresa

Ao criar a empresa, a pessoa escolhe o ramo (dá para trocar depois em **Minha empresa**; nenhum dado é apagado). O ramo define:

- **nomes das telas** — "paciente" na clínica, "tutor" no pet shop, "aluno" nas turmas;
- **papéis oferecidos à equipe e seus nomes** — "Profissional de saúde", "Mecânico", "Atendente";
- **campos extras da ficha** — nascimento e convênio na clínica, endereço no pet shop;
- **módulos ligados** — prontos: pets do cliente, agenda, lista de serviços, ficha de atendimento, lembretes, pacotes e mensalidades; ordem de serviço, caixa, comissões e os demais estão no catálogo, mas ainda não foram construídos.

### Agenda (clínica, salão, pet shop e aulas)

- **Serviços e equipe:** uma agenda por pessoa ou sala (ligada a alguém da equipe, ou só um nome, como "Mesa de tosa 2") e os serviços com duração e valor.
- **Agenda:** o dia, com uma coluna por agenda, ou os próximos 7 dias. Marcar (com cadastro do cliente ali mesmo), remarcar, repetir toda semana ou a cada 15 dias (até 12 vezes) e aviso de horário ocupado, com opção de encaixe.
- **Situação:** agendado → confirmado → atendido, faltou ou cancelado. **Atendido gera a conta a receber** no financeiro (`origin = 'atendimento'`), e a falta pode ser cobrada. "Desfazer" volta para agendado e cancela a conta, desde que nada tenha sido recebido nela. Tudo pela função `set_appointment_status`.
- **Lembrete com 1 clique:** abre o WhatsApp com a mensagem pronta no jeito de cada ramo. Nada é enviado automaticamente; o sistema só anota que o lembrete foi aberto.
- **Ficha de atendimento (prontuário):** só quem escreveu lê, nem o administrador. Nada é editado nem apagado: corrigir cria outra anotação ligada à original. Antes de usar com pacientes reais, validar com um advogado as regras da LGPD e dos conselhos profissionais.
- **Visão geral:** nos ramos com agenda, mostra os horários de hoje, os lembretes de amanhã e as faltas da semana.
- A carga de dados traz os atendimentos dos últimos 120 dias em diante.

### Pacotes e mensalidades

- **Pacote de sessões:** vendido à vista ou parcelado (função `sell_package`); as parcelas viram contas a receber (`origin = 'pacote'`). Repetir o pedido não vende duas vezes (`request_id`).
- Ao marcar um horário, o pacote do cliente aparece para escolher. Atendido com pacote **não gera cobrança** e usa uma sessão; a falta cobrada também usa. O banco não deixa passar do total de sessões, e desfazer devolve a sessão.
- Pacote vencido ou encerrado não entra em horário novo. Encerrar exige não ter horário marcado com ele.
- **Mensalidade:** valor, dia do vencimento (1 a 28), início e fim opcional. A cobrança de cada mês é criada por `generate_subscription_charges`, chamada ao carregar os dados da empresa (não depende de tarefa agendada no servidor); um índice único garante uma cobrança por mês. Cancelar para as cobranças novas; as que já existem continuam no financeiro.
- Quem vende pacotes e cria mensalidades: administrador, gestor, recepção e financeiro. O profissional vê os pacotes dos próprios pacientes. As cobranças só aparecem para quem vê o financeiro, que também tem o botão "Cobrar pelo WhatsApp" nas mensalidades atrasadas.
- No celular, quando há mais de 5 itens no menu, os últimos vão para "Mais".

### Horário de trabalho, caixa, comissões, turmas e agendamento online

Horários no fuso de Brasília (UTC−3 fixo), igual no aplicativo (`hours.ts`) e no banco.

- **Horário de trabalho:** em Serviços e equipe, cada agenda ganha dias e períodos (até 4 por dia, ex.: com almoço). Fora do horário, num bloqueio ou num horário ocupado, a agenda avisa antes de marcar (`scheduleWarning`) e permite encaixar. Sem horário definido, nada é bloqueado.
- **Bloqueios:** folga, férias, curso ou médico, de algumas horas ou dias inteiros (até 60 dias por vez). Quem marca na agenda cria e tira (`resource_blocks`).
- **Caixa do dia** (salão, barbearia, estética, pet shop, comércio): abre com o troco, venda rápida de produtos, serviços ou item digitado (`cash_sale`), recebimento de atendimentos, pacotes e mensalidades (`cash_receive`) e totais por forma de pagamento. O financeiro ou o dono fecha conferindo o dinheiro da gaveta; esperado = troco + o que entrou em dinheiro, e a diferença fica registrada com observação (`close_cash`). Um caixa aberto por vez; repetir o pedido não duplica. A recepção e o caixa passam a ver só as contas do balcão (atendimento, pacote, mensalidade, caixa), nunca as contas a pagar.
- **Produtos:** nome e preço, em Serviços e equipe. Sem estoque por enquanto.
- **Comissões:** regras em porcentagem ou valor fixo; vale a mais específica (profissional + serviço › serviço › profissional › geral). A base é cada atendimento atendido no mês (a sessão de pacote vale o preço do pacote ÷ sessões). Só mês encerrado fecha, uma vez por profissional; o fechamento vira conta a pagar (`origin = 'comissao'`, categoria Salários, vence dia 5). Cada profissional vê só a própria comissão.
- **Turmas e presença** (escolas, academias, estúdios): turma com dias, horário, duração, vagas e instrutor. A recepção matricula (o banco não deixa passar das vagas) e marca presença; o instrutor vê os alunos das próprias turmas e marca presença. Reposição de aluno de outra turma. Aviso de quem está sem vir há mais de 3 semanas.
- **Agendamento online:** em Minha empresa, o administrador liga o link `/agendar/[endereço]`. O cliente escolhe serviço, profissional, dia e horário livre, e deixa nome e celular. Só aparece quem tem horário de trabalho. O banco confere tudo de novo (`public_book`): a partir de 30 minutos e até 60 dias, dentro do horário, sem conflito, no máximo 3 horários futuros por celular e 20 pedidos por hora por empresa; o cliente é encontrado pelo celular ou cadastrado. A página pública só chama três funções (`public_booking_info`, `public_busy`, `public_book`) e não lê nenhuma tabela. O horário entra marcado como "online" (confirmado ou não, conforme a escolha da empresa). `/agendar/exemplo` mostra o Studio Bella da prévia e não grava nada.

O catálogo fica em `src/lib/domain/segments.ts` e tem um espelho no banco (`_segment_modules`, `_module_min_plan`); um teste compara os dois. Toda ação passa por quatro perguntas:

| Pergunta                      | Onde é respondida                                                          |
| ----------------------------- | -------------------------------------------------------------------------- |
| 1. O ramo tem o módulo?       | `moduleEnabled` (aplicativo) e `module_enabled` (banco, nas políticas RLS) |
| 2. O plano inclui o módulo?   | idem                                                                       |
| 3. O papel da pessoa permite? | `permissions.ts`, `execute.ts` e as políticas RLS                          |
| 4. O registro é dela?         | `visibility.ts` e as políticas RLS                                         |

Enquanto não existe cobrança, toda empresa nasce no plano "empresa" e nada é bloqueado por plano. O plano e os módulos extras só mudam direto no banco; o administrador não consegue alterá-los. O limite de pessoas por plano ainda não é aplicado.

---

## O que funciona, o que é simulado e o que está pendente

### Testado automaticamente (`npm test` — 137 testes)

- Regras de dinheiro, datas, divisão de parcelas, saldo e situação das contas, totais de proposta e matriz de permissões.
- **Caso de aceitação completo** no motor da prévia **e no banco** (migrações reais rodando no PGlite):
  venda de R$ 1.500 → 3 × R$ 500 → conferência cria 3 contas vinculadas → R$ 200 na 1ª parcela → parcial com R$ 300 → painel com R$ 1.500 vendidos, R$ 200 recebidos e R$ 1.300 a receber → repetir a confirmação não duplica → **usuário de outra empresa não lê nem altera** → **vendedor não confirma parcelas**.
- RLS: vendedor não vê contas a pagar nem lança despesas; chave composta impede misturar empresas; histórico não pode ser apagado; o dono faz o fluxo sozinho; numeração e aceite de propostas.
- Chamadas diretas ao banco (sem passar pela interface): o e-mail do perfil não pode ser trocado para receber o convite de outra pessoa; venda não fecha com parcela sem número, valor ou vencimento; vendedor não aponta a própria negociação para um cliente que não vê; proposta e itens só são gravados pelas funções.
- Ramos e papéis novos, no motor da prévia **e no banco**: o catálogo do banco é igual ao do aplicativo; só o administrador troca o ramo e ninguém troca o plano; recepção e caixa cuidam dos clientes de todos e o profissional só dos próprios; nenhum dos três vê negociações, vendas ou financeiro; pets só existem com o módulo ligado, são lidos por quem vê o tutor e gravados por quem edita o tutor, nunca entre empresas; trocar de ramo não apaga os campos do ramo anterior.
- Pacotes e mensalidades, no motor da prévia **e no banco**: venda em parcelas sem duplicar; só quem pode vende; atendido com pacote usa sessão sem gerar conta e não passa do total; desfazer devolve a sessão; pacote de outro cliente, vencido ou encerrado não entra no horário; mensalidade gera uma cobrança por mês até o mês atual, sem duplicar, e para ao ser cancelada; empresas sem o módulo não têm nada disso.
- Agenda, no motor da prévia **e no banco**: cada profissional vê e marca só na própria agenda; quem atende um paciente do colega passa a vê-lo, mas não edita a ficha; a situação não muda direto na tabela; atendido gera a conta a receber, desfazer cancela, e com pagamento registrado não desfaz; falta cobrada vira conta; horário encerrado não se remarca; a ficha de atendimento só é lida por quem escreveu e não pode ser alterada nem apagada; empresas sem o módulo não têm agenda.
- Horário, caixa, comissões, turmas e agendamento online, no motor da prévia **e no banco**: bloqueio só na agenda que a pessoa cuida; um caixa aberto por vez, venda e recebimento sem duplicar, esperado da gaveta certo, só financeiro ou dono fecham; recepção e caixa não veem contas a pagar; comissão pela regra mais específica, com o mês contado no horário de Brasília, fechada uma vez e só depois do mês acabar (aplicativo e banco chegam ao mesmo valor); turma não passa das vagas e o instrutor marca presença dos próprios alunos; o link público só funciona ligado, recusa horário fora do atendimento, ocupado ou muito próximo, não cria cadastro repetido e limita 3 horários por celular.
- Convites: o vínculo só existe depois do aceite; o convite espera quem ainda não tem conta; e-mail não confirmado não vê nem aceita; recusar e cancelar não criam vínculo; só o administrador convida e cancela; quem teve o acesso removido só volta aceitando um novo convite.

### Verificado manualmente no navegador (prévia, por mim, assistente de IA)

- Problema 1: erro de R$ 600 aparece perto do campo e **some ao corrigir** para R$ 200; a mensagem final é "Recebimento de R$ 200,00 registrado. Faltam R$ 300,00."
- Problema 2: "Registrar recebimento" para entradas e "Registrar pagamento" para saídas.
- Problema 3: parcelas mostram cliente, venda e "Parcela 1 de 3" na lista e na janela.
- Problema 4: "Ver proposta" abre a proposta.
- Problema 5: fechamento e conferência mostram as 3 etapas, o objetivo e quem precisa agir.
- Problema 6: para o financeiro, a ação principal é "Registrar recebimento", e "Nova negociação" não aparece.
- Problema 7: em 375 px de largura nenhuma tela passa da área visível; o quadro de negociações rola só dentro da própria área.
- Clique triplo em "Criar 3 parcelas" cria só 3; alertas abrem a lista filtrada; a ficha lateral preserva busca e foco; Esc fecha; formulário preenchido pede confirmação antes de descartar.

> Isso é uma avaliação feita por IA, **não um teste com usuários reais**. Recomendo sessões curtas com 3 a 5 pessoas do público-alvo antes de publicar.

### Simulado (somente na prévia)

- Todos os dados e pessoas; "Simular envio" da proposta (nada é enviado); persistência (memória da aba).

### Implementado, mas não executado contra um Supabase real

- Login e cadastro (Supabase Auth), criação de empresa, membros, ações do servidor via PostgREST/RPC e o proxy de sessão. O SQL foi testado no PGlite, mas a integração HTTP completa depende de um projeto Supabase configurado, que não estava disponível.
- Concorrência real entre duas conexões: o PGlite tem uma única conexão, então foram testados reenvio e idempotência. As travas `FOR UPDATE` e os índices únicos estão no SQL, mas não foram exercitados em paralelo.

### Dados e aparência da empresa (Minha empresa)

- O administrador preenche razão social, CNPJ ou CPF (aceita o CNPJ alfanumérico), telefone, e-mail, endereço e as **condições comerciais padrão**, que já vêm preenchidas em cada proposta nova.
- **Logotipo:** PNG, JPG, WebP ou SVG. O navegador reduz para no máximo 600 × 240 px e regrava como WebP. Fica na própria linha da empresa (`companies.logo_data_url`, até cerca de 300 KB), sem precisar do Supabase Storage. SVG nunca é guardado como SVG.
- **Cor da marca:** 8 sugestões ou qualquer cor. Troca só os tons de ação (`--color-primary*`). Cores claras demais são escurecidas automaticamente para manter contraste de 4,5:1 com texto branco. O verde do dinheiro, os alertas e o menu escuro não mudam.
- **Cor do menu lateral:** automática (tom escuro da cor da marca), 6 sugestões escuras ou qualquer cor. A cor escolhida é escurecida quando preciso para manter contraste de 7:1 com o texto branco do menu.
- **Marca branca dentro do sistema:** o menu e a barra do celular mostram o logotipo da empresa (ou as iniciais na cor da marca). A marca Thigu aparece só no login, na criação da empresa e na página inicial.
- O logotipo e os dados aparecem no cabeçalho da proposta (tela e impressão).
- No banco, o administrador só altera as colunas editáveis da empresa (`created_by` ficou protegido), e o formato de cada campo é conferido por `check`.

### Pendente / próximos passos

- Ramos: as telas de negociações, propostas, financeiro, tarefas e o guia da prévia ainda dizem "cliente" em todos os ramos; a troca de nome vale para o menu, a lista, a ficha, o cadastro e a visão geral.
- Lembrete automático pelo WhatsApp oficial: depende de conta WhatsApp Business verificada pela Meta (ver a conversa da Fase 2).
- Caixa: sangria e reforço no meio do dia; estoque dos produtos.
- Agendamento online: o cliente desmarcar pelo link; escolher "qualquer profissional".
- Mensalidades: cobrança automática no cartão (hoje a cobrança é criada, mas o pagamento é registrado à mão).
- Agenda: remarcar ou cancelar toda a série de uma vez; ver a semana em grade de horários; registro de quem abriu cada ficha de atendimento (hoje só o autor lê, então não há outros acessos para registrar).

- Testes de ponta a ponta (Playwright) contra um Supabase local (`supabase start`, que exige Docker).
- Enviar o convite por e-mail (hoje o convite existe e exige aceite, mas o administrador avisa a pessoa por conta própria).
- As telas de convite (lista em **Minha empresa** e aviso para quem foi convidado) só existem na versão real e ainda não foram vistas rodando contra um Supabase.
- Paginação ao carregar dados (hoje tudo da empresa é carregado de uma vez, o que serve para pequenas empresas).
- Evoluções previstas: receitas e despesas recorrentes, importação e exportação de planilhas, lembretes simples.
- **Fora do escopo:** integração bancária, cobrança automática, WhatsApp oficial, emissão fiscal, estoque e ERP.

**Não está pronto para produção** só porque compila e passa nos testes: falta validar com Supabase real, testar com usuários e revisar a segurança antes de publicar.

## Identidade visual

Navegação `#142D4E`, ações `#3563E9`, dinheiro `#18A77B`, fundo `#F6F8FC`, texto `#172033`. Títulos em **Manrope**, interface em **Inter**, ambas servidas localmente (`@fontsource-variable`). O símbolo "t" com os quadrados azul e verde está em `src/components/brand/thigu-logo.tsx`, e o ícone do app em `src/app/icon.svg`.
