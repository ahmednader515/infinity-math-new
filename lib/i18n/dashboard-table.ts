"use client";

/** Table + header alignment for RTL Arabic dashboard. */
export function useDashboardTable() {
  const thClass =
    "px-3 py-2 text-start text-sm font-semibold text-[var(--color-foreground)]";
  const thClassCompact =
    "p-2 text-start text-sm font-medium text-[var(--color-foreground)]";
  return { locale: "ar" as const, dir: "rtl" as const, thClass, thClassCompact };
}

export function dateLocaleForUi(): string {
  return "ar-EG";
}
