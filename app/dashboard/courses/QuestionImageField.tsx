"use client";

import { useState } from "react";
import { useT } from "@/components/LocaleProvider";

export function QuestionImageField({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const t = useT();
  const Cf = "dashboard.courseForm";
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="mb-2">
      <label className="block text-xs font-medium text-[var(--color-muted)]">
        {t(`${Cf}.questionImageLabel`, "Question image (optional)")}
      </label>
      {value ? (
        <div className="mt-1 flex flex-wrap items-start gap-2">
          <img
            src={value}
            alt=""
            className="max-h-32 max-w-full rounded border border-[var(--color-border)] object-contain"
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-red-600 hover:underline"
          >
            {t(`${Cf}.remove`, "Remove")}
          </button>
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--color-border)]/50">
          {uploading ? t(`${Cf}.uploadingImage`) : t(`${Cf}.chooseImageUpload`)}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            disabled={uploading}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setError("");
              setUploading(true);
              try {
                const fd = new FormData();
                fd.set("file", f);
                const res = await fetch("/api/upload/image", { method: "POST", body: fd });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.url) {
                  onChange(String(data.url));
                } else {
                  const msg = data.missing?.length
                    ? `${data.error} ${data.missing.join(", ")}`
                    : (data.error || t(`${Cf}.uploadFailedDetail`));
                  setError(msg);
                }
              } catch {
                setError(t(`${Cf}.connectionFailedUpload`));
              } finally {
                setUploading(false);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      {error ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      <input
        type="url"
        value={value}
        onChange={(e) => {
          setError("");
          onChange(e.target.value);
        }}
        placeholder={t(`${Cf}.questionImageUrlPlaceholder`, "Or paste image URL")}
        className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
      />
    </div>
  );
}
