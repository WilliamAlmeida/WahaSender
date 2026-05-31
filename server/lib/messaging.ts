/**
 * Substitutes {{name}}, {{phone}}, {{id}} placeholders in a template string.
 */
export function applyPlaceholders(
  template: string,
  values: Record<string, string | null | undefined>,
): string {
  let out = template;
  for (const [key, raw] of Object.entries(values)) {
    const value = String(raw ?? '');
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
    out = out.replace(regex, value);
  }
  return out;
}

/**
 * Expands spintax like {opt1|opt2|opt3}, including nested constructs.
 * Returns a random pick at every node, deterministic per call.
 */
export function resolveSpintax(input: string, rng: () => number = Math.random): string {
  let text = input;
  let matches = text.match(/\{([^{}]+)\}/g);
  let safety = 0;
  while (matches && safety < 1000) {
    for (const match of matches) {
      const options = match.slice(1, -1).split('|');
      const choice = options[Math.floor(rng() * options.length)] ?? '';
      text = text.replace(match, choice);
    }
    matches = text.match(/\{([^{}]+)\}/g);
    safety++;
  }
  return text;
}

/** Strips non-digits and appends @c.us when no JID suffix present. */
export function toWhatsappChatId(rawPhone: string): string {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (rawPhone.includes('@')) return rawPhone;
  return `${digits}@c.us`;
}
