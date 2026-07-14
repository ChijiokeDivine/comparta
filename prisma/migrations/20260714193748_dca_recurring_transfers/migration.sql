-- CreateEnum
CREATE TYPE "RecurringTransferFrequency" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RecurringTransferStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RecurringTransferExecutionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED_INSUFFICIENT_FUNDS', 'FAILED_OTHER');

-- CreateTable
CREATE TABLE "recurring_transfers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "sourceLedgerAccountId" TEXT NOT NULL,
    "destinationIdentifier" TEXT,
    "destinationLedgerAccountId" TEXT,
    "amount" BIGINT NOT NULL,
    "frequency" "RecurringTransferFrequency" NOT NULL,
    "nextExecutionDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "RecurringTransferStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "recurring_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_transfer_executions" (
    "id" TEXT NOT NULL,
    "recurringTransferId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "executedAt" TIMESTAMP(3),
    "status" "RecurringTransferExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "txId" TEXT,
    "ledgerReferenceId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_transfer_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_transfers_orgId_status_idx" ON "recurring_transfers"("orgId", "status");

-- CreateIndex
CREATE INDEX "recurring_transfers_status_nextExecutionDate_idx" ON "recurring_transfers"("status", "nextExecutionDate");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_transfer_executions_txId_key" ON "recurring_transfer_executions"("txId");

-- CreateIndex
CREATE INDEX "recurring_transfer_executions_recurringTransferId_createdAt_idx" ON "recurring_transfer_executions"("recurringTransferId", "createdAt");

-- CreateIndex
CREATE INDEX "recurring_transfer_executions_status_idx" ON "recurring_transfer_executions"("status");

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_sourceLedgerAccountId_fkey" FOREIGN KEY ("sourceLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_destinationLedgerAccountId_fkey" FOREIGN KEY ("destinationLedgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfers" ADD CONSTRAINT "recurring_transfers_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfer_executions" ADD CONSTRAINT "recurring_transfer_executions_recurringTransferId_fkey" FOREIGN KEY ("recurringTransferId") REFERENCES "recurring_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_transfer_executions" ADD CONSTRAINT "recurring_transfer_executions_txId_fkey" FOREIGN KEY ("txId") REFERENCES "onchain_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
