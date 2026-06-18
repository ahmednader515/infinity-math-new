-- ربط الواجب بالحصة: كل حصة يمكن أن تكون لها استلام واجب
-- تشغيله مرة واحدة من لوحة Neon: SQL Editor (بعد add-homework.sql)
--
-- ملاحظة: في قاعدة Infinity Math الحالية الحصص مخزّنة في جدول "Chapter"
-- (وليس "Lesson"). عمود lesson_id يشير إلى معرّف الفصل/الحصة في "Chapter".

-- 1) إضافة خيار "استلام الواجب" للحصة
ALTER TABLE "Chapter" ADD COLUMN IF NOT EXISTS accepts_homework BOOLEAN NOT NULL DEFAULT false;

-- 2) ربط التسليم بالحصة (اختياري للتسليمات القديمة المرتبطة بالكورس فقط)
ALTER TABLE "HomeworkSubmission" ADD COLUMN IF NOT EXISTS lesson_id TEXT REFERENCES "Chapter"(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "HomeworkSubmission_lesson_id_idx" ON "HomeworkSubmission"(lesson_id);
