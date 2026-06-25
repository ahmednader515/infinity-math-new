import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getQuizById,
  countSubmittedQuizAttemptsByUserAndCourse,
  createQuizAttemptReturningId,
  getInProgressQuizAttemptId,
  canStudentAccessQuizInCourse,
  isRemedialQuizUnlocked,
  quizBelongsToCourse,
  getCourseWithContent,
  hasFullCourseAccessAsStudent,
} from "@/lib/db";
import {
  isContentUnlockedInProgression,
  shouldApplySequentialProgression,
} from "@/lib/course-progression-server";

function resolveViewingCourseId(request: Request, body?: { courseId?: unknown }): string | null {
  const fromBody = body?.courseId != null ? String(body.courseId).trim() : "";
  if (fromBody) return fromBody;
  const fromQuery = new URL(request.url).searchParams.get("courseId")?.trim() ?? "";
  return fromQuery || null;
}

/** بدء محاولة اختبار: تُحسب محاولة فور الضغط على "ابدأ" */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ quizId: string }> }
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

    let body: { courseId?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      /* courseId optional in body */
    }
    const viewingCourseId = resolveViewingCourseId(request, body);

    const result = await getQuizById(quizId, viewingCourseId);
    if (!result || !result.course) {
      return NextResponse.json({ error: "الاختبار غير موجود" }, { status: 404 });
    }

    const courseId = String(
      result.quiz.viewingCourseId ?? result.quiz.courseId ?? result.quiz.course_id,
    );
    if (viewingCourseId && !(await quizBelongsToCourse(quizId, viewingCourseId))) {
      return NextResponse.json({ error: "الاختبار غير مرتبط بهذه الدورة" }, { status: 404 });
    }
    if (!(await isRemedialQuizUnlocked(session.user.id, result.quiz))) {
      return NextResponse.json({ error: "هذا الاختبار غير متاح بعد" }, { status: 403 });
    }

    const role = (session.user as { role?: string }).role;
    const isStaff = role === "ADMIN" || role === "ASSISTANT_ADMIN" || role === "TEACHER";
    if (!isStaff && !(await canStudentAccessQuizInCourse(session.user.id, quizId, courseId))) {
      return NextResponse.json({ error: "غير مسجّل في هذه الدورة" }, { status: 403 });
    }

    if (!isStaff) {
      const hasFull = await hasFullCourseAccessAsStudent(session.user.id, courseId);
      if (shouldApplySequentialProgression(role, hasFull)) {
        const content = await getCourseWithContent(courseId);
        if (content?.course) {
          const unlocked = await isContentUnlockedInProgression(
            session.user.id,
            role,
            hasFull,
            courseId,
            "quiz",
            quizId,
            content.lessons as Record<string, unknown>[],
            content.quizzes as Record<string, unknown>[],
          );
          if (!unlocked) {
            return NextResponse.json({ error: "هذا المحتوى مقفول" }, { status: 403 });
          }
        }
      }
    }

    const maxAttempts = result.course.max_quiz_attempts ?? result.course.maxQuizAttempts;
    if (typeof maxAttempts === "number" && maxAttempts > 0) {
      const attemptsUsed = await countSubmittedQuizAttemptsByUserAndCourse(session.user.id, courseId);
      if (attemptsUsed >= maxAttempts) {
        return NextResponse.json({ error: "تم استنفاد المحاولات" }, { status: 403 });
      }
    }

    const existingAttemptId = await getInProgressQuizAttemptId(session.user.id, quizId);
    if (existingAttemptId) {
      return NextResponse.json({ success: true, attemptId: existingAttemptId, resumed: true });
    }

    const attemptId = await createQuizAttemptReturningId(session.user.id, quizId, 0, 0);
    return NextResponse.json({ success: true, attemptId });
  } catch (e) {
    console.error("API quizzes [quizId] start:", e);
    return NextResponse.json({ error: "حدث خطأ في بدء الاختبار" }, { status: 500 });
  }
}
