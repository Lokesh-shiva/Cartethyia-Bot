import OpenAI from "openai";
import PQueue from "p-queue";

const client = new OpenAI({
  baseURL: process.env.LM_STUDIO_URL || "http://localhost:1234/v1",
  apiKey: "lm-studio",
});

const aiQueue = new PQueue({ concurrency: 1 });
let lastErrorLog = 0;

const MODEL = process.env.LM_STUDIO_MODEL || "local-model";

export interface AIPromptOptions {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export async function askAI(options: AIPromptOptions): Promise<string | null> {
  return aiQueue.add(async () => {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user",   content: options.userPrompt   },
        ],
        max_tokens: options.maxTokens ?? 40,
        temperature: 0.85,
      });
      return response.choices[0]?.message?.content?.trim() ?? null;
    } catch {
      const now = Date.now();
      if (now - lastErrorLog > 60_000) {
        console.warn("[AI] LM Studio unreachable — AI narration disabled until it starts.");
        lastErrorLog = now;
      }
      return null;
    }
  }) as Promise<string | null>;
}

/**
 * Generate a one-sentence interaction narration.
 * recentMessages: last few things the actor said in chat, used for context.
 */
export async function generateInteractionFlavor(
  action: string,
  actorName: string,
  targetName: string | null,
  affinityScore: number,
  recentMessages: string[] = []
): Promise<string> {
  const tone =
    affinityScore > 500 ? "playful and close"
    : affinityScore > 100 ? "friendly"
    : "a little shy";

  // Summarise recent chat so the AI can reflect it in the narration
  const contextLine = recentMessages.length > 0
    ? `Recently ${actorName} said: "${recentMessages.slice(0, 3).join(" / ")}". Subtly reflect their mood if it fits.`
    : "";

  const who = targetName ? `${actorName} ${action}s ${targetName}` : `${actorName} ${action}s`;

  const result = await askAI({
    systemPrompt: `You write ONE short sentence of anime-style narration for a Discord RPG. Tone: ${tone}. No quotes. No emojis. Under 15 words.`,
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
