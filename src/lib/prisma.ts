import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon serverless requires a WebSocket constructor in Node environments
neonConfig.webSocketConstructor = ws;

// Retry transient connection errors up to 3× with backoff (Neon cold-start,
// dropped WebSocket). Skip retry for definitive query errors (validation,
// constraint violations) — those will fail identically every time.
const MAX_ATTEMPTS = 5;

// Neon/pg errors bury the real reason in nested fields — surface whatever we can.
function describeErr(err: any): string {
  return err?.code
    ?? err?.cause?.code
    ?? err?.message
    ?? err?.cause?.message
    ?? err?.name
    ?? (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (err: any) {
      lastErr = err;
      const isQueryError = err instanceof Prisma.PrismaClientKnownRequestError
        || err instanceof Prisma.PrismaClientValidationError;
      if (isQueryError || attempt === MAX_ATTEMPTS - 1) throw err;
      console.warn(`[Prisma] transient error (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying: ${describeErr(err)}`);
      // Backoff: 0.4s, 0.8s, 1.6s, 3.2s — gives Neon time to wake from suspend
      await new Promise(r => setTimeout(r, 400 * Math.pow(2, attempt)));
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
    console.error("[Prisma:error]", e?.message || e?.target || describeErr(e));
  });
  client.$on("warn", (e: any) => {
    console.warn("[Prisma:warn]", e?.message || describeErr(e));
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
