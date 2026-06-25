import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCourseWithContent,
  getEnrollment,
  getAllowedQuizIdsForUserCourse,
  getAllowedLessonIdsForUserCourse,
  hasFullCourseAccessAsStudent,
  quizBelongsToCourse,
} from "@/lib/db";
import { CourseOutlineSidebar } from "@/components/CourseOutlineSidebar";
import { CourseContentAccessDenied } from "@/components/CourseContentAccessDenied";
import { QuizResultsClient } from "./QuizResultsClient";
import { resolveCourseProgression, shouldApplySequentialProgression } from "@/lib/course-progression-server";
import { findProgressionRowForQuiz } from "@/lib/course-progression";
import { getServerTranslator } from "@/lib/i18n/server";
import { pickLocalizedText } from "@/lib/i18n/localized-field";

type Props = {
  params: Promise<{ slug: string; quizId: string }>;
  searchParams: Promise<{ attemptId?: string; courseId?: string }>;
};

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function courseHref(course: { slug?: string | null; id: string }): string {
  const segment = course.slug && course.slug.trim() ? encodeURIComponent(course.slug.trim()) : course.id;
  return `/courses/${segment}`;
}

export default async function QuizResultsPage({ params, searchParams }: Props) {
  const t = await getServerTranslator();
  const { slug: courseSegment, quizId } = await params;
  const { attemptId, courseId: courseIdParam } = await searchParams;
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
  let isEnrolled = false;
  let allowedQuizIds: string[] = [];
  let allowedLessonIds: string[] = [];
  if (isStaff) canAccess = true;
  if (session?.user?.id) {
    const en = await getEnrollment(session.user.id, course.id);
    isEnrolled = !!en;
    if (en) {
      canAccess = true;
      hasFullStudentAccess = true;
    } else if (session.user.role === "STUDENT") {
      hasFullStudentAccess = await hasFullCourseAccessAsStudent(session.user.id, course.id);
      canAccess = hasFullStudentAccess;
      if (!hasFullStudentAccess) {
        [allowedLessonIds, allowedQuizIds] = await Promise.all([
          getAllowedLessonIdsForUserCourse(session.user.id, course.id),
          getAllowedQuizIdsForUserCourse(session.user.id, course.id),
        ]);
        if (allowedLessonIds.length > 0 || allowedQuizIds.length > 0) {
          canAccess = true;
        }
      }
    }
  }
  if (!canAccess) notFound();

  const courseAr =
    course.titleAr != null
      ? String(course.titleAr)
      : course.title_ar != null
        ? String(course.title_ar)
        : null;
  const courseEn = course.title != null ? String(course.title) : null;
  const courseTitle = pickLocalizedText(null, courseAr, courseEn) || courseEn || courseAr || "";

  const belongs = await quizBelongsToCourse(quizId, course.id);
  if (!belongs) notFound();

  const quizRow = (data.quizzes ?? []).find((q) => String((q as { id?: string }).id) === quizId);
  if (!quizRow) notFound();

  const quizDenied =
    !isStaff &&
    !isEnrolled &&
    !hasFullStudentAccess &&
    (allowedLessonIds.length > 0 || allowedQuizIds.length > 0) &&
    !allowedQuizIds.includes(quizId);

  if (quizDenied) {
    return (
      <CourseContentAccessDenied
        title={t("courses.quizAccessDeniedTitle", "You do not have access to this quiz")}
        message={t(
          "courses.quizAccessDeniedMessage",
          "The code you redeemed unlocks only specific content in this course. To take this quiz, purchase the full course or redeem another code that includes it.",
        )}
        courseHref={courseHref(course)}
        courseTitle={courseTitle}
        backLabel={t("courses.backToCourse", "Back to")}
        purchaseCourseLabel={t("courses.purchaseCourseAction", "Purchase course")}
        activateCodeLabel={t("courses.activateAnotherCode", "Redeem another code")}
      />
    );
  }

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
  }

  const activeQuizId = progressionRow?.targetId ?? quizId;
  const viewingCourseId = courseIdParam?.trim() || course.id;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_200px]">
        <article className="min-w-0 lg:col-start-1 lg:row-start-1">
          <QuizResultsClient
            quizId={activeQuizId}
            courseId={viewingCourseId}
            attemptId={attemptId?.trim() || undefined}
          />
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
