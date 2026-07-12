# Identity, Address Book & Send/Receive Engine — what's new

This delivery adds two things on top of your existing foundation
(Organization/User/Wallet/LedgerAccount/LedgerEntry/OnchainTransaction,
the Circle SDK wrapper, and the ledger engine):

1. **Username system + Address Book** (`lib/identity/`, `lib/contacts/`)
2. **Send/receive transfer engine** (`lib/transfers/`, `jobs/confirmTransaction.ts`)

## Before you run this

**`prisma/schema.prisma` changed.** New models (`Contact`, `IdempotencyKey`),
a new enum (`IdentifierType`, `IdempotencyStatus`), a new `username` +
`defaultLedgerAccountId` field on `Organization`, and new fields on
`OnchainTransaction` (`sourceChain`, `referenceType`, `referenceId`, `memo`,
`idempotencyKey`). You need to:

```bash
npm install          # picks up @prisma/adapter-pg + pg, added below
npx prisma generate  # regenerates app/generated/prisma against the new schema
npx prisma migrate dev --name identity-and-transfers
```

I couldn't run `prisma generate` in my own sandbox (no network access to
`binaries.prisma.sh` from here), so `app/generated/prisma` is **not**
included in this delivery — regenerate it locally before running
anything. Every file that imports from `@/app/generated/prisma` will show
a "module not found" error until you do.

**New dependencies**: I noticed `lib/db/prisma.ts` now uses
`@prisma/adapter-pg` (a Postgres driver adapter) rather than the default
engine — I added `@prisma/adapter-pg` and `pg` to `package.json` since
they weren't listed but the code requires them.

## 1. Username system

- `Organization.username` — unique, lowercase, `[a-z0-9_]{3,20}`, can
  never start with `0x` (that's what keeps usernames and addresses from
  ever colliding in format — see `lib/identity/username.ts`).
- `POST /api/username/claim` — format + denylist validation, rate-limited
  10 attempts / 10 minutes per IP (`lib/rateLimit.ts`, Redis-backed),
  race-safe uniqueness via the DB unique constraint (not just a
  pre-check).
- `GET /api/resolve/:identifier` — the single resolver
  (`lib/identity/resolver.ts`) every other feature should call. Accepts a
  username OR a raw Arc address, returns the destination address + org
  display name when known. Rejects malformed input with a specific
  reason rather than failing silently.

## 2. Address Book

- `Contact` model, scoped to an org, unique on `(orgId, identifier)`.
  `identifierType` is always inferred from format (never trusted from
  request input) so it can never drift from what the resolver would
  actually do with it.
- Full CRUD: `GET/POST /api/contacts`, `GET/PATCH/DELETE /api/contacts/:id`.
- `lastPaidAt` is touched automatically by a successful send (see
  `lib/transfers/send.ts`).

## 3. Send/receive engine

- **`lib/transfers/send.ts`** — `sendPayment()`, the one function every
  outbound feature (manual send, invoice payout, payroll, DCA) should
  call. Resolves the recipient, rejects self-sends, validates USDC
  precision (rejects >6 decimals rather than rounding), fast-fails on
  insufficient balance, submits to Circle with an idempotency key, then
  atomically writes the `OnchainTransaction` + debits the ledger in one
  DB transaction. If the DB write fails after Circle already accepted the
  transfer, it's logged as CRITICAL for manual reconciliation — the same
  partial-failure pattern as the KYB-approval wallet provisioning flow.
- **`jobs/confirmTransaction.ts`** — polls (or is triggered by the
  webhook) until a transaction reaches CONFIRMED or FAILED. On FAILED, it
  writes an **offsetting credit** — the original debit is never deleted
  or edited, per the append-only ledger rule.
- **`lib/transfers/receive.ts`** — handles Circle's
  `transactions.inbound` webhook: resolves which org owns the receiving
  wallet, credits `Organization.defaultLedgerAccountId` (falling back to
  the "Operating" bucket by name), and records the `OnchainTransaction`
  with both `chain` (settlement — always Arc) and `sourceChain` (origin,
  when Circle's payload distinguishes a CCTP/Gateway-consolidated
  transfer from a same-chain one).
- **API-level idempotency** (`lib/transfers/idempotency.ts`,
  `IdempotencyKey` table): `POST /api/transfers/send` **requires** an
  `Idempotency-Key` header. A retried request with the same key replays
  the stored response instead of re-executing; the same key with a
  different payload is rejected as a conflict. This is separate from (and
  in addition to) the idempotency key Circle itself receives on the
  outbound transfer call.
- `POST /api/transfers/send`, `GET /api/transfers` (paginated, filterable
  by ledger account / direction / counterparty / date range).

## Known gaps / TODOs

- `notifyPaymentFailed` / `notifyPaymentReceived` are logging stubs —
  wire up to real email/in-app notifications when that infra exists.
- The Circle→internal chain mapping in `lib/circle/chainMapping.ts` is
  best-effort; extend the table as you add chains.
- The inbound webhook payload's cross-chain source-chain attribution
  assumes a `sourceBlockchain` field that isn't present on every Circle
  notification variant — verify against your actual webhook payloads
  once CCTP/Gateway inbound is live and adjust `lib/transfers/receive.ts`
  if the real field name differs.