import {
  EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, GuildMember, TextChannel,
  ComponentType, ButtonInteraction, AttachmentBuilder,
} from "discord.js";
import { getOrCreateUser, awardUser } from "./economy";
import { generateOnboardingQuestions, PersonalityQuestion } from "./personalityQuestions";
import { generateWelcomeCard } from "./welcomeCard";
import prisma from "./prisma";

// ── Colours ───────────────────────────────────────────────────────────────────
const C = {
  primary:  0x6366F1,
  fusion:   0xFF6B35,
  glacio:   0x4FC3F7,
  electro:  0xB39DDB,
  aero:     0x80CBC4,
  havoc:    0x9C27B0,
  spectro:  0xFFD54F,
  gold:     0xF5A623,
  dark:     0x1E1F2E,
  green:    0x4CAF50,
  red:      0xFF4F6D,
};

// Guide content moved to src/lib/guide.ts — surfaced via the /guide command.

// ── Personality question ──────────────────────────────────────────────────────
async function askQuestion(
  channel: TextChannel,
  userId:  string,
  q:       PersonalityQuestion,
  qIndex:  number,
  total:   number,
): Promise<{ value: string; trait: string } | null> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    q.options.map(o =>
      new ButtonBuilder()
        .setCustomId(`onboard_q_${q.id}_${o.value}`)
        .setLabel(o.label)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const embed = new EmbedBuilder()
    .setColor(C.primary)
    .setAuthor({ name: `Resonance Calibration  ·  ${qIndex + 1} of ${total}` })
    .setDescription(`## ${q.text}`)
    .setFooter({ text: "CARTETHYIA  ·  Your answers shape your unique ability at Ascension." });

  const msg = await channel.send({ embeds: [embed], components: [row] });

  return new Promise((resolve) => {
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      filter: b => b.user.id === userId && b.customId.startsWith(`onboard_q_${q.id}_`),
      time:   5 * 60 * 1000,
      max:    1,
    });

    collector.on("collect", async (btn: ButtonInteraction) => {
      await btn.deferUpdate();
      const chosen = q.options.find(o => `onboard_q_${q.id}_${o.value}` === btn.customId)!;
      const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        q.options.map(o =>
          new ButtonBuilder()
            .setCustomId(`done_${o.value}`)
            .setLabel(o.label)
            .setStyle(o.value === chosen.value ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(true)
        )
      );
      await msg.edit({ components: [doneRow] });
      resolve({ value: chosen.value, trait: chosen.trait });
    });

    collector.on("end", (_, reason) => {
      if (reason === "time") resolve(null);
    });
  });
}

