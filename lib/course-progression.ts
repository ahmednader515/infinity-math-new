import {
  mergeCourseContentItems,
  normalizeQuizTypeValue,
  findRemedialForParent,
  remedialChildIdsInCourse,
} from "./course-content";

export type ProgressionContentRow = {
  type: "lesson" | "quiz";
  /** Stable slot id (lesson id or normal quiz id). */
  slotId: string;
  /** Id used for links (lesson id or active quiz id including remedial). */
  targetId: string;
  order: number;
  title: string;
  locked: boolean;
  completed: boolean;
  isRemedial: boolean;
  questionsCount?: number;
  lesson?: Record<string, unknown>;
  quiz?: Record<string, unknown>;
};

export type CourseProgressionState = {
  rows: ProgressionContentRow[];
  /** Highest index the student may open (0-based). */
  maxUnlockedIndex: number;
};

type BuildProgressionInput = {
  lessons: Record<string, unknown>[];
  quizzes: Record<string, unknown>[];
  completedLessonIds: Set<string>;
  submittedQuizIds: Set<string>;
  passedQuizIds: Set<string>;
  sequentialLockEnabled: boolean;
};

/**
 * Build ordered content rows with lock/completed flags.
 * Normal quiz failed → slot shows remedial quiz until remedial is passed.
 * Quiz completion uses any passing submitted attempt (supports unlimited retries).
 */
export function buildCourseProgressionState(input: BuildProgressionInput): CourseProgressionState {
  const {
    lessons,
    quizzes,
    completedLessonIds,
    submittedQuizIds,
    passedQuizIds,
    sequentialLockEnabled,
  } = input;
  const childRemedialIds = remedialChildIdsInCourse(quizzes);
  const quizzesForMerge = quizzes.filter((q) => !childRemedialIds.has(String(q.id)));
  const merged = mergeCourseContentItems(lessons, quizzesForMerge);

  const rows: ProgressionContentRow[] = merged.map((item) => {
    if (item.type === "lesson") {
      const l = item.data;
      return {
        type: "lesson",
        slotId: item.id,
        targetId: item.id,
        order: item.order,
        title: String(l.titleAr ?? l.title_ar ?? l.title ?? ""),
        locked: false,
        completed: completedLessonIds.has(item.id),
        isRemedial: false,
        lesson: l,
      };
    }

    const normalQuiz = item.data;
    const normalId = item.id;
    const remedial = findRemedialForParent(quizzes, normalId);
    const remedialId = remedial ? String(remedial.id) : null;
    const normalPassed = passedQuizIds.has(normalId);
    const remedialPassed = remedialId ? passedQuizIds.has(remedialId) : false;
    const normalFailed = submittedQuizIds.has(normalId) && !normalPassed;

    let activeQuiz = normalQuiz;
    let activeId = normalId;
    let isRemedial = false;

    if (!normalPassed && remedial && normalFailed && !remedialPassed) {
      activeQuiz = remedial;
      activeId = remedialId!;
      isRemedial = true;
    } else if (!normalPassed && remedial && remedialPassed) {
      activeQuiz = remedial;
      activeId = remedialId!;
      isRemedial = true;
    }

    const completed = normalPassed || remedialPassed;

    return {
      type: "quiz",
      slotId: normalId,
      targetId: activeId,
      order: item.order,
      title: String(activeQuiz.title ?? ""),
      locked: false,
      completed,
      isRemedial,
      questionsCount: Number((activeQuiz as { _count?: { questions?: number } })._count?.questions ?? 0),
      quiz: activeQuiz,
    };
  });

  if (sequentialLockEnabled && rows.length > 0) {
    let chainUnlocked = true;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (i === 0) {
        row.locked = false;
      } else {
        row.locked = !chainUnlocked;
      }
      if (row.locked) chainUnlocked = false;
      else if (!row.completed) chainUnlocked = false;
    }
  }

  let maxUnlockedIndex = rows.length - 1;
  if (sequentialLockEnabled) {
    maxUnlockedIndex = rows.findIndex((r) => r.locked);
    if (maxUnlockedIndex === -1) maxUnlockedIndex = rows.length - 1;
  }

  return { rows, maxUnlockedIndex };
}

export function isProgressionTargetUnlocked(
  state: CourseProgressionState,
  type: "lesson" | "quiz",
  targetId: string,
): boolean {
  const idx = state.rows.findIndex((r) => r.type === type && r.targetId === targetId);
  if (idx === -1) {
    const slotIdx = state.rows.findIndex((r) => r.slotId === targetId);
    if (slotIdx === -1) return false;
    return !state.rows[slotIdx].locked;
  }
  return !state.rows[idx].locked;
}

export function findProgressionRowForLesson(
  state: CourseProgressionState,
  lessonId: string,
): ProgressionContentRow | undefined {
  return state.rows.find((r) => r.type === "lesson" && r.targetId === lessonId);
}

export function findProgressionRowForQuiz(
  state: CourseProgressionState,
  quizId: string,
): ProgressionContentRow | undefined {
  return state.rows.find(
    (r) => r.type === "quiz" && (r.targetId === quizId || r.slotId === quizId),
  );
}

/** Next content item after a completed quiz slot (for navigation after pass). */
export function getNextProgressionRowAfterQuiz(
  state: CourseProgressionState,
  quizId: string,
): ProgressionContentRow | undefined {
  const idx = state.rows.findIndex(
    (r) => r.type === "quiz" && (r.targetId === quizId || r.slotId === quizId),
  );
  if (idx < 0) return undefined;
  const current = state.rows[idx];
  if (!current.completed) return undefined;
  const next = state.rows[idx + 1];
  if (!next || next.locked) return undefined;
  return next;
}
