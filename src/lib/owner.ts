export const OWNER_ID = "979379636586819746";

export function isOwner(userId: string): boolean {
  return userId === OWNER_ID;
}
