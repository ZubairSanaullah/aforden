import "dotenv/config";
import { prisma } from "@/lib/prisma";

async function main() {
    await prisma.$queryRaw`SELECT 1`;

    console.log("Aforden database connection successful.");
}

main()
    .catch((error) => {
        console.error("Database connection failed:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });