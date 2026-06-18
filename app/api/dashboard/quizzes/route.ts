import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getQuizzesForAdminManage } from "@/lib/db";
import { isStaffRole } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }
  const role = session.user.role as UserRole;
  if (!isStaffRole(role)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const quizzes = await getQuizzesForAdminManage(session.user.id, role);
  return NextResponse.json({ quizzes });
}
