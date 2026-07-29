import {
  SlashCommandBuilder, ChatInputCommandInteraction,
  AttachmentBuilder, EmbedBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction,
  ComponentType,
} from "discord.js";
import { Command } from "../../types";
import { getOrCreateUser } from "../../lib/economy";
import { generateProfileCard, BondData, EchoSlotData, WeaponData } from "../../lib/canvas";
import { resolvePlayerBonuses, applyBonuses } from "../../lib/setBonus";
import { computeAura, getMaxAura } from "../../lib/aura";
import { communityFooter } from "../../lib/communityFooter";
import { mailNudge } from "../../lib/mailNudge";
import prisma from "../../lib/prisma";
import { CHARACTER_KITS } from "../../lib/characterKit";
import { ELEMENT_COLORS } from "../../lib/echoes";
import "../../lib/kits";
import path from "path";
import fs from "fs";

const command: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View your Cartethyia character profile card.")
    .addUserOption(opt =>
      opt.setName("user").setDescription("View another player's profile.").setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const target  = interaction.options.getUser("user") ?? interaction.user;
    const member  = interaction.guild?.members.cache.get(target.id)
                 ?? await interaction.guild?.members.fetch(target.id).catch(() => null);
    const displayName = member?.displayName ?? target.displayName ?? target.username;
    const avatarUrl   = target.displayAvatarURL({ size: 256, extension: "png" });

    const user     = await getOrCreateUser(target.id, displayName, avatarUrl);
    const auraState = computeAura(user.resonanceAura ?? 5, user.auraUpdatedAt ?? new Date(), getMaxAura((user as any).patronTier ?? 0));

    // ── Bonds (sorted by synchrony score descending) ────────────────────────
    const allRawBonds = await prisma.bond.findMany({
      where: { OR: [{ initiatorId: user.id }, { receiverId: user.id }] },
    });
    const totalBonds = allRawBonds.length;

    const partnerIds = allRawBonds.map(b =>
      b.initiatorId === user.id ? b.receiverId : b.initiatorId
    );

    const partnerUsers = await prisma.user.findMany({
      where:  { id: { in: partnerIds } },
      select: { id: true, username: true, avatarUrl: true },
    });

    // Fetch synchrony scores for sorting
    const affinities = await prisma.affinity.findMany({
      where: {
        OR: partnerIds.map(pid => {
          const [a, b] = [user.id, pid].sort();
          return { userAId: a, userBId: b };
        }),
      },
      select: { userAId: true, userBId: true, score: true },
    });

    const getScore = (partnerId: string) => {
      const [a, b] = [user.id, partnerId].sort();
      return affinities.find(af => af.userAId === a && af.userBId === b)?.score ?? 0;
    };

    const sortedBonds = [...allRawBonds].sort((a, b) => {
      const pA = a.initiatorId === user.id ? a.receiverId : a.initiatorId;
      const pB = b.initiatorId === user.id ? b.receiverId : b.initiatorId;
      return getScore(pB) - getScore(pA);
    });

    const bonds: BondData[] = sortedBonds.slice(0, 3).map(b => {
      const partnerId = b.initiatorId === user.id ? b.receiverId : b.initiatorId;
      const pu        = partnerUsers.find(p => p.id === partnerId);
      const gMember   = interaction.guild?.members.cache.get(partnerId);
      return {
        displayName: gMember?.displayName ?? pu?.username ?? "Unknown",
        avatarUrl:   pu?.avatarUrl ?? null,
        bondType:    b.bondType,
      };
    });

    // ── Equipped echoes ─────────────────────────────────────────────────────
    const rawEchoes = await prisma.echo.findMany({
      where:  { userId: user.id, isEquipped: true },
      select: { name: true, element: true, rarity: true, cost: true, level: true, equippedSlot: true },
    });

    const echoes: EchoSlotData[] = rawEchoes
      .filter(e => e.equippedSlot !== null)
      .map(e => ({
        name:    e.name,
        element: e.element,
        rarity:  e.rarity,
        cost:    e.cost,
        level:   e.level,
        slot:    e.equippedSlot!,
      }));

    // ── Equipped weapon ─────────────────────────────────────────────────────
    const rawWeapon = await prisma.weapon.findFirst({
      where:  { userId: user.id, isEquipped: true },
      select: { name: true, weaponType: true, rarity: true, baseAtk: true, level: true, awakened: true, awakenedName: true, weaponBond: true },
    });

    const weapon: WeaponData | null = rawWeapon
      ? { name: rawWeapon.name, weaponType: rawWeapon.weaponType, rarity: rawWeapon.rarity, baseAtk: rawWeapon.baseAtk, level: rawWeapon.level, awakened: rawWeapon.awakened, awakenedName: rawWeapon.awakenedName, weaponBond: rawWeapon.weaponBond }
      : null;

    // ── Resolve combat stats (echoes + weapon + set bonuses + ability) ──────
    const bonuses = await resolvePlayerBonuses(target.id);
    const stats   = applyBonuses(user, bonuses);

    // Show only the ONE character the player has chosen to display (not
    // every owned character) so the card doesn't clutter as the roster
    // grows. This is a standalone preference (profileDisplayCharacterId),
    // independent of /team's combat-ally slot — /team is headed toward a
    // multi-character roster later, and coupling profile display to "the"
    // team ally wouldn't survive that. Falls back to the team ally for
    // players who set one before this preference existed.
    const prefRow = await prisma.user.findUnique({
      where:  { id: target.id },
      select: { profileDisplayCharacterId: true, teamAllyCharacterId: true },
    });
    const rawDisplayId = prefRow?.profileDisplayCharacterId ?? prefRow?.teamAllyCharacterId ?? null;
    const displayCharacterId = rawDisplayId && CHARACTER_KITS[rawDisplayId] ? rawDisplayId : null;
    const displayProgress = displayCharacterId
      ? await prisma.characterProgress.findUnique({
          where: { userId_characterId: { userId: target.id, characterId: displayCharacterId } },
          select: { level: true },
        })
      : null;
    const displayKit = displayCharacterId ? CHARACTER_KITS[displayCharacterId] : null;
    // Prefer a dedicated "<Name>_icon.png" crop for the small badge tile —
    // falls back to the full portrait (cover-fit clipped into the tile
    // already) if no icon variant has been drawn yet for this character.
    const displayIconPath = (() => {
      if (!displayKit) return null;
      const ext = path.extname(displayKit.portraitPath);
      const iconCandidate = displayKit.portraitPath.slice(0, -ext.length) + "_icon" + ext;
      return fs.existsSync(path.join(process.cwd(), iconCandidate)) ? iconCandidate : displayKit.portraitPath;
    })();
    const displayCharacter = displayProgress && displayKit
      ? {
          label: displayKit.label,
          level: displayProgress.level,
          portraitPath: displayIconPath!,
          color: "#" + ELEMENT_COLORS[displayKit.element as keyof typeof ELEMENT_COLORS].toString(16).padStart(6, "0"),
        }
      : null;

    // ── Generate card ───────────────────────────────────────────────────────
    const buffer = await generateProfileCard({
      id:              user.id,
      username:        user.username,
      avatarUrl,
      element:         user.element,
      level:           user.level,
      worldLevel:      user.worldLevel,
      resonanceExp:    user.resonanceExp,
      baseHp:          stats.hp,
      baseAtk:         stats.atk,
      baseDef:         stats.def,
      baseSpeed:       stats.spd,
      critRate:        stats.critRate,
      critDmg:         stats.critDmg,
      credits:         user.credits,
      lunakite:        user.lunakite,
      paradoxCores:    user.paradoxCores,
      resonanceAura:     auraState.current,
      auraMax:           auraState.max,
      auraNextRegenMs:   auraState.nextRegenMs,
      uniqueAbilityName: user.uniqueAbilityName,
      patronTier:        (user as any).patronTier ?? 0,
      displayCharacter: displayCharacter ?? undefined,
      displayName,
      bonds,
      echoes,
      weapon,
    });

    const attachment = new AttachmentBuilder(buffer, { name: "profile.webp" });
    const extraBonds = totalBonds > 3 ? `  ·  +${totalBonds - 3} more bond${totalBonds - 3 !== 1 ? "s" : ""} — use /bonds` : "";
    const PATRON_TIER_NAMES: Record<number, string> = { 1: "Attuned", 2: "Ascendant", 3: "Calamity" };
    const patronTitle = (user as any).patronTier ? `  ·  ✦ ${PATRON_TIER_NAMES[(user as any).patronTier]} Patron` : "";
    const solaceBadge = displayCharacter ? `  ·  ${displayKit?.emoji ?? "◈"} ${displayCharacter.label} (Lv${displayCharacter.level})` : "";

    // Only nudge for own profile (not when viewing others)
    const nudge = target.id === interaction.user.id
      ? await mailNudge(interaction.user.id, (user as any).createdAt as Date)
      : "";

    const embed = new EmbedBuilder()
      .setColor(0x0D1117)
      .setDescription(
        `-# [Vote on top.gg](https://top.gg/bot/1510163339177623642/vote) · [Vote on DBL](https://discordbotlist.com/bots/cartethyia/upvote) · [Vote on rank.top](https://rank.top/bot/cartethyia) · [Join community](https://discord.gg/vgVmRMc2Gb)` +
        nudge
      )
      .setImage("attachment://profile.webp")
      .setFooter({ text: `CARTETHYIA  ·  ${displayName}'s Profile${patronTitle}${solaceBadge}${extraBonds}`, iconURL: avatarUrl });

    // Own-profile view gets a picker to change which owned character's badge
    // shows — independent of /team's combat-ally selection.
    let components: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
    let ownedIds: string[] = [];
    if (target.id === interaction.user.id) {
      const ownedProgress = await prisma.characterProgress.findMany({
        where:  { userId: interaction.user.id },
        select: { characterId: true },
      });
      ownedIds = ownedProgress.map(p => p.characterId).filter(id => CHARACTER_KITS[id] !== undefined);
      if (ownedIds.length > 0) {
        const options = [
          { label: "None — no badge", description: "Don't show any character on your profile", value: "none", emoji: "🚫" },
          ...ownedIds.map(id => {
            const kit = CHARACTER_KITS[id];
            return { label: kit.label, description: `Show ${kit.label} on your profile card`, value: id, emoji: kit.emoji };
          }),
        ];
        const select = new StringSelectMenuBuilder()
          .setCustomId("profile_display_select")
          .setPlaceholder(displayCharacterId ? `Showing: ${displayKit?.label}` : "Showing: nothing — pick a character")
          .addOptions(options);
        components = [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
      }
    }

    const msg = await interaction.editReply({ embeds: [embed], files: [attachment], components });

    if (target.id === interaction.user.id && ownedIds.length > 0) {
      const collector = msg.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === interaction.user.id && i.customId === "profile_display_select",
        time: 120_000, max: 1,
      });
      collector.on("collect", async (sel: StringSelectMenuInteraction) => {
        await sel.deferUpdate();
        const choice = sel.values[0];
        const newDisplayId = choice === "none" ? null : (ownedIds.includes(choice) ? choice : null);
        await prisma.user.update({ where: { id: interaction.user.id }, data: { profileDisplayCharacterId: newDisplayId } });
        await sel.followUp({
          content: newDisplayId
            ? `◈ **${CHARACTER_KITS[newDisplayId].label}** will now show on your profile. Run \`/profile\` again to see it.`
            : `◈ Profile badge cleared. Run \`/profile\` again to see it.`,
          flags: 64,
        });
      });
      collector.on("end", () => { interaction.editReply({ components: [] }).catch(() => {}); });
    }

    // Tutorial: viewing own profile at step 1 → advance to step 2 (fight pending)
    if (target.id === interaction.user.id && (user as any).tutorialStep === 1) {
      await prisma.user.update({ where: { id: user.id }, data: { tutorialStep: 2 } });
      await interaction.followUp({
        content: `◈ **${displayName}** — your resonance is live.\nJust **send a message** anywhere and your first encounter will spark. Good luck.`,
        flags: 64,
      });
    }
  },
};

export default command;
