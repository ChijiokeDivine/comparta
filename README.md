<div align="center">

# Comparta

**Smart Financial Operating System for Modern Teams**

Send USDC payments, issue invoices, run payroll, create payment links, allocate balances automatically, earn yield on savings, dollar-cost-average into self-custody, and get AI-powered spending insights - all on one secure, onchain platform built on Circle's Arc L1.

[![Stack: Next.js 16 + TypeScript](https://img.shields.io/badge/Stack-Next.js%2016%20%7C%20TypeScript-blue)](#tech-stack)
[![Database: PostgreSQL + Prisma 7](https://img.shields.io/badge/DB-PostgreSQL%20%7C%20Prisma%207-4169E1)](#data-layer)
[![Custody: Circle Developer Controlled Wallets · Arc](https://img.shields.io/badge/Custody-Circle%20%7C%20Arc%20L1-5850EB)](#custody--onchain-layer)
[![Jobs: BullMQ + Redis](https://img.shields.io/badge/Jobs-BullMQ%20%7C%20Redis-DC382D)](#background-jobs)
[![LLM: Groq](https://img.shields.io/badge/LLM-Groq-F55036)](#ai--spending-insights)
[![License: Private](https://img.shields.io/badge/License-Private-lightgrey)](#license)

</div>

---

## Why Comparta Exists

Small teams, distributed teams, and crypto-native businesses face the same friction today:
- **Moving money is slow and expensive.** Bank wires take days, ACH bounces, SWIFT is opaque.
- **Finance workflows are siloed.** One tool for invoices, another for payroll, a third for savings - none of them reconcile.
- **Stablecoin tooling is fragmented.** Wallets are built for consumers, not teams; no permission model, no audit trail, no buckets.
- **"Traditional finance for crypto" doesn't exist yet.** You get a wallet app that treats every user the same, or a bank that hates crypto - never both.

Comparta unifies **treasury, payments, payroll, savings, and analytics** on a single ledger backed by Circle Developer-Controlled Wallets on the Arc L1. Each organization is one Circle-custodied wallet on Arc (one onchain attack surface, one Web3Signer key set, one compliance perimeter) with **multiple virtual balance buckets** implemented as a Postgres double-entry ledger on top of it - Operating, Tax Reserve, Payroll, Savings, and custom buckets with any name, any purpose. Every dollar in the system is reconciled nightly against the onchain balance.

---

## What It Does (9 Phases, Shipped)

| Phase | Module | What you get |
|---|---|---|
| **0 · Foundations** | Auth + KYB gating · Circle wallet provisioning · Append-only double-entry ledger · Webhook ingestion | The substrate everything else stands on |
| **1 · Identity + Transfers** | Usernames · Address Book · Send/Receive USDC engine · Dual-layer idempotency | Payable to `@yourname` instead of `0x…` · Transfers are audit-logged · Retry-safe |
| **2 · Bucket Mgmt + Allocation Rules** | Custom ledger buckets (rename/archive) · Standing auto-transfer rules (PERCENTAGE / FIXED) · ON_INCOMING_PAYMENT or SCHEDULED (cron) triggers | "Sweep 20% of every invoice payment into Tax Reserve" in one click |
| **3 · Invoicing** | Line-item invoices · PDF-ready display · Email delivery · Due-date milestones with auto-overdue · Auto-reconciliation against inbound USDC · Audit event log | Send an invoice → counterparty pays to a username/payment-link → marked paid automatically |
| **4 · Payment Links** | One-off or reusable shareable `/pay/:slug` checkout · FIXED_AMOUNT or OPEN_AMOUNT · Card (Circle Payments API) or wallet (Arc) at checkout · Fraud-resistant amount matching · Expiry + max-uses | Drop a link in Slack, get paid - no integrations required |
| **5 · Contacts** | Org-scoped address book · CRUD · `lastPaidAt` touch on successful send · Optional back-link to Payee rows | Your team's vendor roster, always up to date |
| **6 · Payroll** | Payee directory · Standing schedules (WEEKLY/BIWEEKLY/MONTHLY) → auto-generated DRAFT runs · Approval workflow (DRAFT → PENDING_APPROVAL → PROCESSING) · Per-item retry · CSV export · Identifier-resolution flagging at run-creation time | Biweekly payroll in 30 seconds · Failed send? Retry just that one payee |
| **7 · Smart Savings · Yield** | Per-bucket yield enablement (USYC) · Three savings-rule triggers: `PERCENTAGE_OF_INCOME`, `ROUND_UP` (hooks outbound debits), `FIXED_RECURRING` (cron) · Partial/full redemptions as an async state machine · Liquid-plus-deployed composed view | "Round up every vendor payment to the next $10 into savings" works out of the box |
| **8 · DCA / Recurring Transfers** | Standing, interval-based transfers (DAILY/WEEKLY/BIWEEKLY/MONTHLY) · Destination: external username/address OR another internal bucket · Optional end date · Pause/Resume/Cancel · Per-cycle execution log w/ failure reasons | Weekly $100 DCA to your cold wallet · Monthly sweep from Operating → Payroll bucket |
| **9 · Spending Insights · AI** | Auto-categorization: deterministic RULES → LLM (Groq) suggestion w/ confidence threshold → manual override · 7 seeded SYSTEM categories + CUSTOM org-defined categories · Anomaly detection (large outflow · new-counterparty large-payment) · Natural-language dashboard querying (NL→SQL) · Counterparty fingerprinting | "What did we spend on contractors last quarter?" answered in plain English |

---

## How It Works Internally

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Next.js 16 App Router                            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌───────────────┐  │
│  │  app/**   (Frontend) │  │  app/api/** (Routes) │  │ Middleware.ts │  │
│  │  marketing / dash    │  │  CRUD + action RPCs  │  │  withAuth     │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └───────┬───────┘  │
│             │                         │                        │          │
│             └────────────────┬────────┴────────────────────────┘          │
│                              │                                            │
│                    ┌─────────▼─────────┐        ┌──────────────────┐     │
│                    │   lib/** SERVICES │◄───────┤   Auth Gates     │     │
│                    │  (pure business   │        │  kyb-gate.ts     │     │
│                    │    logic layer)   │        │  canManageBucket │     │
│                    └─────────┬─────────┘        └──────────────────┘     │
│                              │                                            │
│             ┌────────────────┼───────────────────────┐                   │
│             │                │                       │                   │
│     ┌───────▼──────┐  ┌──────▼────────┐   ┌─────────▼──────────┐        │
│     │ ledger/engine│  │ circle/* SDK  │   │ groq/client.ts LLM  │        │
│     │  (row locks) │  │  (wallets +   │   │ (categorization +  │        │
│     │ append-only  │  │   payments +  │   │  NL query xlate)   │        │
│     └───────┬──────┘  │   USYC yield) │   └────────────────────┘        │
│             │         └──────┬─────────┘                                 │
│             │                │                                           │
│             └───────┬────────┘                                           │
│                     │                                                    │
│        ┌────────────▼─────────────┐          ┌────────────────────┐     │
│        │    PostgreSQL + Prisma   │          │     Redis (IORedis)│     │
│        │  ───────────────────    │          │  ───────────────   │     │
│        │  30 tables · 28 enums   │          │  BullMQ queues +   │     │
│        │  7 migration phases     │          │  rate-limiting     │     │
│        └──────────────────────────┘          └─────────┬──────────┘     │
│                                                        │                │
│                                                 ┌──────▼───────┐        │
│                                                 │ jobs/workers │        │
│                                                 │  (BullMQ)    │        │
│                                                 │  5 workers   │        │
│                                                 └──────────────┘        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Design Principles - Non-Negotiable

1. **Append-only everywhere that matters.**
   `LedgerEntry`, `OnchainTransaction`, `InvoiceEvent`, `PayrollRunItem`, `AllocationRuleExecution`, `SavingsRuleExecution`, `RecurringTransferExecution`, `WebhookEvent` - **never updated, never deleted.** Corrections are new offsetting rows. Without this property, reconciliation becomes intractable. See [`ledger/engine.ts`](lib/ledger/engine.ts).

2. **Money is always `bigint` in micro-USDC (6 decimals).**
   Floats are banned. Conversion to/from the decimal strings Circle's APIs expect lives in exactly one file: [`lib/circle/amount.ts`](lib/circle/amount.ts). Nothing else does the conversion inline.

3. **Single-writer per module.**
   - Only `ledger/engine.ts` writes `LedgerEntry` (via `recordEntry()` / `transferBetweenLedgerAccounts()`).
   - Only `circle/wallets.ts`, `circle/payments.ts`, `circle/usyc.ts` call the Circle SDK.
   - Only `transfers/send.ts` calls both - it's the one outbound-money primitive every feature (manual-send, payroll, DCA) uses.
   - This keeps correctness audit-bounded.

4. **Two-layer idempotency on every money move.**
   - **API layer**: Clients send an `Idempotency-Key` HTTP header; the same key retried replays the stored response (`lib/transfers/idempotency.ts`).
   - **Provider layer**: Every Circle `createTransaction` carries its own idempotency key, so even if the DB write after Circle succeeds fails (partial failure), retrying the whole flow never moves money twice. Partial-failure pairs (Circle YES, DB NO) are logged CRITICAL for manual reconciliation - same pattern in KYB approval wallet provisioning.

5. **KYB gating re-reads the DB every request.**
   JWTs carry `kybStatus` as a convenience hint, but [`kyb-gate.ts`](lib/auth/kyb-gate.ts)'s `requireApprovedOrg()` always re-reads `Organization.kybStatus` fresh from Postgres. An org can be approved or compliance-held mid-session; financial gating never lags.

6. **Concurrency via row locks, not optimistic updates.**
   `recordEntry()` issues a raw `SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE` before any read/write, so N concurrent debits to the same bucket always serialize and the denormalized `balanceAfter` snapshot never drifts. Vitest covers this.

### The One-Wallet, Multi-Bucket Abstraction

This is Comparta's defining design choice, worth understanding explicitly:

```
Circle (one wallet per org on Arc)
        │
        │  USDC balance onchain = single source of truth at settlement layer
        ▼
Postgres LedgerAccount[] (many virtual buckets per wallet)
   Operating ($12,000)
   Tax Reserve ($3,500)
   Payroll ($4,200)      }  Sum of all LedgerAccounts.balance
   Savings ($800)        }   ≡  Onchain Wallet.balance
   Client Deposits ($150)
   ...custom buckets
```

Every feature - bucket transfers, allocation rules, savings rules, payroll, yield - only ever touches the **ledger layer**. The onchain wallet moves on inbound settlement (Circle credits it) and outbound send (Circle debits it). The invariant that `SUM(ledger_accounts) == onchain_balance` is checked nightly by the reconciliation worker. If it ever drifts, an alert fires and the cause is a specific, replayable `referenceType` / `referenceId` pair - never a mystery.

### Identity Layer: Usernames ≡ Addresses

`@jane` and `0xab…42` resolve through exactly one function: [`lib/identity/resolver.ts`](lib/identity/resolver.ts). It's format-aware - anything starting with `0x` is treated as a raw address; everything else goes through the `Organization.username` unique column. No other feature is allowed to parse identifiers itself. This means when you do payroll or a DCA transfer to `@jane`, every execution *re-resolves* `@jane` fresh - if she releases the username between now and then, it fails loudly instead of silently sending to whoever claimed it next.

### AI & Spending Insights (Phase 9)

LLM access is **strictly read-only** and scoped to transaction metadata only (amounts, memos, counterparty display names, dates). Raw addresses, entity secrets, or PII are never sent. Two separate uses:

1. **Categorization suggestion pipeline** ([`lib/insights/categorization/llmCategorize.ts`](lib/insights/categorization/llmCategorize.ts)): `RULE` first (deterministic `referenceType` → category map). If no rule fires → call Groq to suggest a category with confidence basis points. Below a threshold → `needsConfirmation` flag; user one-tap confirm/override. Above threshold → auto-applied. LLM's suggested name+reasoning is preserved even after manual override for eval/audits.

2. **Natural-language dashboard queries** ([`lib/insights/nlQuery/`](lib/insights/nlQuery/)): User types "What did we pay contractors per month last quarter?" → LLM translates to a typed semantic schema (`schema.ts`) → safe SQL builder (`executeQuery.ts`) → returns a tabular/chartable result. The LLM never touches SQL directly; it only emits a typed AST.

Anomaly detection (Phase 9, non-LLM): [`lib/insights/anomalies/detect.ts`](lib/insights/anomalies/detect.ts) flags:
- **LARGE_OUTFLOW**: A single transaction >3× trailing 90-day average outflow
- **NEW_COUNTERPARTY_LARGE_PAYMENT**: First-ever payment to a new counterparty AND it's large relative to normal first-payment sizes

Flags are informational only - "worth a second look", never auto-reversing.

---

## Tech Stack

| Concern | Choice | Notes |
|---|---|---|
| **Frontend** | Next.js 16 · App Router · React 19 · TypeScript 5 · Tailwind CSS v4 · GSAP animations · Lenis smooth scroll | Marketing site + dashboard in the same deploy |
| **Backend (API)** | Next.js Route Handlers (`app/api/**`) | Single-repo fullstack; API routes are the backend |
| **Data Layer** | PostgreSQL 15+ · Prisma 7 (`@prisma/adapter-pg` · `prisma-client` generator) · Prisma Migrate | Generated client output path: `app/generated/prisma/` (check your `.gitignore`) |
| **Custody & Onchain** | Circle Developer-Controlled Wallets SDK v10 · **Arc L1** (testnet / mainnet) · Circle Payments API (card/ACH checkout) · **USYC** yield-bearing token · Circle Webhooks (ECDSA-signed, verified against public key) | One entity secret → one wallet set → N org wallets |
| **Auth** | NextAuth v4 (Credentials: email+password, JWT sessions) · PrismaAdapter (for future OAuth providers) · `bcryptjs` password hashing · Session carries `orgId` + `role` + `kybStatus` | Replace/extend with OAuth (Google / magic links) without touching financial routes |
| **Authorization** | Role-based: `OWNER` / `ADMIN` / `MEMBER` · Bucket management: `canManageBucket.ts` gate · KYB: `requireApprovedOrg()` re-reads DB | OWNER/ADMIN can create/edit buckets and rules; MEMBER can view+approve per-route |
| **Background Jobs** | BullMQ · IORedis · 6 named queues (see `QUEUE_NAMES` in [jobs/queue.ts](jobs/queue.ts)) · 5 dedicated worker files + 6 standalone jobs | Redis is the durable job store; survives process restart mid-payroll-run |
| **Rate Limiting** | IORedis-backed · Sliding-window · `lib/rateLimit.ts` | Username claim endpoint: 10 tries/10 min/IP |
| **LLM / AI** | Groq SDK (OpenAI-compatible chat completions) | Used for categorization suggestions + NL→schema translation; optional if Phase 9 features aren't enabled |
| **Testing** | Vitest 4 · Aliased `@/*` · Ledger engine has full correctness suite | `tests/ledger.test.ts` covers append-only drift, zero-sum transfers, N-way concurrency, org-total-balance |
| **Linting** | ESLint 9 · `eslint-config-next` |  |

---

## Project Structure

```
comparta/
├── app/
│   ├── layout.tsx                ← Root layout · Manrope font · full SEO/OG manifest
│   ├── page.tsx                  ← Marketing homepage (scroll · GSAP pinned sections)
│   ├── globals.css               ← Tailwind v4 import · @theme inline · brand tokens
│   ├── components/
│   │   ├── FooterColumn.tsx
│   │   └── NavDropdown.tsx       ← Mega-menu hover dropdown (staggered reveal)
│   ├── invoices/_components/     ← Invoice display + formatting
│   └── api/                      ← 25+ route handler groups (see API Overview below)
│
├── lib/                          ← Pure business logic (no React imports)
│   ├── auth/                     ← NextAuth config · kyb-gate · canManageBucket
│   ├── db/prisma.ts              ← PrismaClient singleton (HMR-safe, PrismaPg adapter)
│   ├── env.ts                    ← Zod-schema validated env vars (the only place that reads process.env)
│   ├── rateLimit.ts              ← Redis-backed sliding-window rate limiter
│   ├── ledger/engine.ts          ← THE ledger: recordEntry / transferBetweenLedgerAccounts (row-locked, append-only)
│   ├── circle/                   ← Exclusive owner of all Circle SDK calls
│   │   ├── client.ts             ← Memoized SDK singleton + sandbox/live guard + entity secret note
│   │   ├── wallets.ts            ← createWallet, getBalance, sendTransaction
│   │   ├── payments.ts           ← Card/ACH checkout (Circle Payments API)
│   │   ├── usyc.ts               ← USYC deploy / redeem / NAV quote
│   │   ├── amount.ts             ← ONLY place that does bigint↔decimal conversion (6dp)
│   │   ├── chainMapping.ts       ← Circle chain id ↔ schema enum Chain
│   │   └── webhookVerify.ts      ← ECDSA sig verify against Circle's published pubkey
│   ├── identity/                 ← Username system · Address validation · Universal resolver
│   ├── contacts/service.ts
│   ├── transfers/                ← send (generic outbound primitive) · receive (webhook inbound handler) · idempotency
│   ├── buckets/                  ← CRUD + archive · default set creation · dependency graph
│   ├── allocationRules/          ← engine (rule firing) · service (CRUD) · serialize
│   ├── invoices/                 ← CRUD · send/void · money calc · auto-reconciliation w/ inbound tx · PaymentLink creation hook
│   ├── paymentLinks/             ← CRUD · slug generation · checkout (card+wallet paths) · completion · reconciliation amount-matching
│   ├── payroll/                  ← payees · schedules · scheduler (DRAFT gen) · runs · approve/submit · per-item execute/retry · completion · CSV export
│   ├── savings/                  ← bucket yield config · 3-trigger sweep engine (pct-of-income / round-up / fixed-recurring / cron) · USYC deploy+redeem · yieldRate · NAV-aware overview (liquid + deployed)
│   ├── dca/                      ← RecurringTransfer CRUD · execution (external send + internal bucket paths) · schedule math · pause/resume
│   ├── insights/                 ← Phase 9
│   │   ├── categorization/       ← Seed (7 SYSTEM cats) · RULE map · LLM suggestion pipeline · service (confirm/override)
│   │   ├── anomalies/            ← Detection sweep (2 types) · service (dismiss)
│   │   ├── dashboard/queries.ts  ← Dashboard aggregate SQL
│   │   ├── nlQuery/              ← Natural-language → Schema AST → SQL pipeline
│   │   └── counterparty.ts       ← Counterparty normalization/fingerprinting
│   ├── groq/client.ts            ← Memoized Groq client
│   ├── http/clientIp.ts
│   └── notifications/            ← Logging stubs (wire to email/in-app)
│
├── jobs/
│   ├── queue.ts                  ← Central BullMQ queue + IORedis client definitions (QUEUE_NAMES)
│   ├── confirmTransaction.ts     ← Polls Circle until OnchainTransaction is CONFIRMED/FAILED; on FAILURE writes offsetting credit
│   ├── confirmYieldRedemption.ts ← Same state-machine pattern for YieldRedemptionRequest
│   ├── categorizeTransactions.ts ← Phase 9 sweep: RULE → LLM → categorize uncategorized transactions
│   ├── detectAnomalies.ts        ← Phase 9 sweep: anomaly flags for new settled transactions
│   ├── executePayroll.ts         ← Runs a single PayrollRun (per-item sends, retries, completion)
│   ├── processRecurringTransfers.ts ← Fires all due RecurringTransfer cycles (external + internal paths)
│   ├── invoiceOverdue.worker.ts  ← Sweeps dueDate+3d/7d milestones, fires reminders
│   ├── paymentLinkExpiry.worker.ts ← Sweeps expired PaymentLinks, marks EXPIRED
│   └── workers/                  ← BullMQ Worker classes (run as separate processes)
│       ├── reconciliation.worker.ts
│       ├── allocationRulesScheduled.worker.ts
│       ├── savingsSweep.worker.ts
│       └── payrollSchedule.worker.ts
│
├── prisma/
│   ├── schema.prisma             ← 30 models · 28 enums · 9 documented phases
│   ├── migrations/               ← 7 migration files (atomic, named phases)
│   └── migration_lock.toml
│
├── prisma.config.ts              ← Prisma 7 config (TS-based, `dotenv/config` preload)
├── tests/ledger.test.ts          ← Ledger engine correctness suite
├── types/
│   ├── lordicon.d.ts             ← JSX typings for Lordicon CDN custom elements
│   └── next-auth.d.ts            ← Session/JWT extensions (orgId, role, kybStatus)
├── public/
│   ├── favicon_io/               ← Full favicon set + site.webmanifest (PWA)
│   └── IMG-20260716-WA0038.jpg   ← OG Image (1200×630)
├── global.d.ts
├── middleware.ts                 ← withAuth edge guard for protected routes (NOT the KYB gate - that's server-side)
├── next.config.ts
├── postcss.config.mjs            ← @tailwindcss/postcss plugin (Tailwind v4)
├── tsconfig.json                 ← `@/*` path alias, `next` plugin
├── vitest.config.ts
├── eslint.config.mjs
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json
└── .env.example
```

---

## API Overview

All API routes live under `app/api/`. Every route that moves money or reads financial data **calls `requireApprovedOrg()` at the top** (authenticated + org KYB-approved, DB-fresh).

### Auth & Identity

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Create `Organization` (KYB `PENDING`) + owner `User` (hashed password) |
| POST | `/api/auth/[...nextauth]` | NextAuth sign-in (email + password credentials, JWT session) |
| POST | `/api/username/claim` | Claim an org username (rate-limited · format regex · DB unique · denylist) |
| GET | `/api/resolve/:identifier` | Universal resolver: `@username` OR `0x…` → `{ address, orgDisplayName? }` (rejects with reason) |

### Admin / KYB

| Method | Route | Description |
|---|---|---|
| POST | `/api/org/kyb/approve` | Manual admin stub (gated by `ADMIN_API_SECRET`). Flips `kybStatus=APPROVED`, then **atomically provisions Circle wallet + 4 default ledger buckets** (Operating / Tax Reserve / Payroll / Savings). Swap for a real KYB provider's webhook when ready. |

### Wallet & Ledger

| Method | Route | Description |
|---|---|---|
| GET | `/api/wallet/balance` | Liquid balance per bucket + deployed yield value + onchain USDC verification (one response, composes multiple sources) |
| POST | `/api/ledger/transfer` | Internal move between **same org's** two buckets - no onchain tx, goes through `transferBetweenLedgerAccounts()` (zero-sum) |

### Transfers (USDC Send/Receive)

| Method | Route | Description |
|---|---|---|
| POST | `/api/transfers/send` | **Requires `Idempotency-Key` header.** Send USDC from a bucket to an identifier (username or address). Calls `sendPayment()` - resolver → self-send guard → precision check → sufficiency fast-fail → Circle submit (idempotent) → OnchainTransaction PENDING write + ledger debit (one DB tx) → enqueue CONFIRM_TRANSACTION poller. Outbound ROUND_UP savings rules also fire here. |
| GET | `/api/transfers` | Paginated, filterable (ledger account / direction / counterparty / date range) |
| POST | `/api/webhooks/circle` | Circle transaction webhook. Verifies ECDSA `X-Circle-Signature` against Circle's public key endpoint → writes raw `WebhookEvent` **before processing** → routes to `receive.ts` (inbound crediting + OnchainTransaction writing + invoice auto-recon + payment-link checkout matching) |
| POST | `/api/webhooks/circle-payments` | Circle Payments API webhook (card/ACH settlement on Payment Links) |

### Contacts / Address Book

| Method | Route | Description |
|---|---|---|
| GET | `/api/contacts` | List org's contacts |
| POST | `/api/contacts` | Create (identifierType inferred - never client-trusted) |
| GET | `/api/contacts/:id` | |
| PATCH | `/api/contacts/:id` | |
| DELETE | `/api/contacts/:id` | |

### Buckets (LedgerAccounts) & Allocation Rules

| Method | Route | Description |
|---|---|---|
| GET POST | `/api/buckets` | List / Create |
| GET PATCH | `/api/buckets/:id` | Read / Update name |
| POST | `/api/buckets/:id/archive` | Soft-delete (flag + timestamp + user id). Rejects if `balance > 0` or SYSTEM-critical type. |
| GET POST | `/api/allocation-rules` | List / Create standing allocation rules (PERCENTAGE or FIXED_AMOUNT, ON_INCOMING_PAYMENT or SCHEDULED cron triggers, priority-ordered) |
| GET PATCH DELETE | `/api/allocation-rules/:id` | CRUD individual rules. Update toggles `active`, values, priority. |

### Invoicing (Phase 3)

| Method | Route | Description |
|---|---|---|
| GET POST | `/api/invoices` | List / Create. `lineItems` JSON carries display values; authoritative `subtotal/tax/total` are bigint - server-computed, **never client-trusted**. Auto-creates a 1:1 amount-locked `PaymentLink` at creation for checkout. |
| GET PATCH DELETE | `/api/invoices/:id` | Read / Update (line items while DRAFT) / Void. Voiding writes a VOID `InvoiceEvent` append-only row; invoice rows themselves are never deleted. |
| POST | `/api/invoices/:id/send` | Sends invoice to recipient + `InvoiceEvent` logged (SENT + delivery metadata) |

### Payment Links (Phase 4)

| Method | Route | Description |
|---|---|---|
| GET POST | `/api/payment-links` | List / Create shareable `/pay/:slug` URLs. FIXED_AMOUNT or OPEN_AMOUNT · maxUses · expiresAt |
| GET | `/api/payment-links/:id` | Read |
| POST | `/api/payment-links/:id/pause` | Pause (stops new checkouts) |
| POST | `/api/payment-links/:id/resume` | Resume |
| *(public)* | `/pay/:slug` | Checkout page rendered via the shareable slug - supports both **wallet** (Arc address pay, amount-matched on inbound) and **card/ACH** (Circle Payments API) paths |

### Payroll (Phase 6)

| Method | Route | Description |
|---|---|---|
| GET POST | `/api/payroll/payees` | List / Create payees (payType · defaultAmount · optional contact back-link) |
| GET PATCH DELETE | `/api/payroll/payees/:id` | CRUD |
| GET POST | `/api/payroll/schedules` | List / Create schedules (source bucket · WEEKLY/BIWEEKLY/MONTHLY frequency · nextRunDate · active) - the schedule worker auto-generates DRAFT `PayrollRun`s from these |
| GET PUT DELETE | `/api/payroll/schedules/:id` | CRUD |
| GET POST | `/api/payroll/runs` | List / Create (manual one-off runs) |
| GET | `/api/payroll/runs/:id` | Read run + items |
| POST | `/api/payroll/runs/:id/submit` | `DRAFT` → `PENDING_APPROVAL` |
| POST | `/api/payroll/runs/:id/approve` | OWNER/ADMIN approval: `PENDING_APPROVAL` → enqueues `PAYROLL_RUN` BullMQ job (`PROCESSING`) |
| GET POST | `/api/payroll/runs/:id/items` | Run-item CRUD (while DRAFT: edit amounts, remove, etc.) |
| POST | `/api/payroll/runs/:id/items/:itemId/retry` | Retry a single FAILED run item (fresh send, new tx) |
| GET | `/api/payroll/runs/:id/export` | Run CSV export |
| GET | `/api/payroll/export` | Org-wide payroll CSV export |

### Smart Savings + Yield (Phase 7)

| Method | Route | Description |
|---|---|---|
| PUT | `/api/savings/:ledgerAccountId` | Set bucket yield config: `isYieldEnabled`, `yieldAllocationPct` (0–10000 bps), `minimumBalanceFloor` (liquidity safety floor). Enforces "required iff sibling is true" declaratively. |
| GET | `/api/savings/:ledgerAccountId/yield-history` | Paginated USYC deployment + redemption history (NAV snapshots) |
| POST | `/api/savings/:ledgerAccountId/redeem` | Request partial/full USYC redemption → creates `YieldRedemptionRequest` PENDING → enqueues polling → when settled: credits `LedgerAccount` + logs YIELD_REDEMPTION entry |
| GET | `/api/savings/:ledgerAccountId/redeem/:requestId` | Poll status (PENDING → PROCESSING → COMPLETED/FAILED) |
| GET POST | `/api/savings/rules` | List / Create `SavingsRule` (PERCENTAGE_OF_INCOME · ROUND_UP · FIXED_RECURRING triggers) |
| GET PATCH DELETE | `/api/savings/rules/:id` | CRUD rules |

### DCA / Recurring Transfers (Phase 8)

| Method | Route | Description |
|---|---|---|
| GET POST | `/api/dca` | List / Create recurring transfers (DAILY/WEEKLY/BIWEEKLY/MONTHLY · destination external **or** internal bucket · optional endDate) |
| GET | `/api/dca/:id` | Read |
| POST | `/api/dca/:id/pause` | Pause (stops scheduling; preserves history) |
| POST | `/api/dca/:id/resume` | Resume |
| POST | `/api/dca/:id/cancel` | Cancel permanently (terminal) |
| GET | `/api/dca/:id/executions` | Paginated per-cycle log with failure reasons (INSUFFICIENT_FUNDS · OTHER) |

---

## Background Jobs & Workers

### Queues

Defined in [jobs/queue.ts](jobs/queue.ts):

| Queue | Purpose | Consumer |
|---|---|---|
| `ledger-reconciliation` | Nightly: compare `SUM(ledger_accounts)` vs onchain wallet balance; flag drift | `reconciliation.worker.ts` |
| `circle-webhook-processing` | Async processing of verified Circle webhooks (after raw row insert) | `reconciliation.worker.ts` |
| `payroll-run` | Execute an approved `PayrollRun` item-by-item; handles individual failures gracefully (does NOT fail the whole run) | `executePayroll.ts` via `payrollSchedule.worker.ts` |
| `savings-sweep` | FIXED_RECURRING + cron-driven AllocationRule savings sweeps + inbound PERCENTAGE | `savingsSweep.worker.ts` |
| `dca-execution` | Daily sweep: fire all due `RecurringTransfer` cycles (both external and internal paths) | `processRecurringTransfers.ts` |
| `confirm-transaction` | Per-outbound-tx polling until Circle reports CONFIRMED or FAILED → on FAILED writes **offsetting credit** back to bucket (original debit untouched) | `confirmTransaction.ts` |
| `yield-redemption-confirmation` | Same pattern for USYC redemptions (NAV-at-settlement aware) | `confirmYieldRedemption.ts` |
| `invoice-overdue-sweep` | Fires dueDate / dueDate+3d / dueDate+7d reminders; rate-limited per invoice by `reminderCount` | `invoiceOverdue.worker.ts` |
| `payment-link-expiry-sweep` | Marks EXPIRED any PaymentLinks whose `expiresAt` has passed | `paymentLinkExpiry.worker.ts` |

### Workers (long-running processes)

`jobs/workers/*.worker.ts` are BullMQ `Worker` classes that should run as **separate, supervised processes** - not in the same Node process as the Next.js server. For local dev you can `pnpm tsx` them directly; for production use PM2/systemd/a Vercel Job Runner/Render background worker/equivalent.

```bash
# Example: run the reconciliation worker locally
pnpm tsx jobs/workers/reconciliation.worker.ts
```

### Standalone Job Scripts

Files like `jobs/confirmTransaction.ts`, `jobs/processRecurringTransfers.ts`, `jobs/categorizeTransactions.ts`, etc. can also be invoked as one-off scripts (useful for backfills, manual retries, or scheduled via cron if you haven't fully adopted BullMQ yet). They import from `jobs/queue.ts` or call the same service primitives.

---

## Installation

### Prerequisites

| Dependency | Version | Why |
|---|---|---|
| Node.js | ≥ 20 | Next.js 16 requirement |
| pnpm | ≥ 9 | Lockfile is `pnpm-lock.yaml` |
| PostgreSQL | ≥ 15 | Prisma + PrismaPg adapter require a reasonably new Postgres |
| Redis | ≥ 7 | BullMQ queues + rate limiting + rate-limit sliding windows |
| Circle Developer Account | - | API key, client key, **entity secret + recovery file** (offline). Account on Arc testnet is free. |
| Groq API Key | - | Phase 9 LLM features; get at console.groq.com |

### 1. Install dependencies

```bash
pnpm install
```

`postinstall` runs `prisma generate` automatically via the `prisma.config.ts` (Prisma 7 TS-based config). If this fails with *"Cannot resolve environment variable: DIRECT_URL"*, see Step 2 first - Prisma evaluates the config file eagerly and requires env vars to be present.

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in **every** value in `.env.local`. [`lib/env.ts`](lib/env.ts) validates all of them at boot via Zod; missing/incorrect values fail loudly with a readable list, not as `undefined` 3 files deep into a Circle call.

| Variable | Description |
|---|---|
| `DATABASE_URL` | Your Postgres connection string (for PrismaPg driver adapter - used for *queries*) |
| `DIRECT_URL` | Non-pooled direct Postgres connection string (used by `prisma migrate` and raw `FOR UPDATE` queries) |
| `REDIS_URL` | Redis connection string (BullMQ + rate limiting). Local Docker Redis fine for dev. |
| `NEXTAUTH_URL` | Full canonical site URL, e.g. `http://localhost:3000` in dev |
| `NEXTAUTH_SECRET` | JWT signing secret. Generate: `openssl rand -base64 32` |
| `CIRCLE_API_KEY` | Circle API key - starts with `TEST_API_KEY:` or `LIVE_API_KEY:` |
| `CIRCLE_CLIENT_KEY` | Circle client-side publishable key (optional; used for future client-side token flows) |
| `CIRCLE_ENTITY_SECRET` | ⚠️ **Single point of catastrophic failure.** Anyone who has this + your API key can move every dollar in every org wallet. Pull this from your platform's secrets manager in production - never a committed `.env`, never logged, never returned from an API. Must be paired with the `recovery_file_*.dat` you generated during entity-secret registration. Store that file OFFLINE / encrypted. |
| `CIRCLE_ENVIRONMENT` | `sandbox` or `production`. App boots with guard clauses that refuse to start if a TEST key is paired with production or vice versa. |
| `ARC_CHAIN` | `ARC_TESTNET` or `ARC_MAINNET` |
| `CIRCLE_WALLET_SET_ID` | Optional but recommended in prod. If unset, first wallet creation lazily makes one and logs a warning. |
| `CIRCLE_WEBHOOK_PUBLIC_KEY_URL` | Defaults to Circle's v2 pubkey endpoint - override for offline/test environments. |
| `GROQ_API_KEY` | For Phase 9 categorization + NL querying. Get at https://console.groq.com |
| `ADMIN_API_SECRET` | Gates the manual `/api/org/kyb/approve` stub. Generate: `openssl rand -hex 32`. Swap this entire flow for a real KYB provider before launch. |

### 3. Run database migrations

```bash
pnpm prisma migrate deploy
```

(Use `pnpm prisma migrate dev` during local development to auto-create named migration files as you edit the schema.)

### 4. Start the dev server

```bash
pnpm dev
```

Visit http://localhost:3000 - you'll see the marketing site.

### 5. Start background workers (in separate terminals)

```bash
# Terminal 2
pnpm tsx jobs/workers/reconciliation.worker.ts

# Terminal 3
pnpm tsx jobs/workers/allocationRulesScheduled.worker.ts

# Terminal 4
pnpm tsx jobs/workers/savingsSweep.worker.ts

# Terminal 5
pnpm tsx jobs/workers/payrollSchedule.worker.ts
```

For Phase 3/4 features you also want the overdue/expiry sweep workers running or scheduled via cron.

---

## Development

### Scripts

```bash
pnpm dev             # next dev
pnpm build           # prisma generate && next build
pnpm start           # next start (production build)
pnpm lint            # eslint (via eslint.config.mjs)
pnpm test            # vitest - runs tests/ledger.test.ts against DATABASE_URL
pnpm prisma generate # regenerate app/generated/prisma (runs automatically in postinstall)
pnpm prisma migrate dev  # create and apply a new migration in dev
pnpm prisma migrate deploy # apply pending migrations to production/staging
```

### Testing

```bash
pnpm test
```

Currently ships with `tests/ledger.test.ts` - the Phase 0 ledger acceptance test. It:

1. Spins up throwaway orgs/buckets against whatever Postgres `DATABASE_URL` points at (**use a disposable test DB** - never prod)
2. Asserts a single account's balance-after snapshot always matches full-history recomputation (no drift)
3. Asserts internal transfers are zero-sum across the org's total balance
4. Fires 30 concurrent `recordEntry()` calls at one bucket in parallel to prove the `SELECT ... FOR UPDATE` row lock prevents races
5. Asserts org-wide `SUM(ledger_accounts)` matches the per-bucket sum

Add tests under `tests/**/*.test.ts` - Vitest auto-picks them up.

### Adding a new feature

The codebase follows a consistent shape per module. Suppose you want to add *Vendor Credits*. You'd:

1. **Prisma schema**: Add the `VendorCredit` model + status enums. Name the migration phase clearly.
2. **Migrations**: `pnpm prisma migrate dev --name vendor-credits`
3. **Service layer**: `lib/vendorCredits/service.ts` for CRUD + domain invariants, `lib/vendorCredits/serialize.ts` for API-shape transformers, `lib/vendorCredits/engine.ts` if it has async state machines or audit-log "execution" tables.
4. **Any money movement?** Go through `lib/transfers/send.ts#sendPayment` for outbound; don't write `LedgerEntry` or call Circle directly.
5. **API routes**: `app/api/vendor-credits/route.ts` + `app/api/vendor-credits/[id]/route.ts`. Call `requireApprovedOrg()` on line 1.
6. **Jobs?** If state-machine polling is needed (confirm-settlement, expiry sweep): add a queue name to `jobs/queue.ts`, write the standalone job file under `jobs/`, optionally add a BullMQ worker in `jobs/workers/`.
7. **Categorization?** If the feature creates new `referenceType` values for `LedgerEntry`, add them to the RULE-based categorization map in `lib/insights/categorization/rules.ts` so transactions auto-classify correctly without needing LLM fallback.

---

## Deployment

### Checklist for first deploy

- [ ] **Secrets:** `CIRCLE_ENTITY_SECRET`, `NEXTAUTH_SECRET`, `ADMIN_API_SECRET`, `GROQ_API_KEY` come from the platform's secrets manager, never committed `/.env*`
- [ ] **Hostnames:** `NEXTAUTH_URL` + `metadataBase` (currently `https://comparta.xyz` in `layout.tsx`, change to your real domain) + Circle Webhook URLs (configured in Circle's dashboard - they must be the public production URLs)
- [ ] **Database:** Managed Postgres (Supabase, Neon, RDS, Render). `DATABASE_URL` can be a pooled connection string; **`DIRECT_URL` must be direct, non-pooled** (Prisma migrate + `SELECT FOR UPDATE` raw queries need real sessions).
- [ ] **Redis:** Managed Redis (Upstash, Redis Cloud, Render). TLS fine - `ioredis` handles `rediss://`.
- [ ] **Circle Wallet Set:** Pre-create one in Circle's dashboard and set `CIRCLE_WALLET_SET_ID`. If you don't, the first wallet provision call creates one automatically - but if you deploy to a serverless autoscale setup you might create duplicates on simultaneous cold starts.
- [ ] **Entity secret recovery file (`recovery_file_*.dat`):** Stored encrypted/offline, **not in the repo, not on any server.** You need it if `CIRCLE_ENTITY_SECRET` is ever lost and you need to re-register a new ciphertext.
- [ ] **Workers:** Run as long-running background processes separate from the Next server (PM2, systemd, Render Background Worker, Vercel Job Runner, Fly Machine, etc.). Serverless functions CANNOT reliably run BullMQ Workers.
- [ ] **Domain & cookies:** NextAuth sets cookies; if your cookie domain is a bare-www split, set the right `NEXTAUTH_URL` so cookies work on the correct scope.

### Vercel (recommended for the frontend/API)

The API layer (`app/api/**`) deploys cleanly as Vercel Serverless Functions. Two critical notes:

1. **Workers MUST NOT run inside Vercel serverless functions.** Serverless functions time out and BullMQ loses lease. Deploy workers separately (a single Render web service running all 5 workers is fine) or use Vercel's new Jobs + Cron primitives for the periodic sweeps.
2. **Prisma connection pooling:** Set `DATABASE_URL` to your pooled URL (e.g. Supabase pooler) and `DIRECT_URL` to direct. The `@prisma/adapter-pg` driver respects them separately.

---

## Security

- **Entity secret discipline.** Read `lib/circle/client.ts`'s top-of-file comment again. Then read it once more.
- **No raw SQL except the FOR UPDATE lock.** All other DB access goes through Prisma queries. ORM injection surface = minimal.
- **No money movement without `requireApprovedOrg()`.** Every financial route has this call on line 1 of the handler.
- **Dual-layer idempotency.** API-level Idempotency-Key header + provider-level Circle idempotency key on every outbound transfer. Retry safe, double-spend proof.
- **Append-only ledger.** Money can't vanish silently; every correction leaves a trail.
- **KYB check is DB-fresh, not JWT-trusted.** JWT is a hint; the server re-reads `kybStatus` on every money call so compliance holds take effect immediately, not on next sign-in.
- **LLM scope-limited.** Only transaction metadata is sent to Groq; never raw addresses, entity secrets, or PII. Groq never generates SQL directly - only a typed semantic schema that's validated before execution.
- **Passwords:** `bcryptjs` with default cost factor. Stored only hashed; `passwordHash` is nullable because future magic-link/OAuth flows won't require one.

---

## Phase Roadmap (Delivered + Future)

### Shipped ✅

- **P0 Foundations** - Auth, KYB gate, wallet provisioning, ledger engine, webhook ingestion
- **P1 Identity + Transfers** - Usernames, contacts, send/receive, idempotency
- **P2 Buckets + Allocation Rules** - CRUD buckets, standing rules (PERCENTAGE/FIXED · inbound · cron)
- **P3 Invoicing** - Line items, send flow, auto-reconciliation, overdue milestones, 1:1 payment link
- **P4 Payment Links** - Shareable `/pay/:slug`, card+wallet checkout paths, expiry + max-uses
- **P5 Contacts** - Full address book
- **P6 Payroll** - Payees · schedules · approvals · per-item retry · CSV · identifier flags
- **P7 Smart Savings + Yield** - 3-trigger rules (pct income · round-up · fixed recurring) · USYC yield · partial redemptions · floors
- **P8 DCA / Recurring Transfers** - Interval-based external/internal sends · pause/resume/cancel · per-cycle logs
- **P9 Spending Insights + AI** - RULE + LLM categorization · 7 seeded SYSTEM categories · anomaly detection · NL dashboard queries

### Up next ⏳ (pick your priority order)

- **P10 Cross-chain consolidation.** CCTP + Circle Gateway inbound → Arc USDC settlement on single wallet; `sourceChain` attribution on `OnchainTransaction` is already modeled.
- **P11 Multi-user billing & subscriptions.** Recurring Payment Links + invoice auto-generation.
- **P12 Real KYB provider integration.** Replace the `POST /api/org/kyb/approve` admin stub with Sumsub/Persona/Onfido webhook → same `kybStatus` flip downstream consumers need nothing.
- **P13 Audit log UI + export.** Every append-only table already has the data; now surface a filterable org admin view w/ CSV export for compliance.
- **P14 OAuth (Google, Apple, magic links).** `PrismaAdapter` is already wired - just add the providers to `auth.ts`.
- **P15 Multi-currency (EURC on-ramps).** `InvoiceCurrency.EURC` already exists in the schema; the guard in `invoices/service.ts` that accepts only USDC is the intentional Phase placeholder.
- **P16 Mobile-friendly responsive sweep.** The marketing site is responsive; the dashboard tables/exports should get the same treatment pass.
- **P17 Role refinements.** Beyond OWNER/ADMIN/MEMBER - e.g. `PAYROLL_MANAGER` (can run payroll, can't touch yield config), `VIEWER` (read-only dash). Permission bitmap over `canManageBucket.ts`.

---

## License

Private & proprietary. Unauthorized copying, distribution, or use of the code in this repository via any medium is strictly prohibited.

---

<div align="center">
<sub>Built on Arc L1 · Powered by Circle · Postgres double-entry ledger · No floats allowed.</sub>
</div>
