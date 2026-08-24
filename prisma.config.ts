import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // This ensures CLI engines safely use the direct port
  datasource: {
    url: env("DIRECT_URL"),
  },
});
