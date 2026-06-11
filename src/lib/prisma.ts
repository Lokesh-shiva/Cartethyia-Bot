import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon serverless requires a WebSocket constructor in Node environments
neonConfig.webSocketConstructor = ws;

// Retry transient connection errors up to 3× with backoff (Neon cold-start,
// dropped WebSocket). Skip retry for definitive query errors (validation,
// constraint violations) — those will fail identically every time.
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run();
    } catch (err: any) {
      lastErr = err;
      const isQueryError = err instanceof Prisma.PrismaClientKnownRequestError
        || err instanceof Prisma.PrismaClientValidationError;
      if (isQueryError || attempt === 2) throw err;
      console.warn(`[Prisma] transient error (attempt ${attempt + 1}/3), retrying:`, err?.message ?? err?.code ?? err);
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in .env");

  const adapter = new PrismaNeon({ connectionString });

  // Event-based logging so we see the REAL error message instead of
  // "prisma:error undefined" (stdout logging prints e.message, which the
  // Neon adapter doesn't always populate).
  const client = new PrismaClient({
    adapter,
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
  });

  client.$on("error", (e: any) => {
    console.error("[Prisma:error]", e?.message || e?.target || JSON.stringify(e));
  });
  client.$on("warn", (e: any) => {
    console.warn("[Prisma:warn]", e?.message || JSON.stringify(e));
  });

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return withRetry(() => query(args));
        },
      },
      async $queryRaw({ args, query }) {
        return withRetry(() => query(args));
      },
      async $executeRaw({ args, query }) {
        return withRetry(() => query(args));
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
