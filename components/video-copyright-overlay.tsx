"use client";

import { useEffect, useState } from "react";

type Props = {
  code: string;
  label: string;
  dir: "rtl" | "ltr";
  style?: "floating" | "watermark";
};

function VideoCopyrightFloatingBadge({ code, label, dir }: { code: string; label: string; dir: "rtl" | "ltr" }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const positions = [
    "right-3 top-3",
    "left-3 bottom-16",
    "left-3 top-10",
    "right-3 bottom-20",
    "left-1/2 top-4 -translate-x-1/2",
    "right-1/2 bottom-14 translate-x-1/2",
  ];
  const pos = positions[tick % positions.length];
  return (
    <div
      className={`pointer-events-none absolute z-[10] max-w-[min(90%,14rem)] select-none rounded-md border border-white/25 bg-black/60 px-2 py-1.5 text-[10px] font-semibold text-white/95 shadow-lg backdrop-blur-sm sm:text-[11px] ${pos}`}
      dir={dir}
      aria-hidden
    >
      <div className="text-[9px] font-normal text-white/75">{label}</div>
      <div className="font-mono tracking-widest">{code}</div>
    </div>
  );
}

function VideoCopyrightCenterWatermark({ code }: { code: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-[10] flex items-center justify-center overflow-hidden select-none px-4" aria-hidden>
      <div className="-rotate-[20deg] text-center font-mono font-bold uppercase tracking-[0.22em] text-white/15 [text-shadow:0_1px_2px_rgba(0,0,0,0.45)] [font-size:clamp(1.4rem,6vw,4.5rem)]">
        {code}
      </div>
    </div>
  );
}

export function VideoCopyrightOverlay({ code, label, dir, style = "floating" }: Props) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {style === "watermark" ? (
        <VideoCopyrightCenterWatermark code={code} />
      ) : (
        <VideoCopyrightFloatingBadge code={code} label={label} dir={dir} />
      )}
    </div>
  );
}
