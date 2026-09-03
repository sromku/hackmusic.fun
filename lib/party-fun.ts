export const FLAIR_EMOJIS = ["🔥", "❤️", "😂", "💀", "🕺", "👀", "🤮", "🎉"] as const;
export type FlairEmoji = typeof FLAIR_EMOJIS[number];

export const MAX_THEME_LENGTH = 60;
export const GUESS_BONUS_POINTS = 2;
export const BOOST_CHEER_POINTS = 6;
export const BASE_REACTION_POINTS = 3;
export const BOOS_TO_SKIP = 3;

export function isFlairEmoji(value: string): value is FlairEmoji {
  return (FLAIR_EMOJIS as readonly string[]).includes(value);
}

export function boosNeededToSkip(shielded: boolean) {
  return BOOS_TO_SKIP + (shielded ? 1 : 0);
}

export function normalizeTheme(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_THEME_LENGTH);
}
