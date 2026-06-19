import OpenAI from "openai";
import PQueue from "p-queue";

// Only enable LM Studio if LM_STUDIO_URL is explicitly set — avoids spamming
// "unreachable" errors when the bot runs on a remote server without it.
const LM_STUDIO_URL = process.env.LM_STUDIO_URL ?? "";
const client = LM_STUDIO_URL
  ? new OpenAI({ baseURL: LM_STUDIO_URL, apiKey: "lm-studio" })
  : null;

const geminiClient = process.env.GEMINI_API_KEY
  ? new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: process.env.GEMINI_API_KEY,
    })
  : null;

const aiQueue = new PQueue({ concurrency: 1 });
let lastErrorLog = 0;

// Circuit breaker: skip LM Studio after repeated timeouts, retry after 10 min
let lmFailStreak   = 0;
let lmOpenUntil    = 0;
const LM_FAIL_THRESHOLD = 3;
const LM_COOLDOWN_MS    = 10 * 60 * 1000;

const MODEL        = process.env.LM_STUDIO_MODEL || "local-model";
const GEMINI_MODEL = process.env.GEMINI_MODEL    || "gemini-2.0-flash";

export interface AIPromptOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

function sanitize(text: string): string | null {
  // Strip closed thought/thinking blocks, keep text outside them
  const clean = text
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/\*+$/, "")
    .trim();

  if (clean) return clean;

  // Gemma thinking model: thought block consumed all tokens — extract last quoted
  // candidate from inside the thought (the model quotes its chosen response)
  const inner = text.replace(/<\/?thought>/gi, "").replace(/<\/?thinking>/gi, "");
  const quotes = [...inner.matchAll(/"([^"]{8,120})"/g)];
  if (quotes.length) return quotes[quotes.length - 1][1].trim() || null;

  return null;
}

export async function askAI(options: AIPromptOptions): Promise<string | null> {
  return aiQueue.add(async () => {
    const messages: { role: "system" | "user"; content: string }[] = [
      { role: "system", content: options.systemPrompt },
      { role: "user",   content: options.userPrompt   },
    ];

    // Primary: LM Studio — skip if not configured or while circuit is open
    if (client && Date.now() >= lmOpenUntil) {
      try {
        const response = await client.chat.completions.create({
          model: MODEL,
          messages,
          max_tokens: options.maxTokens ?? 40,
          temperature: 0.85,
        }, { signal: AbortSignal.timeout(3_000) });
        lmFailStreak = 0; // success — reset breaker
        return sanitize(response.choices[0]?.message?.content ?? "");
      } catch {
        lmFailStreak++;
        if (lmFailStreak >= LM_FAIL_THRESHOLD) {
          lmOpenUntil = Date.now() + LM_COOLDOWN_MS;
          console.warn(`[AI] LM Studio unreachable ${lmFailStreak}× — bypassing for 10 min`);
          lmFailStreak = 0;
        }
      }
    }

    // Fallback: Gemini — prepend instruction to suppress thought/reasoning tags
    if (geminiClient) {
      const geminiMessages = [
        { role: "system" as const, content: options.systemPrompt },
        { role: "user" as const, content: options.userPrompt },
      ];
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt > 1) await new Promise(r => setTimeout(r, 2000));
          console.log(`[AI] Trying Gemini model: ${GEMINI_MODEL}${attempt > 1 ? ` (retry ${attempt})` : ""}`);
          const response = await geminiClient.chat.completions.create({
            model: GEMINI_MODEL,
            messages: geminiMessages,
            max_tokens: Math.max(options.maxTokens ?? 40, 3000),
            temperature: 0.85,
          });
          const raw = response.choices[0]?.message?.content ?? "";
          console.log(`[AI] Gemini raw response: ${JSON.stringify(raw)}`);
          const result = sanitize(raw);
          console.log(`[AI] Gemini sanitized: ${JSON.stringify(result)}`);
          return result;
        } catch (e: any) {
          const status = e?.status as number | undefined;
          console.error(`[AI] Gemini error status: ${status}, message: ${e?.message}`);
          // Only retry on 5xx (transient server errors); bail immediately on 4xx
          if (!status || status < 500) break;
        }
      }
    }

    const now = Date.now();
    if (now - lastErrorLog > 60_000) {
      console.warn("[AI] LM Studio and Gemini both unreachable — AI narration disabled.");
      lastErrorLog = now;
    }
    return null;
  }) as Promise<string | null>;
}

/**
 * Generate a one-sentence interaction narration.
 * recentMessages: last few things the actor said in chat, used for context.
 */
