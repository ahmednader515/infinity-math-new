import Link from "next/link";
import { getServerTranslator } from "@/lib/i18n/server";
import type { ProgressionContentRow } from "@/lib/course-progression";

function courseSeg(course: { slug?: string | null; id: string }): string {
  const s = course.slug && course.slug.trim() ? String(course.slug).trim() : "";
  const normalized = s ? s.replace(/-+$/, "").replace(/^-+/, "") : "";
  return normalized ? encodeURIComponent(normalized) : course.id;
}

function lessonHref(
  course: { slug?: string | null; id: string },
  lesson: Record<string, unknown>,
): string {
  const seg = courseSeg(course);
  const slugVal = lesson.slug;
  const lessonSeg =
    slugVal && String(slugVal).trim()
      ? encodeURIComponent(String(slugVal).trim())
      : String(lesson.id);
  return `/courses/${seg}/lessons/${lessonSeg}`;
}

function quizHref(course: { slug?: string | null; id: string }, quizId: string): string {
  return `/courses/${courseSeg(course)}/quizzes/${encodeURIComponent(quizId)}`;
}

type Props = {
  course: { id: string; slug?: string | null };
  rows: ProgressionContentRow[];
  canAccess: boolean;
};

export async function CourseContentProgressList({ course, rows, canAccess }: Props) {
  const t = await getServerTranslator();

  if (rows.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="text-xl font-semibold text-[var(--color-foreground)]">
        {t("courses.courseContent", "Course content")} ({rows.length})
      </h2>
      <ul className="mt-4 space-y-2">
        {rows.map((row, i) => {
          const locked = row.locked || !canAccess;
          const baseClass = `flex items-center gap-3 rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] p-3 ${
            locked ? "opacity-60" : "transition hover:border-[var(--color-primary)]/30"
          }`;

          const badge = (
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
                row.completed
                  ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                  : locked
                    ? "bg-[var(--color-muted)]/20 text-[var(--color-muted)]"
                    : "bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
              }`}
            >
              {row.completed ? "✓" : locked ? "🔒" : i + 1}
            </span>
          );

          const meta = (
            <div className="min-w-0 flex-1">
              <span className="font-medium text-[var(--color-foreground)]">{row.title}</span>
              {row.type === "lesson" &&
              (row.lesson?.videoUrl ?? row.lesson?.video_url) &&
              !locked ? (
                <span className="mr-2 text-xs text-[var(--color-primary)]">
                  ▶ {t("courses.videoTag", "Video")}
                </span>
              ) : null}
              {row.type === "quiz" ? (
                <span className="mr-2 text-sm text-[var(--color-muted)]">
                  • {row.questionsCount ?? 0} {t("courses.questions", "questions")}
                  {row.isRemedial ? ` • ${t("courses.remedialQuiz", "Remedial")}` : ""}
                </span>
              ) : null}
              {locked && canAccess ? (
                <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                  {t("courses.contentLocked", "Complete the previous item to unlock")}
                </p>
              ) : null}
            </div>
          );

          if (locked) {
            return (
              <li key={`${row.type}-${row.slotId}`}>
                <div className={baseClass} aria-disabled>
                  {badge}
                  {meta}
                </div>
              </li>
            );
          }

          const href =
            row.type === "lesson" && row.lesson
              ? lessonHref(course, row.lesson)
              : quizHref(course, row.targetId);

          return (
            <li key={`${row.type}-${row.slotId}`}>
              <Link href={href} className={baseClass}>
                {badge}
                {meta}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
