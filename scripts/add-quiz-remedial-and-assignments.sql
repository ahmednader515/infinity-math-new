-- Remedial quizzes + multi-course quiz linking
-- Run in Neon SQL Editor or: psql $DATABASE_URL -f scripts/add-quiz-remedial-and-assignments.sql
--
-- Compatible with legacy (camelCase) and modern (snake_case) Quiz columns.

-- quizType + parentQuizId on Quiz (legacy camelCase — matches live Infinity Math schema)
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS "quizType" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS "parentQuizId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Quiz_parentQuizId_fkey'
  ) THEN
    ALTER TABLE "Quiz"
      ADD CONSTRAINT "Quiz_parentQuizId_fkey"
      FOREIGN KEY ("parentQuizId") REFERENCES "Quiz"(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Modern snake_case columns (if app uses modern schema)
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS quiz_type TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS parent_quiz_id TEXT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Quiz_parent_quiz_id_fkey'
  ) THEN
    ALTER TABLE "Quiz"
      ADD CONSTRAINT "Quiz_parent_quiz_id_fkey"
      FOREIGN KEY (parent_quiz_id) REFERENCES "Quiz"(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Junction table: assign one quiz to multiple courses
CREATE TABLE IF NOT EXISTS "QuizCourseAssignment" (
  id TEXT PRIMARY KEY,
  "quizId" TEXT NOT NULL REFERENCES "Quiz"(id) ON DELETE CASCADE,
  "courseId" TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("quizId", "courseId")
);

CREATE INDEX IF NOT EXISTS "QuizCourseAssignment_courseId_idx" ON "QuizCourseAssignment"("courseId");
CREATE INDEX IF NOT EXISTS "QuizCourseAssignment_quizId_idx" ON "QuizCourseAssignment"("quizId");
