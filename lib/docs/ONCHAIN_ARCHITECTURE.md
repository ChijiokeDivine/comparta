# Comparta On-Chain Financial Primitive Layer

## 1. Contract Architecture

```
AgreementCore (immutable)
  ├── custody of ERC-20 (USDC)
  ├── agreement registry + state machine
  ├── authorization + nonces
  ├── settlement / cancel / refund
  └── events
        │
        ├── ConditionalPaymentModule
        │     condition IDs, EIP-712 / resolver auth, partial & multi-beneficiary release
        │
        └── StreamModule
              deterministic linear stream + cliff + claim + cancel
```

**Why this shape**
- Matches the approved architecture (A–M).
- Core stays small and immutable for 1–2+ months while off-chain product evolves.
- New financial products = new focused modules, not core redeployments.
- No product-specific concepts (invoice, payroll, payment-link) on-chain.
- Reuses existing Comparta Circle wallets, ledger, idempotency, and reconciliation patterns.

## 2. Core vs Module Responsibilities

| Concern                    | Core                         | Conditional Module          | Stream Module                |
|---------------------------|------------------------------|-----------------------------|------------------------------|
| Custody                   | Yes                          | —                           | —                            |
| Agreement lifecycle       | Yes                          | —                           | —                            |
| Authorization registry    | Yes                          | consumes                    | consumes                     |
| Nonces / EIP-712 domain   | Yes (shared)                 | own domain for conditions   | —                            |
| Condition registration    | —                            | Yes                         | —                            |
| Condition authorization   | —                            | Yes                         | —                            |
| Stream math / claim       | —                            | —                           | Yes                          |
| Token transfers out       | Yes (`releaseTo`)            | calls Core                  | calls Core                   |

## 3. Storage Model

**AgreementCore**
- `agreements[agreementId]` → full `Agreement` struct (payer, token, principal, deposited, released, times, status, metadataHash, module, timestamps)
- `isAuthorized[agreementId][actor]`
- `nonces[agreementId][actor]`
- `allowedTokens[token]`

**ConditionalPaymentModule**
- `AgreementConditions` keyed by `agreementId` (conditionIds list + mapping of Condition structs)

**StreamModule**
- `streams[agreementId]` → Stream struct (sender, recipient, deposited, claimed, times, cliff, cancelled)

Only fields required for trustless enforcement live on-chain. Business meaning lives behind `metadataHash` + Comparta DB.

## 4–8. Lifecycles

### Agreement
1. Off-chain builds terms + chooses `agreementId` (e.g. `keccak256(orgId, invoiceId, salt)`).
2. `createAgreement` → status `Created`.
3. `fundAgreement` (one or more deposits) → `Funded`.
4. `activateAgreement` (after `startTime` and full principal) → `Active` + module `onActivate`.
5. Module-specific transitions.
6. Terminal: `Settled` | `Cancelled` | `Expired`.

### Conditional Payment
1. After create (while Created/Funded): `registerConditions`.
2. Off-chain business logic decides a condition is satisfied.
3. Authorized actor calls `authorizeCondition` **or** submits EIP-712 signature via `authorizeConditionWithSignature`.
4. Anyone calls `releaseCondition` once authorized + time gates pass.
5. Funds move via `Core.releaseTo`. Auto-settles when fully released.

### Streaming
1. After create: `createStream` (recipient, start, end, cliff).
2. Fund + activate.
3. Recipient calls `claim` any time after cliff; accrued is pure function of time.
4. Authorized party may `cancelStream`: accrued is released to recipient, unaccrued refunded to payer via Core cancel.

### Settlement
- Full release of all deposited funds → `Settled`.
- Explicit cancel → remaining returned to payer.
- `expireAgreement` after `endTime` while still Active.

## 9. On-chain / Off-chain Boundary

**On-chain**
- USDC custody, agreement state, amounts, addresses, timestamps, deadlines, entitlement, release rules, cancellation/refund, authorization, nonces, events.

**Off-chain (existing Comparta)**
- Users, orgs, KYB, invoices, payroll, payment links, savings, allocation rules, UI, notifications, internal ledger (derived), analytics, webhooks, human workflows.

Do **not** duplicate the Comparta database on-chain.

## 10–11. Trust & Security Assumptions

- Circle Developer-Controlled Wallets remain the primary way Comparta moves funds into/out of the protocol.
- Authorized resolvers/signers are registered per agreement (Comparta backend can be one of them; it is not an unbounded admin).
- `metadataHash` is opaque.
- Arc finality + USDC behaviour assumed correct.
- OpenZeppelin ReentrancyGuard, SafeERC20, EIP-712, ECDSA.
- Checks-Effects-Interactions, explicit state machine, custom errors.
- No upgradeability on Core.
- Modules cannot steal funds belonging to agreements that use other modules.

