/**
 * Checks if a character is a digit (0-9).
 * @param character - The character to check.
 * @returns True if the character is a digit, false otherwise.
 */
function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * Checks if a character is a lowercase letter (a-z).
 * @param character - The character to check.
 * @returns True if the character is a lowercase letter, false otherwise.
 */
function isLetter(character: string): boolean {
  return character >= "a" && character <= "z";
}

/**
 * Normalizes an alias by converting it to a standardized format.
 * This includes lowercasing, replacing special characters, and ensuring
 * consistent spacing between letters and digits.
 * @param value - The alias to normalize.
 * @returns The normalized alias.
 */
export function normalizeAlias(value: string): string {
  const text = value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replaceAll("&", " und ");
  let normalized = "";

  // Iterate through each character in the text and apply normalization rules.
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const previous = text[index - 1];
    const next = text[index + 1];

    // Handle decimal points within numbers.
    if (
      (character === "," || character === ".") &&
      previous &&
      next &&
      isDigit(previous) &&
      isDigit(next)
    ) {
      normalized += ".";
      continue;
    }

    // Handle whitespace and punctuation by replacing them with a single space.
    if (
      character.trim() === "" ||
      ",.;:/\\-_()[]{}!?\"'|+*#%".includes(character)
    ) {
      if (normalized && !normalized.endsWith(" ")) normalized += " ";
      continue;
    }

    // Insert a space between a digit and a following letter if not already separated.
    if (
      previous &&
      isDigit(previous) &&
      isLetter(character) &&
      !normalized.endsWith(" ")
    ) {
      normalized += " ";
    }
    normalized += character;
  }

  return normalized.trim();
}
