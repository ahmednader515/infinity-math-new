import type { CourseContentOrderEntry } from "@/lib/save-course-quizzes";

export type ParentQuizRef =
  | { type: "owned"; index: number }
  | { type: "linked"; quizId: string };

export type QuestionOptionRow = { text: string; isCorrect: boolean };
export type QuestionRow = {
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE";
  questionText: string;
  imageUrl: string;
  options: QuestionOptionRow[];
};

export type QuizRow = {
  id?: string;
  title: string;
  timeLimitMinutes: string;
  quizType: "NORMAL" | "REMEDIAL";
  parentQuizRef: ParentQuizRef | null;
  questions: QuestionRow[];
};

export type LinkedQuizRow = {
  quizId: string;
  title: string;
  ownerCourseTitle: string;
  ownerCourseTitleAr?: string | null;
  quizType?: string;
};

export type ContentOrderEntry = CourseContentOrderEntry;

export type LinkableQuizOption = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  courseTitleAr: string | null;
  questionCount: number;
};

export function resolveParentQuizRefFromId(
  parentQuizId: string | null | undefined,
  ownedQuizzes: Array<{ id?: string }>,
  linkedQuizzes: LinkedQuizRow[],
): ParentQuizRef | null {
  const pid = parentQuizId?.trim();
  if (!pid) return null;
  const ownedIndex = ownedQuizzes.findIndex((q) => q.id === pid);
  if (ownedIndex >= 0) return { type: "owned", index: ownedIndex };
  if (linkedQuizzes.some((q) => q.quizId === pid)) return { type: "linked", quizId: pid };
  return null;
}

export function buildParentQuizOptions(
  contentOrder: ContentOrderEntry[],
  quizzes: QuizRow[],
  linkedQuizzes: LinkedQuizRow[],
  excludeOwnedIndex?: number,
): Array<{ ref: ParentQuizRef; label: string }> {
  const options: Array<{ ref: ParentQuizRef; label: string }> = [];
  for (const entry of contentOrder) {
    if (entry.type === "quiz") {
      if (entry.index === excludeOwnedIndex) continue;
      const quiz = quizzes[entry.index];
      if (!quiz || quiz.quizType !== "NORMAL") continue;
      const title = quiz.title.trim() || `#${entry.index + 1}`;
      options.push({ ref: { type: "owned", index: entry.index }, label: title });
    } else if (entry.type === "linkedQuiz") {
      const linked = linkedQuizzes.find((l) => l.quizId === entry.quizId);
      if (!linked || (linked.quizType ?? "NORMAL") !== "NORMAL") continue;
      options.push({
        ref: { type: "linked", quizId: entry.quizId },
        label: `${linked.title} (${linked.ownerCourseTitleAr ?? linked.ownerCourseTitle})`,
      });
    }
  }
  return options;
}

export function parentRefKey(ref: ParentQuizRef | null | undefined): string {
  if (!ref) return "";
  return ref.type === "owned" ? `owned:${ref.index}` : `linked:${ref.quizId}`;
}

export function parentRefFromKey(
  key: string,
  linkedQuizzes: LinkedQuizRow[],
): ParentQuizRef | null {
  if (!key) return null;
  if (key.startsWith("owned:")) {
    const index = parseInt(key.slice(6), 10);
    return Number.isFinite(index) ? { type: "owned", index } : null;
  }
  if (key.startsWith("linked:")) {
    const quizId = key.slice(7);
    return linkedQuizzes.some((l) => l.quizId === quizId) ? { type: "linked", quizId } : null;
  }
  return null;
}
