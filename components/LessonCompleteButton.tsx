"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./LocaleProvider";

type Props = {
  lessonId: string;
  courseId: string;
  initialCompleted: boolean;
};

export function LessonCompleteButton({ lessonId, courseId, initialCompleted }: Props) {
  const t = useT();
  const router = useRouter();
  const [completed, setCompleted] = useState(initialCompleted);
  const [loading, setLoading] = useState(false);

  const markComplete = useCallback(async () => {
    if (completed || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      if (res.ok) {
        setCompleted(true);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }, [completed, loading, lessonId, courseId, router]);

  if (completed) {
    return (
      <p className="mt-6 text-sm font-medium text-[var(--color-success)]">
        ✓ {t("courses.lessonCompleted", "Lesson completed")}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void markComplete()}
      disabled={loading}
      className="mt-6 inline-flex items-center gap-2 rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
    >
      {loading ? t("courses.completingLesson", "Saving...") : t("courses.markLessonComplete", "Mark lesson as complete")}
    </button>
  );
}
