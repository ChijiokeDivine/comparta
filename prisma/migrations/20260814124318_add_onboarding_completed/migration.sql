/*
  Warnings:

  - A unique constraint covering the columns `[depositWalletId]` on the table `payment_link_payments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[depositAddress]` on the table `payment_link_payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "PaymentLinkPaymentStatus" ADD VALUE 'SWEEPING';

-- AlterTable
ALTER TABLE "payment_link_payments" ADD COLUMN     "depositAddress" TEXT,
ADD COLUMN     "depositWalletId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_payments_depositWalletId_key" ON "payment_link_payments"("depositWalletId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_payments_depositAddress_key" ON "payment_link_payments"("depositAddress");
