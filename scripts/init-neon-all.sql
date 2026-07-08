-- ============================================================
-- تهيئة قاعدة بيانات Neon — ملف واحد شامل
-- يدمج init-neon-database.sql + جميع scripts/add-*.sql
-- تشغيل هذا الملف مرة واحدة من لوحة Neon: SQL Editor
--
-- متوافق مع قاعدة Infinity Math الحالية (legacy camelCase): يضيف أعمدة المخطط
-- الحديث، ينقل البيانات، ويُخفّف قيود NOT NULL على الأعمدة القديمة حتى يعمل التطبيق
-- بالمخطط الجديد (snake_case) دون مسار legacy.
--
-- يشمل: الجداول الأساسية، أكواد التفعيل، البث المباشر، التعليقات،
-- إعدادات الصفحة الرئيسية، المدرسين، الواجبات، الرسائل، المتجر،
-- الاشتراكات، تقييمات الدروس، وطلبات تغيير كلمة المرور.
-- ============================================================

-- دالة مساعدة: إنشاء فهرس فقط إذا وُجد العمود (آمن على قواعد legacy)
CREATE OR REPLACE FUNCTION _neon_create_index_if_column(
  p_table text,
  p_index text,
  p_column text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
  ) THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (%I)',
      p_index, p_table, p_column
    );
  END IF;
END;
$$;

-- دالة مساعدة: فهرس مركّب عند وجود كل الأعمدة
CREATE OR REPLACE FUNCTION _neon_create_index_if_columns(
  p_table text,
  p_index text,
  p_columns text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  col_list text;
  needed int;
  found int;
BEGIN
  needed := coalesce(array_length(p_columns, 1), 0);
  IF needed = 0 THEN RETURN; END IF;

  SELECT count(*)::int INTO found
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = p_table
    AND column_name = ANY (p_columns);

  IF found = needed THEN
    SELECT string_agg(format('%I', c), ', ' ORDER BY ord)
    INTO col_list
    FROM unnest(p_columns) WITH ORDINALITY AS t(c, ord);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I (%s)',
      p_index, p_table, col_list
    );
  END IF;
END;
$$;

-- دالة مساعدة: إزالة NOT NULL من عمود legacy (لتجنّب فشل INSERT بالمخطط الجديد)
CREATE OR REPLACE FUNCTION _neon_drop_not_null_if_column(
  p_table text,
  p_column text
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
      AND is_nullable = 'NO'
  ) THEN
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP NOT NULL', p_table, p_column);
  END IF;
END;
$$;

-- 1) المستخدمون
CREATE TABLE IF NOT EXISTS "User" (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'STUDENT' CHECK (role IN ('ADMIN', 'ASSISTANT_ADMIN', 'STUDENT', 'TEACHER')),
  balance        DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) التصنيفات
CREATE TABLE IF NOT EXISTS "Category" (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  name_ar     TEXT,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  image_url   TEXT,
  "order"        INT NOT NULL DEFAULT 0,
  created_by_id  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) الكورسات (تعتمد على User و Category)
CREATE TABLE IF NOT EXISTS "Course" (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  title_ar            TEXT,
  slug                TEXT NOT NULL UNIQUE,
  description         TEXT NOT NULL,
  description_en      TEXT,
  short_desc          VARCHAR(300),
  short_desc_en       VARCHAR(300),
  image_url           TEXT,
  price               DECIMAL(10, 2) NOT NULL DEFAULT 0,
  duration            TEXT,
  level               TEXT,
  is_published        BOOLEAN NOT NULL DEFAULT false,
  "order"             INT NOT NULL DEFAULT 0,
  max_quiz_attempts   INT,
  category_id         TEXT REFERENCES "Category"(id) ON DELETE SET NULL,
  created_by_id       TEXT REFERENCES "User"(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- أعمدة المخطط الحديث على Course (قد تكون الجداول legacy بدونها)
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS title_ar TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS short_desc VARCHAR(300);
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS short_desc_en VARCHAR(300);
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS duration TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "order" INT NOT NULL DEFAULT 0;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS max_quiz_attempts INT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS category_id TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS created_by_id TEXT;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS assigned_teacher_id TEXT REFERENCES "User"(id) ON DELETE SET NULL;
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- تعبئة slug من id للصفوف القديمة
UPDATE "Course" SET slug = id WHERE slug IS NULL AND id IS NOT NULL;

SELECT _neon_create_index_if_column('Course', 'Course_slug_idx', 'slug');
SELECT _neon_create_index_if_column('Course', 'Course_category_id_idx', 'category_id');
SELECT _neon_create_index_if_column('Course', 'Course_created_by_id_idx', 'created_by_id');

-- 4) الدروس
CREATE TABLE IF NOT EXISTS "Lesson" (
  id         TEXT PRIMARY KEY,
  course_id  TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  title_ar   TEXT,
  slug       TEXT NOT NULL,
  content    TEXT,
  video_url  TEXT,
  pdf_url    TEXT,
  duration   INT,
  "order"    INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, slug)
);

SELECT _neon_create_index_if_column('Lesson', 'Lesson_course_id_idx', 'course_id');
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Lesson' AND column_name = 'course_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Lesson' AND column_name = 'courseId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Lesson_courseId_idx" ON "Lesson" ("courseId")';
  END IF;
END $$;

-- 5) الاختبارات
CREATE TABLE IF NOT EXISTS "Quiz" (
  id                  TEXT PRIMARY KEY,
  course_id           TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  "order"             INT NOT NULL DEFAULT 0,
  time_limit_minutes   INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- أعمدة legacy/modern على Quiz
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS course_id TEXT;
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS "order" INT NOT NULL DEFAULT 0;
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS time_limit_minutes INT;
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'courseId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'course_id'
  ) THEN
    UPDATE "Quiz" SET course_id = "courseId" WHERE course_id IS NULL AND "courseId" IS NOT NULL;
  END IF;
END $$;

SELECT _neon_create_index_if_column('Quiz', 'Quiz_course_id_idx', 'course_id');
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'course_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'courseId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Quiz_courseId_idx" ON "Quiz" ("courseId")';
  END IF;
END $$;

