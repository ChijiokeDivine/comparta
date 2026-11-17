-- Paj webhook hardening: delivery dedupe, order delivery metadata, and the
-- per-deployment webhook registration (endpoint + encrypted signing secret).

-- AlterTable
ALTER TABLE "webhook_events" ADD COLUMN "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_dedupeKey_key" ON "webhook_events"("source", "dedupeKey");

-- CreateIndex
CREATE INDEX "webhook_events_source_createdAt_idx" ON "webhook_events"("source", "createdAt");

-- AlterTable
ALTER TABLE "paj_orders" ADD COLUMN "providerSignature" TEXT,
ADD COLUMN "webhookUrl" TEXT,
ADD COLUMN "lastWebhookAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "paj_webhook_configs" (
    "id" TEXT NOT NULL,
    "rampWebhookUrl" TEXT,
    "secretCipher" TEXT,
    "secretHint" TEXT,
    "registeredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paj_webhook_configs_pkey" PRIMARY KEY ("id")
);
