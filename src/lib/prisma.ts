import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";

// Neon serverless requires a WebSocket constructor in Node environments
neonConfig.webSocketConstructor = ws;

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set in .env");

  const adapter = new PrismaNeon({ connectionString });

  const client = new PrismaClient({ adapter, log: ["error", "warn"] });

  // Retry transient connection errors up to 3× with backoff (Neon cold-start)
  // Only skip retry for definitive business-logic errors (validation, constraint, not-found).
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          let lastErr: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              return await query(args);
            } catch (err: any) {
              lastErr = err;
              // Don't retry known Prisma query errors (wrong args, constraint violations, etc.)
              const isQueryError = err instanceof Prisma.PrismaClientKnownRequestError
                || err instanceof Prisma.PrismaClientValidationError;
              if (isQueryError || attempt === 2) throw err;
              await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
            }
          }
          throw lastErr;
        },
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
