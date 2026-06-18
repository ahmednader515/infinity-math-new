"use client";

import { useEffect, useMemo } from "react";
import { useT } from "./LocaleProvider";

/** Tutorial shown in the quality dialog — user sets YouTube quality here; main lesson player reloads on close. */
export const QUALITY_TUTORIAL_YOUTUBE_ID = "hZulbl4ht4k";
export const QUALITY_TUTORIAL_START_SECONDS = 1;

type Props = {
  open: boolean;
  onClose: () => void;
};

export function VideoQualityTutorialDialog({ open, onClose }: Props) {
  const t = useT();

  const embedSrc = useMemo(() => {
    if (!open) return "";
    const params = new URLSearchParams({
      start: String(QUALITY_TUTORIAL_START_SECONDS),
      controls: "1",
      modestbranding: "1",
      rel: "0",
      enablejsapi: "1",
      playsinline: "1",
    });
    if (typeof window !== "undefined") {
      params.set("origin", window.location.origin);
    }
    return `https://www.youtube.com/embed/${QUALITY_TUTORIAL_YOUTUBE_ID}?${params.toString()}`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000001] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quality-tutorial-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(92vh,40rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[var(--color-border)] px-5 py-4">
          <h2 id="quality-tutorial-title" className="text-lg font-bold text-[var(--color-foreground)]">
            {t("video.qualityTutorialTitle", "How to change video quality")}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {t(
              "video.qualityTutorialIntro",
              "Use the video below: open Settings (gear), choose Quality, and pick your resolution. When you are done, close this window to apply the same quality to the lesson video."
            )}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
            <iframe
              key={embedSrc}
              title={t("video.qualityTutorialTitle", "How to change video quality")}
              src={embedSrc}
              className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
        </div>

        <div className="shrink-0 border-t border-[var(--color-border)] p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
          >
            {t("video.qualityTutorialClose", "Close and refresh player")}
          </button>
        </div>
      </div>
    </div>
  );
}
