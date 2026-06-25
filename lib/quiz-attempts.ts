/** Parse per-quiz attempt limit (null = unlimited). */
export function parseQuizMaxAttempts(quiz: Record<string, unknown>): number | null {
  const raw = quiz.maxAttempts ?? quiz.max_attempts ?? quiz.maxQuizAttempts;
  if (raw == null || raw === "") return null;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}