## 12–13. Authorization & Signature Model

- Payer is always authorized at creation.
- Additional actors supplied in `initialAuthorized` or later via `grantAuthorization`.
- Conditional authorization:
  - Direct call by authorized address, **or**
  - EIP-712 `AuthorizeCondition(agreementId, conditionId, nonce, deadline)` signed by an authorized address; anyone may submit.
- Nonces are per-agreement per-actor and consumed on use.

## 14–17. Extensibility

- **New agreement types** → new module implementing `IAgreementModule`, point `module` field at it.
- **New condition types** → new resolver or new EIP-712 types that Conditional module already accepts.
- **What can change off-chain without touching contracts**: any business workflow, invoice/payroll/payment-link logic, UI, ledger mirroring, notifications.
- **What requires a new module**: genuinely new on-chain financial behaviour (e.g. revenue-share formula, installment schedule enforcement).
- **What requires a new Core deployment**: change to custody model, authorization primitives, or settlement semantics themselves (rare).

## 18. Arc Testnet Deployment (Hardhat)

1. Node 18+ and pnpm.
2. `cd contracts && pnpm install`
3. Set env: `PRIVATE_KEY`, `ARC_TESTNET_RPC_URL`, optional `USDC_ADDRESS`, `PROTOCOL_ADMIN`.
4. Deploy:
   ```bash
   npx hardhat run scripts/deploy.ts --network arcTestnet
   # or
   pnpm run deploy:arc
   ```
5. Record addresses printed by the script into env:
   - `AGREEMENT_CORE_ADDRESS`
   - `CONDITIONAL_MODULE_ADDRESS`
   - `STREAM_MODULE_ADDRESS`
   - `USDC_ADDRESS` (Arc Testnet USDC)

**Never invent addresses.** Report only actual deployed addresses after a real broadcast.

Local smoke deploy:

```bash
pnpm run deploy:local
```

Tests:

```bash
pnpm test
```

## 19. Comparta Integration

- `lib/onchain/agreements.ts` – server primitives (`createAgreement`, `fundAgreement`, `authorizeCondition`, `createStream`, `claimStream`, …).
- `lib/onchain/types.ts` – TypeScript mirrors of on-chain state.
- Existing `OnchainTransaction` + ledger + webhook/reconciliation patterns are extended, not replaced.
- Circle wallets continue to be the source of USDC that funds agreements (approve + `fundAgreement`, or a future deposit helper).
- New DB tables (to be added in a follow-up migration) should *mirror* on-chain state keyed by `agreementId` / `metadataHash`; they are never the source of truth for balances.

## 20–21. Database / Indexing / Reconciliation

- Recommended tables (future migration):
  - `OnchainAgreement` (agreementId, status, deposited, released, module, metadataHash, orgId, …)
  - `OnchainAgreementAction` (status machine: intent → submitted → confirmed/failed)
  - `OnchainStream` / `OnchainCondition` mirrors
- Index `AgreementCreated`, `AgreementFunded`, `PaymentReleased`, `StreamClaimed`, etc.
- Reconciliation job compares on-chain `deposited - released` vs cached rows; mismatches are flagged, never auto-overwritten by DB.

## 22. Known Limitations (v1)

- Equal split among beneficiaries in Conditional module (per-beneficiary amounts can be a later module enhancement).
- Stream cancel path relies on the StreamModule (or an authorized caller) being able to finish via Core.cancelAgreement; ensure the module address is in `initialAuthorized` when creating stream agreements.
- No permit / gasless funding yet.
- No multi-token streams in a single agreement (one token per agreement).
- Operator private key used for writes in the TypeScript service; production should use Circle contract interaction or a more robust signing setup.
- Hardhat test suite covers happy paths + unauthorized auth; expand with reentrancy, signature replay, rounding, multi-beneficiary, and cancel edge cases.

## Recommended Next Steps

1. `cd contracts && pnpm install && pnpm test` — confirm green suite.
2. Deploy to Arc Testnet and record real addresses.
3. Add Prisma models for agreement mirrors + action status machine.
4. Wire event indexer (or extend existing webhook/reconciliation workers).
5. Add a thin API surface (`/api/agreements`, …) that calls `lib/onchain/agreements.ts`.
6. Product integration: e.g. “invoice paid via conditional release” or “payroll streamed over 30 days”.
