"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/LocaleProvider";
import { loadQuizResultFromSession } from "@/lib/quiz-result-storage";

type NextContent = { href: string; label: string; type: "lesson" | "quiz" };

type ResultsPayload = {
  attemptId: string;
  quiz: {
    id: string;
    title: string;
    courseId: string;
    course: { id: string; slug: string | null; title: string; titleAr: string | null };
    questions: Array<{
      id: string;
      type: string;
      questionText: string;
      imageUrl?: string | null;
      order: number;
      options: Array<{ id: string; text: string; isCorrect: boolean }>;
    }>;
  };
  result: {
    score: number;
    totalQuestions: number;
    percentage: number;
    passed: boolean;
    passThreshold: number;
    submittedAt: string;
    scoredQuestions: number;
    essayQuestions: number;
  };
  nextContent: NextContent | null;
  canRetry: boolean;
  attemptsUsed: number;
  maxQuizAttempts: number | null;
  answers?: Record<string, string>;
};

function courseHref(course: { slug: string | null; id: string }): string {
  return course.slug?.trim()
    ? `/courses/${encodeURIComponent(course.slug.trim())}`
    : `/courses/${course.id}`;
}

function quizHref(course: { slug: string | null; id: string }, quizId: string, courseId?: string): string {
  const base = course.slug?.trim()
    ? `/courses/${encodeURIComponent(course.slug.trim())}`
    : `/courses/${course.id}`;
  const qs = courseId ? `?courseId=${encodeURIComponent(courseId)}` : "";
  return `${base}/quizzes/${encodeURIComponent(quizId)}${qs}`;
}

