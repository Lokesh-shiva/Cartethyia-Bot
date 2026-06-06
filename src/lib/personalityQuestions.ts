import { askAI } from "./ai";

export interface PersonalityQuestion {
  id:      string;
  text:    string;
  trait:   string;
  options: { label: string; value: string; trait: string }[];
}

// ── Fallback questions if AI is offline ───────────────────────────────────────
const FALLBACK_QUESTIONS: PersonalityQuestion[] = [
  {
    id: "q1", text: "It's 3AM and you can't sleep. You:", trait: "inner nature",
    options: [
      { label: "Scroll through conversations from today",  value: "A", trait: "social"      },
      { label: "Plan tomorrow obsessively",                value: "B", trait: "disciplined"  },
      { label: "Go outside and look at the sky",           value: "C", trait: "wanderer"     },
      { label: "Create something — art, music, anything", value: "D", trait: "creative"     },
    ],
  },
  {
    id: "q2", text: "Someone you dislike genuinely needs help. You:", trait: "moral compass",
    options: [
      { label: "Help them without hesitation",     value: "A", trait: "selfless"    },
      { label: "Help, but make sure they know it", value: "B", trait: "proud"       },
      { label: "Point them to someone else",        value: "C", trait: "calculated" },
      { label: "Let them figure it out",            value: "D", trait: "detached"   },
    ],
  },
  {
    id: "q3", text: "Your greatest weapon is:", trait: "combat philosophy",
    options: [
      { label: "The people who trust you",             value: "A", trait: "support"     },
      { label: "Knowing exactly when to strike",       value: "B", trait: "tactical"    },
      { label: "The fact that nobody sees you coming", value: "C", trait: "stealth"     },
      { label: "Never needing anyone at all",          value: "D", trait: "independent" },
    ],
  },
  {
    id: "q4", text: "What do you leave behind?", trait: "legacy",
    options: [
      { label: "Warmth people can't explain", value: "A", trait: "nurturing"  },
      { label: "A reputation",                value: "B", trait: "ambitious"  },
      { label: "Questions",                   value: "C", trait: "mysterious" },
      { label: "Nothing — that's the point", value: "D", trait: "nihilistic" },
    ],
  },
];

// ── Parse AI response into structured questions ───────────────────────────────
function parseAIQuestions(raw: string): PersonalityQuestion[] | null {
  try {
    const blocks = raw.split(/---+/).map((b) => b.trim()).filter(Boolean);
    if (blocks.length < 3) return null;

    const questions: PersonalityQuestion[] = [];

    for (let i = 0; i < Math.min(blocks.length, 4); i++) {
      const block = blocks[i];
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

      // Find Q: line
      const qLine = lines.find((l) => l.startsWith("Q:"));
      if (!qLine) return null;
      const text = qLine.replace(/^Q:\s*/, "").trim();

      // Find A: B: C: D: lines
      const opts = ["A", "B", "C", "D"].map((v) => {
        const line = lines.find((l) => l.startsWith(`${v}:`));
        return line ? line.replace(`${v}:`, "").trim() : null;
      });

      if (opts.some((o) => !o)) return null;

      questions.push({
        id:    `q${i + 1}`,
        text:  text.slice(0, 256),   // embed title limit
        trait: "personality",
        options: opts.map((label, idx) => ({
          label:  label!.slice(0, 80),   // Discord button label limit
          value:  ["A", "B", "C", "D"][idx],
          trait:  ["reflective", "driven", "free", "creative"][idx],
        })),
      });
    }

    return questions.length >= 3 ? questions : null;
  } catch {
    return null;
  }
}

// ── Generate questions via AI, fall back if offline ───────────────────────────
export async function generateOnboardingQuestions(): Promise<PersonalityQuestion[]> {
  const raw = await askAI({
    systemPrompt: `You write personality quiz questions for an anime RPG onboarding.
Questions must be deep, human, and reveal character — NOT about games or combat.
Think introspection, relationships, values, identity.
Keep each option under 10 words. Be original every time.`,

    userPrompt: `Generate exactly 4 personality questions.
Use EXACTLY this format (--- separates questions):

Q: [thought-provoking scenario or question about who they are]
A: [option 1]
B: [option 2]
C: [option 3]
D: [option 4]
---
Q: [next question]
A: [option 1]
B: [option 2]
C: [option 3]
D: [option 4]
---
Q: [next question]
A: [option 1]
B: [option 2]
C: [option 3]
D: [option 4]
---
Q: [next question]
A: [option 1]
B: [option 2]
C: [option 3]
D: [option 4]`,

    maxTokens: 500,
  });

  if (!raw) {
    console.log("[Onboarding] AI offline — using fallback questions.");
    return FALLBACK_QUESTIONS;
  }

  const parsed = parseAIQuestions(raw);
  if (!parsed) {
    console.log("[Onboarding] AI response malformed — using fallback questions.");
    console.log("[Onboarding] Raw AI response:", raw);
    return FALLBACK_QUESTIONS;
  }

  console.log(`[Onboarding] AI generated ${parsed.length} questions successfully.`);
  return parsed;
}

export interface ResonanceProfile {
  // Onboarding answers
  answers: Record<string, { value: string; trait: string }>;

  // Playstyle (filled silently during levels 1-20)
  dominantVibe:    "physical" | "expressive" | "emotional" | "mixed";
  isSocial:        boolean;  // interacted with many different people
  isConsistent:    boolean;  // maintained daily streak
  topAffinityElement: string | null;

  // Chosen element (set at level 20)
  element: string;
}

/**
 * Build the AI prompt for unique ability generation.
 * Called at Ascension after all data is collected.
 */
export function buildAbilityPrompt(profile: ResonanceProfile): string {
  const answers = Object.values(profile.answers).map((a) => a.trait).join(", ");

  return `You design unique passive abilities for an anime RPG called Cartethyia.

Player profile:
- Personality traits: ${answers}
- Combat style: ${profile.dominantVibe} interactions (${profile.isSocial ? "social, many allies" : "focused, few close bonds"})
- Discipline: ${profile.isConsistent ? "consistent daily player" : "irregular, chaotic energy"}
- Element: ${profile.element}
- Bond affinity: ${profile.topAffinityElement ? `strong connection with ${profile.topAffinityElement} users` : "no strong bonds yet"}

Generate ONE unique passive ability. Respond in exactly this format:
NAME: [2-3 word ability name, lore-sounding, unique]
EFFECT: [one sentence mechanical effect, specific numbers, fits their playstyle]
LORE: [one sentence flavor text, poetic, matches their personality]`;
}
