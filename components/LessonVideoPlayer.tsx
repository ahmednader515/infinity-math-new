"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { PlyrVideoPlayer } from "./plyr-video-player";

type Props = {
  youtubeVideoId: string;
  storageKey: string;
  className?: string;
  lessonId: string;
  courseId: string;
  markCompleteOnEnd: boolean;
  copyrightOverlay?: React.ReactNode;
};

export function LessonVideoPlayer({
  youtubeVideoId,
  storageKey,
  className,
  lessonId,
  courseId,
  markCompleteOnEnd,
  copyrightOverlay,
}: Props) {
  const router = useRouter();

  const onEnded = useCallback(() => {
    if (!markCompleteOnEnd) return;
    void fetch(`/api/lessons/${encodeURIComponent(lessonId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ courseId }),
    }).then((res) => {
      if (res.ok) router.refresh();
    });
  }, [lessonId, courseId, markCompleteOnEnd, router]);

  return (
    <div className="lesson-video-shell relative w-full min-w-0 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-black">
      <PlyrVideoPlayer
        key={`${storageKey}-${youtubeVideoId}`}
        youtubeVideoId={youtubeVideoId}
        storageKey={storageKey}
        className={className}
        onEnded={onEnded}
      />
      {copyrightOverlay}
    </div>
  );
}
