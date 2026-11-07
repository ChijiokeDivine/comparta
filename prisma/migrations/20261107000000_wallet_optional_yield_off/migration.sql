-- Buckets (LedgerAccount) are now created at signup, before any Circle
-- wallet exists, and attached to the wallet later when the user creates
-- one. This makes the wallet relation optional.
ALTER TABLE "ledger_accounts" ALTER COLUMN "walletId" DROP NOT NULL;

-- Yield/USYC is dormant for now. New buckets must default to yield off,
-- and existing buckets are switched off too so savings sweeps never try
-- to reach Circle's USYC endpoints. The columns/tables stay in place so
-- the feature can be re-enabled later.
ALTER TABLE "ledger_accounts" ALTER COLUMN "isYieldEnabled" SET DEFAULT false;
UPDATE "ledger_accounts" SET "isYieldEnabled" = false WHERE "isYieldEnabled" = true;
