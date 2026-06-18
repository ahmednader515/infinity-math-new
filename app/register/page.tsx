"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LoginBackground from "@/app/login/LoginBackground";
import { useT } from "@/components/LocaleProvider";
import {
  EGYPT_GOVERNORATES,
  SIGNUP_GRADES,
  SIGNUP_STUDY_TYPES,
  divisionsForGrade,
  type SignupGrade,
} from "@/lib/signup-options";

const selectClassName =
  "mt-1 w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

const inputClassName =
  "mt-1 w-full rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]";

export default function RegisterPage() {
  const t = useT();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [studentNumber, setStudentNumber] = useState("");
  const [guardianNumber, setGuardianNumber] = useState("");
  const [grade, setGrade] = useState<SignupGrade | "">("");
  const [division, setDivision] = useState("");
  const [studyType, setStudyType] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const divisionOptions = useMemo(
    () => (grade ? divisionsForGrade(grade) : []),
    [grade],
  );

  const passwordsMatch =
    password.length > 0 && confirmPassword.length > 0 && password === confirmPassword;

  function handleGradeChange(value: string) {
    setGrade(value as SignupGrade | "");
    setDivision("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const digits = studentNumber.replace(/\D/g, "");
    if (digits.length !== 11) {
      setError(t("auth.register.phoneMustBe11", "Phone number must be 11 digits"));
      return;
    }
    const guardianDigits = guardianNumber.replace(/\D/g, "");
    if (guardianDigits.length !== 11) {
      setError(t("auth.register.parentPhoneMustBe11", "Guardian phone must be 11 digits"));
      return;
    }
    if (!grade) {
      setError(t("auth.register.gradeRequired", "Please select your grade"));
      return;
    }
    if (!division) {
      setError(t("auth.register.divisionRequired", "Please select your division"));
      return;
    }
    if (!studyType) {
      setError(t("auth.register.studyTypeRequired", "Please select study type"));
      return;
    }
    if (!governorate) {
      setError(t("auth.register.governorateRequired", "Please select governorate"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.register.passwordMismatch", "Passwords do not match"));
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        confirm_password: confirmPassword,
        name,
        student_number: studentNumber.trim(),
        guardian_number: guardianNumber.trim(),
        grade,
        division,
        study_type: studyType,
        governorate,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? t("auth.register.createFailed", "Failed to create account"));
      return;
    }
    router.push(
      `/login?message=${encodeURIComponent(t("auth.register.signupSuccessMessage", "Account created successfully, you can now log in"))}`,
    );
    router.refresh();
  }

  return (
    <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-none items-center justify-center overflow-hidden bg-black px-4 py-12">
      <LoginBackground />
      <div className="pointer-events-none absolute inset-0 z-[1] bg-black/55" />
      <div className="relative z-10 w-full max-w-md rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
          {t("auth.register.title", "Create account")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {t("auth.register.subtitle", "Enter your details to create a new account")}
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {error && (
            <div className="rounded-[var(--radius-btn)] bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.fullNameLabel", "Full name (Arabic)")}
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className={inputClassName}
              placeholder={t("auth.register.fullNamePlaceholder", "Example: Ahmed Mohamed Ali Hassan")}
            />
          </div>
          <div>
            <label htmlFor="student_number" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.phoneLabel", "Student phone (WhatsApp)")}
            </label>
            <input
              id="student_number"
              type="tel"
              inputMode="numeric"
              value={studentNumber}
              onChange={(e) => setStudentNumber(e.target.value)}
              required
              className={`${inputClassName} text-right`}
              placeholder="01xxxxxxxxx"
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="guardian_number" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.parentPhoneLabel", "Guardian phone number")}
            </label>
            <input
              id="guardian_number"
              type="tel"
              inputMode="numeric"
              value={guardianNumber}
              onChange={(e) => setGuardianNumber(e.target.value)}
              required
              className={`${inputClassName} text-right`}
              placeholder="01xxxxxxxxx"
              dir="ltr"
            />
          </div>
          <div>
            <label htmlFor="grade" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.gradeLabel", "Grade")}
            </label>
            <select
              id="grade"
              value={grade}
              onChange={(e) => handleGradeChange(e.target.value)}
              required
              className={selectClassName}
            >
              <option value="">{t("auth.register.gradePlaceholder", "Select grade")}</option>
              {SIGNUP_GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          {grade ? (
            <div>
              <label htmlFor="division" className="block text-sm font-medium text-[var(--color-foreground)]">
                {t("auth.register.divisionLabel", "Division")}
              </label>
              <select
                id="division"
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                required
                className={selectClassName}
              >
                <option value="">{t("auth.register.divisionPlaceholder", "Select division")}</option>
                {divisionOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div>
            <label htmlFor="study_type" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.studyTypeLabel", "Study type")}
            </label>
            <select
              id="study_type"
              value={studyType}
              onChange={(e) => setStudyType(e.target.value)}
              required
              className={selectClassName}
            >
              <option value="">{t("auth.register.studyTypePlaceholder", "Select study type")}</option>
              {SIGNUP_STUDY_TYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="governorate" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.governorateLabel", "Governorate")}
            </label>
            <select
              id="governorate"
              value={governorate}
              onChange={(e) => setGovernorate(e.target.value)}
              required
              className={selectClassName}
            >
              <option value="">{t("auth.register.governoratePlaceholder", "Select governorate")}</option>
              {EGYPT_GOVERNORATES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.passwordLabel", "Password")}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className={inputClassName}
              placeholder={t("auth.register.passwordPlaceholder", "At least 6 characters")}
            />
          </div>
          <div>
            <label htmlFor="confirm_password" className="block text-sm font-medium text-[var(--color-foreground)]">
              {t("auth.register.confirmPasswordLabel", "Confirm password")}
            </label>
            <input
              id="confirm_password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className={inputClassName}
              placeholder={t("auth.register.confirmPasswordPlaceholder", "Re-enter password")}
            />
            {passwordsMatch ? (
              <p className="mt-1 text-xs text-[var(--color-success)]">
                {t("auth.register.passwordsMatch", "Passwords match")}
              </p>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] py-2.5 font-medium text-white transition hover:bg-[var(--color-primary-hover)] disabled:opacity-50"
          >
            {loading ? t("auth.register.submitting", "Creating account...") : t("auth.register.submit", "Create account")}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-[var(--color-muted)]">
          {t("auth.register.hasAccount", "Already have an account?")}{" "}
          <Link href="/login" className="font-medium text-[var(--color-primary)] hover:underline">
            {t("auth.register.login", "Log in")}
          </Link>
        </p>
      </div>
    </div>
  );
}
