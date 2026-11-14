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
5. Rode `npm run dev`, acesse `/entrar` e crie a **sua** conta (a da equipe Thigu).
6. Torne essa conta **equipe Thigu**, rodando uma vez no SQL Editor (troque o e-mail):
   ```sql
   insert into public.platform_admins (user_id)
   select user_id from public.profiles where email = 'voce@suaempresa.com.br';
   ```
7. Acesse `/admin/codigos` para gerar códigos de ativação (veja abaixo). Para testar como cliente, gere um código, crie outra conta e ative uma empresa com ele.
8. Para adicionar pessoas a uma empresa: cada uma cria a própria conta, e o administrador da empresa adiciona o e-mail em **Minha empresa**, escolhendo os papéis. Quem é adicionado assim não precisa de código.

## Venda e ativação por código

Só empresas que pagaram podem ser criadas. A cobrança acontece **fora do sistema** (Pix, boleto, transferência); o Thigu só controla a ativação.

1. **Cliente paga.** Você confirma o pagamento.
2. **Você gera o código** em `/admin/codigos`: nome do cliente, e-mail do comprador, tempo de acesso (1 mês, 3 meses, 6 meses, 1 ano ou outro) e prazo para ativar (padrão: 30 dias).
3. **Você envia por e-mail.** A tela mostra o código **uma única vez** e oferece "Copiar código", "Copiar texto do e-mail" (mensagem pronta com o passo a passo) e "Abrir no meu e-mail". O sistema não envia e-mails sozinho.
4. **O cliente ativa.** Ele cria a conta em `/entrar` com o mesmo e-mail e, em "Vamos cadastrar sua empresa", digita o nome da empresa e o código. Vira administrador, com acesso pelo período comprado.
5. **Renovação.** Perto do vencimento (14 dias antes), o sistema mostra um aviso. O administrador clica em **Renovar com código** (no aviso ou em Minha empresa) e digita o novo código; os dias são somados ao que ainda resta.
6. **Se vencer.** A empresa fica **somente para consulta**: dá para ver e imprimir tudo, mas não registrar nada novo até renovar. Nada é apagado.

**Segurança:** o código é guardado só como hash (nem a equipe consegue recuperá-lo depois); vale uma única vez; pode ficar preso ao e-mail do comprador; expira se não for usado; e 5 tentativas erradas em 15 minutos bloqueiam novas tentativas. Tudo isso é garantido no banco (`supabase/migrations/20261114000003_activation.sql`), não só na tela. Códigos enviados por engano podem ser **cancelados** no painel enquanto não forem usados.

Variáveis opcionais: `NEXT_PUBLIC_THIGU_APP_URL` (endereço usado no texto do e-mail) e `NEXT_PUBLIC_THIGU_SALES_URL` (link "fale com a gente" na tela de ativação).

**Ao aplicar esta migração num banco que já tem empresas**, cada empresa existente ganha 30 dias de acesso. Ajuste depois, se precisar, com `update public.companies set access_until = 'AAAA-MM-DD' where id = '...';`.

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
    company/                membros e papéis
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

Uma pessoa pode ter vários papéis e participar de várias empresas (seletor "Minha empresa").

---

## O que funciona, o que é simulado e o que está pendente

### Testado automaticamente (`npm test` — 55 testes)

- Regras de dinheiro, datas, divisão de parcelas, saldo e situação das contas, totais de proposta e matriz de permissões.
- **Caso de aceitação completo** no motor da prévia **e no banco** (migrações reais rodando no PGlite):
  venda de R$ 1.500 → 3 × R$ 500 → conferência cria 3 contas vinculadas → R$ 200 na 1ª parcela → parcial com R$ 300 → painel com R$ 1.500 vendidos, R$ 200 recebidos e R$ 1.300 a receber → repetir a confirmação não duplica → **usuário de outra empresa não lê nem altera** → **vendedor não confirma parcelas**.
- RLS: vendedor não vê contas a pagar nem lança despesas; chave composta impede misturar empresas; histórico não pode ser apagado; o dono faz o fluxo sozinho; numeração e aceite de propostas.

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

- Testes de ponta a ponta (Playwright) contra um Supabase local (`supabase start`, que exige Docker).
- Convite por e-mail (hoje o administrador adiciona quem já tem conta).
- Paginação ao carregar dados (hoje tudo da empresa é carregado de uma vez, o que serve para pequenas empresas).
- Evoluções previstas: receitas e despesas recorrentes, importação e exportação de planilhas, lembretes simples.
- **Fora do escopo:** integração bancária, cobrança automática, WhatsApp oficial, emissão fiscal, estoque e ERP.

**Não está pronto para produção** só porque compila e passa nos testes: falta validar com Supabase real, testar com usuários e revisar a segurança antes de publicar.

## Identidade visual

Navegação `#142D4E`, ações `#3563E9`, dinheiro `#18A77B`, fundo `#F6F8FC`, texto `#172033`. Títulos em **Manrope**, interface em **Inter**, ambas servidas localmente (`@fontsource-variable`). O símbolo "t" com os quadrados azul e verde está em `src/components/brand/thigu-logo.tsx`, e o ícone do app em `src/app/icon.svg`.
