import Link from "next/link";

type Props = {
  title: string;
  message: string;
  courseHref: string;
  courseTitle: string;
  backLabel: string;
  purchaseCourseLabel: string;
  activateCodeLabel: string;
};

export function CourseContentAccessDenied({
  title,
  message,
  courseHref,
  courseTitle,
  backLabel,
  purchaseCourseLabel,
  activateCodeLabel,
}: Props) {
  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-amber-500/30 bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-card)]">
        <div
          className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 text-3xl"
          aria-hidden
        >
          🔒
        </div>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-muted)]">{message}</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href={courseHref}
            className="inline-flex items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--color-primary-hover)]"
          >
            {purchaseCourseLabel}
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-5 py-2.5 text-sm font-medium text-[var(--color-foreground)] transition hover:border-[var(--color-primary)]/40"
          >
            {activateCodeLabel}
          </Link>
        </div>
        <p className="mt-6 text-xs text-[var(--color-muted)]">
          {backLabel}: {courseTitle}
        </p>
      </div>
    </div>
  );
}
