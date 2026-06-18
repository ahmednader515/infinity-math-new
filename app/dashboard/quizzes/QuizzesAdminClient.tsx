"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/LocaleProvider";
import { useDashboardTable } from "@/lib/i18n/dashboard-table";
import type { QuizAdminManageRow } from "@/lib/types";

export type CourseOption = {
  id: string;
  title: string;
  titleAr: string | null;
};

export function QuizzesAdminClient({
  initialQuizzes,
  initialCourses,
}: {
  initialQuizzes: QuizAdminManageRow[];
  initialCourses: CourseOption[];
}) {
  const router = useRouter();
  const t = useT();
  const Q = "dashboard.quizzesAdmin";
  const { dir, thClass } = useDashboardTable();

  const [quizzes, setQuizzes] = useState(initialQuizzes);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<QuizAdminManageRow | null>(null);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const courseLabel = useCallback(
    (c: CourseOption) => c.titleAr?.trim() || c.title,
    [],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quizzes.filter((quiz) => {
      if (filter === "linked" && quiz.linkedCourses.length === 0) return false;
      if (filter === "unlinked" && quiz.linkedCourses.length > 0) return false;
      if (!q) return true;
      const hay = [
        quiz.title,
        quiz.ownerCourseTitle,
        quiz.ownerCourseTitleAr ?? "",
        ...quiz.linkedCourses.flatMap((c) => [c.courseTitle, c.courseTitleAr ?? ""]),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [quizzes, search, filter]);

  const reload = useCallback(async () => {
    const res = await fetch("/api/dashboard/quizzes", { credentials: "include" });
    if (!res.ok) return;
    const data = (await res.json()) as { quizzes?: QuizAdminManageRow[] };
    if (data.quizzes) setQuizzes(data.quizzes);
  }, []);

  function openManage(quiz: QuizAdminManageRow) {
    setActiveQuiz(quiz);
    setSelectedCourseIds(quiz.linkedCourses.map((c) => c.courseId));
    setError("");
    setSuccess("");
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveQuiz(null);
    setSelectedCourseIds([]);
  }

  function toggleCourse(courseId: string) {
    setSelectedCourseIds((prev) =>
      prev.includes(courseId) ? prev.filter((id) => id !== courseId) : [...prev, courseId],
    );
  }

  async function saveAssignments() {
    if (!activeQuiz) return;
    setSaving(true);
    setError("");
    setSuccess("");
    const res = await fetch(`/api/dashboard/quizzes/${activeQuiz.id}/assignments`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseIds: selectedCourseIds }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : t(`${Q}.saveFailed`));
      return;
    }
    if (data.quiz) {
      setQuizzes((prev) => prev.map((q) => (q.id === activeQuiz.id ? data.quiz : q)));
    } else {
      await reload();
    }
    setSuccess(t(`${Q}.saveSuccess`));
    closeModal();
    router.refresh();
  }

  const assignableCourses = useMemo(() => {
    if (!activeQuiz) return initialCourses;
    return initialCourses.filter((c) => c.id !== activeQuiz.ownerCourseId);
  }, [activeQuiz, initialCourses]);

  return (
    <div className="mt-6 space-y-6">
      <p className="text-sm text-[var(--color-muted)]">{t(`${Q}.subtitle`)}</p>

      {error ? (
        <p className="rounded-[var(--radius-btn)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-[var(--radius-btn)] border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          {success}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--color-foreground)]">{t(`${Q}.searchLabel`)}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(`${Q}.searchPlaceholder`)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--color-foreground)]">{t(`${Q}.filterLabel`)}</span>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          >
            <option value="all">{t(`${Q}.filterAll`)}</option>
            <option value="linked">{t(`${Q}.filterLinked`)}</option>
            <option value="unlinked">{t(`${Q}.filterUnlinked`)}</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[720px] text-sm" dir={dir}>
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-background)]">
              <th className={thClass}>{t(`${Q}.colTitle`)}</th>
              <th className={thClass}>{t(`${Q}.colOwnerCourse`)}</th>
              <th className={thClass}>{t(`${Q}.colType`)}</th>
              <th className={thClass}>{t(`${Q}.colQuestions`)}</th>
              <th className={thClass}>{t(`${Q}.colLinkedCourses`)}</th>
              <th className={thClass}>{t(`${Q}.colActions`)}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className="bg-[var(--color-surface)]">
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--color-muted)]">
                  {t(`${Q}.empty`)}
                </td>
              </tr>
            ) : (
              filtered.map((quiz) => (
                <tr key={quiz.id} className="border-b border-[var(--color-border)] bg-[var(--color-surface)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--color-foreground)]">{quiz.title}</td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {quiz.ownerCourseTitleAr ?? quiz.ownerCourseTitle}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        quiz.quizType === "REMEDIAL"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-[var(--color-border)]/60 text-[var(--color-muted)]"
                      }`}
                    >
                      {quiz.quizType === "REMEDIAL" ? t(`${Q}.typeRemedial`) : t(`${Q}.typeNormal`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-muted)]">{quiz.questionCount}</td>
                  <td className="px-4 py-3">
                    {quiz.linkedCourses.length === 0 ? (
                      <span className="text-[var(--color-muted)]">{t(`${Q}.noneLinked`)}</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {quiz.linkedCourses.map((c) => (
                          <li key={c.courseId} className="text-[var(--color-foreground)]">
                            {c.courseTitleAr ?? c.courseTitle}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openManage(quiz)}
                        className="rounded-[var(--radius-btn)] border border-[var(--color-primary)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10"
                      >
                        {t(`${Q}.manageCoursesBtn`)}
                      </button>
                      <Link
                        href={`/dashboard/courses/${quiz.ownerCourseId}/edit`}
                        className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-foreground)] hover:bg-[var(--color-border)]/40"
                      >
                        {t(`${Q}.editQuizBtn`)}
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && activeQuiz ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-[var(--color-foreground)]">{t(`${Q}.modalTitle`)}</h3>
            <p className="mt-1 text-sm font-medium text-[var(--color-foreground)]">{activeQuiz.title}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              {t(`${Q}.modalOwnerCourse`)}: {activeQuiz.ownerCourseTitleAr ?? activeQuiz.ownerCourseTitle}
            </p>
            <p className="mt-3 text-sm text-[var(--color-muted)]">{t(`${Q}.modalHelp`)}</p>

            {assignableCourses.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--color-muted)]">{t(`${Q}.noCoursesAvailable`)}</p>
            ) : (
              <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
                {assignableCourses.map((course) => (
                  <li key={course.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-btn)] border border-[var(--color-border)] px-3 py-2 hover:border-[var(--color-primary)]">
                      <input
                        type="checkbox"
                        checked={selectedCourseIds.includes(course.id)}
                        onChange={() => toggleCourse(course.id)}
                        className="mt-0.5"
                      />
                      <span className="text-sm text-[var(--color-foreground)]">{courseLabel(course)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveAssignments}
                disabled={saving}
                className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? t(`${Q}.saving`) : t(`${Q}.saveBtn`)}
              </button>
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium"
              >
                {t(`${Q}.cancelBtn`)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
