/** Prefer Arabic DB text; fall back to English column if Arabic is empty. */
export function pickLocalizedText(
  _locale: unknown,
  arabicValue: string | null | undefined,
  englishValue?: string | null | undefined,
): string {
  const ar = (arabicValue ?? "").trim();
  const en = (englishValue ?? "").trim();
  return ar || en;
}

/** Homepage / settings: DB value or translated Arabic default. */
export function settingTextOrDefault(
  raw: string | null | undefined,
  t: (key: string, fallback?: string) => string,
  messageKey: string,
  fallback: string,
): string {
  const v = (raw ?? "").trim();
  return v || t(messageKey, fallback);
}
