-- تفعيل نظام المدرسين المتعددين على المنصة
-- نفّذ الملف من Neon SQL Editor أو: psql $DATABASE_URL -f scripts/add-teachers-multi.sql
--
-- متوافق مع قاعدة Infinity Math الحالية: role في "User" عمود TEXT (بدون enum UserRole)

-- 1) إضافة TEACHER إلى enum الرتب — فقط إن وُجد النوع (مخطط المنصة الجديد)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserRole') THEN
    ALTER TYPE "UserRole" ADD VALUE 'TEACHER';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) حقول المدرس في جدول المستخدمين
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_subject TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS teacher_avatar_url TEXT;

-- 3) تفعيل/إيقاف الميزة من لوحة الأدمن (إن وُجد جدول HomepageSetting)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'HomepageSetting'
  ) THEN
    ALTER TABLE "HomepageSetting" ADD COLUMN IF NOT EXISTS teachers_enabled BOOLEAN NOT NULL DEFAULT false;
    UPDATE "HomepageSetting" SET teachers_enabled = COALESCE(teachers_enabled, false) WHERE id = 'default';
  END IF;
END $$;
