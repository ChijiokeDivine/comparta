// scripts/_setDirectUrl.ts
//
// Imported first by maintenance scripts so lib/db/prisma (which reads
// process.env.DATABASE_URL once, at import time) connects through DIRECT_URL
// instead of the transaction pooler. Order matters: this file must appear
// before the prisma import in the importing script.

if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}
