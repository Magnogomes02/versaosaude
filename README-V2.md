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
firebase deploy
```

## GitHub Actions

- `V2 CI`: roda em pushes/PRs para `main` com Node 22 e Java 21.
- `Firebase Deploy`: workflow manual (`workflow_dispatch`) para publicar `hosting`, `firestore` e `functions` depois de build/test.
- Para usar o deploy manual, cadastre o secret `FIREBASE_SERVICE_ACCOUNT_VERSAOSAUDE_PROD` com o JSON de uma service account autorizada no projeto `versaosaude-prod`.

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

## Modelo de dados novo

Colecoes mantidas: `rooms`, `professionals`, `contracts`, `bookings`, `preferences`, `user_roles`, `audit_logs`.

Colecoes adicionadas: `contract_schedules`, `booking_conflicts`, `receivables`, `receivable_payments`, `receivable_receipts`, `contract_attachments`, `notification_queue`.

## Integridade financeira

- Pagamentos parciais sao registrados em `receivable_payments`.
- `receivables.amountPaid` acumula pagamentos ativos.
- O status fica `partial` ate `amountPaid >= amountDue`.
- Estornos invalidam recibos emitidos e aplicam periodo de graca antes de marcar atraso novamente.
- Cancelamento/encerramento de contrato usa soft cancel e preserva recebiveis/recibos com historico financeiro.

## Observacoes

- O deploy de Functions esta configurado para Node.js 22. A maquina local pode exibir aviso se estiver usando Node 20, mas o build TypeScript continua valido.
- `npm test` roda testes unitarios das Functions e testes de Firestore Rules com emulador local.
- O build Vite usa lazy loading por rota e separa vendors em chunks (`react`, `firebase`, `tanstack`, `vendor`).
- O CI em `.github/workflows/ci.yml` usa Node 22 e Java 21 para buildar frontend, buildar Functions, rodar testes unitarios, rodar Firestore Rules no emulador e auditar dependencias de producao em nivel `high`.
- O deploy em `.github/workflows/firebase-deploy.yml` e manual para evitar publicacao acidental em producao.
