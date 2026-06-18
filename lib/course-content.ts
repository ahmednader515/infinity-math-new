/** Shared helpers for ordered course content (lessons + quizzes). */

export const QUIZ_PASS_PERCENT = 50;

export function quizAttemptPassed(score: number, totalQuestions: number): boolean {
  if (totalQuestions < 1) return false;
  return (score / totalQuestions) * 100 >= QUIZ_PASS_PERCENT;
}

export function contentOrderValue(row: Record<string, unknown>): number {
  const raw =
    row.order ??
    row.sort_position ??
    row.sortPosition ??
    row.position ??
    row.assignment_position;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 9999;
}

export type MergedContentItem =
  | { type: "lesson"; order: number; id: string; data: Record<string, unknown> }
  | { type: "quiz"; order: number; id: string; data: Record<string, unknown> };

/** Merge lessons and quizzes into one timeline sorted by order/position. */
export function mergeCourseContentItems(
  lessons: Record<string, unknown>[],
  quizzes: Record<string, unknown>[],
): MergedContentItem[] {
  const items: MergedContentItem[] = [
    ...lessons.map((l) => ({
      type: "lesson" as const,
      order: contentOrderValue(l),
      id: String(l.id),
      data: l,
    })),
    ...quizzes.map((q) => ({
      type: "quiz" as const,
      order: contentOrderValue(q),
      id: String(q.id),
      data: q,
    })),
  ];
  items.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return items;
}

export function normalizeQuizTypeValue(quiz: Record<string, unknown>): "NORMAL" | "REMEDIAL" {
  return String(quiz.quizType ?? quiz.quiz_type ?? "NORMAL").toUpperCase() === "REMEDIAL"
    ? "REMEDIAL"
    : "NORMAL";
}

export function findRemedialForParent(
  quizzes: Record<string, unknown>[],
  parentQuizId: string,
): Record<string, unknown> | null {
  const pid = parentQuizId.trim();
  if (!pid) return null;
  return (
    quizzes.find((q) => {
      if (normalizeQuizTypeValue(q) !== "REMEDIAL") return false;
      const parent = String(q.parentQuizId ?? q.parent_quiz_id ?? "").trim();
      return parent === pid;
    }) ?? null
  );
}

/** Quiz ids that are remedial children — exclude from standalone slots when parent is in course. */
export function remedialChildIdsInCourse(quizzes: Record<string, unknown>[]): Set<string> {
  const normalIds = new Set(
    quizzes.filter((q) => normalizeQuizTypeValue(q) === "NORMAL").map((q) => String(q.id)),
  );
  const ids = new Set<string>();
  for (const q of quizzes) {
    if (normalizeQuizTypeValue(q) !== "REMEDIAL") continue;
    const parent = String(q.parentQuizId ?? q.parent_quiz_id ?? "").trim();
    if (parent && normalIds.has(parent)) ids.add(String(q.id));
  }
  return ids;
}
