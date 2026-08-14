/*
  Warnings:

  - A unique constraint covering the columns `[circlePaymentIntentId]` on the table `payment_link_payments` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "payment_link_payments" ADD COLUMN     "circlePaymentIntentId" TEXT,
ADD COLUMN     "paymentIntentAddress" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payment_link_payments_circlePaymentIntentId_key" ON "payment_link_payments"("circlePaymentIntentId");
