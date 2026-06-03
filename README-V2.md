# VersaoSaude V2

Esta versao substitui o frontend estatico de `public/` por uma SPA em React, mantendo Firebase como base de autenticacao, banco, storage, hosting e funcoes.

## Stack

- Frontend: Vite, React, TypeScript, React Router, TanStack Query, Firebase Web SDK e lucide-react.
- Backend: Firebase Cloud Functions em TypeScript, Firestore, Firebase Auth, Storage e Cloud Scheduler.
- Deploy: Firebase Hosting publica `dist/`; `public/` permanece no repo como legado de referencia.

## Comandos

```bash
npm install
npm run build
npm test
npm run test:rules
npm run audit:prod
npm --prefix functions install
npm --prefix functions run build
npm --prefix functions test
npm --prefix functions run bootstrap:preferences
npm --prefix functions run seed:finance
firebase deploy
```

## GitHub Actions

- `V2 CI`: roda em pushes/PRs para `main` com Node 22 e Java 21.
- `Firebase Deploy`: workflow manual (`workflow_dispatch`) para publicar `hosting`, `firestore` e `functions` depois de build/test.
- Para usar o deploy manual, cadastre o secret `FIREBASE_SERVICE_ACCOUNT_VERSAOSAUDE_PROD` com o JSON de uma service account autorizada no projeto `versaosaude-prod`.

## Owner e primeiro gestor

As regras da V2 exigem `user_roles/{uid}.role = "owner"` ou `gestor` para operacoes administrativas. O `owner` e o administrador master unico do projeto, mas a interface o trata como gestor para nao expor diferenca visual.

Depois de criar o usuario `magno.gomes.santiago@gmail.com` no Firebase Auth, promova-o a owner com Admin SDK:

```bash
cd functions
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' npm run bootstrap:owner
```

O script define custom claims, cria/atualiza `profiles/{uid}` e `user_roles/{uid}` com `role: "owner"`, e rebaixa qualquer outro owner existente para `gestor`.

Para promover usuarios operacionais como gestores:

```bash
cd functions
FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' npm run bootstrap:gestor -- --email=gestor@clinica.com
```

Alternativa em ambiente ja autenticado com Application Default Credentials:

```bash
cd functions
npm run bootstrap:gestor -- --uid=UID_DO_USUARIO --name="Nome do Gestor"
```

O script cria/atualiza:

- `profiles/{uid}`
- `user_roles/{uid}` com `role: "gestor"` ou `owner`

## Funcoes criticas

As regras de negocio sensiveis ficam em Cloud Functions e sao chamadas pelo frontend:

- `createOrUpdateContract`
- `activateContract`
- `closeOrCancelContract`
- `generateContractBookings`
- `generateContractReceivables`
- `applyContractValueAdjustment`
- `recordPayment`
- `revertPayment`
- `issueReceipt`
- `cancelReceipt`

Jobs agendados:

- `markOverdueReceivables`
- `extendOpenEndedContracts`
- `enqueueDueNotifications`
- `processNotificationQueue`

## Modelo de dados novo

Colecoes mantidas: `rooms`, `professionals`, `contracts`, `bookings`, `preferences`, `user_roles`, `audit_logs`.

Colecoes adicionadas: `contract_schedules`, `booking_conflicts`, `receivables`, `receivable_payments`, `receivable_receipts`, `contract_attachments`, `contract_adjustments`, `notification_queue`.

## Integridade financeira

- Pagamentos parciais sao registrados em `receivable_payments`.
- `receivables.amountPaid` acumula pagamentos ativos.
- O status fica `partial` ate `amountPaid >= amountDue`.
- Recibos sao emitidos por pagamento individual (`paymentId`), inclusive em pagamentos parciais.
- Estornos invalidam recibos emitidos do pagamento estornado e aplicam periodo de graca antes de marcar atraso novamente.
- Cancelamento/encerramento de contrato usa soft cancel e preserva recebiveis/recibos com historico financeiro.
- Recibos recebem `authenticationCode` assinado com HMAC (`hmac-sha256-v1`). Em producao, configure `RECEIPT_SIGNING_SECRET` nas Functions.
- Recebiveis `cancelled` sao tratados como perda financeira na analise gerencial.
- Pagamentos atrasados aceitam multa, juros e desconto separados; o backend tambem calcula sugestao com base em `preferences/system`.

## Scripts de teste

- `npm --prefix functions run bootstrap:preferences`: cria/atualiza `preferences/system` com horizonte, juros, multa e notificacoes.
- `npm --prefix functions run seed:finance`: reseta colecoes operacionais de teste e popula cenarios de recebiveis open/partial/paid/overdue/cancelled, multa, multi-sala, pagamento parcial e notificacoes. O script nao apaga usuarios Auth, `profiles` ou `user_roles`.

## Agenda e expansao

- `activateContract` ja gera recebiveis e reservas iniciais; o frontend nao chama geracao duplicada depois da ativacao.
- `createOrUpdateContract` preserva o status atual do contrato e, quando o contrato ja esta ativo, regenera reservas futuras ao alterar a grade.
- Escritas em massa de reservas, recebiveis, notificacoes e cancelamentos usam commits em blocos para evitar o limite de 500 operacoes por batch do Firestore.

## Observacoes

- O deploy de Functions esta configurado para Node.js 22. A maquina local pode exibir aviso se estiver usando Node 20, mas o build TypeScript continua valido.
- `npm test` roda testes unitarios das Functions e testes de Firestore Rules com emulador local.
- O build Vite usa lazy loading por rota e separa vendors em chunks (`react`, `firebase`, `tanstack`, `vendor`).
- O CI em `.github/workflows/ci.yml` usa Node 22 e Java 21 para buildar frontend, buildar Functions, rodar testes unitarios, rodar Firestore Rules no emulador e auditar dependencias de producao em nivel `high`.
- O deploy em `.github/workflows/firebase-deploy.yml` e manual para evitar publicacao acidental em producao.
