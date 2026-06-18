import { notFound } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getCourseWithContent,
  getEnrollment,
  getAllowedLessonIdsForUserCourse,
  hasFullCourseAccessAsStudent,
  ensureUserCopyrightCode,
  getHomepageSettings,
  isLessonCompleteForUser,
} from "@/lib/db";
import { LessonVideoPlayer } from "@/components/LessonVideoPlayer";
import { VideoCopyrightOverlay } from "@/components/video-copyright-overlay";
import { getYouTubeVideoId } from "@/lib/youtube";
import { CourseOutlineSidebar } from "@/components/CourseOutlineSidebar";
import { LessonHomeworkSection } from "./LessonHomeworkSection";
import { LessonRatingSection } from "./LessonRatingSection";
import { LessonCompleteButton } from "@/components/LessonCompleteButton";
import { resolveCourseProgression, shouldApplySequentialProgression } from "@/lib/course-progression-server";
import { findProgressionRowForLesson } from "@/lib/course-progression";
import { getServerTranslator } from "@/lib/i18n/server";
import { pickLocalizedText } from "@/lib/i18n/localized-field";
import { isCourseSegmentId } from "@/lib/legacy-schema";

type Props = { params: Promise<{ slug: string; lessonSlug: string }> };

function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function isLessonId(segment: string): boolean {
  return isCourseSegmentId(segment);
}

function courseHref(course: { slug?: string | null; id: string }): string {
  const segment = (course.slug && course.slug.trim()) ? encodeURIComponent(course.slug.trim()) : course.id;
  return `/courses/${segment}`;
}

function courseSeg(course: { slug?: string | null; id: string }): string {
  const s = (course.slug && course.slug.trim()) ? String(course.slug).trim() : "";
  const normalized = s ? s.replace(/-+$/, "").replace(/^-+/, "") : "";
  return normalized ? encodeURIComponent(normalized) : (course as { id: string }).id;
}

function lessonHref(course: { slug?: string | null; id: string }, lesson: { slug?: string | null; id: string }): string {
  const seg = courseSeg(course);
  const lessonSeg = (lesson.slug && lesson.slug.trim()) ? encodeURIComponent(lesson.slug.trim()) : lesson.id;
  return `/courses/${seg}/lessons/${lessonSeg}`;
}

function quizHref(course: { slug?: string | null; id: string }, quizId: string): string {
  return `/courses/${courseSeg(course)}/quizzes/${encodeURIComponent(quizId)}`;
}

type NavItem =
  | { type: "lesson"; id: string; slug?: string | null; locked: boolean }
  | { type: "quiz"; id: string; locked: boolean };

