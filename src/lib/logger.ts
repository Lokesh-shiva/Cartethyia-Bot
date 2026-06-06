import fs   from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), "logs");

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────
function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

function todayFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `${date}.txt`);
}

function write(lines: string[]): void {
  const block = lines.join("\n") + "\n\n";
  try {
    fs.appendFileSync(todayFile(), block, "utf8");
  } catch {
    // If we can't write the log file, at least don't crash the bot
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export interface ErrorContext {
  source:  string;   // e.g. "command /vibe", "event messageCreate", "process"
  userId?: string;
  guild?:  string;
  extra?:  string;   // any additional detail
}

export function logError(err: unknown, ctx: ErrorContext): void {
  const msg   = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : "(no stack)";

  const lines = [
    `[${timestamp()}]  ERROR  ·  ${ctx.source}`,
    `${"─".repeat(60)}`,
    `Message : ${msg}`,
    ctx.userId ? `User    : ${ctx.userId}` : null,
    ctx.guild  ? `Guild   : ${ctx.guild}`  : null,
    ctx.extra  ? `Detail  : ${ctx.extra}`  : null,
    `Stack:\n${stack}`,
  ].filter(Boolean) as string[];

  write(lines);
  // Mirror to terminal so the console still shows it during dev
  console.error(`[ERROR] ${ctx.source} — ${msg}`);
}

export function logInfo(message: string): void {
  write([`[${timestamp()}]  INFO   ·  ${message}`]);
}

export function logWarn(message: string): void {
  write([`[${timestamp()}]  WARN   ·  ${message}`]);
  console.warn(`[WARN] ${message}`);
}

// ── Process-level safety net ──────────────────────────────────────────────────
export function attachProcessHandlers(): void {
  process.on("uncaughtException", (err) => {
    logError(err, { source: "process · uncaughtException" });
    // Give the write time to flush, then exit — uncaught exceptions leave
    // the process in an undefined state
    setTimeout(() => process.exit(1), 500);
  });

  process.on("unhandledRejection", (reason) => {
    // 10062 = Unknown Interaction — expected when Discord tokens expire
    // 10008 = Unknown Message — expected when messages are deleted mid-edit
    // 40060 = Interaction already acknowledged — harmless race condition
    const code = (reason as any)?.code;
    if (code === 10062 || code === 10008 || code === 40060) return;
    logError(reason, { source: "process · unhandledRejection" });
  });

  // Intercept console.error so anything logged via it also hits the file
  const _originalError = console.error.bind(console);
  console.error = (...args: any[]) => {
    _originalError(...args);
    const text = args
      .map(a => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : String(a)))
      .join(" ");
    write([`[${timestamp()}]  CONSOLE.ERROR\n${"─".repeat(60)}\n${text}`]);
  };

  const _originalWarn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    _originalWarn(...args);
    const text = args.map(a => String(a)).join(" ");
    write([`[${timestamp()}]  CONSOLE.WARN\n${"─".repeat(60)}\n${text}`]);
  };
}
