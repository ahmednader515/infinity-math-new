import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getQuizById,
  getQuizAttemptById,
  countSubmittedQuizAttemptsByUserAndCourse,
  canStudentAccessQuizInCourse,
  isRemedialQuizUnlocked,
  quizBelongsToCourse,
  getCourseWithContent,
  hasFullCourseAccessAsStudent,
  getLatestQuizAttemptsMap,
} from "@/lib/db";
import { QUIZ_PASS_PERCENT, quizAttemptPassed } from "@/lib/course-content";
import { getNextNavAfterQuizSubmit } from "@/lib/course-progression-server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ quizId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }

    const { quizId } = await params;
    if (!quizId || quizId.length < 20) {
      return NextResponse.json({ error: "معرّف الاختبار غير صالح" }, { status: 400 });
    }

    const url = new URL(request.url);
    const viewingCourseId = url.searchParams.get("courseId")?.trim() || null;
    let attemptId = url.searchParams.get("attemptId")?.trim() || null;

    const result = await getQuizById(quizId, viewingCourseId);
    if (!result || !result.course) {
      return NextResponse.json({ error: "الاختبار غير موجود" }, { status: 404 });
    }

    const courseId = String(
      result.quiz.viewingCourseId ?? result.quiz.courseId ?? result.quiz.course_id,
    );
    const role = (session.user as { role?: string }).role;
    const isStaff = role === "ADMIN" || role === "ASSISTANT_ADMIN" || role === "TEACHER";

    if (viewingCourseId && !(await quizBelongsToCourse(quizId, viewingCourseId))) {
      return NextResponse.json({ error: "الاختبار غير مرتبط بهذه الدورة" }, { status: 404 });
    }
    if (!isStaff && !(await isRemedialQuizUnlocked(session.user.id, result.quiz))) {
      return NextResponse.json({ error: "هذا الاختبار غير متاح بعد" }, { status: 403 });
    }
    if (!isStaff && !(await canStudentAccessQuizInCourse(session.user.id, quizId, courseId))) {
      return NextResponse.json({ error: "غير مسجّل في هذه الدورة" }, { status: 403 });
    }

    let attempt = attemptId
      ? await getQuizAttemptById(attemptId, session.user.id)
      : null;
    if (!attempt) {
      const latest = await getLatestQuizAttemptsMap(session.user.id, [quizId]);
      const latestRow = latest.get(quizId);
      if (latestRow) {
        attempt = await getQuizAttemptById(latestRow.id, session.user.id);
        attemptId = latestRow.id;
      }
    }
    if (!attempt || attempt.quizId !== quizId) {
      return NextResponse.json({ error: "لم يتم العثور على نتيجة لهذا الاختبار" }, { status: 404 });
    }

    const passed = quizAttemptPassed(attempt.score, attempt.totalQuestions);
    const percentage = Math.round((attempt.score / attempt.totalQuestions) * 100);

    const maxAttempts = result.course.max_quiz_attempts ?? result.course.maxQuizAttempts;
    let attemptsUsed = 0;
    let canRetry = true;
    if (!isStaff && typeof maxAttempts === "number" && maxAttempts > 0) {
      attemptsUsed = await countSubmittedQuizAttemptsByUserAndCourse(session.user.id, courseId);
      canRetry = attemptsUsed < maxAttempts;
    } else if (!isStaff) {
      canRetry = true;
    } else {
      canRetry = false;
    }

    let nextContent: { href: string; label: string; type: "lesson" | "quiz" } | null = null;
    if (!isStaff) {
      const hasFull = await hasFullCourseAccessAsStudent(session.user.id, courseId);
      const courseContent = await getCourseWithContent(courseId);
      if (courseContent?.course) {
        nextContent = await getNextNavAfterQuizSubmit(
          session.user.id,
          role,
          hasFull,
          {
            id: String(courseContent.course.id),
            slug: (courseContent.course as { slug?: string | null }).slug ?? null,
          },
          courseContent.lessons as Record<string, unknown>[],
          courseContent.quizzes as Record<string, unknown>[],
          quizId,
          { lesson: "Next lesson", quiz: "Next quiz" },
        );
      }
    }

    const scoredQuestions = result.questions.filter(
      (q) => q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE",
    ).length;
    const essayQuestions = result.questions.length - scoredQuestions;

    return NextResponse.json({
      attemptId: attempt.id,
      quiz: {
        id: result.quiz.id,
        title: result.quiz.title,
        courseId,
        course: {
          id: result.course.id,
          slug: result.course.slug,
          title: result.course.title,
          titleAr: result.course.titleAr ?? result.course.title_ar,
        },
        questions: result.questions.map((q) => ({
          id: q.id,
          type: q.type,
          questionText: q.questionText ?? q.question_text,
          imageUrl: (q.imageUrl ?? q.image_url ?? null) as string | null,
          order: q.order,
          options: (q.options ?? []).map((o: Record<string, unknown>) => ({
            id: o.id,
            text: o.text,
            isCorrect: o.isCorrect ?? o.is_correct,
          })),
        })),
      },
      result: {
        score: attempt.score,
        totalQuestions: attempt.totalQuestions,
        percentage,
        passed,
        passThreshold: QUIZ_PASS_PERCENT,
        submittedAt: attempt.updatedAt,
        scoredQuestions,
        essayQuestions,
      },
      answers: attempt.answers,
      nextContent,
      canRetry,
      attemptsUsed,
      maxQuizAttempts: typeof maxAttempts === "number" ? maxAttempts : null,
    });
  } catch (e) {
    console.error("API quizzes [quizId] results:", e);
    return NextResponse.json({ error: "حدث خطأ في جلب النتيجة" }, { status: 500 });
  }
}
