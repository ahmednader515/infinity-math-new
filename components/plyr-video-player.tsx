"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "plyr/dist/plyr.css";
import { useT } from "./LocaleProvider";
import { VideoQualityTutorialDialog } from "./video-quality-tutorial-dialog";
import {
  exitFullscreenSafe,
  getFullscreenElement,
  getFullscreenPortalTarget,
} from "@/lib/fullscreen";
import type Plyr from "plyr";

export interface PlyrVideoPlayerProps {
  youtubeVideoId: string;
  storageKey?: string;
  className?: string;
  onEnded?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
}

function readSavedProgress(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeSavedProgress(key: string, seconds: number) {
  try {
    localStorage.setItem(key, String(Math.max(0, seconds)));
  } catch {
    /* private mode / quota */
  }
}

function clearSavedProgress(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* */
  }
}

export function PlyrVideoPlayer({
  youtubeVideoId,
  storageKey,
  className = "",
  onEnded,
  onTimeUpdate,
}: PlyrVideoPlayerProps) {
  const t = useT();
  const youtubeContainerRef = useRef<HTMLDivElement>(null);
  const playerRootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Plyr | null>(null);
  const lastSaveRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [fullscreenContainer, setFullscreenContainer] = useState<Element | null>(null);
  const [qualityDialogOpen, setQualityDialogOpen] = useState(false);

  const progressStorageKey =
    storageKey ? `video-progress-${storageKey}` : `video-progress-yt-${youtubeVideoId}`;

  useEffect(() => {
    onEndedRef.current = onEnded;
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onEnded, onTimeUpdate]);

  const saveProgress = useCallback(
    (player: Plyr) => {
      const current = player.currentTime;
      if (!Number.isFinite(current) || current <= 0) return;
      writeSavedProgress(progressStorageKey, current);
    },
    [progressStorageKey]
  );

  const handleSeek = useCallback(
    (seconds: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const player = playerRef.current;
      if (!player) return;
      const duration = player.duration;
      if (!Number.isFinite(duration)) return;
      const next = Math.max(0, Math.min(player.currentTime + seconds, duration));
      player.currentTime = next;
      saveProgress(player);
    },
    [saveProgress]
  );

  const syncFullscreenContainer = useCallback(() => {
    setFullscreenContainer(
      getFullscreenPortalTarget(playerRef.current?.elements?.container ?? null)
    );
  }, []);

  const openQualityDialog = useCallback(async () => {
    await exitFullscreenSafe();
    setQualityDialogOpen(true);
  }, []);

  const closeQualityDialog = useCallback(() => {
    setQualityDialogOpen(false);
    window.location.reload();
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => syncFullscreenContainer();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, [syncFullscreenContainer]);

  useEffect(() => {
    const onViewportChange = () => {
      window.setTimeout(() => {
        syncFullscreenContainer();
        window.dispatchEvent(new Event("resize"));
      }, 300);
    };
    window.addEventListener("orientationchange", onViewportChange);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("orientationchange", onViewportChange);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [syncFullscreenContainer]);

  useEffect(() => {
    const saveOnLeave = () => {
      const player = playerRef.current;
      if (player) saveProgress(player);
    };
    window.addEventListener("pagehide", saveOnLeave);
    window.addEventListener("beforeunload", saveOnLeave);
    return () => {
      window.removeEventListener("pagehide", saveOnLeave);
      window.removeEventListener("beforeunload", saveOnLeave);
    };
  }, [saveProgress]);

  useEffect(() => {
    if (!youtubeVideoId) return;

    let isCancelled = false;

    async function setupPlayer() {
      const target = youtubeContainerRef.current;
      if (!target) return;

      const savedStartTime = Math.floor(readSavedProgress(progressStorageKey));

      try {
        playerRef.current?.destroy();
      } catch {
        /* */
      }
      playerRef.current = null;

      target.innerHTML = "";
      target.setAttribute("data-plyr-provider", "youtube");
      target.setAttribute("data-plyr-embed-id", youtubeVideoId);

      const plyrModule = await import("plyr");
      if (isCancelled) return;

      const PlyrConstructor = (plyrModule.default ?? plyrModule) as typeof Plyr;
      const youtubeConfig: Record<string, unknown> = { rel: 0, modestbranding: 1 };
      if (savedStartTime > 0) {
        youtubeConfig.start = savedStartTime;
      }

      const player = new PlyrConstructor(target, {
        controls: [
          "play-large",
          "play",
          "progress",
          "current-time",
          "duration",
          "mute",
          "volume",
          "captions",
          "settings",
          "pip",
          "airplay",
          "fullscreen",
        ],
        settings: ["speed", "loop"],
        speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
        youtube: youtubeConfig,
        ratio: "16:9",
        fullscreen: { enabled: true, fallback: true, iosNative: false },
      });

      if (isCancelled) {
        try {
          player.destroy();
        } catch {
          /* */
        }
        return;
      }

      playerRef.current = player;
      setIsPlayerReady(false);

      const seekToSaved = () => {
        if (savedStartTime <= 0) return;
        try {
          player.currentTime = savedStartTime;
        } catch {
          /* YouTube API may reject seek */
        }
      };

      player.on("ready", () => {
        if (isCancelled) return;
        setIsPlayerReady(true);
        seekToSaved();
      });

      player.on("pause", () => {
        if (isCancelled) return;
        saveProgress(player);
      });

      player.on("timeupdate", () => {
        if (isCancelled) return;
        const current = player.currentTime;
        onTimeUpdateRef.current?.(current);
        const now = Date.now();
        if (now - lastSaveRef.current >= 1000) {
          lastSaveRef.current = now;
          saveProgress(player);
        }
      });

      player.on("ended", () => {
        if (isCancelled) return;
        clearSavedProgress(progressStorageKey);
        onEndedRef.current?.();
      });

      player.on("enterfullscreen", () => {
        if (isCancelled) return;
        syncFullscreenContainer();
        requestAnimationFrame(syncFullscreenContainer);
      });

      player.on("exitfullscreen", () => {
        if (isCancelled) return;
        setFullscreenContainer(getFullscreenElement());
      });
    }

    void setupPlayer();

    return () => {
      isCancelled = true;
      setIsPlayerReady(false);
      try {
        playerRef.current?.destroy();
      } catch {
        /* */
      }
      playerRef.current = null;
      if (youtubeContainerRef.current) {
        youtubeContainerRef.current.innerHTML = "";
      }
    };
  }, [youtubeVideoId, progressStorageKey, saveProgress, syncFullscreenContainer]);

  const seekControls = (
    <div
      data-video-controls
      className="absolute bottom-12 left-2 z-[9999] flex gap-2"
    >
      <button
        type="button"
        onPointerDown={handleSeek(-10)}
        className="lesson-video-overlay-btn flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-black/75"
        aria-label={t("video.seekBack10", "Back 10 seconds")}
      >
        −10
      </button>
      <button
        type="button"
        onPointerDown={handleSeek(10)}
        className="lesson-video-overlay-btn flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-black/75"
        aria-label={t("video.seekForward10", "Forward 10 seconds")}
      >
        +10
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void openQualityDialog();
        }}
        className="lesson-video-overlay-btn flex h-10 min-w-10 items-center justify-center rounded-full bg-black/55 px-3 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/75"
        aria-label={t("video.changeQuality", "Change quality")}
      >
        {t("video.quality", "Quality")}
      </button>
    </div>
  );

  const overlayControls =
    !qualityDialogOpen &&
    isPlayerReady &&
    (fullscreenContainer ? createPortal(seekControls, fullscreenContainer) : seekControls);

  return (
    <div ref={playerRootRef} className={`lesson-plyr-video relative h-full w-full ${className}`.trim()}>
      <div ref={youtubeContainerRef} className="h-full w-full" />

      {overlayControls}

      <VideoQualityTutorialDialog open={qualityDialogOpen} onClose={closeQualityDialog} />
    </div>
  );
}
