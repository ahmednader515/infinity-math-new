import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getLinkableQuizzes } from "@/lib/db";
import type { UserRole } from "@/lib/types";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }
  const role = session.user.role as UserRole;
  if (role !== "ADMIN" && role !== "ASSISTANT_ADMIN" && role !== "TEACHER") {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const excludeCourseId = request.nextUrl.searchParams.get("excludeCourseId")?.trim() ?? "";
  if (!excludeCourseId) {
    return NextResponse.json({ error: "معرّف الدورة مطلوب" }, { status: 400 });
  }

  const quizzes = await getLinkableQuizzes(excludeCourseId, session.user.id, role);
  return NextResponse.json(quizzes);
}
