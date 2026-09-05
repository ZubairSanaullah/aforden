import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

export interface PrismaConnectionPoolConfig {
    connectionString: string;
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
}

/**
 * Resolves connection pool configuration with serverless-safe defaults.
 * Precedence:
 * 1. Explicit environment variables (PG_POOL_MAX, PG_POOL_TIMEOUT_MS, PG_IDLE_TIMEOUT_MS)
 * 2. URL search parameters in DATABASE_URL (connection_limit, pool_timeout)
 * 3. Serverless defaults: max=5 in production (10 in dev/test), timeout=5000ms, idle=10000ms
 */
export function resolvePrismaPoolConfig(
    connectionString: string | undefined = process.env.DATABASE_URL,
    nodeEnv: string = process.env.NODE_ENV || "development"
): PrismaConnectionPoolConfig {
    const rawUrl = connectionString || "";
    let qConnLimit: number | undefined;
    let qPoolTimeout: number | undefined;

    if (rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            const connLimitParam = parsed.searchParams.get("connection_limit");
            const poolTimeoutParam = parsed.searchParams.get("pool_timeout");
            if (connLimitParam && !isNaN(Number(connLimitParam))) {
                qConnLimit = Number(connLimitParam);
            }
            if (poolTimeoutParam && !isNaN(Number(poolTimeoutParam))) {
                // pool_timeout in connection string is standardly in seconds; convert to ms
                qPoolTimeout = Number(poolTimeoutParam) * 1000;
            }
        } catch {
            // Non-fatal parse fallback for test strings
        }
    }

    const defaultMax = nodeEnv === "production" ? 5 : 10;
    const max = process.env.PG_POOL_MAX
        ? Number(process.env.PG_POOL_MAX)
        : qConnLimit ?? defaultMax;

    const connectionTimeoutMillis = process.env.PG_POOL_TIMEOUT_MS
        ? Number(process.env.PG_POOL_TIMEOUT_MS)
        : qPoolTimeout ?? 5000;

    const idleTimeoutMillis = process.env.PG_IDLE_TIMEOUT_MS
        ? Number(process.env.PG_IDLE_TIMEOUT_MS)
        : 10000;

    return {
        connectionString: rawUrl,
        max,
        connectionTimeoutMillis,
        idleTimeoutMillis,
    };
}

const poolConfig = resolvePrismaPoolConfig();
const adapter = new PrismaPg(poolConfig);

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}