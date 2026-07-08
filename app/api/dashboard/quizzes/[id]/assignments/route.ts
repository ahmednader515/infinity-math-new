import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCourseManageIds, getQuizOwnerCourseId, getQuizzesForAdminManage, syncQuizLinkedCourses } from "@/lib/db";
import { canManageCourse, isStaffRole } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }
  const role = session.user.role as UserRole;
  if (!isStaffRole(role)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;
  const ownerCourseId = await getQuizOwnerCourseId(id);
  if (!ownerCourseId) {
    return NextResponse.json({ error: "الاختبار غير موجود" }, { status: 404 });
  }
  const { createdById: createdBy, assignedTeacherId } = await getCourseManageIds(ownerCourseId);
  if (!canManageCourse(role, session.user.id, createdBy, assignedTeacherId)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const quizzes = await getQuizzesForAdminManage(session.user.id, role);
  const quiz = quizzes.find((q) => q.id === id);
  if (!quiz) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  return NextResponse.json({
    quizId: quiz.id,
    ownerCourseId: quiz.ownerCourseId,
    linkedCourseIds: quiz.linkedCourses.map((c) => c.courseId),
  });
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }
  const role = session.user.role as UserRole;
  if (!isStaffRole(role)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;
  const ownerCourseId = await getQuizOwnerCourseId(id);
  if (!ownerCourseId) {
    return NextResponse.json({ error: "الاختبار غير موجود" }, { status: 404 });
  }
  const { createdById: createdBy, assignedTeacherId } = await getCourseManageIds(ownerCourseId);
  if (!canManageCourse(role, session.user.id, createdBy, assignedTeacherId)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  let body: { courseIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const courseIds = Array.isArray(body.courseIds)
    ? body.courseIds.map((v) => String(v).trim()).filter(Boolean)
    : [];

  if (role === "TEACHER") {
    const allowed = await getQuizzesForAdminManage(session.user.id, role);
    if (!allowed.some((q) => q.id === id)) {
      return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
    }
  }

  await syncQuizLinkedCourses(id, courseIds);

  const quizzes = await getQuizzesForAdminManage(session.user.id, role);
  const quiz = quizzes.find((q) => q.id === id);
  return NextResponse.json({ success: true, quiz: quiz ?? null });
}
