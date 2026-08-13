-- CreateEnum
CREATE TYPE "MultisigProposalStatus" AS ENUM ('PENDING', 'EXECUTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "multisig_signers" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "circleWalletId" TEXT NOT NULL,
    "arcAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multisig_signers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multisig_treasuries" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "deploymentTxId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "chain" "Chain" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "multisig_treasuries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "multisig_proposals" (
    "id" TEXT NOT NULL,
    "treasuryId" TEXT NOT NULL,
    "onChainTransferId" INTEGER NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "MultisigProposalStatus" NOT NULL DEFAULT 'PENDING',
    "approvalCount" INTEGER NOT NULL DEFAULT 1,
    "circleTxId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "multisig_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "multisig_signers_userId_key" ON "multisig_signers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_signers_circleWalletId_key" ON "multisig_signers"("circleWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_signers_arcAddress_key" ON "multisig_signers"("arcAddress");

-- CreateIndex
CREATE INDEX "multisig_signers_orgId_idx" ON "multisig_signers"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_treasuries_orgId_key" ON "multisig_treasuries"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_treasuries_contractAddress_key" ON "multisig_treasuries"("contractAddress");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_treasuries_deploymentTxId_key" ON "multisig_treasuries"("deploymentTxId");

-- CreateIndex
CREATE INDEX "multisig_treasuries_orgId_idx" ON "multisig_treasuries"("orgId");

-- CreateIndex
CREATE INDEX "multisig_proposals_treasuryId_idx" ON "multisig_proposals"("treasuryId");

-- CreateIndex
CREATE INDEX "multisig_proposals_treasuryId_status_idx" ON "multisig_proposals"("treasuryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "multisig_proposals_treasuryId_onChainTransferId_key" ON "multisig_proposals"("treasuryId", "onChainTransferId");

-- AddForeignKey
ALTER TABLE "multisig_signers" ADD CONSTRAINT "multisig_signers_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_signers" ADD CONSTRAINT "multisig_signers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_treasuries" ADD CONSTRAINT "multisig_treasuries_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "multisig_proposals" ADD CONSTRAINT "multisig_proposals_treasuryId_fkey" FOREIGN KEY ("treasuryId") REFERENCES "multisig_treasuries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
