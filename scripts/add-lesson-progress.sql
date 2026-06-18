-- Lesson completion tracking for sequential course unlocking
CREATE TABLE IF NOT EXISTS "LessonProgress" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  lesson_id TEXT NOT NULL,
  course_id TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, lesson_id, course_id)
);

CREATE INDEX IF NOT EXISTS "LessonProgress_user_course_idx" ON "LessonProgress"(user_id, course_id);