export function QuizResultsClient({
  quizId,
  courseId,
  attemptId,
}: {
  quizId: string;
  courseId?: string;
  attemptId?: string;
}) {
  const t = useT();
  const [data, setData] = useState<ResultsPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (courseId) params.set("courseId", courseId);
    if (attemptId) params.set("attemptId", attemptId);
    const qs = params.toString() ? `?${params.toString()}` : "";

    fetch(`/api/quizzes/${encodeURIComponent(quizId)}/results${qs}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error ?? t("quiz.resultsLoadFailed", "Failed to load results"));
        }
        setData(json as ResultsPayload);
        const apiAnswers =
          json.answers && typeof json.answers === "object" ? (json.answers as Record<string, string>) : {};
        const stored = loadQuizResultFromSession(String(json.attemptId));
        const mergedAnswers =
          Object.keys(apiAnswers).length > 0
            ? apiAnswers
            : stored?.answers ?? {};
        setAnswers(mergedAnswers);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : t("quiz.resultsLoadFailed", "Failed to load results"));
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [quizId, courseId, attemptId, t]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="text-[var(--color-muted)]">{t("quiz.loadingResults", "Loading results...")}</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <p className="rounded-[var(--radius-btn)] border border-red-500/50 bg-red-500/10 px-4 py-3 text-red-600">
          {error ?? t("quiz.resultsNotFound", "Results not found")}
        </p>
        <Link href="/courses" className="mt-4 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline">
          ← {t("common.backToCourses", "Back to courses")}
        </Link>
      </div>
    );
  }

  const { quiz, result } = data;
  const courseTitle = quiz.course.titleAr ?? quiz.course.title;
  const courseLink = courseHref(quiz.course);
  const retryHref = quizHref(quiz.course, quiz.id, courseId);
  const hasAnswerReview = Object.keys(answers).length > 0;

  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  quiz.questions.forEach((q) => {
    if (q.type !== "MULTIPLE_CHOICE" && q.type !== "TRUE_FALSE") return;
    const selected = answers[q.id];
    if (!selected) {
      unansweredCount++;
      return;
    }
    const opt = q.options.find((o) => o.id === selected);
    if (opt?.isCorrect) correctCount++;
    else incorrectCount++;
  });

  const submittedDate = new Date(result.submittedAt);
  const dateStr = Number.isNaN(submittedDate.getTime())
    ? ""
    : submittedDate.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <Link href={courseLink} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
        ← {t("courses.backToCourse", "Back to")} {courseTitle}
      </Link>

      <header>
        <p className="text-sm font-medium text-[var(--color-muted)]">{t("quiz.resultsPageLabel", "Quiz results")}</p>
        <h1 className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">{quiz.title}</h1>
        {dateStr ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {t("quiz.submittedAt", "Submitted:")} {dateStr}
          </p>
        ) : null}
      </header>

      <div
        className={`rounded-[var(--radius-card)] border p-6 ${
          result.passed
            ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/10"
            : "border-amber-500/40 bg-amber-500/10"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-[var(--color-muted)]">{t("quiz.yourScore", "Your score")}</p>
            <p className="mt-1 text-4xl font-bold text-[var(--color-foreground)]">
              {result.percentage}%
            </p>
            <p className="mt-2 text-sm text-[var(--color-foreground)]">
              {result.score} {t("quiz.from", "out of")} {result.totalQuestions}{" "}
              {t("quiz.scoredQuestionsShort", "scored questions")}
            </p>
          </div>
          <span
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              result.passed
                ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
            }`}
          >
            {result.passed
              ? t("quiz.statusPassed", "Passed")
              : t("quiz.statusNotPassed", "Not passed")}
          </span>
        </div>
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          {t("quiz.passThresholdNote", "Pass threshold:")} {result.passThreshold}%
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-success)]">{correctCount}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t("quiz.correctCount", "Correct")}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{incorrectCount}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t("quiz.incorrectCount", "Incorrect")}</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--color-foreground)]">{unansweredCount}</p>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t("quiz.unansweredCount", "Unanswered")}</p>
        </div>
      </div>

      {result.essayQuestions > 0 ? (
        <p className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-muted)]">
          {t(
            "quiz.essayNotAutoCorrected",
            "Essay questions are not auto-graded; the teacher can review them later.",
          )}{" "}
          ({result.essayQuestions} {t("quiz.essayQuestionsCount", "essay questions")})
        </p>
      ) : null}

      <div className="rounded-[var(--radius-card)] border border-[var(--color-primary)]/30 bg-[var(--color-primary-light)]/20 p-4">
        <p className="text-sm font-medium text-[var(--color-foreground)]">
          {t("quiz.nextContentUnlocked", "The next lesson or quiz is now available in the course.")}
        </p>
      </div>

      {hasAnswerReview ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
            {t("quiz.answerReview", "Answer review")}
          </h2>
          {quiz.questions.map((q, i) => {
            if (q.type !== "MULTIPLE_CHOICE" && q.type !== "TRUE_FALSE") {
              return (
                <div
                  key={q.id}
                  className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
                >
                  <p className="font-medium text-[var(--color-foreground)]">
                    {i + 1}. {q.questionText}
                  </p>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">{t("quiz.essay", "Essay")}</p>
                  {answers[q.id] ? (
                    <p className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm">
                      {answers[q.id]}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--color-muted)]">{t("quiz.noAnswer", "No answer")}</p>
                  )}
                </div>
              );
            }

            const selectedId = answers[q.id];
            const selected = q.options.find((o) => o.id === selectedId);
            const correctOpt = q.options.find((o) => o.isCorrect);
            const isCorrect = !!selected?.isCorrect;

            return (
              <div
                key={q.id}
                className={`rounded-[var(--radius-card)] border p-5 ${
                  !selectedId
                    ? "border-[var(--color-border)] bg-[var(--color-surface)]"
                    : isCorrect
                      ? "border-[var(--color-success)]/40 bg-[var(--color-success)]/5"
                      : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-[var(--color-foreground)]">
                    {i + 1}. {q.questionText}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      !selectedId
                        ? "bg-[var(--color-muted)]/20 text-[var(--color-muted)]"
                        : isCorrect
                          ? "bg-[var(--color-success)]/20 text-[var(--color-success)]"
                          : "bg-red-500/20 text-red-600"
                    }`}
                  >
                    {!selectedId
                      ? t("quiz.unanswered", "Unanswered")
                      : isCorrect
                        ? t("quiz.correct", "Correct")
                        : t("quiz.incorrect", "Incorrect")}
                  </span>
                </div>
                {q.imageUrl ? (
                  <img
                    src={q.imageUrl}
                    alt=""
                    className="mt-3 max-h-48 max-w-full rounded border border-[var(--color-border)] object-contain"
                  />
                ) : null}
                <ul className="mt-4 space-y-2">
                  {q.options.map((opt) => {
                    const isSelected = selectedId === opt.id;
                    const showCorrect = opt.isCorrect;
                    return (
                      <li
                        key={opt.id}
                        className={`rounded border px-3 py-2 text-sm ${
                          showCorrect
                            ? "border-[var(--color-success)]/50 bg-[var(--color-success)]/10"
                            : isSelected
                              ? "border-red-500/50 bg-red-500/10"
                              : "border-[var(--color-border)] bg-[var(--color-background)]"
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          {isSelected ? <span className="font-medium">{t("quiz.yourChoice", "Your choice:")}</span> : null}
                          <span>{opt.text}</span>
                          {showCorrect ? (
                            <span className="text-[var(--color-success)]">✓ {t("quiz.correctAnswer", "Correct answer")}</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {!isCorrect && correctOpt ? (
                  <p className="mt-3 text-sm text-[var(--color-muted)]">
                    {t("quiz.correctWas", "Correct answer:")} <span className="font-medium text-[var(--color-foreground)]">{correctOpt.text}</span>
                  </p>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3 border-t border-[var(--color-border)] pt-6">
        {data.canRetry ? (
          <Link
            href={retryHref}
            className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 font-medium transition hover:border-[var(--color-primary)]/40"
          >
            {t("quiz.retryQuiz", "Retry quiz")}
            {data.maxQuizAttempts != null ? (
              <span className="mr-2 text-sm text-[var(--color-muted)]">
                ({data.attemptsUsed} / {data.maxQuizAttempts})
              </span>
            ) : null}
          </Link>
        ) : null}
        {data.nextContent ? (
          <Link
            href={data.nextContent.href}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-3 font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            {data.nextContent.type === "lesson"
              ? t("courses.nextLesson", "Next lesson")
              : t("courses.nextQuiz", "Next quiz")}{" "}
            →
          </Link>
        ) : null}
        <Link
          href={courseLink}
          className="rounded-[var(--radius-btn)] border border-[var(--color-border)] px-6 py-3 font-medium text-[var(--color-foreground)] hover:bg-[var(--color-background)]"
        >
          {t("quiz.backToCourseOutline", "Back to course content")}
        </Link>
      </div>
    </div>
  );
}
