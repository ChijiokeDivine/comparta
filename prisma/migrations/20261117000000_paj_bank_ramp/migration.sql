-- CreateEnum
CREATE TYPE "PajOrderType" AS ENUM ('ONRAMP', 'OFFRAMP');

-- CreateEnum
CREATE TYPE "PajOrderStatus" AS ENUM ('INIT', 'PROCESSING', 'COMPLETED', 'ERROR');

-- CreateTable
CREATE TABLE "paj_bank_accounts" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "pajId" TEXT,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "solanaAddress" TEXT,
    "evmAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paj_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paj_orders" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" "PajOrderType" NOT NULL,
    "status" "PajOrderStatus" NOT NULL DEFAULT 'INIT',
    "pajOrderId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "tokenAmount" DECIMAL(24,6),
    "fiatAmount" DECIMAL(24,2),
    "rate" DECIMAL(24,6),
    "fee" DECIMAL(24,6),
    "recipientAddress" TEXT,
    "depositAddress" TEXT,
    "bankAccountId" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "accountName" TEXT,
    "fromLedgerAccountId" TEXT,
    "onchainTransactionId" TEXT,
    "memo" TEXT,
    "failureReason" TEXT,
    "rawPayload" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paj_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "paj_bank_accounts_orgId_idx" ON "paj_bank_accounts"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "paj_bank_accounts_orgId_bankCode_accountNumber_key" ON "paj_bank_accounts"("orgId", "bankCode", "accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "paj_orders_pajOrderId_key" ON "paj_orders"("pajOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "paj_orders_onchainTransactionId_key" ON "paj_orders"("onchainTransactionId");

-- CreateIndex
CREATE INDEX "paj_orders_orgId_createdAt_idx" ON "paj_orders"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "paj_orders_orgId_type_idx" ON "paj_orders"("orgId", "type");

-- CreateIndex
CREATE INDEX "paj_orders_status_idx" ON "paj_orders"("status");

-- AddForeignKey
ALTER TABLE "paj_bank_accounts" ADD CONSTRAINT "paj_bank_accounts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paj_orders" ADD CONSTRAINT "paj_orders_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paj_orders" ADD CONSTRAINT "paj_orders_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "paj_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
