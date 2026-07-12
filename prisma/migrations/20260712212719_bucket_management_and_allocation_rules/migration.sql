/*
  Warnings:

  - A unique constraint covering the columns `[paymentLinkId]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AllocationRuleType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "AllocationTrigger" AS ENUM ('ON_INCOMING_PAYMENT', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "AllocationExecutionStatus" AS ENUM ('EXECUTED', 'SKIPPED_ZERO_AMOUNT', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentLinkType" AS ENUM ('FIXED_AMOUNT', 'OPEN_AMOUNT');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentLinkPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'WRONG_AMOUNT_REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('WALLET', 'CARD');

-- AlterEnum
ALTER TYPE "LedgerReferenceType" ADD VALUE 'ALLOCATION_RULE';

-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedBy" TEXT;

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "PaymentLinkType" NOT NULL,
    "amount" BIGINT,
    "description" TEXT,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "receivingLedgerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_link_payments" (
    "id" TEXT NOT NULL,
    "paymentLinkId" TEXT NOT NULL,
    "payerIdentifier" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "amountExpected" BIGINT NOT NULL,
    "amountPaid" BIGINT,
    "status" "PaymentLinkPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "txId" TEXT,
    "circlePaymentId" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "payment_link_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceLedgerAccountId" TEXT NOT NULL,
    "targetLedgerAccountId" TEXT NOT NULL,
    "name" TEXT,
    "ruleType" "AllocationRuleType" NOT NULL,
    "value" BIGINT NOT NULL,
    "trigger" "AllocationTrigger" NOT NULL DEFAULT 'ON_INCOMING_PAYMENT',
    "scheduleCron" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastExecutedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_rule_executions" (
    "id" TEXT NOT NULL,
    "allocationRuleId" TEXT NOT NULL,
    "triggerReferenceType" "LedgerReferenceType" NOT NULL,
    "triggerReferenceId" TEXT NOT NULL,
    "amountAllocated" BIGINT NOT NULL,
    "status" "AllocationExecutionStatus" NOT NULL,
    "ledgerReferenceId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_rule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_links_slug_key" ON "payment_links"("slug");

-- CreateIndex
CREATE INDEX "payment_links_orgId_status_idx" ON "payment_links"("orgId", "status");

-- CreateIndex
CREATE INDEX "payment_links_status_expiresAt_idx" ON "payment_links"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_payments_txId_key" ON "payment_link_payments"("txId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_payments_circlePaymentId_key" ON "payment_link_payments"("circlePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_payments_idempotencyKey_key" ON "payment_link_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_link_payments_paymentLinkId_status_idx" ON "payment_link_payments"("paymentLinkId", "status");

-- CreateIndex
CREATE INDEX "payment_link_payments_status_createdAt_idx" ON "payment_link_payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "allocation_rules_orgId_sourceLedgerAccountId_trigger_active_idx" ON "allocation_rules"("orgId", "sourceLedgerAccountId", "trigger", "active");

-- CreateIndex
CREATE INDEX "allocation_rules_trigger_active_idx" ON "allocation_rules"("trigger", "active");

-- CreateIndex
CREATE INDEX "allocation_rule_executions_allocationRuleId_createdAt_idx" ON "allocation_rule_executions"("allocationRuleId", "createdAt");

-- CreateIndex
CREATE INDEX "allocation_rule_executions_status_idx" ON "allocation_rule_executions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentLinkId_key" ON "invoices"("paymentLinkId");

-- CreateIndex
CREATE INDEX "ledger_accounts_orgId_archived_idx" ON "ledger_accounts"("orgId", "archived");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "payment_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_receivingLedgerAccountId_fkey" FOREIGN KEY ("receivingLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link_payments" ADD CONSTRAINT "payment_link_payments_paymentLinkId_fkey" FOREIGN KEY ("paymentLinkId") REFERENCES "payment_links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_link_payments" ADD CONSTRAINT "payment_link_payments_txId_fkey" FOREIGN KEY ("txId") REFERENCES "onchain_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_sourceLedgerAccountId_fkey" FOREIGN KEY ("sourceLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rules" ADD CONSTRAINT "allocation_rules_targetLedgerAccountId_fkey" FOREIGN KEY ("targetLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_rule_executions" ADD CONSTRAINT "allocation_rule_executions_allocationRuleId_fkey" FOREIGN KEY ("allocationRuleId") REFERENCES "allocation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
