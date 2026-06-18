import type { ProgressionContentRow } from "./course-progression";

export function courseSeg(course: { slug?: string | null; id: string }): string {
  const s = course.slug && String(course.slug).trim() ? String(course.slug).trim() : "";
  const normalized = s ? s.replace(/-+$/, "").replace(/^-+/, "") : "";
  return normalized ? encodeURIComponent(normalized) : course.id;
}

export function progressionRowHref(
  course: { slug?: string | null; id: string },
  row: ProgressionContentRow,
): string {
  if (row.type === "lesson" && row.lesson) {
    const l = row.lesson;
    const slug = l.slug;
    const lessonSeg =
      slug && String(slug).trim()
        ? encodeURIComponent(String(slug).trim())
        : String(l.id ?? row.targetId);
    return `/courses/${courseSeg(course)}/lessons/${lessonSeg}`;
  }
  return `/courses/${courseSeg(course)}/quizzes/${encodeURIComponent(row.targetId)}`;
}

export type ProgressionNavLink = {
  href: string;
  label: string;
  type: "lesson" | "quiz";
};

export function progressionRowToNavLink(
  course: { slug?: string | null; id: string },
  row: ProgressionContentRow,
  labels: { lesson: string; quiz: string },
): ProgressionNavLink {
  return {
    href: progressionRowHref(course, row),
    type: row.type,
    label: row.type === "lesson" ? labels.lesson : labels.quiz,
  };
}
