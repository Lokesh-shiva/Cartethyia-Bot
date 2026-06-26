import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Retry only true connection-level transient errors.
// Never retry query/validation errors — they'll fail identically every time.
const MAX_ATTEMPTS = 3;

function describeErr(err: any): string {
  return err?.code
    ?? err?.cause?.code
    ?? err?.message
    ?? err?.cause?.message
    ?? err?.name
    ?? (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
}

function isTransient(err: any): boolean {
  const code: string = err?.code ?? err?.cause?.code ?? "";
  const msg:  string = (err?.message ?? err?.cause?.message ?? "").toLowerCase();
  return (
    ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "EPIPE"].includes(code) ||
    msg.includes("connection") || msg.includes("timeout") || msg.includes("socket")
  );
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
      if (isQueryError || !isTransient(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      console.warn(`[Prisma] transient error (attempt ${attempt + 1}/${MAX_ATTEMPTS}), retrying: ${describeErr(err)}`);
      await new Promise(r => setTimeout(r, attempt === 0 ? 150 : 400));
    }
  }
  throw lastErr;
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in .env");

  const pool    = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);

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
