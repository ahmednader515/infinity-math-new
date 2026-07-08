"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QuizApiPayload } from "./QuizPageClient";
import { useT } from "@/components/LocaleProvider";
import { saveQuizResultToSession } from "@/lib/quiz-result-storage";

function resultsPath(
  course: QuizApiPayload["course"],
  quizId: string,
  attemptId: string,
  viewingCourseId?: string,
): string {
  const seg = course.slug?.trim()
    ? encodeURIComponent(course.slug.trim())
    : course.id;
  const params = new URLSearchParams({ attemptId });
  if (viewingCourseId) params.set("courseId", viewingCourseId);
  return `/courses/${seg}/quizzes/${encodeURIComponent(quizId)}/results?${params.toString()}`;
}

export function QuizTake({
  quiz,
  viewingCourseId,
}: {
  quiz: QuizApiPayload;
  viewingCourseId?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [started, setStarted] = useState(Boolean(quiz.inProgressAttemptId));
  const [attemptId, setAttemptId] = useState<string | null>(quiz.inProgressAttemptId ?? null);
  const [starting, setStarting] = useState(false);
  const [wantsRetry, setWantsRetry] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const timeLimitMinutes = quiz.timeLimitMinutes ?? null;
  const totalSeconds =
    timeLimitMinutes != null && Number(timeLimitMinutes) > 0
      ? Math.floor(Number(timeLimitMinutes)) * 60
      : 0;
  const [remainingSeconds, setRemainingSeconds] = useState(totalSeconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeUpSubmitStartedRef = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const canAttempt = quiz.canAttempt !== false;
  const attemptsUsed = typeof quiz.attemptsUsed === "number" ? quiz.attemptsUsed : null;
  const maxQuizAttempts = typeof quiz.maxQuizAttempts === "number" ? quiz.maxQuizAttempts : null;
  const hasSubmitted = Boolean(quiz.hasSubmitted);
  const canRetry =
    maxQuizAttempts == null || (attemptsUsed != null && attemptsUsed < maxQuizAttempts);

  const showPreviousResult =
    hasSubmitted && !wantsRetry && !started && quiz.latestAttemptId;

  function setAnswer(questionId: string, value: string) {
    setAnswers((a) => ({ ...a, [questionId]: value }));
  }

  const allAnswered = quiz.questions.every((q) => {
    const a = answers[q.id];
    if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") return a !== undefined && a !== "";
    return true;
  });

  const totalScored = quiz.questions.filter(
    (q) => q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE",
  ).length;

  function calculateScoreFromAnswers(ans: Record<string, string>) {
    let s = 0;
    quiz.questions.forEach((q) => {
      if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") {
        const opt = q.options.find((o) => o.id === ans[q.id]);
        if (opt?.isCorrect) s++;
      }
    });
    return s;
  }

  const submitAnswers = useCallback(
    async (reason?: "timeup") => {
      const currentAnswers = answersRef.current;
      const s = calculateScoreFromAnswers(currentAnswers);
      setSubmitting(true);
      try {
        const res = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            score: s,
            totalQuestions: totalScored,
            attemptId,
            courseId: viewingCourseId ?? quiz.courseId,
            answers: currentAnswers,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error ?? t("quiz.saveResultFailed", "Failed to save result"));
          if (reason === "timeup") timeUpSubmitStartedRef.current = false;
          setSubmitting(false);
          return;
        }
        const data = await res.json().catch(() => ({}));
        const savedAttemptId =
          typeof data.attemptId === "string" ? data.attemptId : attemptId ?? "";
        if (savedAttemptId) {
          saveQuizResultToSession({
            attemptId: savedAttemptId,
            quizId: quiz.id,
            answers: currentAnswers,
            questions: quiz.questions,
          });
          router.push(resultsPath(quiz.course, quiz.id, savedAttemptId, viewingCourseId ?? quiz.courseId));
          return;
        }
        alert(t("quiz.saveResultFailed", "Failed to save result"));
        if (reason === "timeup") timeUpSubmitStartedRef.current = false;
      } catch {
        alert(t("quiz.serverConnectionFailed", "Failed to connect to server"));
        if (reason === "timeup") timeUpSubmitStartedRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [attemptId, quiz, t, totalScored, viewingCourseId, router],
  );

  async function handleStart() {
    if (!canAttempt || starting || started) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/quizzes/${encodeURIComponent(quiz.id)}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: viewingCourseId ?? quiz.courseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error ?? t("quiz.cannotStartQuiz", "Unable to start quiz"));
        return;
      }
      const id = typeof data.attemptId === "string" ? data.attemptId : null;
      setAttemptId(id);
      setStarted(true);
      setAnswers({});
    } catch {
      alert(t("quiz.serverConnectionFailed", "Failed to connect to server"));
    } finally {
      setStarting(false);
    }
  }

  async function handleSubmit() {
    if (!allAnswered && remainingSeconds > 0) return;
    await submitAnswers();
  }

  useEffect(() => {
    timeUpSubmitStartedRef.current = false;
    if (!started || totalSeconds <= 0) return;
    setRemainingSeconds(totalSeconds);
    const id = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          if (intervalRef.current === id) intervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    intervalRef.current = id;
    return () => {
      clearInterval(id);
      if (intervalRef.current === id) intervalRef.current = null;
    };
  }, [started, totalSeconds]);

  useEffect(() => {
    if (!started || totalSeconds <= 0 || remainingSeconds > 0) return;
    if (timeUpSubmitStartedRef.current) return;
    timeUpSubmitStartedRef.current = true;
    void submitAnswers("timeup");
  }, [remainingSeconds, started, submitAnswers, totalSeconds]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const mm = Math.floor(remainingSeconds / 60);
  const ss = remainingSeconds % 60;
  const timeDisplay = `${mm}:${ss.toString().padStart(2, "0")}`;

  if (showPreviousResult && quiz.latestAttemptId) {
    const resultsHref = resultsPath(
      quiz.course,
      quiz.id,
      quiz.latestAttemptId,
      viewingCourseId ?? quiz.courseId,
    );
    return (
      <div className="mt-8 space-y-6">
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <p className="text-lg font-semibold text-[var(--color-foreground)]">
            {t("quiz.alreadySubmittedTitle", "You have already taken this quiz")}
          </p>
          {quiz.resultScore != null && quiz.resultTotal != null ? (
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {t("quiz.lastScore", "Your last score:")}{" "}
              {quiz.resultPercentage != null ? `${quiz.resultPercentage}% — ` : ""}
              {quiz.resultScore} {t("quiz.from", "out of")} {quiz.resultTotal}
            </p>
          ) : null}
          {quiz.hasPassed ? (
            <p className="mt-2 text-sm font-medium text-[var(--color-success)]">
              ✓ {t("quiz.statusPassed", "Passed")}
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
              {t("quiz.statusNotPassed", "Not passed")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={resultsHref}
            className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-3 font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            {t("quiz.viewResults", "View results")}
          </Link>
          {canRetry ? (
            <button
              type="button"
              onClick={() => setWantsRetry(true)}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 font-medium transition hover:border-[var(--color-primary)]/40"
            >
              {t("quiz.retryQuiz", "Retry quiz")}
            </button>
          ) : null}
          {quiz.nextContent ? (
            <Link
              href={quiz.nextContent.href}
              className="rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3 font-medium transition hover:border-[var(--color-primary)]/40"
            >
              {quiz.nextContent.type === "lesson"
                ? t("courses.nextLesson", "Next lesson")
                : t("courses.nextQuiz", "Next quiz")}{" "}
              →
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-8">
      {toastMessage && (
        <div
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-[var(--radius-btn)] border border-amber-500/50 bg-amber-500/15 px-4 py-2 text-sm font-medium text-amber-800 dark:text-amber-200 shadow-lg"
          role="alert"
        >
          {toastMessage}
        </div>
      )}

      {started && totalSeconds > 0 && (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <p className="text-sm font-medium text-[var(--color-foreground)]">
            {t("quiz.remainingTime", "Time left:")}{" "}
            <span className="font-mono text-[var(--color-primary)]">{timeDisplay}</span>
          </p>
        </div>
      )}

      {!started && !quiz.inProgressAttemptId ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <h3 className="text-lg font-semibold text-[var(--color-foreground)]">
            {t("quiz.readyTitle", "Ready to start the quiz?")}
          </h3>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {t(
              "quiz.readySubtitleSubmit",
              "When you click \"Start quiz\", your attempt will be recorded. After submitting, the next lesson or quiz will unlock.",
            )}
            {maxQuizAttempts != null && attemptsUsed != null ? (
              <span className="mr-1">
                {" "}
                ({t("quiz.usedAttempts", "Used")}: {attemptsUsed} {t("quiz.fromAttempts", "of")}{" "}
                {maxQuizAttempts})
              </span>
            ) : null}
          </p>
          {!canAttempt ? (
            <p className="mt-4 rounded-[var(--radius-btn)] border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {t("quiz.cannotAttempt", "You cannot start a new attempt for this quiz due to attempt limits.")}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleStart}
              disabled={!canAttempt || starting}
              className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-3 font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
            >
              {starting ? t("quiz.starting", "Starting...") : t("quiz.start", "Start quiz")}
            </button>
          </div>
        </div>
      ) : null}

      {started
        ? quiz.questions.map((q, i) => (
            <div
              key={q.id}
              className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6"
            >
              <p className="font-medium text-[var(--color-foreground)]">
                {i + 1}. {q.questionText}
              </p>
              {q.imageUrl ? (
                <img
                  src={q.imageUrl}
                  alt=""
                  className="mt-3 max-h-64 max-w-full rounded border border-[var(--color-border)] object-contain"
                />
              ) : null}
              <span className="mt-1 block text-xs text-[var(--color-muted)]">
                {q.type === "MULTIPLE_CHOICE"
                  ? t("quiz.multipleChoice", "Multiple choice")
                  : q.type === "TRUE_FALSE"
                    ? t("quiz.trueFalse", "True/False")
                    : t("quiz.essay", "Essay")}
              </span>
              {q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE" ? (
                <ul className="mt-4 space-y-2">
                  {q.options.map((opt) => (
                    <li key={opt.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded border border-[var(--color-border)] p-3 hover:bg-[var(--color-background)]">
                        <input
                          type="radio"
                          name={q.id}
                          value={opt.id}
                          checked={answers[q.id] === opt.id}
                          onChange={() => setAnswer(q.id, opt.id)}
                        />
                        <span>{opt.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <textarea
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswer(q.id, e.target.value)}
                  placeholder={t("quiz.essayPlaceholder", "Write your answer here...")}
                  rows={4}
                  className="mt-4 w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
                />
              )}
            </div>
          ))
        : null}

      {started ? (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={(!allAnswered && remainingSeconds > 0) || submitting}
          className="rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-6 py-3 font-medium text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
        >
          {submitting ? t("quiz.submitting", "Submitting...") : t("quiz.finishAndShowResult", "Finish and show result")}
        </button>
      ) : null}
    </div>
  );
}
