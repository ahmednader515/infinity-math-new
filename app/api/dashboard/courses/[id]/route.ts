import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canManageCourse, readCourseManageIds } from "@/lib/permissions";
import {
  getCourseById,
  getCourseForEdit,
  updateCourse,
  deleteCourse,
  findCategoryByNameForDashboard,
  createCategory,
  categoryIsManageableOnDashboard,
  assertAssignableTeacher,
} from "@/lib/db";
import { syncCourseLessons } from "@/lib/save-course-lessons";
import {
  saveCourseQuizzes,
  type CourseContentOrderEntry,
  type CourseQuizInput,
} from "@/lib/save-course-quizzes";
import { revalidatePublicCache, PUBLIC_CACHE_TAGS } from "@/lib/public-data-cache";

type LessonInput = {
  id?: string;
  title: string;
  titleAr?: string;
  videoUrl?: string;
  content?: string;
  pdfUrl?: string;
  acceptsHomework?: boolean;
};
type ContentOrderEntry = CourseContentOrderEntry;

/** تحديث دورة - للأدمن ومساعد الأدمن */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;
  let body: {
    title?: string;
    titleAr?: string;
    titleEn?: string;
    description?: string;
    descriptionAr?: string;
    descriptionEn?: string;
    shortDesc?: string;
    shortDescAr?: string;
    shortDescEn?: string;
    imageUrl?: string;
    price?: number;
    isPublished?: boolean;
    maxQuizAttempts?: number | null;
    categoryId?: string | null;
    categoryName?: string;
    categoryNameAr?: string;
    categoryNameEn?: string;
    acceptsHomework?: boolean;
    teacherId?: string;
    lessons?: LessonInput[];
    quizzes?: CourseQuizInput[];
    contentOrder?: ContentOrderEntry[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const course = await getCourseById(id);
  if (!course) {
    return NextResponse.json({ error: "الدورة غير موجودة" }, { status: 404 });
  }
  const createdBy = (course as { createdById?: string | null; created_by_id?: string | null }).createdById ?? (course as { created_by_id?: string | null }).created_by_id ?? null;
  const assignedTeacherId =
    (course as { assignedTeacherId?: string | null; assigned_teacher_id?: string | null }).assignedTeacherId ??
    (course as { assigned_teacher_id?: string | null }).assigned_teacher_id ??
    null;
  if (!canManageCourse(session.user.role, session.user.id, createdBy, assignedTeacherId)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }
  const slug = (course as { slug?: string }).slug ?? "";

  const titleAr = (body.titleAr ?? body.title)?.trim();
  const titleEn = (body.titleEn ?? titleAr)?.trim();
  const descriptionAr = (body.descriptionAr ?? body.description)?.trim();
  const descriptionEn = (body.descriptionEn ?? descriptionAr)?.trim();
  if (!titleAr || !descriptionAr) {
    return NextResponse.json({ error: "العنوان والوصف بالعربية مطلوبان" }, { status: 400 });
  }

  const role = session.user.role;
  const currentCategoryId =
    (course as { categoryId?: string | null }).categoryId ??
    (course as { category_id?: string | null }).category_id ??
    null;

  let categoryId: string | null | undefined = body.categoryId;
  const catNameAr = (body.categoryNameAr ?? body.categoryName)?.trim();
  const catNameEn = (body.categoryNameEn ?? catNameAr)?.trim();
  if (catNameAr || catNameEn) {
    let cat =
      (catNameAr ? await findCategoryByNameForDashboard(catNameAr, session.user.id, role) : null) ??
      (catNameEn ? await findCategoryByNameForDashboard(catNameEn, session.user.id, role) : null);
    if (!cat) {
      const slugBase = catNameEn || catNameAr || "cat";
      const slugCat = slugBase.toLowerCase().replace(/\s+/g, "-").replace(/[^\w\u0600-\u06FF-]+/g, "") || "cat";
      const uniqueSlug = slugCat + "-" + Date.now();
      cat = await createCategory({
        name: catNameEn || catNameAr || slugBase,
        name_ar: catNameAr || catNameEn || slugBase,
        slug: uniqueSlug,
        created_by_id: session.user.id,
      });
    }
    categoryId = cat.id;
  } else if (body.categoryId !== undefined) {
    if (body.categoryId === null || body.categoryId === "") {
      categoryId = null;
    } else {
      const incoming = String(body.categoryId).trim();
      if (incoming !== currentCategoryId) {
        const ok = await categoryIsManageableOnDashboard(incoming, session.user.id, role);
        if (!ok) {
          return NextResponse.json({ error: "القسم غير صالح أو غير مسموح" }, { status: 400 });
        }
      }
      categoryId = incoming;
    }
  }

  let assignedTeacherUpdate: string | undefined;
  let createdByRestore: string | undefined;
  if (session.user.role === "ADMIN" && body.teacherId?.trim()) {
    try {
      await assertAssignableTeacher(body.teacherId.trim());
      assignedTeacherUpdate = body.teacherId.trim();
      createdByRestore = session.user.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "المدرس المحدد غير صالح";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  await updateCourse(id, {
    title: titleEn || titleAr,
    title_ar: titleAr,
    description: descriptionAr,
    description_en: descriptionEn,
    short_desc: (body.shortDescAr ?? body.shortDesc)?.trim() || null,
    short_desc_en: (body.shortDescEn ?? body.shortDescAr ?? body.shortDesc)?.trim() || null,
    image_url: body.imageUrl?.trim() || null,
    price: body.price ?? 0,
    is_published: body.isPublished ?? true,
    max_quiz_attempts: null,
    ...(categoryId !== undefined && { category_id: categoryId }),
    ...(body.acceptsHomework !== undefined && { accepts_homework: body.acceptsHomework }),
    ...(assignedTeacherUpdate !== undefined && { assigned_teacher_id: assignedTeacherUpdate }),
    ...(createdByRestore !== undefined && { created_by_id: createdByRestore }),
  });

  const lessons = body.lessons ?? [];
  const quizzes = body.quizzes ?? [];
  const contentOrder: ContentOrderEntry[] =
    body.contentOrder ??
    ([
      ...lessons.map((_, i) => ({ type: "lesson" as const, index: i })),
      ...quizzes.map((_, i) => ({ type: "quiz" as const, index: i })),
    ] satisfies ContentOrderEntry[]);

  await syncCourseLessons({
    courseId: id,
    courseSlug: slug,
    lessons,
    contentOrder,
  });

  await saveCourseQuizzes({
    courseId: id,
    lessonsCount: lessons.length,
    quizzes,
    contentOrder,
    replaceOwned: true,
  });

  revalidatePublicCache(PUBLIC_CACHE_TAGS.courses);

  return NextResponse.json({ success: true });
}

/** جلب دورة كاملة للتعديل - للأدمن ومساعد الأدمن */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;
  const data = await getCourseForEdit(id);
  if (!data?.course) {
    return NextResponse.json({ error: "الدورة غير موجودة" }, { status: 404 });
  }
  const c0 = data.course as {
    createdById?: string | null;
    created_by_id?: string | null;
    assignedTeacherId?: string | null;
    assigned_teacher_id?: string | null;
  };
  const { createdById: createdBy, assignedTeacherId } = readCourseManageIds(c0);
  if (!canManageCourse(session.user.role, session.user.id, createdBy, assignedTeacherId)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const c = data.course;
  const payload = {
    id: c.id,
    title: c.title,
    titleEn: c.title,
    titleAr: c.titleAr ?? c.title_ar,
    slug: c.slug,
    description: c.description,
    descriptionAr: c.description,
    descriptionEn: (c as { descriptionEn?: string | null; description_en?: string | null }).descriptionEn ?? (c as { description_en?: string | null }).description_en ?? "",
    shortDesc: c.shortDesc ?? c.short_desc,
    shortDescAr: c.shortDesc ?? c.short_desc ?? "",
    shortDescEn: (c as { shortDescEn?: string | null; short_desc_en?: string | null }).shortDescEn ?? (c as { short_desc_en?: string | null }).short_desc_en ?? "",
    imageUrl: c.imageUrl ?? c.image_url,
    price: Number(c.price ?? 0),
    isPublished: c.isPublished ?? c.is_published ?? true,
    maxQuizAttempts: c.maxQuizAttempts ?? c.max_quiz_attempts ?? null,
    categoryId: (c as { categoryId?: string | null }).categoryId ?? null,
    teacherId: assignedTeacherId ?? createdBy,
    lessons: data.lessons.map((l) => ({
      id: String((l as { id?: string }).id ?? ""),
      title: l.title,
      titleAr: l.titleAr ?? l.title_ar,
      videoUrl: l.videoUrl ?? l.video_url,
      content: l.content,
      pdfUrl: l.pdfUrl ?? l.pdf_url,
      acceptsHomework: Boolean((l as { acceptsHomework?: boolean; accepts_homework?: boolean }).acceptsHomework ?? (l as { accepts_homework?: boolean }).accepts_homework ?? false),
    })),
    quizzes: data.quizzes.map((q) => ({
      id: q.id,
      title: q.title,
      quizType: (q as { quizType?: string }).quizType ?? "NORMAL",
      parentQuizId: (q as { parentQuizId?: string | null }).parentQuizId ?? null,
      timeLimitMinutes: (q as { timeLimitMinutes?: number | null }).timeLimitMinutes ?? null,
        maxAttempts: (() => {
          const raw = (q as { maxAttempts?: number | null; max_attempts?: number | null }).maxAttempts
            ?? (q as { max_attempts?: number | null }).max_attempts;
          if (raw == null) return null;
          const n = Number(raw);
          return Number.isFinite(n) && n >= 1 ? n : null;
        })(),
        questions: (q.questions ?? []).map((qt) => ({
        type: qt.type,
        questionText: qt.questionText ?? qt.question_text,
        options: (qt.options ?? []).map((o) => ({ text: o.text, isCorrect: o.isCorrect ?? o.is_correct })),
      })),
    })),
    linkedQuizzes: (data.linkedQuizzes ?? []).map((q) => ({
      id: q.id,
      title: q.title,
      quizType: (q as { quizType?: string }).quizType ?? "NORMAL",
      parentQuizId: (q as { parentQuizId?: string | null }).parentQuizId ?? null,
      ownerCourseId: (q as { ownerCourseId?: string }).ownerCourseId ?? "",
      ownerCourseTitle: (q as { ownerCourseTitle?: string }).ownerCourseTitle ?? "",
      ownerCourseTitleAr: (q as { ownerCourseTitleAr?: string | null }).ownerCourseTitleAr ?? null,
      order: (q as { order?: number }).order ?? 0,
      questionCount: (q as { _count?: { questions?: number } })._count?.questions ?? 0,
    })),
  };
  return NextResponse.json(payload);
}

/** حذف دورة - للأدمن ومساعد الأدمن. يحذف التسجيلات والحصص والاختبارات تلقائياً (Cascade) */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const { id } = await params;

  const course = await getCourseById(id);
  if (!course) {
    return NextResponse.json({ error: "الدورة غير موجودة" }, { status: 404 });
  }
  const { createdById: createdByDel, assignedTeacherId: assignedDel } = readCourseManageIds(
    course as {
      createdById?: string | null;
      created_by_id?: string | null;
      assignedTeacherId?: string | null;
      assigned_teacher_id?: string | null;
    },
  );
  if (!canManageCourse(session.user.role, session.user.id, createdByDel, assignedDel)) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  await deleteCourse(id);

  revalidatePublicCache(PUBLIC_CACHE_TAGS.courses);

  return NextResponse.json({ success: true });
}
