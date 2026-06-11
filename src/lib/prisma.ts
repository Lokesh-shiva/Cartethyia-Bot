import { PrismaClient } from "@prisma/client";
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

  // Retry failed queries up to 3× with backoff (handles Neon cold-start ETIMEDOUT)
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          let lastErr: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              return await query(args);
            } catch (err: any) {
              lastErr = err;
              const retryable = err?.code === "ETIMEDOUT" || err?.code === "ECONNRESET" || err?.code === "ENOTFOUND";
              if (!retryable || attempt === 2) throw err;
              await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
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