-- 6) أسئلة الاختبار
CREATE TABLE IF NOT EXISTS "Question" (
  id            TEXT PRIMARY KEY,
  quiz_id       TEXT NOT NULL REFERENCES "Quiz"(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('MULTIPLE_CHOICE', 'ESSAY', 'TRUE_FALSE')),
  question_text TEXT NOT NULL,
  "order"       INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS quiz_id TEXT;
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS question_text TEXT;
ALTER TABLE "Question" ADD COLUMN IF NOT EXISTS "order" INT NOT NULL DEFAULT 0;
SELECT _neon_create_index_if_column('Question', 'Question_quiz_id_idx', 'quiz_id');
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'quiz_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'quizId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "Question_quizId_idx" ON "Question" ("quizId")';
  END IF;
END $$;

-- 7) خيارات الأسئلة
CREATE TABLE IF NOT EXISTS "QuestionOption" (
  id          TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES "Question"(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT false,
  position    INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT _neon_create_index_if_column('QuestionOption', 'QuestionOption_question_id_idx', 'question_id');
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuestionOption' AND column_name = 'question_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuestionOption' AND column_name = 'questionId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "QuestionOption_questionId_idx" ON "QuestionOption" ("questionId")';
  END IF;
END $$;

-- 8) التسجيل في الكورسات (legacy: جدول Purchase بـ userId/courseId)
CREATE TABLE IF NOT EXISTS "Enrollment" (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  course_id   TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);

SELECT _neon_create_index_if_column('Enrollment', 'Enrollment_user_id_idx', 'user_id');
SELECT _neon_create_index_if_column('Enrollment', 'Enrollment_course_id_idx', 'course_id');
SELECT _neon_create_index_if_column('Purchase', 'Purchase_userId_idx', 'userId');
SELECT _neon_create_index_if_column('Purchase', 'Purchase_courseId_idx', 'courseId');
SELECT _neon_create_index_if_columns('Purchase', 'Purchase_userId_courseId_idx', ARRAY['userId', 'courseId']);

-- 8.5) أكواد التفعيل (لكورس كامل أو حصص محددة)
CREATE TABLE IF NOT EXISTS "ActivationCode" (
  id               TEXT PRIMARY KEY,
  course_id        TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  code             TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at          TIMESTAMPTZ,
  used_by_user_id  TEXT REFERENCES "User"(id) ON DELETE SET NULL
);

SELECT _neon_create_index_if_column('ActivationCode', 'ActivationCode_course_id_idx', 'course_id');
SELECT _neon_create_index_if_column('ActivationCode', 'ActivationCode_code_idx', 'code');
SELECT _neon_create_index_if_column('ActivationCode', 'ActivationCode_created_at_idx', 'created_at');
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ActivationCode' AND column_name = 'courseId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivationCode_courseId_idx" ON "ActivationCode" ("courseId")';
  END IF;
END $$;

-- ربط الكود بحصص محددة داخل الكورس (اختياري)
-- legacy: Chapter — modern: Lesson
DO $acl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ActivationCodeLesson'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Lesson'
    ) THEN
      CREATE TABLE "ActivationCodeLesson" (
        activation_code_id TEXT NOT NULL REFERENCES "ActivationCode"(id) ON DELETE CASCADE,
        lesson_id          TEXT NOT NULL REFERENCES "Lesson"(id) ON DELETE CASCADE,
        PRIMARY KEY (activation_code_id, lesson_id)
      );
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Chapter'
    ) THEN
      CREATE TABLE "ActivationCodeLesson" (
        activation_code_id TEXT NOT NULL REFERENCES "ActivationCode"(id) ON DELETE CASCADE,
        lesson_id          TEXT NOT NULL REFERENCES "Chapter"(id) ON DELETE CASCADE,
        PRIMARY KEY (activation_code_id, lesson_id)
      );
    END IF;
  END IF;
END
$acl$;
SELECT _neon_create_index_if_column('ActivationCodeLesson', 'ActivationCodeLesson_code_idx', 'activation_code_id');
SELECT _neon_create_index_if_column('ActivationCodeLesson', 'ActivationCodeLesson_lesson_idx', 'lesson_id');

-- ربط الكود باختبارات محددة داخل الكورس (اختياري)
CREATE TABLE IF NOT EXISTS "ActivationCodeQuiz" (
  activation_code_id TEXT NOT NULL REFERENCES "ActivationCode"(id) ON DELETE CASCADE,
  quiz_id            TEXT NOT NULL REFERENCES "Quiz"(id) ON DELETE CASCADE,
  PRIMARY KEY (activation_code_id, quiz_id)
);

SELECT _neon_create_index_if_column('ActivationCodeQuiz', 'ActivationCodeQuiz_code_idx', 'activation_code_id');
SELECT _neon_create_index_if_column('ActivationCodeQuiz', 'ActivationCodeQuiz_quiz_idx', 'quiz_id');
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ActivationCodeQuiz' AND column_name = 'quizId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ActivationCodeQuiz_quizId_idx" ON "ActivationCodeQuiz" ("quizId")';
  END IF;
END $$;

-- 9) محاولات الاختبار (legacy: studentId/quizId — modern: user_id/quiz_id + score)
CREATE TABLE IF NOT EXISTS "QuizAttempt" (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  quiz_id         TEXT NOT NULL REFERENCES "Quiz"(id) ON DELETE CASCADE,
  score           INT NOT NULL,
  total_questions INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS quiz_id TEXT;
ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS score INT;
ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS total_questions INT;
ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "QuizAttempt" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'studentId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'user_id'
  ) THEN
    UPDATE "QuizAttempt" SET user_id = "studentId" WHERE user_id IS NULL AND "studentId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'quizId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'quiz_id'
  ) THEN
    UPDATE "QuizAttempt" SET quiz_id = "quizId" WHERE quiz_id IS NULL AND "quizId" IS NOT NULL;
  END IF;
END $$;

SELECT _neon_create_index_if_columns('QuizAttempt', 'QuizAttempt_user_quiz_idx', ARRAY['user_id', 'quiz_id']);
SELECT _neon_create_index_if_column('QuizAttempt', 'QuizAttempt_user_id_idx', 'user_id');
SELECT _neon_create_index_if_columns('QuizAttempt', 'QuizAttempt_studentId_quizId_idx', ARRAY['studentId', 'quizId']);
SELECT _neon_create_index_if_column('QuizAttempt', 'QuizAttempt_studentId_idx', 'studentId');