export default async function LessonPage({ params }: Props) {
  const t = await getServerTranslator();
  const { slug: courseSegment, lessonSlug: lessonSegment } = await params;
  const courseDecoded = decodeSegment(courseSegment);
  const lessonDecoded = decodeSegment(lessonSegment);
  const session = await getServerSession(authOptions);

  const data = await getCourseWithContent(courseDecoded);
  if (!data?.course) notFound();

  const course = data.course as unknown as Record<string, unknown> & { id: string; slug?: string | null; lessons: Record<string, unknown>[]; quizzes?: Array<Record<string, unknown> & { _count?: { questions?: number } }> };
  course.lessons = data.lessons;
  const role = session?.user?.role;
  course.quizzes = data.quizzes ?? [];

  const isStaff = role === "ADMIN" || role === "ASSISTANT_ADMIN" || role === "TEACHER";
  const isStudent = role === "STUDENT";
  let isEnrolled = false;
  let allowedLessonIds: string[] = [];
  let hasFullStudentAccess = false;
  if (session?.user?.id) {
    const en = await getEnrollment(session.user.id, course.id);
    isEnrolled = !!en;
    if (session.user.role === "STUDENT") {
      hasFullStudentAccess = await hasFullCourseAccessAsStudent(session.user.id, course.id);
    }
    if (!isEnrolled && !isStaff && !hasFullStudentAccess) {
      allowedLessonIds = await getAllowedLessonIdsForUserCourse(session.user.id, course.id);
    }
  }
  const canAccessCourse =
    isStaff || isEnrolled || hasFullStudentAccess || allowedLessonIds.length > 0;
  if (!canAccessCourse) notFound();

  const lesson = isLessonId(lessonDecoded)
    ? data.lessons.find((l: Record<string, unknown>) => l.id === lessonDecoded)
    : data.lessons.find((l: Record<string, unknown>) => l.slug === lessonDecoded);
  if (!lesson) notFound();

  const lessonObj = lesson as Record<string, unknown>;
  const lessonId = String(lessonObj.id ?? lesson.id);

  const progression = await resolveCourseProgression(
    session?.user?.id,
    role,
    hasFullStudentAccess,
    course.id,
    data.lessons as Record<string, unknown>[],
    data.quizzes as Record<string, unknown>[],
  );
  const progressionRow = findProgressionRowForLesson(progression, lessonId);
  if (
    shouldApplySequentialProgression(role, hasFullStudentAccess) &&
    progressionRow?.locked
  ) {
    notFound();
  }

  // لو الوصول جزئي فقط (بدون تسجيل كامل أو اشتراك منصة): لا نسمح بفتح إلا الحصص المحددة
  if (!isStaff && !isEnrolled && !hasFullStudentAccess && allowedLessonIds.length > 0) {
    if (!allowedLessonIds.includes(lessonId)) notFound();
  }

  const videoUrl = (lessonObj.videoUrl ?? lessonObj.video_url) as string;
  const youtubeVideoId = getYouTubeVideoId(videoUrl);
  const courseAr =
    course.titleAr != null
      ? String(course.titleAr)
      : course.title_ar != null
        ? String(course.title_ar)
        : null;
  const courseEn = course.title != null ? String(course.title) : null;
  const courseTitle = pickLocalizedText(null, courseAr, courseEn) || courseEn || courseAr || "";
  const lessonAr =
    lessonObj.titleAr != null
      ? String(lessonObj.titleAr)
      : lessonObj.title_ar != null
        ? String(lessonObj.title_ar)
        : null;
  const lessonEn = lessonObj.title != null ? String(lessonObj.title) : null;
  const lessonTitle = pickLocalizedText(null, lessonAr, lessonEn) || lessonEn || lessonAr || "";

  let studentCopyrightCode: string | null = null;
  if (session?.user?.role === "STUDENT" && session.user.id) {
    studentCopyrightCode = await ensureUserCopyrightCode(session.user.id);
  }
  const homepageSettings = await getHomepageSettings();
  const copyrightOverlayStyle =
    homepageSettings.copyrightOverlayStyle === "watermark" ? "watermark" : "floating";


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
  const currentIndex = navItems.findIndex((i) => i.type === "lesson" && i.id === lessonId);
  const prevItem = currentIndex > 0 ? navItems[currentIndex - 1] : null;
  const nextItem =
    currentIndex >= 0 && currentIndex < navItems.length - 1 ? navItems[currentIndex + 1] : null;

  const lessonCompleted =
    session?.user?.id && isStudent
      ? progressionRow?.completed ?? (await isLessonCompleteForUser(session.user.id, lessonId, course.id))
      : false;
  const canMarkComplete = isStudent && hasFullStudentAccess && !lessonCompleted;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        <Link href={courseHref(course)} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
          ← {t("courses.backToCourse", "Back to")} {courseTitle}
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_200px]">
        {/* محتوى الحصة — دائماً العمود العريض */}
        <article className="min-w-0 lg:col-start-1 lg:row-start-1">
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{lessonTitle}</h1>

          {youtubeVideoId && (
            <div className="mt-6">
              <LessonVideoPlayer
                youtubeVideoId={youtubeVideoId}
                storageKey={String(lessonObj.id)}
                className="w-full"
                lessonId={lessonId}
                courseId={course.id}
                markCompleteOnEnd={canMarkComplete}
                copyrightOverlay={
                  studentCopyrightCode?.trim() ? (
                    <VideoCopyrightOverlay
                      code={studentCopyrightCode.trim()}
                      label={t("video.copyrightCode", "Copyright code")}
                      dir="rtl"
                      style={copyrightOverlayStyle}
                    />
                  ) : undefined
                }
              />
            </div>
          )}

          {(lessonObj.pdfUrl ?? lessonObj.pdf_url) ? (
            <div className="mt-6">
              <a
                href={String(lessonObj.pdfUrl ?? lessonObj.pdf_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
              >
                📄 {t("courses.downloadPdf", "Download / View PDF")}
              </a>
            </div>
          ) : null}

          {lessonObj.content ? (
            <div className="mt-6 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 prose-custom text-[var(--color-foreground)]">
              {String(lessonObj.content).split("\n").map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ) : null}

          {Boolean(lessonObj.acceptsHomework ?? lessonObj.accepts_homework) && (
            <LessonHomeworkSection lessonId={String(lessonObj.id)} />
          )}

          {isStudent ? <LessonRatingSection lessonId={String(lessonObj.id)} /> : null}

          {isStudent && hasFullStudentAccess ? (
            <LessonCompleteButton
              lessonId={lessonId}
              courseId={course.id}
              initialCompleted={lessonCompleted}
            />
          ) : null}

          {/* أزرار السابق والتالي أسفل الحصة */}
          <nav className="mt-8 flex w-full items-center justify-between gap-4 border-t border-[var(--color-border)] pt-6">
            {prevItem && !prevItem.locked ? (
              <Link
                href={prevItem.type === "lesson" ? lessonHref(course, { id: prevItem.id, slug: prevItem.slug ?? undefined }) : quizHref(course, prevItem.id)}
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium transition hover:border-[var(--color-primary)]/40 hover:bg-[var(--color-background)]"
              >
                ← {prevItem.type === "lesson"
                  ? t("courses.previousLesson", "Previous lesson")
                  : t("courses.previousQuiz", "Previous quiz")}
              </Link>
            ) : (
              <span />
            )}
            {nextItem && !nextItem.locked ? (
              <Link
                href={nextItem.type === "lesson" ? lessonHref(course, { id: nextItem.id, slug: nextItem.slug ?? undefined }) : quizHref(course, nextItem.id)}
                className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-3 text-sm font-medium text-white transition hover:bg-[var(--color-primary-hover)]"
              >
                {nextItem.type === "lesson"
                  ? t("courses.nextLesson", "Next lesson")
                  : t("courses.nextQuiz", "Next quiz")} →
              </Link>
            ) : null}
          </nav>
        </article>

        {/* قائمة الكورس — العمود الضيق على الجانب */}
        <aside className="order-first lg:col-start-2 lg:row-start-1 lg:order-none">
          <CourseOutlineSidebar
            course={{ id: course.id, slug: course.slug as string | null | undefined }}
            rows={progression.rows}
            canAccess
            currentLessonId={lessonId}
            currentQuizId={null}
          />
        </aside>
      </div>
    </div>
  );
}
