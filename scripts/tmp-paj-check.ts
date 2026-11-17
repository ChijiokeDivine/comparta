import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { prisma } = await import("@/lib/db");
  const { getPajAvailability } = await import("@/lib/paj/service");
  const { resolveAppNetwork } = await import("@/lib/config/network");

  console.log("resolved network:", resolveAppNetwork());
  console.log("PAJ_CASH_ENVIRONMENT:", process.env.PAJ_CASH_ENVIRONMENT ?? "(unset → production)");

  const wallet = await prisma.wallet.findFirst({ select: { orgId: true, chain: true } });
  if (!wallet) {
    console.log("no wallet rows in db");
    return;
  }
  console.log("sample wallet chain:", wallet.chain);
  console.log("availability:", JSON.stringify(await getPajAvailability(wallet.orgId), null, 2));
}

main()
  .catch((e) => {
    console.error("FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.$disconnect().catch(() => {});
  });