-- 10) المدفوعات (رصيد مدفوع — أرباح المنصة)
CREATE TABLE IF NOT EXISTS "Payment" (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  course_id  TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  amount     DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT _neon_create_index_if_column('Payment', 'Payment_created_at_idx', 'created_at');

-- 11) البث المباشر
CREATE TABLE IF NOT EXISTS "LiveStream" (
  id                TEXT PRIMARY KEY,
  course_id         TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  title_ar          TEXT,
  provider          TEXT NOT NULL CHECK (provider IN ('zoom', 'google_meet')),
  meeting_url       TEXT NOT NULL,
  meeting_id        TEXT,
  meeting_password  TEXT,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  description       TEXT,
  "order"           INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT _neon_create_index_if_column('LiveStream', 'LiveStream_course_id_idx', 'course_id');
SELECT _neon_create_index_if_column('LiveStream', 'LiveStream_scheduled_at_idx', 'scheduled_at');
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'LiveStream' AND column_name = 'courseId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "LiveStream_courseId_idx" ON "LiveStream" ("courseId")';
  END IF;
END $$;

-- إضافة أعمدة اختيارية للمستخدم (لو الجدول قديم)
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS student_number      TEXT,
  ADD COLUMN IF NOT EXISTS guardian_number     TEXT,
  ADD COLUMN IF NOT EXISTS current_session_id  TEXT;

-- إضافة وقت الاختبار بالدقائق للاختبارات (لو الجدول قديم)
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS time_limit_minutes INT;

-- طلبات تغيير كلمة المرور (نسيان كلمة المرور — تنفيذها الأدمن)
CREATE TABLE IF NOT EXISTS "PasswordChangeRequest" (
  id                            TEXT PRIMARY KEY,
  user_id                       TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  new_password_hash             TEXT NOT NULL,
  requested_identifier         TEXT,
  requested_old_password       TEXT,
  requested_new_password_plain TEXT,
  status                        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at                  TIMESTAMPTZ,
  processed_by_id               TEXT REFERENCES "User"(id) ON DELETE SET NULL
);
SELECT _neon_create_index_if_column('PasswordChangeRequest', 'PasswordChangeRequest_user_id_idx', 'user_id');
SELECT _neon_create_index_if_column('PasswordChangeRequest', 'PasswordChangeRequest_status_idx', 'status');
SELECT _neon_create_index_if_column('PasswordChangeRequest', 'PasswordChangeRequest_created_at_idx', 'created_at');
ALTER TABLE "PasswordChangeRequest" ADD COLUMN IF NOT EXISTS requested_identifier TEXT;
ALTER TABLE "PasswordChangeRequest" ADD COLUMN IF NOT EXISTS requested_old_password TEXT;
ALTER TABLE "PasswordChangeRequest" ADD COLUMN IF NOT EXISTS requested_new_password_plain TEXT;

-- إضافة عمود القسم للكورسات لو الجدول قديم وبدون العمود
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE "Course" ADD COLUMN category_id TEXT REFERENCES "Category"(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS "Course_category_id_idx" ON "Course"(category_id);
  END IF;
END $$;

-- 12) تعليقات الطلاب (للصفحة الرئيسية)
CREATE TABLE IF NOT EXISTS "Review" (
  id             TEXT PRIMARY KEY,
  text           TEXT NOT NULL,
  text_en        TEXT,
  author_name    TEXT NOT NULL,
  author_title   TEXT,
  author_title_en TEXT,
  avatar_letter  TEXT,
  image_url      TEXT,
  "order"        INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT _neon_create_index_if_column('Review', 'Review_order_idx', 'order');
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS text_en TEXT;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS author_title_en TEXT;

-- 13) إعدادات الصفحة الرئيسية (صورة المدرس، النصوص، روابط واتساب/فيسبوك، عنوان التبويب، لون الهيرو، نصوص الفوتر)
CREATE TABLE IF NOT EXISTS "HomepageSetting" (
  id                  TEXT PRIMARY KEY DEFAULT 'default',
  teacher_image_url   TEXT,
  hero_title          TEXT,
  hero_slogan         TEXT,
  platform_name       TEXT,
  youtube_url         TEXT,
  linkedin_url        TEXT,
  whatsapp_url        TEXT,
  facebook_url        TEXT,
  telegram_url        TEXT,
  team_youtube_url    TEXT,
  team_linkedin_url   TEXT,
  team_whatsapp_url   TEXT,
  team_facebook_url   TEXT,
  team_telegram_url   TEXT,
  social_right_label  TEXT,
  social_left_label   TEXT,
  social_left_enabled BOOLEAN NOT NULL DEFAULT true,
  page_title          TEXT,
  hero_bg_preset      TEXT,
  footer_title        TEXT,
  footer_tagline      TEXT,
  footer_copyright    TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- لو الجدول كان موجوداً قديماً بدون الأعمدة الجديدة نضيفها
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS whatsapp_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS facebook_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS youtube_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS telegram_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS team_whatsapp_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS team_facebook_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS team_youtube_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS team_linkedin_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS team_telegram_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS social_right_label TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS social_left_label TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS social_right_label_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS social_left_label_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS social_left_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS page_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS page_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_bg_preset TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_bg_custom_from TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_bg_custom_to TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS copyright_overlay_style TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_name_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slogan_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS footer_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS footer_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS footer_tagline TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS footer_tagline_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS footer_copyright TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS footer_copyright_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS reviews_section_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS reviews_section_subtitle_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_badge_text_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_description_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_button_text_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_subtitle_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_subtitle_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_news_section_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_subtitle_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_method_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_transfer_instruction_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_confirmation_note_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_whatsapp_button_text_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_waiting_note_en TEXT;

-- إدراج الصف الافتراضي إن لم يكن موجوداً
INSERT INTO "HomepageSetting" (id, teacher_image_url, hero_title, hero_slogan, platform_name, whatsapp_url, facebook_url, team_whatsapp_url, team_facebook_url, page_title, hero_bg_preset, footer_title, footer_tagline, footer_copyright, updated_at)
VALUES (
  'default',
  '/instructor.png',
  'أستاذ / عصام محي',
  'ادرسها... يمكن تفهم المعلومة صح!',
  'منصة أستاذ عصام محي',
  'https://wa.me/966553612356',
  'https://www.facebook.com/profile.php?id=61562686209159',
  NULL,
  NULL,
  'منصتي التعليمية | دورات وتعلم أونلاين',
  'navy',
  'منصتي التعليمية',
  'تعلم بأسلوب حديث ومنهجية واضحة',
  'منصتي التعليمية. جميع الحقوق محفوظة.',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- تعيين قيم افتراضية للأعمدة الجديدة لو الصف كان موجوداً من قبل
UPDATE "HomepageSetting"
SET
  whatsapp_url     = COALESCE(whatsapp_url, 'https://wa.me/966553612356'),
  facebook_url     = COALESCE(facebook_url, 'https://www.facebook.com/profile.php?id=61562686209159'),
  youtube_url      = COALESCE(youtube_url, NULL),
  linkedin_url     = COALESCE(linkedin_url, NULL),
  telegram_url     = COALESCE(telegram_url, NULL),
  team_youtube_url = COALESCE(team_youtube_url, NULL),
  team_linkedin_url = COALESCE(team_linkedin_url, NULL),
  team_whatsapp_url = COALESCE(team_whatsapp_url, NULL),
  team_facebook_url = COALESCE(team_facebook_url, NULL),
  team_telegram_url = COALESCE(team_telegram_url, NULL),
  social_right_label = COALESCE(NULLIF(TRIM(social_right_label), ''), 'الدعم'),
  social_left_label = COALESCE(NULLIF(TRIM(social_left_label), ''), 'دعم الفريق'),
  social_left_enabled = COALESCE(social_left_enabled, true),
  page_title       = COALESCE(page_title, 'منصتي التعليمية | دورات وتعلم أونلاين'),
  hero_bg_preset   = COALESCE(hero_bg_preset, 'navy'),
  copyright_overlay_style = COALESCE(copyright_overlay_style, 'floating'),
  footer_title     = COALESCE(footer_title, 'منصتي التعليمية'),
  footer_tagline   = COALESCE(footer_tagline, 'تعلم بأسلوب حديث ومنهجية واضحة'),
  footer_copyright = COALESCE(footer_copyright, 'منصتي التعليمية. جميع الحقوق محفوظة.'),
  updated_at       = NOW()
WHERE id = 'default';

-- ============================================================
-- 14) Category.created_by_id (add-category-if-missing)
-- ============================================================
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS created_by_id TEXT;

-- ============================================================
-- 15) User: TEACHER + حقوق الطبع + حقول المدرس
--     (add-teachers-multi, add-user-copyright-code, add-teacher-homepage-order)
-- ============================================================
DO $$ BEGIN
  ALTER TYPE "UserRole" ADD VALUE 'TEACHER';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $fix$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname AS cname
    FROM pg_constraint con
    INNER JOIN pg_class rel ON rel.oid = con.conrelid
    INNER JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'User'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%role%'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%TEACHER%'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', 'public', 'User', r.cname);
  END LOOP;
END
$fix$;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_allowed_values_check";
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'role'
  ) AND NOT EXISTS (
    SELECT 1 FROM "User"
    WHERE role IS NOT NULL
      AND role NOT IN ('ADMIN', 'ASSISTANT_ADMIN', 'STUDENT', 'TEACHER', 'USER')
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_role_allowed_values_check"
      CHECK (role IN ('ADMIN', 'ASSISTANT_ADMIN', 'STUDENT', 'TEACHER', 'USER'));
  END IF;
END $$;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS copyright_code VARCHAR(10);
CREATE UNIQUE INDEX IF NOT EXISTS user_copyright_code_unique
  ON "User" (copyright_code)
  WHERE copyright_code IS NOT NULL AND TRIM(copyright_code) <> '';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_subject TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_avatar_url TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_homepage_order INTEGER;

-- ============================================================
-- 16) الواجبات (add-homework, add-homework-lesson)
-- ============================================================
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS accepts_homework BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Lesson" ADD COLUMN IF NOT EXISTS accepts_homework BOOLEAN NOT NULL DEFAULT false;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Chapter'
  ) THEN
    ALTER TABLE "Chapter" ADD COLUMN IF NOT EXISTS accepts_homework BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "HomeworkSubmission" (
  id              TEXT PRIMARY KEY,
  course_id       TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  submission_type TEXT NOT NULL CHECK (submission_type IN ('link', 'pdf', 'image')),
  link_url        TEXT,
  file_url        TEXT,
  file_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT _neon_create_index_if_column('HomeworkSubmission', 'HomeworkSubmission_course_id_idx', 'course_id');
SELECT _neon_create_index_if_column('HomeworkSubmission', 'HomeworkSubmission_user_id_idx', 'user_id');
SELECT _neon_create_index_if_column('HomeworkSubmission', 'HomeworkSubmission_created_at_idx', 'created_at');
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'userId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "HomeworkSubmission_userId_idx" ON "HomeworkSubmission" ("userId")';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'courseId'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "HomeworkSubmission_courseId_idx" ON "HomeworkSubmission" ("courseId")';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Lesson'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'lesson_id'
    ) THEN
      ALTER TABLE "HomeworkSubmission"
        ADD COLUMN lesson_id TEXT REFERENCES "Lesson"(id) ON DELETE CASCADE;
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Chapter'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'lesson_id'
    ) THEN
      ALTER TABLE "HomeworkSubmission"
        ADD COLUMN lesson_id TEXT REFERENCES "Chapter"(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
SELECT _neon_create_index_if_column('HomeworkSubmission', 'HomeworkSubmission_lesson_id_idx', 'lesson_id');

-- ============================================================
-- 17) الرسائل والمحادثات (add-messages)
-- ============================================================
CREATE TABLE IF NOT EXISTS "Conversation" (
  id              TEXT PRIMARY KEY,
  staff_user_id   TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  student_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(staff_user_id, student_user_id)
);
SELECT _neon_create_index_if_column('Conversation', 'Conversation_staff_user_id_idx', 'staff_user_id');
SELECT _neon_create_index_if_column('Conversation', 'Conversation_student_user_id_idx', 'student_user_id');

