-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('SALARY', 'HOURLY', 'CONTRACT');

-- CreateEnum
CREATE TYPE "PayrollFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayrollRunItemStatus" AS ENUM ('PENDING', 'SENT', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "YieldPositionStatus" AS ENUM ('ACTIVE', 'REDEEMED');

-- CreateEnum
CREATE TYPE "SavingsRuleTrigger" AS ENUM ('PERCENTAGE_OF_INCOME', 'ROUND_UP', 'FIXED_RECURRING');

-- CreateEnum
CREATE TYPE "SavingsRuleExecutionStatus" AS ENUM ('EXECUTED', 'SKIPPED_ZERO_AMOUNT', 'SKIPPED_FLOOR_PROTECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "YieldRedemptionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerReferenceType" ADD VALUE 'YIELD_DEPLOYMENT';
ALTER TYPE "LedgerReferenceType" ADD VALUE 'YIELD_REDEMPTION';

-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "isYieldEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minimumBalanceFloor" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "yieldAllocationPct" INTEGER;

-- CreateTable
CREATE TABLE "payees" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifierType" "IdentifierType" NOT NULL,
    "payType" "PayType" NOT NULL DEFAULT 'CONTRACT',
    "defaultAmount" BIGINT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_schedules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceLedgerAccountId" TEXT NOT NULL,
    "name" TEXT,
    "frequency" "PayrollFrequency" NOT NULL,
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "payrollScheduleId" TEXT,
    "orgId" TEXT NOT NULL,
    "sourceLedgerAccountId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totalAmount" BIGINT NOT NULL DEFAULT 0,
    "initiatedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_items" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "PayrollRunItemStatus" NOT NULL DEFAULT 'PENDING',
    "txId" TEXT,
    "identifierIssue" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "payroll_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yield_positions" (
    "id" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "usycAmount" BIGINT NOT NULL,
    "usdcEquivalentAtDeploy" BIGINT NOT NULL,
    "navAtDeploy" TEXT NOT NULL,
    "status" "YieldPositionStatus" NOT NULL DEFAULT 'ACTIVE',
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yield_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "yield_redemption_requests" (
    "id" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "yieldPositionId" TEXT NOT NULL,
    "usycAmountRequested" BIGINT NOT NULL,
    "usdcAmountSettled" BIGINT,
    "status" "YieldRedemptionStatus" NOT NULL DEFAULT 'PENDING',
    "circleConversionId" TEXT,
    "idempotencyKey" TEXT,
    "ledgerEntryId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "yield_redemption_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_rules" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT,
    "trigger" "SavingsRuleTrigger" NOT NULL,
    "value" BIGINT NOT NULL,
    "scheduleCron" TEXT,
    "lastExecutedAt" TIMESTAMP(3),
    "sourceLedgerAccountId" TEXT NOT NULL,
    "targetLedgerAccountId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "savings_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "savings_rule_executions" (
    "id" TEXT NOT NULL,
    "savingsRuleId" TEXT NOT NULL,
    "triggerReferenceType" "LedgerReferenceType" NOT NULL,
    "triggerReferenceId" TEXT NOT NULL,
    "amountSwept" BIGINT NOT NULL,
    "status" "SavingsRuleExecutionStatus" NOT NULL,
    "ledgerReferenceId" TEXT,
    "yieldPositionId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "savings_rule_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payees_orgId_active_idx" ON "payees"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "payees_orgId_identifier_key" ON "payees"("orgId", "identifier");

-- CreateIndex
CREATE INDEX "payroll_schedules_orgId_active_idx" ON "payroll_schedules"("orgId", "active");

-- CreateIndex
CREATE INDEX "payroll_schedules_active_nextRunDate_idx" ON "payroll_schedules"("active", "nextRunDate");

-- CreateIndex
CREATE INDEX "payroll_runs_orgId_status_idx" ON "payroll_runs"("orgId", "status");

-- CreateIndex
CREATE INDEX "payroll_runs_orgId_createdAt_idx" ON "payroll_runs"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_payrollScheduleId_scheduledFor_key" ON "payroll_runs"("payrollScheduleId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_items_txId_key" ON "payroll_run_items"("txId");

-- CreateIndex
CREATE INDEX "payroll_run_items_payrollRunId_status_idx" ON "payroll_run_items"("payrollRunId", "status");

-- CreateIndex
CREATE INDEX "payroll_run_items_payeeId_idx" ON "payroll_run_items"("payeeId");

-- CreateIndex
CREATE INDEX "yield_positions_ledgerAccountId_status_idx" ON "yield_positions"("ledgerAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "yield_redemption_requests_circleConversionId_key" ON "yield_redemption_requests"("circleConversionId");

-- CreateIndex
CREATE UNIQUE INDEX "yield_redemption_requests_idempotencyKey_key" ON "yield_redemption_requests"("idempotencyKey");

-- CreateIndex
CREATE INDEX "yield_redemption_requests_ledgerAccountId_status_idx" ON "yield_redemption_requests"("ledgerAccountId", "status");

-- CreateIndex
CREATE INDEX "yield_redemption_requests_yieldPositionId_idx" ON "yield_redemption_requests"("yieldPositionId");

-- CreateIndex
CREATE INDEX "savings_rules_orgId_sourceLedgerAccountId_trigger_active_idx" ON "savings_rules"("orgId", "sourceLedgerAccountId", "trigger", "active");

-- CreateIndex
CREATE INDEX "savings_rules_trigger_active_idx" ON "savings_rules"("trigger", "active");

-- CreateIndex
CREATE INDEX "savings_rule_executions_savingsRuleId_createdAt_idx" ON "savings_rule_executions"("savingsRuleId", "createdAt");

-- CreateIndex
CREATE INDEX "savings_rule_executions_status_idx" ON "savings_rule_executions"("status");

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_schedules" ADD CONSTRAINT "payroll_schedules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_schedules" ADD CONSTRAINT "payroll_schedules_sourceLedgerAccountId_fkey" FOREIGN KEY ("sourceLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payrollScheduleId_fkey" FOREIGN KEY ("payrollScheduleId") REFERENCES "payroll_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_sourceLedgerAccountId_fkey" FOREIGN KEY ("sourceLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_initiatedBy_fkey" FOREIGN KEY ("initiatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "payees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_txId_fkey" FOREIGN KEY ("txId") REFERENCES "onchain_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yield_positions" ADD CONSTRAINT "yield_positions_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yield_redemption_requests" ADD CONSTRAINT "yield_redemption_requests_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "yield_redemption_requests" ADD CONSTRAINT "yield_redemption_requests_yieldPositionId_fkey" FOREIGN KEY ("yieldPositionId") REFERENCES "yield_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_rules" ADD CONSTRAINT "savings_rules_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_rules" ADD CONSTRAINT "savings_rules_sourceLedgerAccountId_fkey" FOREIGN KEY ("sourceLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_rules" ADD CONSTRAINT "savings_rules_targetLedgerAccountId_fkey" FOREIGN KEY ("targetLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "savings_rule_executions" ADD CONSTRAINT "savings_rule_executions_savingsRuleId_fkey" FOREIGN KEY ("savingsRuleId") REFERENCES "savings_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
