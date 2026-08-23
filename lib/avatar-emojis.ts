export const AVATAR_EMOJIS = [
  { emoji: "🎧", label: "Headphones" },
  { emoji: "🪩", label: "Disco ball" },
  { emoji: "🦄", label: "Unicorn" },
  { emoji: "👻", label: "Ghost" },
  { emoji: "🐸", label: "Frog" },
  { emoji: "🐙", label: "Octopus" },
  { emoji: "🦊", label: "Fox" },
  { emoji: "🐼", label: "Panda" },
  { emoji: "🦖", label: "Dinosaur" },
  { emoji: "🐝", label: "Bee" },
  { emoji: "🍕", label: "Pizza" },
  { emoji: "🌶️", label: "Chili pepper" },
  { emoji: "🍄", label: "Mushroom" },
  { emoji: "🥑", label: "Avocado" },
  { emoji: "🚀", label: "Rocket" },
  { emoji: "🛸", label: "UFO" },
  { emoji: "⚡", label: "Lightning" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "🌈", label: "Rainbow" },
  { emoji: "🎸", label: "Guitar" },
  { emoji: "🥁", label: "Drum" },
  { emoji: "🎷", label: "Saxophone" },
  { emoji: "🤖", label: "Robot" },
  { emoji: "😎", label: "Cool face" },
] as const;

export function isAvatarEmoji(value: string): boolean {
  return AVATAR_EMOJIS.some((option) => option.emoji === value);
}
