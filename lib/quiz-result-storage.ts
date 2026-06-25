export type StoredQuizResult = {
  attemptId: string;
  quizId: string;
  answers: Record<string, string>;
  questions: Array<{
    id: string;
    type: string;
    questionText: string;
    imageUrl?: string | null;
    order: number;
    options: Array<{ id: string; text: string; isCorrect: boolean }>;
  }>;
};

const key = (attemptId: string) => `quiz-result-${attemptId}`;

export function saveQuizResultToSession(data: StoredQuizResult): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(data.attemptId), JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
}

export function loadQuizResultFromSession(attemptId: string): StoredQuizResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key(attemptId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredQuizResult;
  } catch {
    return null;
  }
}
