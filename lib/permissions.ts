import type { UserRole } from "@/lib/types";

export function isStaffRole(role: string): role is "ADMIN" | "ASSISTANT_ADMIN" | "TEACHER" {
  return role === "ADMIN" || role === "ASSISTANT_ADMIN" || role === "TEACHER";
}

/** أدمن أو مساعد: يديرون كل الكورسات؛ مدرس: كورساته أو المُسنَدة إليه */
export function canManageCourse(
  role: UserRole | string,
  sessionUserId: string,
  courseCreatedById: string | null | undefined,
  courseAssignedTeacherId?: string | null | undefined,
): boolean {
  if (role === "ADMIN" || role === "ASSISTANT_ADMIN") return true;
  if (role === "TEACHER") {
    const assigned = courseAssignedTeacherId?.trim() || null;
    return (
      (!!courseCreatedById && courseCreatedById === sessionUserId) ||
      (!!assigned && assigned === sessionUserId)
    );
  }
  return false;
}

export function readCourseManageIds(course: {
  createdById?: string | null;
  created_by_id?: string | null;
  assignedTeacherId?: string | null;
  assigned_teacher_id?: string | null;
}): { createdById: string | null; assignedTeacherId: string | null } {
  const createdById = course.createdById ?? course.created_by_id ?? null;
  const assignedTeacherId = course.assignedTeacherId ?? course.assigned_teacher_id ?? null;
  return {
    createdById: createdById != null ? String(createdById) : null,
    assignedTeacherId: assignedTeacherId != null ? String(assignedTeacherId) : null,
  };
}

/** كورسات المدرس الذاتية تُخفى من القائمة العامة؛ المُسنَدة من الأدمن تبقى ظاهرة */
export function courseIsHiddenFromPublicTeacherCatalog(
  course: {
    createdById?: string | null;
    created_by_id?: string | null;
    assignedTeacherId?: string | null;
    assigned_teacher_id?: string | null;
  },
  teacherAccountIds: Set<string>,
): boolean {
  if (teacherAccountIds.size === 0) return false;
  const { createdById, assignedTeacherId } = readCourseManageIds(course);
  if (assignedTeacherId) return false;
  return !!createdById && teacherAccountIds.has(createdById);
}
