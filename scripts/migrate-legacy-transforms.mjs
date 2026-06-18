/**
 * Pure transform helpers for legacy → modern DB migration.
 * Mirrors lib/legacy-schema.ts (no TypeScript compile step).
 */

export function mapLegacyRole(role) {
  const r = String(role ?? "USER");
  if (r === "USER") return "STUDENT";
  if (r === "ADMIN" || r === "TEACHER" || r === "ASSISTANT_ADMIN" || r === "STUDENT") return r;
  return "STUDENT";
}

export function buildUniqueEmail(phone, userId, usedEmails) {
  const trimmed = String(phone ?? "").trim();
  let email = trimmed ? `${trimmed}@phone.local` : `${userId}@migrated.local`;
  if (!usedEmails.has(email)) {
    usedEmails.add(email);
    return email;
  }
  email = trimmed ? `${trimmed}+${userId}@phone.local` : `${userId}@migrated.local`;
  usedEmails.add(email);
  return email;
}

export function transformUser(row, usedEmails) {
  const id = String(row.id);
  const phoneRaw = row.phoneNumber ?? row.student_number;
  const phone = phoneRaw != null ? String(phoneRaw).trim() : "";
  const existingEmail =
    row.email != null && String(row.email).trim().includes("@")
      ? String(row.email).trim()
      : null;
  const email = existingEmail ?? buildUniqueEmail(phone, id, usedEmails);
  if (existingEmail) usedEmails.add(existingEmail);

  const nameRaw = row.fullName ?? row.name;
  const name = String(nameRaw ?? "").trim() || "User";

  return {
    id,
    email,
    password_hash: String(row.hashedPassword ?? row.password_hash ?? ""),
    name,
    role: mapLegacyRole(row.role),
    balance: Number(row.balance ?? 0),
    student_number: phone || null,
    guardian_number:
      row.parentPhoneNumber != null
        ? String(row.parentPhoneNumber)
        : row.guardian_number != null
          ? String(row.guardian_number)
          : null,
    grade: row.grade != null ? String(row.grade) : null,
    division: row.division != null ? String(row.division) : null,
    study_type:
      row.studyType != null
        ? String(row.studyType)
        : row.study_type != null
          ? String(row.study_type)
          : null,
    governorate: row.governorate != null ? String(row.governorate) : null,
    created_at: row.createdAt ?? row.created_at ?? new Date(),
    updated_at: row.updatedAt ?? row.updated_at ?? new Date(),
  };
}

export function transformCategory(row) {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    name_ar: row.name_ar ?? row.nameAr ?? null,
    slug: String(row.slug ?? row.id),
    description: row.description ?? null,
    image_url: row.image_url ?? row.imageUrl ?? null,
    order: Number(row.order ?? 0),
    created_by_id: row.created_by_id ?? row.createdById ?? null,
    created_at: row.created_at ?? row.createdAt ?? new Date(),
    updated_at: row.updated_at ?? row.updatedAt ?? new Date(),
  };
}

export function transformCourse(row) {
  const id = String(row.id);
  const title = String(row.title ?? "");
  return {
    id,
    title,
    title_ar: row.title_ar ?? row.titleAr ?? title,
    slug: row.slug != null ? String(row.slug) : id,
    description: String(row.description ?? ""),
    description_en: row.description_en ?? row.descriptionEn ?? null,
    short_desc: row.short_desc ?? row.shortDesc ?? null,
    short_desc_en: row.short_desc_en ?? row.shortDescEn ?? null,
    image_url: row.image_url ?? row.imageUrl ?? null,
    price: Number(row.price ?? 0),
    duration: row.duration ?? null,
    level: row.level ?? row.grade ?? null,
    is_published: Boolean(row.is_published ?? row.isPublished ?? false),
    order: Number(row.order ?? 0),
    max_quiz_attempts: row.max_quiz_attempts ?? row.maxQuizAttempts ?? null,
    category_id: row.category_id ?? row.categoryId ?? null,
    created_by_id: row.created_by_id ?? row.userId ?? null,
    accepts_homework: Boolean(row.accepts_homework ?? false),
    created_at: row.created_at ?? row.createdAt ?? new Date(),
    updated_at: row.updated_at ?? row.updatedAt ?? new Date(),
    _archiveExtras:
      row.divisions?.length || row.studyTypes?.length
        ? { divisions: row.divisions ?? [], studyTypes: row.studyTypes ?? [] }
        : null,
  };
}

