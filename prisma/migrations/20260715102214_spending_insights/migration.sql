-- CreateEnum
CREATE TYPE "TransactionCategoryKind" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CategorizationSource" AS ENUM ('RULE', 'LLM', 'MANUAL');

-- CreateEnum
CREATE TYPE "AnomalyType" AS ENUM ('LARGE_OUTFLOW', 'NEW_COUNTERPARTY_LARGE_PAYMENT');

-- CreateEnum
CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'DISMISSED');

-- CreateTable
CREATE TABLE "transaction_categories" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TransactionCategoryKind" NOT NULL DEFAULT 'CUSTOM',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_categorizations" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "onchainTransactionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "CategorizationSource" NOT NULL,
    "confidenceBps" INTEGER,
    "needsConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "confirmedAt" TIMESTAMP(3),
    "llmSuggestedCategoryName" TEXT,
    "llmReasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_categorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spending_anomalies" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "onchainTransactionId" TEXT NOT NULL,
    "type" "AnomalyType" NOT NULL,
    "status" "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "transactionAmount" BIGINT NOT NULL,
    "comparisonAmount" BIGINT,
    "multiplier" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "spending_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_categories_orgId_kind_idx" ON "transaction_categories"("orgId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_categories_orgId_name_key" ON "transaction_categories"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_categorizations_onchainTransactionId_key" ON "transaction_categorizations"("onchainTransactionId");

-- CreateIndex
CREATE INDEX "transaction_categorizations_orgId_categoryId_idx" ON "transaction_categorizations"("orgId", "categoryId");

-- CreateIndex
CREATE INDEX "transaction_categorizations_orgId_needsConfirmation_idx" ON "transaction_categorizations"("orgId", "needsConfirmation");

-- CreateIndex
CREATE INDEX "spending_anomalies_orgId_status_idx" ON "spending_anomalies"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "spending_anomalies_onchainTransactionId_type_key" ON "spending_anomalies"("onchainTransactionId", "type");

-- AddForeignKey
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_categorizations" ADD CONSTRAINT "transaction_categorizations_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_categorizations" ADD CONSTRAINT "transaction_categorizations_onchainTransactionId_fkey" FOREIGN KEY ("onchainTransactionId") REFERENCES "onchain_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_categorizations" ADD CONSTRAINT "transaction_categorizations_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "transaction_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spending_anomalies" ADD CONSTRAINT "spending_anomalies_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spending_anomalies" ADD CONSTRAINT "spending_anomalies_onchainTransactionId_fkey" FOREIGN KEY ("onchainTransactionId") REFERENCES "onchain_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
