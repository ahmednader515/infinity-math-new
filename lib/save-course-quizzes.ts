import { detectSchemaMode } from "./legacy-schema";
import {
  createQuiz,
  createQuestion,
  createQuestionOption,
  updateQuiz,
  deleteQuizById,
  deleteQuestionsByQuizId,
  getOwnedQuizIdsForCourse,
  syncQuizCourseAssignments,
  sql,
} from "./db";
import type { QuizType } from "./types";

type QuestionOptionInput = { text: string; isCorrect: boolean };
type QuestionInput = {
  type: "MULTIPLE_CHOICE" | "ESSAY" | "TRUE_FALSE";
  questionText: string;
  imageUrl?: string | null;
  options?: QuestionOptionInput[];
};

export type ParentQuizRef =
  | { type: "owned"; index: number }
  | { type: "linked"; quizId: string };

export type CourseQuizInput = {
  id?: string;
  title: string;
  timeLimitMinutes?: number | null;
  quizType?: QuizType;
  parentQuizRef?: ParentQuizRef | null;
  questions: QuestionInput[];
};

export type CourseContentOrderEntry =
  | { type: "lesson"; index: number }
  | { type: "quiz"; index: number }
  | { type: "linkedQuiz"; quizId: string };

function resolveParentQuizId(
  ref: ParentQuizRef | null | undefined,
  ownedQuizIds: string[],
): string | null {
  if (!ref) return null;
  if (ref.type === "linked") return ref.quizId?.trim() || null;
  if (ref.type === "owned") {
    const id = ownedQuizIds[ref.index];
    return id?.trim() || null;
  }
  return null;
}

async function createQuizQuestions(
  quizId: string,
  questions: QuestionInput[],
  legacy: boolean,
): Promise<void> {
  for (let qti = 0; qti < questions.length; qti++) {
    const qt = questions[qti];
    const qType = qt.type === "ESSAY" ? "ESSAY" : qt.type === "TRUE_FALSE" ? "TRUE_FALSE" : "MULTIPLE_CHOICE";
    const optionRows =
      (qt.type === "MULTIPLE_CHOICE" || qt.type === "TRUE_FALSE") && Array.isArray(qt.options)
        ? qt.options.map((o) => ({ text: o.text?.trim() || "", is_correct: !!o.isCorrect }))
        : [];
    const question = await createQuestion({
      quiz_id: quizId,
      type: qType,
      question_text: qt.questionText?.trim() || "",
      order: qti + 1,
      image_url: qt.imageUrl?.trim() || null,
      options: legacy ? optionRows : undefined,
    });
    if (!legacy && optionRows.length > 0) {
      for (let oi = 0; oi < optionRows.length; oi++) {
        const opt = optionRows[oi];
        await createQuestionOption({
          question_id: question.id,
          text: opt.text,
          is_correct: opt.is_correct,
          position: oi + 1,
        });
      }
    }
  }
}

export async function saveCourseQuizzes(params: {
  courseId: string;
  lessonsCount: number;
  quizzes: CourseQuizInput[];
  contentOrder: CourseContentOrderEntry[];
  replaceOwned?: boolean;
}): Promise<void> {
  const { courseId, lessonsCount, quizzes, contentOrder, replaceOwned = false } = params;
  const legacy = (await detectSchemaMode(sql)) === "legacy";
  const existingQuizIds = replaceOwned ? new Set(await getOwnedQuizIdsForCourse(courseId)) : new Set<string>();
  const keptQuizIds = new Set<string>();
  const ownedQuizIds: string[] = [];
  const pendingParentUpdates: Array<{ quizId: string; parentQuizRef: ParentQuizRef }> = [];

  for (let qi = 0; qi < quizzes.length; qi++) {
    const q = quizzes[qi];
    const mins = q.timeLimitMinutes;
    const timeLimitMinutes =
      typeof mins === "number" && Number.isFinite(mins) && mins >= 1 ? mins : null;
    const order = contentOrder.findIndex((e) => e.type === "quiz" && e.index === qi);
    const orderVal = order >= 0 ? order : lessonsCount + qi;
    const quizType: QuizType = q.quizType === "REMEDIAL" ? "REMEDIAL" : "NORMAL";
    const parentFromLinked =
      q.parentQuizRef?.type === "linked" ? resolveParentQuizId(q.parentQuizRef, ownedQuizIds) : null;
    const quizId = q.id?.trim();
    const quizPayload = {
      title: q.title?.trim() || `اختبار ${qi + 1}`,
      order: orderVal,
      time_limit_minutes: timeLimitMinutes,
      quiz_type: quizType,
      parent_quiz_id: parentFromLinked,
    };

    let activeQuizId: string;
    if (replaceOwned && quizId && existingQuizIds.has(quizId)) {
      await updateQuiz(quizId, quizPayload);
      await deleteQuestionsByQuizId(quizId);
      await createQuizQuestions(quizId, q.questions ?? [], legacy);
      activeQuizId = quizId;
    } else {
      const quiz = await createQuiz({
        course_id: courseId,
        ...quizPayload,
      });
      activeQuizId = quiz.id;
      await createQuizQuestions(activeQuizId, q.questions ?? [], legacy);
    }

    ownedQuizIds.push(activeQuizId);
    keptQuizIds.add(activeQuizId);

    if (quizType === "REMEDIAL" && q.parentQuizRef?.type === "owned") {
      pendingParentUpdates.push({ quizId: activeQuizId, parentQuizRef: q.parentQuizRef });
    }
  }

  if (replaceOwned) {
    for (const id of existingQuizIds) {
      if (!keptQuizIds.has(id)) {
        await deleteQuizById(id);
      }
    }
  }

  for (const pending of pendingParentUpdates) {
    const parentId = resolveParentQuizId(pending.parentQuizRef, ownedQuizIds);
    if (!parentId) continue;
    if (legacy) {
      await sql`UPDATE "Quiz" SET "parentQuizId" = ${parentId} WHERE id = ${pending.quizId}`;
    } else {
      await sql`UPDATE "Quiz" SET parent_quiz_id = ${parentId} WHERE id = ${pending.quizId}`;
    }
  }

  const linkedAssignments: Array<{ quizId: string; position: number }> = [];
  for (const entry of contentOrder) {
    if (entry.type !== "linkedQuiz") continue;
    const quizId = entry.quizId?.trim();
    if (!quizId) continue;
    const position = contentOrder.indexOf(entry);
    linkedAssignments.push({ quizId, position: position >= 0 ? position : linkedAssignments.length });
  }
  await syncQuizCourseAssignments(courseId, linkedAssignments);
}
