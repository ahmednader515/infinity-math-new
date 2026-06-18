export const SIGNUP_GRADES = [
  "الأول الثانوي",
  "الثاني الثانوي",
  "الثالث الثانوي",
] as const;

export type SignupGrade = (typeof SIGNUP_GRADES)[number];

export const SIGNUP_DIVISIONS_BY_GRADE: Record<SignupGrade, readonly string[]> = {
  "الأول الثانوي": ["بكالوريا", "عام"],
  "الثاني الثانوي": ["علمي", "ادبي", "بكالوريا"],
  "الثالث الثانوي": ["علمي رياضة", "ادبي"],
};

export const SIGNUP_STUDY_TYPES = ["سنتر", "اونلاين"] as const;

export type SignupStudyType = (typeof SIGNUP_STUDY_TYPES)[number];

/** جميع محافظات مصر (27 محافظة) */
export const EGYPT_GOVERNORATES = [
  "القاهرة",
  "الجيزة",
  "الأسكندرية",
  "الدقهلية",
  "البحر الأحمر",
  "البحيرة",
  "الفيوم",
  "الغربية",
  "الإسماعيلية",
  "المنوفية",
  "المنيا",
  "القليوبية",
  "الوادي الجديد",
  "السويس",
  "أسوان",
  "أسيوط",
  "بني سويف",
  "بورسعيد",
  "دمياط",
  "الشرقية",
  "جنوب سيناء",
  "كفر الشيخ",
  "مطروح",
  "الأقصر",
  "قنا",
  "شمال سيناء",
  "سوهاج",
] as const;

export type EgyptGovernorate = (typeof EGYPT_GOVERNORATES)[number];

export function divisionsForGrade(grade: string): readonly string[] {
  return SIGNUP_DIVISIONS_BY_GRADE[grade as SignupGrade] ?? [];
}

export function isValidSignupGrade(grade: string): grade is SignupGrade {
  return (SIGNUP_GRADES as readonly string[]).includes(grade);
}

export function isValidDivisionForGrade(grade: string, division: string): boolean {
  return divisionsForGrade(grade).includes(division);
}

export function isValidSignupStudyType(value: string): value is SignupStudyType {
  return (SIGNUP_STUDY_TYPES as readonly string[]).includes(value);
}

export function isValidGovernorate(value: string): value is EgyptGovernorate {
  return (EGYPT_GOVERNORATES as readonly string[]).includes(value);
}
