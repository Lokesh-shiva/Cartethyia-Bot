// src/lib/guildManagers.ts
// Shared "can this member manage server-level bot config" check — same rule
// /setup already uses (bot owner, server owner, Administrator, ManageGuild,
// or a role listed in GuildSettings.setupManagerRoleIds), reused by any
// other owner-gated command that server admins/mods should also be able to
// run (e.g. /tournament start/cancel).
import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";
import prisma from "./prisma";
import { isOwner } from "./owner";

export async function isGuildManager(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guildId) return false;
  if (isOwner(interaction.user.id)) return true;
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  const settings = await prisma.guildSettings.findUnique({ where: { guildId: interaction.guildId } });
  const managerRoles: string[] = (settings as any)?.setupManagerRoleIds ?? [];
  if (!managerRoles.length) return false;

  const memberRoles = interaction.member?.roles;
  const roleIds: string[] = Array.isArray(memberRoles)
    ? memberRoles
    : memberRoles && "cache" in (memberRoles as any)
      ? [...(memberRoles as any).cache.keys()]
      : [];
  return managerRoles.some(r => roleIds.includes(r));
}