// Per-action tone hints so the AI doesn't default to "soft and shy" for everything
const ACTION_TONE: Record<string, string> = {
  // Aggressive / impactful
  slap:     "sharp and satisfying — like a decisive smack, not gentle",
  kick:     "powerful and dynamic, legs flying",
  punch:    "hard-hitting and direct, no hesitation",
  bonk:     "comedic and exaggerated — cartoon-style head bonk",
  // Playful / chaotic
  bite:     "sharp and mischievous, with a hint of feral energy",
  poke:     "persistently annoying, playful and teasing",
  lick:     "weird, chaotic, and unhinged — why are they doing this",
  nom:      "goblin energy — chomp first, think later",
  // Warm / tender
  hug:      "warm and enveloping, genuinely comforting",
  cuddle:   "cozy and soft, utterly comfortable",
  pat:      "gentle and affectionate, like a reassuring gesture",
  // Romantic
  kiss:     "tender and intimate, a beat of held breath",
  handhold: "quietly romantic — the small gesture that means everything",
  // Casual / friendly
  highfive: "energetic and triumphant",
  wave:     "casual and cheerful",
  wink:     "sly and confident",
  shrug:    "unbothered and effortlessly cool",
  // Expressive
  dance:    "uninhibited, full of rhythm and joy",
  cry:      "heavy and genuine — tears falling freely",
  blush:    "flustered and embarrassed, cheeks pink",
  smug:     "insufferably self-satisfied",
  angry:    "visibly fuming, a storm behind the eyes",
  happy:    "beaming with uncontained joy",
  cringe:   "physically recoiling in secondhand embarrassment",
  bored:    "completely and thoroughly done with everything",
  nervous:  "fidgeting, pulse quickening",
};

export async function generateInteractionFlavor(
  action: string,
  actorName: string,
  targetName: string | null,
  affinityScore: number,
  recentMessages: string[] = []
): Promise<string> {
  const bonusTone = ACTION_TONE[action] ?? "expressive and in-character";

  // Only include recent chat context if it's meaningful (ignore command spam)
  const contextLine = recentMessages.length > 0
    ? `Context — ${actorName} recently said: "${recentMessages.slice(0, 2).join(" / ")}". Reflect their vibe only if it naturally fits.`
    : "";

  const who = targetName ? `${actorName} ${action}s ${targetName}` : `${actorName} ${action}s`;

  const result = await askAI({
    systemPrompt: `You write ONE short sentence of anime-style narration for a Discord RPG action. Tone for this action: ${bonusTone}. Match the energy — don't soften aggressive actions or exaggerate gentle ones. No quotes. No emojis. Under 15 words.`,
    userPrompt: `${who}. ${contextLine}`.trim(),
    maxTokens: 40,
  });

  // Fallback lines if AI is offline
  const fallbacks: Record<string, string[]> = {
    pat:      [`${actorName} gently pats ${targetName ?? "the air"}.`, `A soft pat lands on ${targetName ?? "nobody in particular"}.`],
    hug:      [`${actorName} pulls ${targetName ?? "themselves"} into a warm hug.`, `Arms wrap around ${targetName ?? "the void"} tightly.`],
    kiss:     [`${actorName} steals a quick kiss from ${targetName ?? "the wind"}.`],
    slap:     [`${actorName} delivers a decisive slap to ${targetName ?? "thin air"}.`],
    bite:     [`${actorName} bites down on ${targetName ?? "nothing"} with surprising force.`],
    poke:     [`${actorName} pokes ${targetName ?? "the void"} persistently.`],
    cuddle:   [`${actorName} cuddles up close to ${targetName ?? "a pillow"}.`],
    handhold: [`${actorName} quietly reaches for ${targetName ?? "someone's"} hand.`],
    bonk:     [`${actorName} delivers a decisive bonk to ${targetName ?? "thin air"}.`, `A legendary bonk lands squarely on ${targetName ?? "an unsuspecting head"}.`],
    highfive: [`${actorName} throws out a hand for a high five with ${targetName ?? "the void"}.`],
    lick:     [`${actorName} licks ${targetName ?? "something questionable"} without warning.`],
    kick:     [`${actorName} lands a powerful kick on ${targetName ?? "thin air"}.`],
    punch:    [`${actorName} lands a clean punch on ${targetName ?? "the open air"}.`],
    dance:    [`${actorName} breaks into an impromptu dance.`],
    cry:      [`${actorName} lets out a quiet sob.`],
    wink:     [`${actorName} flashes a sly wink.`],
    shrug:    [`${actorName} shrugs with absolute indifference.`],
    default:  [`${actorName} ${action}s with full commitment.`],
  };

  if (result) return result;
  const pool = fallbacks[action] ?? fallbacks.default;
  return pool[Math.floor(Math.random() * pool.length)];
}

export { aiQueue };