CREATE TABLE IF NOT EXISTS "Message" (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES "Conversation"(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'file')),
  content         TEXT,
  file_url        TEXT,
  file_name       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT _neon_create_index_if_column('Message', 'Message_conversation_id_idx', 'conversation_id');
SELECT _neon_create_index_if_column('Message', 'Message_created_at_idx', 'created_at');

-- ============================================================
-- 18) المتجر (add-store-feature, add-store-purchases, add-store-home-section-copy)
-- ============================================================
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS store_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS store_section_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS store_section_description TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS store_section_title_en TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS store_section_description_en TEXT;

CREATE TABLE IF NOT EXISTS "StoreProduct" (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       DECIMAL(10, 2) NOT NULL DEFAULT 0,
  image_url   TEXT,
  pdf_url     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT _neon_create_index_if_columns('StoreProduct', 'StoreProduct_active_sort_idx', ARRAY['is_active', 'sort_order', 'created_at']);
ALTER TABLE "StoreProduct" ADD COLUMN IF NOT EXISTS cost_price DECIMAL(10, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "UserStorePurchase" (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES "StoreProduct"(id) ON DELETE CASCADE,
  price_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);
SELECT _neon_create_index_if_columns('UserStorePurchase', 'UserStorePurchase_user_idx', ARRAY['user_id', 'created_at']);

-- ============================================================
-- 19) اشتراكات المنصة (add-platform-subscriptions)
-- ============================================================
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS subscriptions_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  duration_kind TEXT NOT NULL CHECK (duration_kind IN ('week', 'month', 'year')),
  price         DECIMAL(10, 2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT _neon_create_index_if_columns('SubscriptionPlan', 'SubscriptionPlan_active_sort_idx', ARRAY['is_active', 'sort_order']);

CREATE TABLE IF NOT EXISTS "UserPlatformSubscription" (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  plan_id    TEXT REFERENCES "SubscriptionPlan"(id) ON DELETE SET NULL,
  price_paid DECIMAL(10, 2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT _neon_create_index_if_columns('UserPlatformSubscription', 'UserPlatformSubscription_user_expires_idx', ARRAY['user_id', 'expires_at']);

-- ============================================================
-- 20) تقييمات الدروس (add-lesson-ratings)
--     legacy: الحصص في "Chapter" — modern: "Lesson"
-- ============================================================
DO $lesson_rating$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'LessonRating'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Chapter'
    ) THEN
      CREATE TABLE "LessonRating" (
        id         TEXT PRIMARY KEY,
        lesson_id  TEXT NOT NULL REFERENCES "Chapter"(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        course_id  TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
        rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT lesson_rating_unique_lesson_user UNIQUE (lesson_id, user_id)
      );
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'Lesson'
    ) THEN
      CREATE TABLE "LessonRating" (
        id         TEXT PRIMARY KEY,
        lesson_id  TEXT NOT NULL REFERENCES "Lesson"(id) ON DELETE CASCADE,
        user_id    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
        course_id  TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
        rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT lesson_rating_unique_lesson_user UNIQUE (lesson_id, user_id)
      );
    END IF;
  END IF;
END
$lesson_rating$;
SELECT _neon_create_index_if_column('LessonRating', 'LessonRating_lesson_id_idx', 'lesson_id');
SELECT _neon_create_index_if_column('LessonRating', 'LessonRating_course_id_idx', 'course_id');
SELECT _neon_create_index_if_column('LessonRating', 'LessonRating_user_id_idx', 'user_id');

-- ============================================================
-- 21) أعمدة HomepageSetting الإضافية (ensure-homepage-setting-columns + add-homepage-*)
-- ============================================================
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS reviews_section_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS reviews_section_subtitle TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_course_id_1 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_course_id_2 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_course_id_3 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_course_id_4 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_course_id_5 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS primary_color TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS header_logo_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_badge_text TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_description TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS cta_button_text TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_template TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_image_1 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_image_2 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_image_3 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_image_4 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_image_5 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_slider_interval_ms INTEGER;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_subtitle TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_phone_image_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_phone_bg_color TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_store_badge_1_image_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_store_badge_1_link TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_store_badge_2_image_url TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero3_store_badge_2_link TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS teachers_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_subtitle TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_background_color TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_details_items TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_news_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_news_items TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS platform_news_section_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_subtitle TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_method_title TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_transfer_instruction TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_wallet_number TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_confirmation_note TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_whatsapp_number TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_whatsapp_button_text TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS add_balance_waiting_note TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_float_image_1 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_float_image_2 TEXT;
ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS hero_float_image_3 TEXT;

UPDATE "HomepageSetting" SET teachers_enabled = COALESCE(teachers_enabled, false) WHERE id = 'default';

UPDATE "HomepageSetting"
SET platform_news_section_title = 'أخبار المنصة', updated_at = NOW()
WHERE id = 'default' AND platform_news_section_title IS NULL;

UPDATE "HomepageSetting"
SET
  add_balance_title = COALESCE(add_balance_title, 'إضافة رصيد'),
  add_balance_subtitle = COALESCE(add_balance_subtitle, 'اختر طريقة الدفع ثم اتبع التعليمات'),
  add_balance_method_title = COALESCE(add_balance_method_title, 'فودافون كاش'),
  add_balance_transfer_instruction = COALESCE(add_balance_transfer_instruction, 'قم بتحويل المبلغ المطلوب إلى رقم المحفظة التالي:'),
  add_balance_wallet_number = COALESCE(add_balance_wallet_number, '01023005622'),
  add_balance_confirmation_note = COALESCE(add_balance_confirmation_note, 'بعد التحويل، يجب إرسال صورة تأكيد التحويل على واتساب على الرقم'),
  add_balance_whatsapp_number = COALESCE(add_balance_whatsapp_number, '966553612356'),
  add_balance_whatsapp_button_text = COALESCE(add_balance_whatsapp_button_text, 'إرسال صورة التأكيد على واتساب'),
  add_balance_waiting_note = COALESCE(add_balance_waiting_note, 'بعد إرسال صورة التأكيد، يكون رصيدك في انتظار وصوله إلى حسابك. سيتم إضافة الرصيد خلال أقرب وقت.')
WHERE id = 'default';

-- ============================================================
-- 22) اختبارات تعويضية + ربط الاختبار بعدة دورات
--     (add-quiz-remedial-and-assignments.sql)
-- ============================================================
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS "quizType" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS "parentQuizId" TEXT;
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS quiz_type TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Quiz" ADD COLUMN IF NOT EXISTS parent_quiz_id TEXT;

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

