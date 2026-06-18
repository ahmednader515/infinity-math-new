import {
  buildCourseProgressionState,
  findProgressionRowForLesson,
  findProgressionRowForQuiz,
  getNextProgressionRowAfterQuiz,
  type CourseProgressionState,
} from "./course-progression";
import { QUIZ_PASS_PERCENT } from "./course-content";
import { progressionRowToNavLink, type ProgressionNavLink } from "./course-progression-nav";
import {
  getCompletedLessonIdsForCourse,
  getQuizProgressSets,
} from "./db";

const STAFF_ROLES = new Set(["ADMIN", "ASSISTANT_ADMIN", "TEACHER"]);

export function shouldApplySequentialProgression(
  role: string | null | undefined,
  hasFullStudentAccess: boolean,
): boolean {
  if (role && STAFF_ROLES.has(role)) return false;
  if (role !== "STUDENT") return false;
  return hasFullStudentAccess;
}

export async function resolveCourseProgression(
  userId: string | null | undefined,
  role: string | null | undefined,
  hasFullStudentAccess: boolean,
  courseId: string,
  lessons: Record<string, unknown>[],
  quizzes: Record<string, unknown>[],
): Promise<CourseProgressionState> {
  const sequentialLockEnabled = shouldApplySequentialProgression(role, hasFullStudentAccess);

  if (!userId || !sequentialLockEnabled) {
    return buildCourseProgressionState({
      lessons,
      quizzes,
      completedLessonIds: new Set<string>(),
      submittedQuizIds: new Set<string>(),
      passedQuizIds: new Set<string>(),
      sequentialLockEnabled: false,
    });
  }

  const quizIds = quizzes.map((q) => String(q.id));
  const [completedLessonIds, quizProgress] = await Promise.all([
    getCompletedLessonIdsForCourse(userId, courseId),
    getQuizProgressSets(userId, quizIds, QUIZ_PASS_PERCENT),
  ]);

  return buildCourseProgressionState({
    lessons,
    quizzes,
    completedLessonIds,
    submittedQuizIds: quizProgress.submitted,
    passedQuizIds: quizProgress.passed,
    sequentialLockEnabled: true,
  });
}

export async function isContentUnlockedInProgression(
  userId: string,
  role: string | null | undefined,
  hasFullStudentAccess: boolean,
  courseId: string,
  contentType: "lesson" | "quiz",
  contentId: string,
  lessons: Record<string, unknown>[],
  quizzes: Record<string, unknown>[],
): Promise<boolean> {
  if (!shouldApplySequentialProgression(role, hasFullStudentAccess)) return true;
  const state = await resolveCourseProgression(
    userId,
    role,
    hasFullStudentAccess,
    courseId,
    lessons,
    quizzes,
  );
  if (contentType === "lesson") {
    const row = findProgressionRowForLesson(state, contentId);
    return !!row && !row.locked;
  }
  const row = findProgressionRowForQuiz(state, contentId);
  return !!row && !row.locked && row.targetId === contentId;
}

export async function getNextNavAfterQuizSubmit(
  userId: string,
  role: string | null | undefined,
  hasFullStudentAccess: boolean,
  course: { id: string; slug?: string | null },
  lessons: Record<string, unknown>[],
  quizzes: Record<string, unknown>[],
  quizId: string,
  labels: { lesson: string; quiz: string },
): Promise<ProgressionNavLink | null> {
  const state = await resolveCourseProgression(
    userId,
    role,
    hasFullStudentAccess,
    course.id,
    lessons,
    quizzes,
  );
  const next = getNextProgressionRowAfterQuiz(state, quizId);
  if (!next) return null;
  return progressionRowToNavLink(course, next, labels);
}

export function getNextNavFromProgression(
  course: { id: string; slug?: string | null },
  state: CourseProgressionState,
  quizId: string,
  labels: { lesson: string; quiz: string },
): ProgressionNavLink | null {
  const next = getNextProgressionRowAfterQuiz(state, quizId);
  if (!next) return null;
  return progressionRowToNavLink(course, next, labels);
}
