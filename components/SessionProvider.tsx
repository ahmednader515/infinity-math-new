"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";
import { ReactNode } from "react";

/** refetchInterval: إعادة التحقق من الجلسة — ٦٠ ثانية توازن بين الأمان وسرعة التحميل */
const SESSION_REFETCH_INTERVAL = 60;

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider refetchInterval={SESSION_REFETCH_INTERVAL}>
      {children}
    </NextAuthSessionProvider>
  );
}