CREATE TABLE IF NOT EXISTS "QuizCourseAssignment" (
  id TEXT PRIMARY KEY,
  "quizId" TEXT NOT NULL REFERENCES "Quiz"(id) ON DELETE CASCADE,
  "courseId" TEXT NOT NULL REFERENCES "Course"(id) ON DELETE CASCADE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("quizId", "courseId")
);
SELECT _neon_create_index_if_column('QuizCourseAssignment', 'QuizCourseAssignment_courseId_idx', 'courseId');
SELECT _neon_create_index_if_column('QuizCourseAssignment', 'QuizCourseAssignment_quizId_idx', 'quizId');

-- ============================================================
-- ترحيل legacy → modern (نقل البيانات + أعمدة التطبيق الجديد)
-- بعد هذا القسم يكتشف التطبيق المخطط الحديث (بدون fullName).
-- ============================================================

-- --- User: أعمدة حديثة + نقل من fullName/phoneNumber/hashedPassword ---
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'fullName'
  ) THEN
    UPDATE "User" SET name = COALESCE(NULLIF(TRIM(name), ''), "fullName")
    WHERE (name IS NULL OR TRIM(name) = '') AND "fullName" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'phoneNumber'
  ) THEN
    UPDATE "User" SET email = COALESCE(
      NULLIF(TRIM(email), ''),
      CASE
        WHEN "phoneNumber" IS NOT NULL AND TRIM("phoneNumber") <> ''
          THEN TRIM("phoneNumber") || '@phone.local'
        ELSE id || '@migrated.local'
      END
    )
    WHERE email IS NULL OR TRIM(email) = '';
    UPDATE "User" SET student_number = COALESCE(student_number, "phoneNumber")
    WHERE student_number IS NULL AND "phoneNumber" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'parentPhoneNumber'
  ) THEN
    UPDATE "User" SET guardian_number = COALESCE(guardian_number, "parentPhoneNumber")
    WHERE guardian_number IS NULL AND "parentPhoneNumber" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'hashedPassword'
  ) THEN
    UPDATE "User" SET password_hash = COALESCE(NULLIF(password_hash, ''), "hashedPassword", '')
    WHERE password_hash IS NULL OR password_hash = '';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'createdAt'
  ) THEN
    UPDATE "User" SET created_at = COALESCE(created_at, "createdAt")
    WHERE created_at IS NULL AND "createdAt" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'updatedAt'
  ) THEN
    UPDATE "User" SET updated_at = COALESCE(updated_at, "updatedAt")
    WHERE updated_at IS NULL AND "updatedAt" IS NOT NULL;
  END IF;
