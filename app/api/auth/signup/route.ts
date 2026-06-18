import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { getUserByEmailOrPhone, createUser } from "@/lib/db";
import {
  EGYPT_GOVERNORATES,
  SIGNUP_GRADES,
  SIGNUP_STUDY_TYPES,
  divisionsForGrade,
  isValidDivisionForGrade,
  isValidGovernorate,
  isValidSignupGrade,
  isValidSignupStudyType,
} from "@/lib/signup-options";
import { z } from "zod";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

const signupSchema = z
  .object({
    password: z.string().min(6, "كلمة المرور 6 أحرف على الأقل"),
    confirm_password: z.string().min(6, "تأكيد كلمة المرور مطلوب"),
    name: z.string().min(2, "الاسم حرفين على الأقل"),
    student_number: z.string().min(1, "رقم الهاتف مطلوب"),
    guardian_number: z.string().min(1, "رقم ولي الأمر مطلوب"),
    grade: z.enum(SIGNUP_GRADES, { message: "اختر الصف الدراسي" }),
    division: z.string().min(1, "اختر القسم"),
    study_type: z.enum(SIGNUP_STUDY_TYPES, { message: "اختر نوع الدراسة" }),
    governorate: z.enum(EGYPT_GOVERNORATES, { message: "اختر المحافظة" }),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "كلمتا المرور غير متطابقتين",
    path: ["confirm_password"],
  })
  .refine(
    (data) => digitsOnly(data.student_number).length === 11,
    { message: "رقم الهاتف يجب أن يكون 11 رقماً", path: ["student_number"] },
  )
  .refine(
    (data) => digitsOnly(data.guardian_number).length === 11,
    { message: "رقم ولي الأمر يجب أن يكون 11 رقماً", path: ["guardian_number"] },
  )
  .refine(
    (data) => isValidDivisionForGrade(data.grade, data.division),
    { message: "القسم غير صالح للصف المختار", path: ["division"] },
  );

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "بيانات غير صالحة" },
        { status: 400 },
      );
    }
    const {
      password,
      name,
      student_number,
      guardian_number,
      grade,
      division,
      study_type,
      governorate,
    } = parsed.data;

    if (!isValidSignupGrade(grade) || !isValidSignupStudyType(study_type) || !isValidGovernorate(governorate)) {
      return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
    }
    if (!divisionsForGrade(grade).includes(division)) {
      return NextResponse.json({ error: "القسم غير صالح للصف المختار" }, { status: 400 });
    }

    const phone = digitsOnly(student_number);
    const existing = await getUserByEmailOrPhone(phone);
    if (existing) {
      return NextResponse.json(
        { error: "رقم الهاتف مستخدم مسبقاً" },
        { status: 400 },
      );
    }

    const passwordHash = await hash(password, 12);
    await createUser({
      email: `${phone}@phone.local`,
      password_hash: passwordHash,
      name: name.trim(),
      role: "STUDENT",
      student_number: phone,
      guardian_number: digitsOnly(guardian_number),
      grade,
      division,
      study_type,
      governorate,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("Signup error:", e);
    const message = e instanceof Error ? e.message : String(e);
    const isVercel = !!process.env.VERCEL;
    let userMessage = "حدث خطأ أثناء إنشاء الحساب.";
    if (message.includes("DATABASE_URL") || message.includes("Environment variable not found")) {
      userMessage = isVercel
        ? "قاعدة البيانات غير مضبوطة على السيرفر. في Vercel: Settings → Environment Variables → أضف DATABASE_URL (رابط Neon أو Supabase) ثم أعد النشر. للتحقق: افتح /api/health"
        : "لم يتم ضبط قاعدة البيانات. أنشئ ملف .env وأضف DATABASE_URL ثم نفّذ: npm run db:push";
    } else if (
      message.includes("does not exist") ||
      message.includes("Unknown table") ||
      message.includes("relation") ||
      message.includes("P1001") ||
      message.includes("P2021") ||
      message.includes("Can't reach")
    ) {
      userMessage = isVercel
        ? "الاتصال بقاعدة البيانات فشل. تأكد أن DATABASE_URL على Vercel يشير إلى قاعدة سحابية (Neon/Supabase) وليس localhost، ثم أعد النشر. للتحقق: افتح /api/health"
        : "جدول المستخدمين غير موجود أو قاعدة البيانات غير متصلة. افتح لوحة Neon → SQL Editor، انسخ محتوى ملف scripts/init-neon-database.sql ونفّذه مرة واحدة لإنشاء الجداول.";
    } else if (message.includes("unique") || message.includes("duplicate") || message.includes("phoneNumber")) {
      userMessage = "رقم الهاتف مستخدم مسبقاً";
    } else if (process.env.NODE_ENV === "development" && message) {
      userMessage = message;
    }
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