export function transformChapterToLesson(row, pdfUrlOverride) {
  const id = String(row.id);
  return {
    id,
    course_id: String(row.courseId),
    title: String(row.title ?? ""),
    title_ar: null,
    slug: id,
    content: row.description != null ? String(row.description) : null,
    video_url: row.videoUrl != null ? String(row.videoUrl) : null,
    pdf_url: pdfUrlOverride ?? (row.documentUrl != null ? String(row.documentUrl) : null),
    duration: null,
    order: Number(row.position ?? 0),
    accepts_homework: false,
    created_at: row.createdAt ?? new Date(),
    updated_at: row.updatedAt ?? new Date(),
    _archiveExtras: {
      isPublished: row.isPublished,
      isFree: row.isFree,
      videoType: row.videoType,
      youtubeVideoId: row.youtubeVideoId,
      requirePassingQuiz: row.requirePassingQuiz,
      requiredQuizId: row.requiredQuizId,
      studyTypes: row.studyTypes ?? [],
    },
  };
}

export function transformQuiz(row) {
  const quizTypeRaw = row.quizType ?? row.quiz_type ?? "NORMAL";
  const quizType = String(quizTypeRaw).toUpperCase() === "REMEDIAL" ? "REMEDIAL" : "NORMAL";
  const parentQuizId = row.parentQuizId ?? row.parent_quiz_id;
  return {
    id: String(row.id),
    course_id: String(row.courseId ?? row.course_id),
    title: String(row.title ?? ""),
    order: Number(row.position ?? row.order ?? 0),
    time_limit_minutes: row.timer ?? row.time_limit_minutes ?? null,
    quiz_type: quizType,
    parent_quiz_id: parentQuizId != null && String(parentQuizId).trim() ? String(parentQuizId) : null,
    created_at: row.created_at ?? row.createdAt ?? new Date(),
    updated_at: row.updated_at ?? row.updatedAt ?? new Date(),
    _archiveExtras: {
      description: row.description ?? null,
      isPublished: row.isPublished ?? null,
      maxAttempts: row.maxAttempts ?? null,
    },
  };
}

export function mapLegacyQuestionType(type) {
  const t = String(type ?? "MULTIPLE_CHOICE");
  if (t === "SHORT_ANSWER") return "ESSAY";
  if (t === "TRUE_FALSE" || t === "MULTIPLE_CHOICE" || t === "ESSAY") return t;
  return "MULTIPLE_CHOICE";
}

export function parseLegacyQuestionOptions(optionsJson, questionId, correctAnswer) {
  if (!optionsJson) return [];
  try {
    const parsed = JSON.parse(optionsJson);
    if (!Array.isArray(parsed)) return [];
    const now = new Date();
    return parsed.map((item, index) => {
      const text =
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "text" in item
            ? String(item.text)
            : String(item);
      return {
        id: `${questionId}-opt-${index}`,
        question_id: questionId,
        text,
        is_correct: text === String(correctAnswer ?? ""),
        created_at: now,
        updated_at: now,
      };
    });
  } catch {
    return [];
  }
}

export function transformQuestion(row) {
  const id = String(row.id);
  return {
    id,
    quiz_id: String(row.quizId ?? row.quiz_id),
    type: mapLegacyQuestionType(row.type),
    question_text: String(row.text ?? row.question_text ?? ""),
    image_url: row.imageUrl ?? row.image_url ?? null,
    order: Number(row.position ?? row.order ?? 0),
    created_at: row.created_at ?? row.createdAt ?? new Date(),
    updated_at: row.updated_at ?? row.updatedAt ?? new Date(),
    _archiveExtras: {
      imageUrl: row.imageUrl ?? null,
      points: row.points ?? null,
      correctAnswer: row.correctAnswer ?? null,
      options: row.options ?? null,
    },
    _optionsJson: row.options != null ? String(row.options) : null,
    _correctAnswer: row.correctAnswer != null ? String(row.correctAnswer) : "",
  };
}

export function transformPurchaseToEnrollment(row) {
  return {
    id: String(row.id),
    user_id: String(row.userId),
    course_id: String(row.courseId),
    enrolled_at: row.createdAt ?? new Date(),
  };
}

export function transformQuizResultToAttempt(row) {
  return {
    id: String(row.id),
    user_id: String(row.studentId),
    quiz_id: String(row.quizId),
    score: Number(row.score ?? 0),
    total_questions: Number(row.totalPoints ?? 0),
    created_at: row.submittedAt ?? row.createdAt ?? new Date(),
    updated_at: row.updatedAt ?? row.submittedAt ?? row.createdAt ?? new Date(),
  };
}

export function serializeRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (Array.isArray(v)) out[k] = v;
    else out[k] = v;
  }
  return out;
}