END $$;

UPDATE "User" SET role = 'STUDENT' WHERE role = 'USER';
UPDATE "User" SET name = COALESCE(NULLIF(TRIM(name), ''), 'User') WHERE name IS NULL OR TRIM(name) = '';
UPDATE "User" SET email = COALESCE(NULLIF(TRIM(email), ''), id || '@migrated.local') WHERE email IS NULL OR TRIM(email) = '';
UPDATE "User" SET password_hash = COALESCE(password_hash, '') WHERE password_hash IS NULL;

SELECT _neon_drop_not_null_if_column('User', 'fullName');
SELECT _neon_drop_not_null_if_column('User', 'phoneNumber');
SELECT _neon_drop_not_null_if_column('User', 'parentPhoneNumber');
SELECT _neon_drop_not_null_if_column('User', 'hashedPassword');

ALTER TABLE "User" DROP COLUMN IF EXISTS "fullName";

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_role_allowed_values_check";
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'role'
  ) THEN
    ALTER TABLE "User" ADD CONSTRAINT "User_role_allowed_values_check"
      CHECK (role IN ('ADMIN', 'ASSISTANT_ADMIN', 'STUDENT', 'TEACHER'));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- --- Course: نقل userId/imageUrl/isPublished → created_by_id/image_url/is_published ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'userId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'created_by_id'
  ) THEN
    UPDATE "Course" SET created_by_id = "userId"
    WHERE created_by_id IS NULL AND "userId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'imageUrl'
  ) THEN
    UPDATE "Course" SET image_url = COALESCE(image_url, "imageUrl")
    WHERE image_url IS NULL AND "imageUrl" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'isPublished'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'is_published'
  ) THEN
    UPDATE "Course" SET is_published = "isPublished"
    WHERE is_published IS NULL AND "isPublished" IS NOT NULL;
    UPDATE "Course" SET "isPublished" = is_published
    WHERE is_published IS NOT NULL
      AND ("isPublished" IS NULL OR "isPublished" IS DISTINCT FROM is_published);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'isPublished'
  ) THEN
    UPDATE "Course" SET is_published = "isPublished"
    WHERE "isPublished" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'grade'
  ) THEN
    UPDATE "Course" SET level = COALESCE(level, grade)
    WHERE level IS NULL AND grade IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'createdAt'
  ) THEN
    UPDATE "Course" SET created_at = COALESCE(created_at, "createdAt")
    WHERE created_at IS NULL AND "createdAt" IS NOT NULL;
    UPDATE "Course" SET "createdAt" = COALESCE("createdAt", created_at, NOW())
    WHERE "createdAt" IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'updatedAt'
  ) THEN
    UPDATE "Course" SET updated_at = COALESCE(updated_at, "updatedAt")
    WHERE updated_at IS NULL AND "updatedAt" IS NOT NULL;
    UPDATE "Course" SET "updatedAt" = COALESCE("updatedAt", updated_at, NOW())
    WHERE "updatedAt" IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'isPublished'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'is_published'
  ) THEN
    UPDATE "Course" SET "isPublished" = is_published
    WHERE "isPublished" IS NULL AND is_published IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'imageUrl'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'image_url'
  ) THEN
    UPDATE "Course" SET "imageUrl" = image_url
    WHERE "imageUrl" IS NULL AND image_url IS NOT NULL;
  END IF;
