import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  hasFullCourseAccessAsStudent,
  markLessonComplete,
  getEnrollment,
  getCourseWithContent,
} from "@/lib/db";
import {
  isContentUnlockedInProgression,
  shouldApplySequentialProgression,
} from "@/lib/course-progression-server";

type Params = { params: Promise<{ lessonId: string }> };

export async function POST(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || session.user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { lessonId } = await params;
  let body: { courseId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const courseId = body.courseId?.trim();
  if (!courseId) {
    return NextResponse.json({ error: "courseId required" }, { status: 400 });
  }

  const [enrollment, fullAccess] = await Promise.all([
    getEnrollment(session.user.id, courseId),
    hasFullCourseAccessAsStudent(session.user.id, courseId),
  ]);
  if (!enrollment && !fullAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (shouldApplySequentialProgression(session.user.role, fullAccess)) {
    const content = await getCourseWithContent(courseId);
    if (content?.course) {
      const unlocked = await isContentUnlockedInProgression(
        session.user.id,
        session.user.role,
        fullAccess,
        courseId,
        "lesson",
        lessonId,
        content.lessons as Record<string, unknown>[],
        content.quizzes as Record<string, unknown>[],
      );
      if (!unlocked) {
        return NextResponse.json({ error: "Content locked" }, { status: 403 });
      }
    }
  }

  const ok = await markLessonComplete(session.user.id, lessonId, courseId);
  if (!ok) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
