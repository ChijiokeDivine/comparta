-- CreateEnum
CREATE TYPE "KybStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('ARC_TESTNET', 'ARC_MAINNET', 'ETH_SEPOLIA', 'ETH_MAINNET', 'SOLANA', 'BASE', 'AVAX', 'ARBITRUM');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('OPERATING', 'RESERVE', 'PAYROLL', 'SAVINGS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerReferenceType" AS ENUM ('ONCHAIN_TX', 'INTERNAL_TRANSFER', 'INVOICE', 'PAYROLL_RUN', 'SAVINGS_SWEEP', 'DCA', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "OnchainDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "OnchainTxStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('USERNAME', 'ADDRESS');

-- CreateEnum
CREATE TYPE "IdempotencyKeyStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "username" TEXT,
    "defaultLedgerAccountId" TEXT,
    "kybStatus" "KybStatus" NOT NULL DEFAULT 'PENDING',
    "kybApprovedAt" TIMESTAMP(3),
    "kybApprovedBy" TEXT,
    "circleEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "circleWalletId" TEXT NOT NULL,
    "circleWalletSetId" TEXT,
    "arcAddress" TEXT NOT NULL,
    "chain" "Chain" NOT NULL DEFAULT 'ARC_TESTNET',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL DEFAULT 'CUSTOM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "referenceType" "LedgerReferenceType" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onchain_transactions" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "txHash" TEXT,
    "direction" "OnchainDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "counterpartyAddress" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "sourceChain" "Chain",
    "status" "OnchainTxStatus" NOT NULL DEFAULT 'PENDING',
    "circleTransactionId" TEXT,
    "idempotencyKey" TEXT,
    "rawPayload" JSONB,
    "memo" TEXT,
    "referenceType" "LedgerReferenceType",
    "referenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "onchain_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'circle',
    "eventType" TEXT,
    "signatureOk" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "processError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifierType" "IdentifierType" NOT NULL,
    "notes" TEXT,
    "lastPaidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyKeyStatus" NOT NULL DEFAULT 'PENDING',
    "responseBody" JSONB,
    "responseStatus" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_username_key" ON "organizations"("username");

-- CreateIndex
CREATE INDEX "organizations_kybStatus_idx" ON "organizations"("kybStatus");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_circleWalletId_key" ON "wallets"("circleWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_arcAddress_key" ON "wallets"("arcAddress");

-- CreateIndex
CREATE INDEX "wallets_orgId_idx" ON "wallets"("orgId");

-- CreateIndex
CREATE INDEX "ledger_accounts_orgId_idx" ON "ledger_accounts"("orgId");

-- CreateIndex
CREATE INDEX "ledger_accounts_walletId_idx" ON "ledger_accounts"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_orgId_name_key" ON "ledger_accounts"("orgId", "name");

-- CreateIndex
CREATE INDEX "ledger_entries_ledgerAccountId_createdAt_idx" ON "ledger_entries"("ledgerAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_referenceType_referenceId_idx" ON "ledger_entries"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_transactions_txHash_key" ON "onchain_transactions"("txHash");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_transactions_circleTransactionId_key" ON "onchain_transactions"("circleTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "onchain_transactions_idempotencyKey_key" ON "onchain_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "onchain_transactions_walletId_status_idx" ON "onchain_transactions"("walletId", "status");

-- CreateIndex
CREATE INDEX "onchain_transactions_circleTransactionId_idx" ON "onchain_transactions"("circleTransactionId");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE INDEX "webhook_events_eventType_idx" ON "webhook_events"("eventType");

-- CreateIndex
CREATE INDEX "contacts_orgId_lastPaidAt_idx" ON "contacts"("orgId", "lastPaidAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_orgId_identifier_key" ON "contacts"("orgId", "identifier");

-- CreateIndex
CREATE INDEX "idempotency_keys_orgId_idx" ON "idempotency_keys"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_orgId_endpoint_key_key" ON "idempotency_keys"("orgId", "endpoint", "key");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_defaultLedgerAccountId_fkey" FOREIGN KEY ("defaultLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onchain_transactions" ADD CONSTRAINT "onchain_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