END $$;

UPDATE "Course" SET slug = id WHERE slug IS NULL AND id IS NOT NULL;
UPDATE "Course" SET description = COALESCE(description, '') WHERE description IS NULL;
UPDATE "Course" SET price = COALESCE(price, 0) WHERE price IS NULL;

SELECT _neon_drop_not_null_if_column('Course', 'userId');
SELECT _neon_drop_not_null_if_column('Course', 'createdAt');
SELECT _neon_drop_not_null_if_column('Course', 'updatedAt');

DO $$ BEGIN
  ALTER TABLE "Course" ALTER COLUMN "userId" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Course" ALTER COLUMN "createdAt" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Course" ALTER COLUMN "updatedAt" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Course" ALTER COLUMN "createdAt" SET DEFAULT NOW();
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Course" ALTER COLUMN "updatedAt" SET DEFAULT NOW();
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- مزامنة أعمدة legacy camelCase عند INSERT/UPDATE بالمخطط الجديد
CREATE OR REPLACE FUNCTION _neon_course_legacy_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'createdAt'
    ) THEN
      IF NEW."createdAt" IS NULL THEN
        NEW."createdAt" := COALESCE(NEW.created_at, NOW());
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'updatedAt'
    ) THEN
      IF NEW."updatedAt" IS NULL THEN
        NEW."updatedAt" := COALESCE(NEW.updated_at, NOW());
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'userId'
    ) THEN
      IF NEW."userId" IS NULL AND NEW.created_by_id IS NOT NULL THEN
        NEW."userId" := NEW.created_by_id;
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'isPublished'
    ) THEN
      IF NEW.is_published IS NOT NULL THEN
        NEW."isPublished" := NEW.is_published;
      ELSIF NEW."isPublished" IS NULL THEN
        NEW."isPublished" := false;
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Course' AND column_name = 'imageUrl'
    ) THEN
      IF NEW."imageUrl" IS NULL AND NEW.image_url IS NOT NULL THEN
        NEW."imageUrl" := NEW.image_url;
      END IF;
    END IF;
    IF NEW.created_at IS NULL THEN
      NEW.created_at := COALESCE(NEW."createdAt", NOW());
    END IF;
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := COALESCE(NEW."updatedAt", NOW());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _neon_course_legacy_sync_trg ON "Course";
CREATE TRIGGER _neon_course_legacy_sync_trg
  BEFORE INSERT OR UPDATE ON "Course"
  FOR EACH ROW EXECUTE FUNCTION _neon_course_legacy_sync();

-- --- Chapter → Lesson (نفس المعرّفات) ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Chapter'
  ) THEN
    INSERT INTO "Lesson" (
      id, course_id, title, title_ar, slug, content, video_url, pdf_url, "order", created_at, updated_at
    )
    SELECT
      c.id,
      c."courseId",
      c.title,
      NULL,
      c.id,
      c.description,
      c."videoUrl",
      c."documentUrl",
      COALESCE(c.position, 0),
      COALESCE(c."createdAt", NOW()),
      COALESCE(c."updatedAt", NOW())
    FROM "Chapter" c
    WHERE NOT EXISTS (SELECT 1 FROM "Lesson" l WHERE l.id = c.id);
  END IF;
END $$;

-- --- Purchase → Enrollment ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'Purchase'
  ) THEN
    INSERT INTO "Enrollment" (id, user_id, course_id, enrolled_at)
    SELECT
      p.id,
      p."userId",
      p."courseId",
      COALESCE(p."createdAt", NOW())
    FROM "Purchase" p
    WHERE (p.status IS NULL OR p.status = 'ACTIVE')
      AND NOT EXISTS (
        SELECT 1 FROM "Enrollment" e
        WHERE e.user_id = p."userId" AND e.course_id = p."courseId"
      );
  END IF;
END $$;

-- --- Quiz: courseId/position/timer → course_id/order/time_limit_minutes ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'courseId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'course_id'
  ) THEN
    UPDATE "Quiz" SET course_id = "courseId" WHERE course_id IS NULL AND "courseId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'position'
  ) THEN
    UPDATE "Quiz" SET "order" = position
    WHERE ("order" IS NULL OR "order" = 0) AND position IS NOT NULL AND position <> 0;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'timer'
  ) THEN
    UPDATE "Quiz" SET time_limit_minutes = timer
    WHERE time_limit_minutes IS NULL AND timer IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'quizType'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'quiz_type'
  ) THEN
    UPDATE "Quiz" SET quiz_type = UPPER(TRIM("quizType"))
    WHERE "quizType" IS NOT NULL AND TRIM("quizType") <> '';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'parentQuizId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'parent_quiz_id'
  ) THEN
    UPDATE "Quiz" SET parent_quiz_id = "parentQuizId"
    WHERE parent_quiz_id IS NULL AND "parentQuizId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'createdAt'
  ) THEN
    UPDATE "Quiz" SET created_at = COALESCE(created_at, "createdAt")
    WHERE created_at IS NULL AND "createdAt" IS NOT NULL;
    UPDATE "Quiz" SET "createdAt" = COALESCE("createdAt", created_at, NOW())
    WHERE "createdAt" IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'updatedAt'
  ) THEN
    UPDATE "Quiz" SET updated_at = COALESCE(updated_at, "updatedAt")
    WHERE updated_at IS NULL AND "updatedAt" IS NOT NULL;
    UPDATE "Quiz" SET "updatedAt" = COALESCE("updatedAt", updated_at, NOW())
    WHERE "updatedAt" IS NULL;
  END IF;
END $$;

SELECT _neon_drop_not_null_if_column('Quiz', 'courseId');
SELECT _neon_drop_not_null_if_column('Quiz', 'position');
SELECT _neon_drop_not_null_if_column('Quiz', 'createdAt');
SELECT _neon_drop_not_null_if_column('Quiz', 'updatedAt');

