import { prisma } from "../lib/db/prisma";
import {
  DEFAULT_TERMS_HTML,
  DEFAULT_TERMS_TITLE,
  DEFAULT_TERMS_VERSION,
} from "../lib/legal/default-terms";

async function main() {
  // 1. Deactivate any currently active Terms
  await prisma.legalDocument.updateMany({
    where: {
      documentType: "TERMS_OF_SERVICE",
      isActive: true,
    },
    data: { isActive: false },
  });

  // 2. Upsert the new version (safe to re-run)
  const doc = await prisma.legalDocument.upsert({
    where: {
      documentType_versionString: {
        documentType: "TERMS_OF_SERVICE",
        versionString: DEFAULT_TERMS_VERSION,
      },
    },
    create: {
      documentType: "TERMS_OF_SERVICE",
      versionString: DEFAULT_TERMS_VERSION,
      title: DEFAULT_TERMS_TITLE,
      content: DEFAULT_TERMS_HTML,
      isActive: true,
      publishedAt: new Date(),
    },
    update: {
      title: DEFAULT_TERMS_TITLE,
      content: DEFAULT_TERMS_HTML,
      isActive: true,
      publishedAt: new Date(),
    },
  });

  console.log("✅ Terms of Service seeded:");
  console.log(`   id:      ${doc.id}`);
  console.log(`   version: ${doc.versionString}`);
  console.log(`   active:  ${doc.isActive}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });