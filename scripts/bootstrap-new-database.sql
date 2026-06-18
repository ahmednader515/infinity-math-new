-- ============================================================
-- Bootstrap NEW database (modern schema only)
-- Run on NEW_DATABASE_URL before migrate-legacy-to-new.mjs
-- Or use: npm run migrate:legacy-db -- --bootstrap
--
-- Step 1: run scripts/init-neon-database.sql (full base schema)
-- Step 2: run THIS file (patches for migration target)
-- ============================================================

-- Allow TEACHER role (init-neon-database only allows ADMIN/ASSISTANT_ADMIN/STUDENT)
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_check";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_allowed_values_check";
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname AS cname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'User'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE "User" DROP CONSTRAINT IF EXISTS %I', r.cname);
  END LOOP;
END $$;
ALTER TABLE "User" ADD CONSTRAINT "User_role_allowed_values_check"
  CHECK (role IN ('ADMIN', 'ASSISTANT_ADMIN', 'STUDENT', 'TEACHER'));

-- Teacher profile columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_subject TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_avatar_url TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS copyright_code VARCHAR(10);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS grade TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS study_type TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS governorate TEXT;

-- Remedial quizzes + multi-course linking
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS quiz_type TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS parent_quiz_id TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Quiz_parent_quiz_id_fkey') THEN
    ALTER TABLE "Quiz"
      ADD CONSTRAINT "Quiz_parent_quiz_id_fkey"
      FOREIGN KEY (parent_quiz_id) REFERENCES "Quiz"(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

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

-- Homework
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS accepts_homework BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS accepts_homework BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "HomeworkSubmission" (
  id              TEXT PRIMARY KEY,
  course_id       TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  submission_type TEXT NOT NULL CHECK (submission_type IN ('link', 'pdf', 'image')),
  link_url        TEXT,
  file_url        TEXT,
  file_name       TEXT,
  lesson_id       TEXT REFERENCES "Lesson"(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "HomeworkSubmission_course_id_idx" ON "HomeworkSubmission"(course_id);
CREATE INDEX IF NOT EXISTS "HomeworkSubmission_user_id_idx" ON "HomeworkSubmission"(user_id);
CREATE INDEX IF NOT EXISTS "HomeworkSubmission_lesson_id_idx" ON "HomeworkSubmission"(lesson_id);

-- Migration archive (unmappable legacy rows)
CREATE TABLE IF NOT EXISTS "_MigrationArchive" (
  id           TEXT PRIMARY KEY,
  source_table TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  payload      JSONB NOT NULL,
  migrated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "_MigrationArchive_source_table_idx" ON "_MigrationArchive"(source_table);
CREATE INDEX IF NOT EXISTS "_MigrationArchive_source_id_idx" ON "_MigrationArchive"(source_id);

-- Question images (legacy imageUrl)
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS image_url TEXT;