DO $$ BEGIN
  ALTER TABLE "Quiz" ALTER COLUMN "createdAt" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Quiz" ALTER COLUMN "updatedAt" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Quiz" ALTER COLUMN "createdAt" SET DEFAULT NOW();
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Quiz" ALTER COLUMN "updatedAt" SET DEFAULT NOW();
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION _neon_quiz_legacy_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'createdAt'
    ) AND NEW."createdAt" IS NULL THEN
      NEW."createdAt" := COALESCE(NEW.created_at, NOW());
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'Quiz' AND column_name = 'updatedAt'
    ) AND NEW."updatedAt" IS NULL THEN
      NEW."updatedAt" := COALESCE(NEW.updated_at, NOW());
    END IF;
    IF NEW.created_at IS NULL THEN
      NEW.created_at := COALESCE(NEW."createdAt", NOW());
    END IF;
    IF NEW.updated_at IS NULL THEN
      NEW.updated_at := COALESCE(NEW."updatedAt", NOW());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _neon_quiz_legacy_sync_trg ON "Quiz";
CREATE TRIGGER _neon_quiz_legacy_sync_trg
  BEFORE INSERT OR UPDATE ON "Quiz"
  FOR EACH ROW EXECUTE FUNCTION _neon_quiz_legacy_sync();

-- --- Question: quizId/text/position → quiz_id/question_text/order + QuestionOption ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'quizId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'quiz_id'
  ) THEN
    UPDATE "Question" SET quiz_id = "quizId" WHERE quiz_id IS NULL AND "quizId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'text'
  ) THEN
    UPDATE "Question" SET question_text = COALESCE(question_text, text)
    WHERE (question_text IS NULL OR question_text = '') AND text IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'position'
  ) THEN
    UPDATE "Question" SET "order" = position
    WHERE ("order" IS NULL OR "order" = 0) AND position IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'createdAt'
  ) THEN
    UPDATE "Question" SET created_at = COALESCE(created_at, "createdAt")
    WHERE created_at IS NULL AND "createdAt" IS NOT NULL;
    UPDATE "Question" SET "createdAt" = COALESCE("createdAt", created_at, NOW())
    WHERE "createdAt" IS NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'updatedAt'
  ) THEN
    UPDATE "Question" SET updated_at = COALESCE(updated_at, "updatedAt")
    WHERE updated_at IS NULL AND "updatedAt" IS NOT NULL;
    UPDATE "Question" SET "updatedAt" = COALESCE("updatedAt", updated_at, NOW())
    WHERE "updatedAt" IS NULL;
  END IF;
END $$;

UPDATE "Question" SET type = 'ESSAY' WHERE type = 'SHORT_ANSWER';

DO $migrate_qopts$
DECLARE
  r RECORD;
  i int;
  opt_text text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Question' AND column_name = 'options'
  ) THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT q.id, q.options, q."correctAnswer"
    FROM "Question" q
    WHERE q.options IS NOT NULL AND TRIM(q.options) <> '' AND q.options <> '[]'
      AND NOT EXISTS (SELECT 1 FROM "QuestionOption" o WHERE o.question_id = q.id)
  LOOP
    BEGIN
      IF json_typeof(r.options::json) <> 'array' THEN
        CONTINUE;
      END IF;
      FOR i IN 0..(json_array_length(r.options::json) - 1) LOOP
        opt_text := r.options::json->>i;
        IF opt_text IS NULL THEN
          CONTINUE;
        END IF;
        INSERT INTO "QuestionOption" (id, question_id, text, is_correct, position, created_at, updated_at)
        VALUES (
          r.id || '-opt-' || i,
          r.id,
          opt_text,
          opt_text = COALESCE(r."correctAnswer", ''),
          i + 1,
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO NOTHING;
      END LOOP;
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END
$migrate_qopts$;

SELECT _neon_drop_not_null_if_column('Question', 'quizId');
SELECT _neon_drop_not_null_if_column('Question', 'text');
SELECT _neon_drop_not_null_if_column('Question', 'createdAt');
SELECT _neon_drop_not_null_if_column('Question', 'updatedAt');

DO $$ BEGIN
  ALTER TABLE "Question" ALTER COLUMN "createdAt" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Question" ALTER COLUMN "updatedAt" DROP NOT NULL;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Question" ALTER COLUMN "createdAt" SET DEFAULT NOW();
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Question" ALTER COLUMN "updatedAt" SET DEFAULT NOW();
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

-- --- QuizAttempt: studentId/quizId → user_id/quiz_id ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'studentId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'user_id'
  ) THEN
    UPDATE "QuizAttempt" SET user_id = "studentId" WHERE user_id IS NULL AND "studentId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'quizId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'QuizAttempt' AND column_name = 'quiz_id'
  ) THEN
    UPDATE "QuizAttempt" SET quiz_id = "quizId" WHERE quiz_id IS NULL AND "quizId" IS NOT NULL;
  END IF;
END $$;

SELECT _neon_drop_not_null_if_column('QuizAttempt', 'studentId');
SELECT _neon_drop_not_null_if_column('QuizAttempt', 'quizId');

-- --- ActivationCode: courseId → course_id ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ActivationCode' AND column_name = 'courseId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ActivationCode' AND column_name = 'course_id'
  ) THEN
    UPDATE "ActivationCode" SET course_id = "courseId" WHERE course_id IS NULL AND "courseId" IS NOT NULL;
  END IF;
END $$;

SELECT _neon_drop_not_null_if_column('ActivationCode', 'courseId');

-- --- HomeworkSubmission: userId/courseId → user_id/course_id ---
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'userId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'user_id'
  ) THEN
    UPDATE "HomeworkSubmission" SET user_id = "userId" WHERE user_id IS NULL AND "userId" IS NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'courseId'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'HomeworkSubmission' AND column_name = 'course_id'
  ) THEN
    UPDATE "HomeworkSubmission" SET course_id = "courseId" WHERE course_id IS NULL AND "courseId" IS NOT NULL;
  END IF;
END $$;

SELECT _neon_drop_not_null_if_column('HomeworkSubmission', 'userId');
SELECT _neon_drop_not_null_if_column('HomeworkSubmission', 'courseId');

-- تنظيف الدوال المساعدة (اختياري)
DROP FUNCTION IF EXISTS _neon_drop_not_null_if_column(text, text);
DROP FUNCTION IF EXISTS _neon_create_index_if_columns(text, text, text[]);
DROP FUNCTION IF EXISTS _neon_create_index_if_column(text, text, text);
