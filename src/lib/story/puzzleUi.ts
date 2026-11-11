// Discord rendering for the three story puzzles. Pure builders: state in, embed + button rows out.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { buildScarOptions, scarAnswer } from "./puzzles";
import { lanternGridOf, sequenceOf, SEQUENCE_LENGTH } from "./puzzleStep";
import { buildCustomId } from "./runEngine";
import { NODE_COLOR } from "./mapCard";
import type { NodeDefinition, PuzzleDefinition, RunState } from "./types";

export const SEQUENCE_SYMBOLS = ["🔥", "❄️", "🌿", "⚡"];
const pct = (f: number) => `${Math.round(f * 100)}%`;

export interface PuzzleViewOpts {
  /** SEQUENCE: show the pattern. LANTERNS: highlight this cell as the hinted press. */
  revealSequence?: boolean;
  hintCell?: number;
  sceneAttachment?: string;
}

export function buildPuzzleView(
  runId: string, node: NodeDefinition, nodeIndex: number, state: RunState, opts: PuzzleViewOpts = {},
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const def = node.puzzle as PuzzleDefinition;
  const puzzle = state.puzzle!;
  const id = (kind: "pz" | "hint", option?: string) => buildCustomId(kind, runId, nodeIndex, option);
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let body = node.intro;

  const hintBtn = new ButtonBuilder()
    .setCustomId(id("hint")).setLabel(`Hint (-${pct(def.hintCostFraction)} HP)`).setStyle(ButtonStyle.Secondary)
    .setDisabled(state.hpFraction <= def.hintCostFraction);

  if (def.kind === "SEQUENCE") {
    const step = puzzle.progress[0] ?? 0;
    body += opts.revealSequence
      ? `\n\n**Watch closely:**  ${sequenceOf(puzzle).map(i => SEQUENCE_SYMBOLS[i]).join("   ")}`
      : `\n\n**Repeat the pattern.**  Step ${step + 1}/${SEQUENCE_LENGTH}  ·  Mistakes ${puzzle.mistakes}/${def.limit}`;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      SEQUENCE_SYMBOLS.map((sym, i) => new ButtonBuilder().setCustomId(id("pz", String(i))).setLabel(sym).setStyle(ButtonStyle.Primary).setDisabled(!!opts.revealSequence)),
    ));
    const ctl = [hintBtn.setDisabled(hintBtn.data.disabled || !!opts.revealSequence)];
    if (def.forceOption) {
      ctl.push(new ButtonBuilder().setCustomId(id("pz", "force")).setLabel(`${def.forceOption.label} (-${pct(def.forceOption.hpCostFraction)} HP)`)
        .setStyle(ButtonStyle.Danger).setDisabled(state.hpFraction <= def.forceOption.hpCostFraction || !!opts.revealSequence));
    }
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(ctl));
  } else if (def.kind === "LANTERNS") {
    const grid = lanternGridOf(puzzle);
    body += `\n\n**Presses:** ${puzzle.progress.length}/${def.limit}`;
    for (let r = 0; r < 3; r++) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents([0, 1, 2].map(c => {
        const i = r * 3 + c;
        return new ButtonBuilder().setCustomId(id("pz", String(i))).setLabel(grid[i] ? "Lit" : "Dark")
          .setStyle(opts.hintCell === i ? ButtonStyle.Success : grid[i] ? ButtonStyle.Primary : ButtonStyle.Secondary);
      })));
    }
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      hintBtn, new ButtonBuilder().setCustomId(id("pz", "giveup")).setLabel("Give up").setStyle(ButtonStyle.Danger),
    ));
  } else {
    const answer = scarAnswer(def.clues ?? []);
    if (puzzle.hintsUsed > 0) body += `\n\n**You recall the counts:**  ${(def.clues ?? []).join("  +  ")}`;
    body += `\n\n**Mistakes:** ${puzzle.mistakes}/${def.limit}`;
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      buildScarOptions(answer, puzzle.seed).map(v => new ButtonBuilder().setCustomId(id("pz", String(v))).setLabel(String(v))
        .setStyle(ButtonStyle.Primary).setDisabled(puzzle.progress.includes(v))),
    ));
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(hintBtn));
  }

  const embed = new EmbedBuilder()
    .setColor(parseInt(NODE_COLOR.PUZZLE.slice(1), 16))
    .setTitle(node.title)
    .setDescription(body)
    .setFooter({ text: `CARTETHYIA  ·  Story  ·  HP ${pct(state.hpFraction)}` });
  if (opts.sceneAttachment) embed.setImage(`attachment://${opts.sceneAttachment}`);
  return { embeds: [embed], components: rows };
}
