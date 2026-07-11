# Comparta — Phase 0: Foundations

Onchain business finance platform. Invoicing, payments, payroll, and
savings settle in USDC on Circle's Arc L1. Every org gets one
Circle-custodied wallet on Arc; multiple balances ("Operating", "Tax
Reserve", "Payroll", "Savings", custom buckets) are a Postgres ledger
layered on top of that single wallet — **not** separate onchain wallets.

This phase builds only the substrate everything else depends on: auth +
KYB gating, Circle wallet provisioning, the double-entry ledger engine,
and webhook ingestion. No invoicing, payment links, or payroll UI yet.

## Stack

- Next.js 16 (App Router), fullstack — API routes double as the backend
- PostgreSQL + Prisma (new `prisma-client` generator, output to `app/generated/prisma`)
- Circle Developer-Controlled Wallets SDK, custody on Arc (testnet by default)
- NextAuth (credentials/email+password) for auth
- BullMQ + Redis for background jobs (reconciliation now; payroll/DCA/savings sweeps in later phases)

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

   (`postinstall` runs `prisma generate` automatically.)

2. **Fill in environment variables.** Copy `.env.example` → `.env.local`
   and fill in every value. In particular:

   - `DATABASE_URL` / `DIRECT_URL` — your Postgres instance
   - `REDIS_URL` — a Redis instance (local Docker is fine for dev)
   - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
   - `CIRCLE_API_KEY` — from the Circle developer console
   - `CIRCLE_ENTITY_SECRET` — the entity secret you generated. **This is
     the single point of catastrophic failure for the whole product** —
     see the security note at the top of `lib/circle/client.ts`. In any
     real environment (not local dev) this must come from a secrets
     manager, never a committed `.env` file.
   - `ADMIN_API_SECRET` — gates the manual KYB-approval stub endpoint;
     `openssl rand -hex 32`

   You mentioned you've already generated your entity secret + recovery
   file and keys — drop the entity secret into `CIRCLE_ENTITY_SECRET` in
   `.env.local` (never commit it), and store the recovery file
   (`recovery_file_*.dat`) somewhere secure and offline. It's already
   excluded via `.gitignore`.

3. **Run migrations**

   ```bash
   npm run db:migrate
   ```

4. **Start the dev server**

   ```bash
   npm run dev
   ```

5. **(Optional) Start the reconciliation worker** in a separate process:

   ```bash
   npm run worker:reconciliation
   ```

## Architecture notes

### The ledger is append-only

`LedgerEntry` rows are never updated or deleted. Every balance mutation —
onchain settlement, invoice payment, payroll run, savings sweep, DCA,
internal bucket transfer — goes through `lib/ledger/engine.ts`'s
`recordEntry()` or `transferBetweenLedgerAccounts()`. Corrections are new
offsetting entries (`referenceType: ADJUSTMENT`). This is the single most
important design decision in the system — get it wrong and reconciliation
becomes impossible later. See `tests/ledger.test.ts` for the correctness
tests this guarantees (row-locked concurrency safety, zero-sum internal
transfers, full-history recomputation matching the denormalized snapshot).

### Money is always a bigint, never a float

Amounts are stored as `BigInt` in micro-USDC (6 decimals) everywhere in
Postgres. `lib/circle/amount.ts` is the only place that converts to/from
the decimal strings Circle's API expects — never do that conversion
inline elsewhere.

### KYB gating

`middleware.ts` blocks unauthenticated requests to protected routes at
the edge. The actual KYB check — `Organization.kybStatus === 'APPROVED'`
— happens server-side per-request in `lib/auth/kyb-gate.ts`'s
`requireApprovedOrg()`, which every financial API route calls first. It
deliberately re-reads status from Postgres rather than trusting a JWT
claim, since KYB status can change mid-session (approval, or a
compliance hold).

KYB approval itself is a manual stub for now
(`POST /api/org/kyb/approve`, gated by `ADMIN_API_SECRET`) — flips the
status and, on approval, provisions the org's Circle wallet plus its four
default ledger buckets in one step. Swap this for a real KYB provider
later without touching anything downstream of `kybStatus`.

### Webhook ingestion

`POST /api/webhooks/circle` verifies `X-Circle-Signature` against
Circle's published ECDSA public key (`lib/circle/webhookVerify.ts`), then
writes the raw payload to `WebhookEvent` **before** any processing — so a
bug in handler logic can never lose an event. Processing itself is
currently a stub (log + mark `PROCESSED`); real handling (matching
`OnchainTransaction` rows, driving the ledger engine, marking invoices
paid) is a later phase.

## API routes in this phase

| Route | Purpose |
|---|---|
| `POST /api/auth/register` | Create an Organization (KYB `PENDING`) + owner User |
| `POST /api/auth/[...nextauth]` | NextAuth sign-in |
| `POST /api/org/kyb/approve` | Admin-secret-gated KYB approval stub; provisions wallet + default buckets |
| `GET /api/wallet/balance` | Ledger bucket breakdown + live onchain USDC balance |
| `POST /api/ledger/transfer` | Move funds between two of the org's own buckets |
| `POST /api/webhooks/circle` | Circle webhook ingestion |

## Testing

```bash
npm run test
```

`tests/ledger.test.ts` is the Phase 0 acceptance test: it spins up a
throwaway Organization/Wallet/LedgerAccount set (against whatever
Postgres `DATABASE_URL` points at — **use a disposable test database**),
and asserts:

- a ledger account's balance always matches full-history recomputation
- internal transfers are zero-sum across an org's total balance
- concurrent writes to the same account never race (row-lock correctness)
- an org's total ledger balance equals the sum across all its `LedgerAccount`s

## What's deliberately NOT built yet

Invoicing, payment links, payroll execution, smart savings (USYC),
DCA, CCTP/Gateway cross-chain consolidation, spending insights, and the
address book are all later phases. This phase is the substrate only.
