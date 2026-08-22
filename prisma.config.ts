import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // This ensures CLI engines safely use the direct port
  datasource: {
    url: "postgresql://postgres.twksbckmtlgcqdmdrbjf:I2rHUYYjG4syF02z@aws-1-us-west-2.pooler.supabase.com:5432/postgres",
  },
});