// ── Main onboarding flow ──────────────────────────────────────────────────────
export async function sendOnboarding(member: GuildMember, channel: TextChannel) {
  const displayName = member.displayName;
  const avatarUrl   = member.user.displayAvatarURL({ size: 256, extension: "png" });

  const user        = await getOrCreateUser(member.id, displayName, avatarUrl);
  const isFirstTime = !user.isOnboarded;

  // ── 1. Dramatic welcome ───────────────────────────────────────────────────
  // Visual welcome banner (canvas)
  const welcomeCard = await generateWelcomeCard(displayName, avatarUrl, isFirstTime);
  const welcomeAttach = new AttachmentBuilder(welcomeCard, { name: "welcome.png" });

  await channel.send({
    content: `<@${member.id}>`,
    files: [welcomeAttach],
    embeds: [new EmbedBuilder()
      .setColor(C.primary)
      .setImage("attachment://welcome.png")
      .setDescription(
        `**CARTETHYIA** is a social RPG where **interaction is power**.\n` +
        `Here's the loop:\n\n` +
        `◈  **Chat** → Resonance EXP → Level up\n` +
        `◈  **Fight echoes** that spawn while chatting → build your power\n` +
        `◈  **/vibe** & **/bond** → materials + relationships\n` +
        `◈  **/dungeon · /duel · /raid · /ascend** → combat & progression\n\n` +
        `📖  Run **/guide** anytime for the full tutorial.`
      )
      .setFooter({ text: "CARTETHYIA  ·  Resonance System" })],
  });

  if (isFirstTime) {
    await awardUser(member.id, { credits: 500, tuningModules: 3, resonanceRecords: 5 });
  }

  await new Promise(r => setTimeout(r, 1500));

  // ── Already onboarded — skip questions, just point to /guide ───────────────
  if (!isFirstTime) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(C.primary)
        .setTitle("✦  Already Calibrated")
        .setDescription(
          `Your resonance signature is already on record — no need to redo the questions.\n\n` +
          `📖  Run **/guide** anytime for the full tutorial on every system.`
        )
        .addFields({
          name:  "Quick command reference:",
          value: [
            `\`/daily\` · \`/vibe\` · \`/dispatch send\` · \`/profile\``,
            `\`/echoes\` · \`/echo-equip\` · \`/echo-upgrade\` · \`/echo-reveal\` · \`/echo-reroll\``,
            `\`/dungeon\` · \`/duel\` · \`/shop\` · \`/leaderboard\` · \`/ascend\``,
          ].join("\n"),
        })
        .setFooter({ text: "CARTETHYIA  ·  Welcome back." })],
    });
    return;
  }

  // ── 3. Personality calibration intro (first time only) ───────────────────
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("◈  Resonance Calibration")
      .setDescription(
        `Now — **4 questions** to calibrate your resonance signature.\n\n` +
        `Your answers are stored in your **Resonance Profile** and feed directly into the AI ` +
        `that generates your **unique passive ability** when you win your first Ascension Trial.\n\n` +
        `Every player's ability is different. These answers are part of what makes yours yours.\n\n` +
        `*There are no right answers.*`
      )
      .setFooter({ text: "CARTETHYIA  ·  Resonance Calibration  ·  You have 5 minutes per question." })],
  });

  await new Promise(r => setTimeout(r, 1500));

  // ── 4. Questions ──────────────────────────────────────────────────────────
  const questions = await generateOnboardingQuestions();
  const answers: Record<string, { value: string; trait: string }> = {};

  for (let i = 0; i < questions.length; i++) {
    const q      = questions[i];
    const answer = await askQuestion(channel, member.id, q, i, questions.length);
    if (!answer) break;
    answers[q.id] = answer;
    if (i < questions.length - 1) await new Promise(r => setTimeout(r, 800));
  }

  // ── 5. Save profile ───────────────────────────────────────────────────────
  const answered = Object.keys(answers).length;
  const total    = questions.length;

  await prisma.user.update({
    where: { id: member.id },
    data:  {
      // Only mark fully onboarded if all questions were answered —
      // partial/timeout lets them restart with /start
      isOnboarded:      answered === total,
      resonanceProfile: {
        answers,
        dominantVibe:       "mixed",
        isSocial:           false,
        isConsistent:       false,
        topAffinityElement: null,
        element:            "NONE",
      },
    },
  });

  // ── 6. First steps closing ────────────────────────────────────────────────

  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(C.primary)
      .setTitle("✦  Resonance Calibrated — You're Ready")
      .setDescription(
        (answered === total
          ? `Your personality has been recorded. It will shape a **unique passive ability** generated just for you at Ascension.`
          : `Partial calibration saved. Run \`/start\` anytime to redo it — questions won't repeat.`)
        + `\n\n📖  **New to the game? Run \`/guide\`** for a full tutorial on every system.`
      )
      .addFields(
        {
          name:  "First steps — do these now:",
          value: [
            `**1.** \`/daily\` — claim your first daily reward right now`,
            `**2.** Chat anywhere — every message earns Resonance EXP toward your next level`,
            `**3.** Watch for **⚔ Fight** buttons — enemies spawn while you chat, defeat them to collect Echoes`,
            `**4.** \`/vibe pat @someone\` — earn Tuning Modules + build Affinity with your first interaction`,
            `**5.** \`/dungeon\` — fight 3-wave runs for echoes and materials`,
            `**6.** \`/profile\` — see your character card`,
          ].join("\n"),
        },
        {
          name:  "When you hit Level 20:",
          value: [
            `› \`/element\` will trigger automatically — choose your element (permanent)`,
            `› Then \`/ascend\` to fight your first boss and break your level cap`,
            `› Win and your **unique passive ability** is generated — no two are the same`,
          ].join("\n"),
        },
        {
          name:  "Useful commands to know:",
          value: [
            `**Build:**`,
            `\`/echoes\` — grid card + set bonuses  ·  \`/echo\` — view an echo card`,
            `\`/echo-equip\` · \`/echo-upgrade\` · \`/echo-reveal\` · \`/echo-reroll\``,
            `\`/forge\` · \`/equip\` · \`/weapon\` · \`/weapon-upgrade\``,
            `\`/dungeon\` — 14 dungeons (echo + material + boss trials)`,
            ``,
            `**Combat:**`,
            `\`/duel @player\` — 1v1 PvP  ·  \`/ascend\` — boss trial`,
            `\`/raid start\` — server co-op boss (needs Manage Server)`,
            ``,
            `**Economy & Social:**`,
            `\`/shop\` · \`/leaderboard\` · \`/inventory\` · \`/daily\` · \`/dispatch send\``,
            `\`/vibe [action] @someone\` · \`/affinity @user\` · \`/bond create\` · \`/profile\``,
            ``,
            `📖  Full tutorial anytime: **/guide**`,
          ].join("\n"),
        },
      )
      .setFooter({ text: "CARTETHYIA  ·  The world is watching." })],
  });
}
