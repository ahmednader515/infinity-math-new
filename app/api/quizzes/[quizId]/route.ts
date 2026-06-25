import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getQuizById,
  countSubmittedQuizAttemptsByUserAndCourse,
  createQuizAttempt,
  updateQuizAttemptById,
  canStudentAccessQuizInCourse,
  isRemedialQuizUnlocked,
  quizBelongsToCourse,
  getCourseWithContent,
  hasFullCourseAccessAsStudent,
  getQuizProgressSets,
  getLatestQuizAttemptsMap,
  getInProgressQuizAttemptId,
} from "@/lib/db";
import { QUIZ_PASS_PERCENT, quizAttemptPassed } from "@/lib/course-content";
import { getNextNavAfterQuizSubmit } from "@/lib/course-progression-server";

/**
 * جلب اختبار بالمعرّف — مع التحقق من حد المحاولات إن وُجد.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ quizId: string }> }
) {
  try {
    const { quizId } = await params;
    if (!quizId || quizId.length < 20) {
      return NextResponse.json({ error: "معرّف الاختبار غير صالح" }, { status: 400 });
    }

    const url = new URL(request.url);
    const viewingCourseId = url.searchParams.get("courseId")?.trim() || null;

    const result = await getQuizById(quizId, viewingCourseId);

    if (!result || !result.course) {
      return NextResponse.json({ error: "الاختبار غير موجود" }, { status: 404 });
    }

    const isPublished = result.course.isPublished ?? result.course.is_published;
    if (!isPublished) {
      return NextResponse.json({ error: "الدورة غير منشورة" }, { status: 404 });
    }

    const courseId = (result.quiz.viewingCourseId ?? result.quiz.courseId ?? result.quiz.course_id) as string;
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    const isStaff = role === "ADMIN" || role === "ASSISTANT_ADMIN" || role === "TEACHER";
    if (viewingCourseId && !(await quizBelongsToCourse(quizId, viewingCourseId))) {
      return NextResponse.json({ error: "الاختبار غير مرتبط بهذه الدورة" }, { status: 404 });
    }
    if (!isStaff && !(await isRemedialQuizUnlocked(session.user.id, result.quiz))) {
      return NextResponse.json({ error: "هذا الاختبار التعويضي غير متاح بعد" }, { status: 403 });
    }
    if (!isStaff && !(await canStudentAccessQuizInCourse(session.user.id, quizId, courseId))) {
      return NextResponse.json({ error: "غير مسجّل في هذه الدورة أو لا تملك صلاحية لهذا الاختبار" }, { status: 403 });
    }

    const maxAttempts = result.course.max_quiz_attempts ?? result.course.maxQuizAttempts;
    let canAttempt = true;
    let attemptsUsed = 0;
    let inProgressAttemptId: string | null = null;
    if (session?.user?.id && typeof maxAttempts === "number" && maxAttempts > 0) {
      if (isStaff || (await canStudentAccessQuizInCourse(session.user.id, quizId, courseId))) {
        attemptsUsed = await countSubmittedQuizAttemptsByUserAndCourse(session.user.id, courseId);
        inProgressAttemptId = await getInProgressQuizAttemptId(session.user.id, quizId);
        if (attemptsUsed >= maxAttempts && !inProgressAttemptId) {
          canAttempt = false;
        }
      }
    }

    const rawLimit = result.quiz.timeLimitMinutes ?? result.quiz.time_limit_minutes;
    let timeLimitMinutes: number | null = null;
    if (rawLimit != null && rawLimit !== "") {
      const n = Math.floor(Number(rawLimit));
      if (Number.isFinite(n) && n >= 1) {
        timeLimitMinutes = Math.min(24 * 60, n);
      }
    }

    const payload = {
      id: result.quiz.id,
      title: result.quiz.title,
      courseId: (result.quiz.viewingCourseId ?? result.quiz.courseId ?? result.quiz.course_id) as string,
      order: result.quiz.order,
      timeLimitMinutes,
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
      maxQuizAttempts: typeof maxAttempts === "number" ? maxAttempts : null,
      attemptsUsed,
      canAttempt,
      inProgressAttemptId,
      hasPassed: false as boolean,
      hasSubmitted: false as boolean,
      latestAttemptId: null as string | null,
      resultScore: null as number | null,
      resultTotal: null as number | null,
      resultPercentage: null as number | null,
      nextContent: null as { href: string; label: string; type: "lesson" | "quiz" } | null,
    };

    if (session?.user?.id && !isStaff) {
      const { submitted, passed } = await getQuizProgressSets(session.user.id, [quizId], QUIZ_PASS_PERCENT);
      payload.hasPassed = passed.has(quizId);
      payload.hasSubmitted = submitted.has(quizId);
      if (payload.hasSubmitted) {
        const latest = await getLatestQuizAttemptsMap(session.user.id, [quizId]);
        const att = latest.get(quizId);
        if (att) {
          payload.latestAttemptId = att.id;
          payload.resultScore = att.score;
          payload.resultTotal = att.totalQuestions;
          if (att.totalQuestions > 0) {
            payload.resultPercentage = Math.round((att.score / att.totalQuestions) * 100);
          }
        }
        const hasFull = await hasFullCourseAccessAsStudent(session.user.id, courseId);
        const courseContent = await getCourseWithContent(courseId);
        if (courseContent?.course) {
          payload.nextContent = await getNextNavAfterQuizSubmit(
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
    }

    if (!canAttempt && !payload.hasSubmitted) {
      return NextResponse.json(
        { error: "تم استنفاد عدد المحاولات المسموح بها لهذا الاختبار في الكورس.", ...payload },
        { status: 403 }
      );
    }

    return NextResponse.json(payload);
  } catch (e) {
    console.error("API quizzes [quizId]:", e);
    return NextResponse.json(
      { error: "حدث خطأ في جلب الاختبار" },
      { status: 500 }
    );
  }
}

/** تسجيل نتيجة محاولة الاختبار */
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

    let body: {
      score?: number;
      totalQuestions?: number;
      attemptId?: string | null;
      courseId?: string | null;
      answers?: Record<string, string>;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
    }

    const score = Number(body.score ?? 0);
    const totalQuestions = Number(body.totalQuestions ?? 0);
    if (totalQuestions < 1) {
      return NextResponse.json({ error: "عدد الأسئلة غير صالح" }, { status: 400 });
    }
    const answersJson =
      body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)
        ? JSON.stringify(body.answers)
        : null;

    const viewingCourseId = body.courseId?.trim() || new URL(request.url).searchParams.get("courseId")?.trim() || null;
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

    const maxAttempts = result.course.max_quiz_attempts ?? result.course.maxQuizAttempts;
    const attemptId = typeof body.attemptId === "string" && body.attemptId.trim() ? body.attemptId.trim() : null;
    if (typeof maxAttempts === "number" && maxAttempts > 0) {
      const used = await countSubmittedQuizAttemptsByUserAndCourse(session.user.id, courseId);
      const inProgress = attemptId
        ? attemptId
        : await getInProgressQuizAttemptId(session.user.id, quizId);
      if (used >= maxAttempts && !inProgress) {
        return NextResponse.json({ error: "تم استنفاد المحاولات" }, { status: 403 });
      }
    }

    let savedAttemptId = attemptId;
    if (attemptId) {
      const ok = await updateQuizAttemptById({
        attemptId,
        userId: session.user.id,
        quizId,
        score,
        totalQuestions,
        answersJson,
      });
      if (!ok) {
        savedAttemptId = await createQuizAttempt(
          session.user.id,
          quizId,
          score,
          totalQuestions,
          answersJson,
        );
      }
    } else {
      savedAttemptId = await createQuizAttempt(
        session.user.id,
        quizId,
        score,
        totalQuestions,
        answersJson,
      );
    }

    const passed = quizAttemptPassed(score, totalQuestions);
    const percentage = Math.round((score / totalQuestions) * 100);
    let nextContent: { href: string; label: string; type: "lesson" | "quiz" } | null = null;
    let attemptsUsed = 0;
    let canRetry = true;

    if (!isStaff) {
      if (typeof maxAttempts === "number" && maxAttempts > 0) {
        attemptsUsed = await countSubmittedQuizAttemptsByUserAndCourse(session.user.id, courseId);
        canRetry = attemptsUsed < maxAttempts;
      }
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

    if (!savedAttemptId) {
      const latest = await getLatestQuizAttemptsMap(session.user.id, [quizId]);
      savedAttemptId = latest.get(quizId)?.id ?? null;
    }

    return NextResponse.json({
      success: true,
      passed,
      percentage,
      score,
      totalQuestions,
      attemptId: savedAttemptId,
      nextContent,
      canRetry,
      attemptsUsed,
      maxQuizAttempts: typeof maxAttempts === "number" ? maxAttempts : null,
    });
  } catch (e) {
    console.error("API quizzes [quizId] POST:", e);
    return NextResponse.json({ error: "حدث خطأ في تسجيل النتيجة" }, { status: 500 });
  }
}
