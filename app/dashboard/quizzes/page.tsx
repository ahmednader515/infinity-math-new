import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import {
  getCoursesWithCounts,
  getCoursesWithCountsForCreator,
  getQuizzesForAdminManage,
} from "@/lib/db";
import { getServerTranslator } from "@/lib/i18n/server";
import { isStaffRole } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";
import { QuizzesAdminClient } from "./QuizzesAdminClient";

export default async function QuizzesAdminPage() {
  const session = await getServerSession(authOptions);
  if (!session || !isStaffRole(session.user.role)) {
    redirect("/dashboard");
  }

  const role = session.user.role as UserRole;
  const t = await getServerTranslator();

  const quizzes = await getQuizzesForAdminManage(session.user.id, role);
  const courseRows =
    role === "TEACHER"
      ? await getCoursesWithCountsForCreator(session.user.id)
      : await getCoursesWithCounts();

  const courses = courseRows.map((c) => ({
    id: String(c.id),
    title: String(c.title ?? ""),
    titleAr: (c.titleAr ?? c.title_ar ?? null) as string | null,
  }));

  return (
    <div>
      <Link href="/dashboard" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
        {t("dashboard.backToDashboard")}
      </Link>
      <h2 className="mt-4 text-xl font-bold text-[var(--color-foreground)]">
        {t("dashboard.quizzesPage.title")}
      </h2>
      <QuizzesAdminClient initialQuizzes={quizzes} initialCourses={courses} />
    </div>
  );
}
