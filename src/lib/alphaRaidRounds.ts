export interface AlphaRoundParticipant {
  userId: string;
  isDefeated: boolean;
}

export interface AlphaRoundState {
  pendingUserIds: Set<string>;
  currentIndex: number;
  roundComplete: boolean;
}

function findPendingIndex(
  participants: readonly AlphaRoundParticipant[],
  startIndex: number,
  pendingUserIds: ReadonlySet<string>,
  includeStart: boolean,
): number {
  if (participants.length === 0 || pendingUserIds.size === 0) return -1;

  const firstOffset = includeStart ? 0 : 1;
  const normalizedStart = ((startIndex % participants.length) + participants.length) % participants.length;
  for (let offset = firstOffset; offset < participants.length + firstOffset; offset++) {
    const index = (normalizedStart + offset) % participants.length;
    const participant = participants[index]!;
    if (!participant.isDefeated && pendingUserIds.has(participant.userId)) return index;
  }
  return -1;
}

export function beginAlphaRound(
  participants: readonly AlphaRoundParticipant[],
  startIndex: number,
): AlphaRoundState {
  const pendingUserIds = new Set(
    participants.filter(participant => !participant.isDefeated).map(participant => participant.userId),
  );
  const currentIndex = findPendingIndex(participants, startIndex, pendingUserIds, true);
  return { pendingUserIds, currentIndex, roundComplete: pendingUserIds.size === 0 };
}

export function recordAlphaAction(
  state: AlphaRoundState,
  participants: readonly AlphaRoundParticipant[],
  userId: string,
): AlphaRoundState {
  const pendingUserIds = new Set(state.pendingUserIds);
  pendingUserIds.delete(userId);

  if (pendingUserIds.size === 0) {
    return { pendingUserIds, currentIndex: state.currentIndex, roundComplete: true };
  }

  const currentIndex = findPendingIndex(participants, state.currentIndex, pendingUserIds, false);
  return { pendingUserIds, currentIndex, roundComplete: false };
}
