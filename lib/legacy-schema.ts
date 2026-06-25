/**
 * Compatibility layer for the Infinity Math legacy database schema
 * (fullName/phoneNumber/Chapter/Purchase camelCase columns).
 */
import type {
  Course,
  Enrollment,
  Lesson,
  Question,
  QuestionOption,
  QuestionType,
  Quiz,
  User,
  UserRole,
} from "./types";

export type SchemaMode = "legacy" | "modern";

let cachedSchemaMode: SchemaMode | null = null;

export function isUuidLike(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

export function isCourseSegmentId(segment: string): boolean {
  return isUuidLike(segment) || /^c[a-z0-9]{22,24}$/i.test(segment);
}

/** Prefer modern is_published when both legacy and modern columns exist */
export function resolveCourseIsPublished(row: Record<string, unknown>): boolean {
  if (row.is_published != null) return Boolean(row.is_published);
  if (row.isPublished != null) return Boolean(row.isPublished);
  return false;
}

export async function detectSchemaMode(
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>,
): Promise<SchemaMode> {
  if (cachedSchemaMode) return cachedSchemaMode;
  try {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'fullName'
      LIMIT 1
    `;
    cachedSchemaMode = rows.length > 0 ? "legacy" : "modern";
  } catch {
    cachedSchemaMode = "modern";
  }
  return cachedSchemaMode;
}

export function resetSchemaModeCache(): void {
  cachedSchemaMode = null;
}

function mapLegacyRole(role: unknown): UserRole {
  const r = String(role ?? "USER");
  if (r === "USER") return "STUDENT";
  if (r === "ADMIN" || r === "TEACHER" || r === "ASSISTANT_ADMIN" || r === "STUDENT") {
    return r;
  }
  return "STUDENT";
}

/** Role values stored in legacy DB for a given app role */
export function legacyRolesForAppRole(role: UserRole): string[] {
  if (role === "STUDENT") return ["USER", "STUDENT"];
  return [role];
}

export function mapLegacyUserRow(row: Record<string, unknown>): User {
  const phone = row.phoneNumber != null ? String(row.phoneNumber) : "";
  return {
    id: String(row.id),
    email: phone ? `${phone}@phone.local` : "",
    password_hash: String(row.hashedPassword ?? ""),
    name: String(row.fullName ?? ""),
    role: mapLegacyRole(row.role),
    balance: String(row.balance ?? 0),
    student_number: phone || null,
    guardian_number: row.parentPhoneNumber != null ? String(row.parentPhoneNumber) : null,
    image: row.image != null ? String(row.image) : null,
    grade: row.grade != null ? String(row.grade) : null,
    division: row.division != null ? String(row.division) : null,
    studyType: row.studyType != null ? String(row.studyType) : null,
    governorate: row.governorate != null ? String(row.governorate) : null,
    created_at: row.createdAt as Date,
    updated_at: row.updatedAt as Date,
  } as User & {
    image?: string | null;
    grade?: string | null;
    division?: string | null;
    studyType?: string | null;
    governorate?: string | null;
  };
}

export function mapLegacyCourseRow(row: Record<string, unknown>): Course {
  const id = String(row.id);
  const imageUrl = row.imageUrl != null ? String(row.imageUrl) : row.image_url != null ? String(row.image_url) : null;
  return {
    id,
    title: String(row.title ?? ""),
    title_ar: row.title_ar != null ? String(row.title_ar) : null,
    slug: row.slug != null ? String(row.slug) : id,
    description: String(row.description ?? ""),
    short_desc: row.short_desc != null ? String(row.short_desc) : null,
    image_url: imageUrl,
    price: String(row.price ?? 0),
    duration: row.duration != null ? String(row.duration) : null,
    level: row.level != null ? String(row.level) : row.grade != null ? String(row.grade) : null,
    is_published: resolveCourseIsPublished(row),
    order: row.order != null ? Number(row.order) : 0,
    category_id: row.category_id != null ? String(row.category_id) : null,
    created_by_id: row.created_by_id != null ? String(row.created_by_id) : row.userId != null ? String(row.userId) : null,
    created_at: (row.created_at ?? row.createdAt) as Date,
    updated_at: (row.updated_at ?? row.updatedAt) as Date,
    grade: row.grade != null ? String(row.grade) : null,
    divisions: Array.isArray(row.divisions) ? row.divisions.map(String) : [],
    studyTypes: Array.isArray(row.studyTypes) ? row.studyTypes.map(String) : [],
    imageUrl,
  } as Course & {
    grade?: string | null;
    divisions?: string[];
    studyTypes?: string[];
    imageUrl?: string | null;
  };
}

export function mapLegacyChapterToLesson(row: Record<string, unknown>): Lesson {
  const id = String(row.id);
  return {
    id,
    title: String(row.title ?? ""),
    title_ar: null,
    slug: id,
    content: row.description != null ? String(row.description) : null,
    video_url: row.videoUrl != null ? String(row.videoUrl) : null,
    pdf_url: row.documentUrl != null ? String(row.documentUrl) : null,
    duration: null,
    order: Number(row.position ?? 0),
    course_id: String(row.courseId),
    is_free: Boolean(row.isFree),
    is_published: Boolean(row.isPublished),
    video_type: row.videoType != null ? String(row.videoType) : null,
    youtube_video_id: row.youtubeVideoId != null ? String(row.youtubeVideoId) : null,
    created_at: row.createdAt as Date,
    updated_at: row.updatedAt as Date,
  } as Lesson & {
    is_free?: boolean;
    is_published?: boolean;
    video_type?: string | null;
    youtube_video_id?: string | null;
  };
}

export function mapLegacyPurchaseToEnrollment(row: Record<string, unknown>): Enrollment {
  return {
    id: String(row.id),
    user_id: String(row.userId),
    course_id: String(row.courseId),
    enrolled_at: row.createdAt as Date,
    status: row.status != null ? String(row.status) : "ACTIVE",
  } as Enrollment & { status?: string };
}

export function mapLegacyQuizRow(row: Record<string, unknown>): Quiz {
  const quizTypeRaw = row.quizType ?? row.quiz_type;
  const quizType =
    String(quizTypeRaw ?? "NORMAL").toUpperCase() === "REMEDIAL" ? "REMEDIAL" : "NORMAL";
  const parentQuizId = row.parentQuizId ?? row.parent_quiz_id;
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    course_id: String(row.courseId),
    order: Number(row.position ?? 0),
    time_limit_minutes: row.timer != null ? Number(row.timer) : null,
    quiz_type: quizType,
    parent_quiz_id: parentQuizId != null && String(parentQuizId).trim() ? String(parentQuizId) : null,
    description: row.description != null ? String(row.description) : null,
    is_published: Boolean(row.isPublished),
    max_attempts: row.maxAttempts != null ? Number(row.maxAttempts) : 1,
    created_at: row.createdAt as Date,
    updated_at: row.updatedAt as Date,
  } as Quiz & {
    description?: string | null;
    is_published?: boolean;
    max_attempts?: number;
  };
}

function mapLegacyQuestionType(type: unknown): QuestionType {
  const t = String(type ?? "MULTIPLE_CHOICE");
  if (t === "SHORT_ANSWER") return "ESSAY";
  if (t === "TRUE_FALSE" || t === "MULTIPLE_CHOICE" || t === "ESSAY") return t;
  return "MULTIPLE_CHOICE";
}

export function parseLegacyQuestionOptions(
  optionsJson: string | null | undefined,
  questionId: string,
  correctAnswer: string,
): QuestionOption[] {
  if (!optionsJson) return [];
  try {
    const parsed = JSON.parse(optionsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = new Date();
    return parsed.map((item, index) => {
      const text =
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "text" in item
            ? String((item as { text: unknown }).text)
            : String(item);
      return {
        id: `${questionId}-opt-${index}`,
        text,
        is_correct: text === correctAnswer,
        question_id: questionId,
        position: index + 1,
        created_at: now,
        updated_at: now,
      };
    });
  } catch {
    return [];
  }
}

export function mapLegacyQuestionRow(row: Record<string, unknown>): Question {
  const id = String(row.id);
  return {
    id,
    type: mapLegacyQuestionType(row.type),
    question_text: String(row.text ?? ""),
    order: Number(row.position ?? 1),
    quiz_id: String(row.quizId),
    points: row.points != null ? Number(row.points) : 1,
    image_url: row.imageUrl != null ? String(row.imageUrl) : null,
    correct_answer: row.correctAnswer != null ? String(row.correctAnswer) : null,
    created_at: row.createdAt as Date,
    updated_at: row.updatedAt as Date,
  } as Question & {
    points?: number;
    image_url?: string | null;
    correct_answer?: string | null;
  };
}

export function mapLegacyQuestionWithOptions(row: Record<string, unknown>): Question & { options: QuestionOption[] } {
  const question = mapLegacyQuestionRow(row);
  const options = parseLegacyQuestionOptions(
    row.options != null ? String(row.options) : null,
    question.id,
    String(row.correctAnswer ?? ""),
  );
  return { ...question, options };
}

/** App role → value stored in legacy User.role */
export function appRoleToLegacyRole(role: UserRole): string {
  return role === "STUDENT" ? "USER" : role;
}
