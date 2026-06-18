import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCourseWithContent,
  getEnrollment,
  hasFullCourseAccessAsStudent,
  quizBelongsToCourse,
} from "@/lib/db";
import { CourseOutlineSidebar } from "@/components/CourseOutlineSidebar";
import { QuizPageClient } from "./QuizPageClient";
import { resolveCourseProgression, shouldApplySequentialProgression, getNextNavFromProgression } from "@/lib/course-progression-server";
import { findProgressionRowForQuiz } from "@/lib/course-progression";
import { getServerTranslator } from "@/lib/i18n/server";

type Props = { params: Promise<{ slug: string; quizId: string }> };

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function courseSeg(course: { slug?: string | null; id: string }): string {
  const s = course.slug && course.slug.trim() ? String(course.slug).trim() : "";
  const normalized = s ? s.replace(/-+$/, "").replace(/^-+/, "") : "";
  return normalized ? encodeURIComponent(normalized) : course.id;
}

function lessonHref(
  course: { slug?: string | null; id: string },
  lesson: { slug?: string | null; id: string },
): string {
  const seg = courseSeg(course);
  const lessonSeg =
    lesson.slug && lesson.slug.trim() ? encodeURIComponent(lesson.slug.trim()) : lesson.id;
  return `/courses/${seg}/lessons/${lessonSeg}`;
}

function quizHref(course: { slug?: string | null; id: string }, targetQuizId: string): string {
  return `/courses/${courseSeg(course)}/quizzes/${encodeURIComponent(targetQuizId)}`;
}

type NavItem =
  | { type: "lesson"; id: string; slug?: string | null; locked: boolean }
  | { type: "quiz"; id: string; locked: boolean };

export default async function QuizPage({ params }: Props) {
  const t = await getServerTranslator();
  const { slug: courseSegment, quizId } = await params;
  const courseDecoded = decodeSegment(courseSegment);
  const session = await getServerSession(authOptions);

  const data = await getCourseWithContent(courseDecoded);
  if (!data?.course) notFound();

  const course = data.course as unknown as Record<string, unknown> & {
    id: string;
    slug?: string | null;
    lessons: Record<string, unknown>[];
    quizzes?: Array<Record<string, unknown> & { _count?: { questions?: number } }>;
  };
  course.lessons = data.lessons;
  const role = session?.user?.role;
  const isStaff = role === "ADMIN" || role === "ASSISTANT_ADMIN" || role === "TEACHER";

  let canAccess = false;
  let hasFullStudentAccess = false;
  if (isStaff) canAccess = true;
  if (session?.user?.id) {
    const en = await getEnrollment(session.user.id, course.id);
    if (en) {
      canAccess = true;
      hasFullStudentAccess = true;
    } else if (session.user.role === "STUDENT") {
      hasFullStudentAccess = await hasFullCourseAccessAsStudent(session.user.id, course.id);
      canAccess = hasFullStudentAccess;
    }
  }
  if (!canAccess) notFound();

  const belongs = await quizBelongsToCourse(quizId, course.id);
  if (!belongs) notFound();

  const quizRow = (data.quizzes ?? []).find((q) => String((q as { id?: string }).id) === quizId);
  if (!quizRow) notFound();

  const progression = await resolveCourseProgression(
    session?.user?.id,
    role,
    hasFullStudentAccess,
    course.id,
    data.lessons as Record<string, unknown>[],
    data.quizzes as Record<string, unknown>[],
  );

  const progressionRow = findProgressionRowForQuiz(progression, quizId);
  if (shouldApplySequentialProgression(role, hasFullStudentAccess)) {
    if (!progressionRow || progressionRow.locked) notFound();
    if (progressionRow.type === "quiz" && progressionRow.targetId !== quizId) {
      redirect(quizHref(course, progressionRow.targetId));
    }
  }

  const activeQuizId = progressionRow?.targetId ?? quizId;

  const nextNav =
    progressionRow?.completed
      ? getNextNavFromProgression(
          { id: course.id, slug: course.slug as string | null | undefined },
          progression,
          activeQuizId,
          {
            lesson: t("courses.nextLesson", "Next lesson"),
            quiz: t("courses.nextQuiz", "Next quiz"),
          },
        )
      : null;

  const navItems: NavItem[] = progression.rows.map((row) => {
    if (row.type === "lesson") {
      const l = row.lesson as Record<string, unknown> & { id: string; slug?: string | null };
      return {
        type: "lesson" as const,
        id: row.targetId,
        slug: l.slug ?? null,
        locked: row.locked,
      };
    }
    return { type: "quiz" as const, id: row.targetId, locked: row.locked };
  });
  const currentIndex = navItems.findIndex((i) => i.type === "quiz" && i.id === activeQuizId);
  const prevItem = currentIndex > 0 ? navItems[currentIndex - 1] : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_200px]">
        <article className="min-w-0 lg:col-start-1 lg:row-start-1">
          <QuizPageClient quizId={activeQuizId} courseId={course.id} />

          <nav className="mx-auto mt-8 flex w-full max-w-3xl items-center justify-between gap-4 border-t border-[var(--color-border)] px-4 pt-6 sm:px-6">
            {prevItem && !prevItem.locked ? (
              <Link
                href={
                  prevItem.type === "lesson"
                    ? lessonHref(course, prevItem)
                    : quizHref(course, prevItem.id)
                }
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium transition hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-background)]"
              >
                ← {prevItem.type === "lesson"
                  ? t("courses.previousLesson", "Previous lesson")
                  : t("courses.previousQuiz", "Previous quiz")}
              </Link>
            ) : (
              <span />
            )}
            {nextNav ? (
              <Link
                href={nextNav.href}
                className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-3 text-sm font-medium text-white transition hover:bg-[var(--color-primary-hover)]"
              >
                {nextNav.label} →
              </Link>
            ) : null}
          </nav>
        </article>

        <aside className="order-first lg:col-start-2 lg:row-start-1 lg:order-none">
          <CourseOutlineSidebar
            course={{ id: course.id, slug: course.slug as string | null | undefined }}
            rows={progression.rows}
            canAccess
            currentLessonId={null}
            currentQuizId={activeQuizId}
          />
        </aside>
      </div>
    </div>
  );
}
