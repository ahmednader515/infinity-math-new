#!/usr/bin/env node
/**
 * Migrate legacy Infinity Math DB → clean modern schema on NEW_DATABASE_URL.
 *
 * Usage:
 *   npm run migrate:legacy-db -- --dry-run
 *   npm run migrate:legacy-db -- --bootstrap --truncate
 *   npm run migrate:legacy-db -- --users-only
 *
 * Env:
 *   DATABASE_URL      — legacy source
 *   NEW_DATABASE_URL  — modern target
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { neon, Pool } from "@neondatabase/serverless";
import "dotenv/config";
import {
  transformUser,
  transformCategory,
  transformCourse,
  transformChapterToLesson,
  transformQuiz,
  transformQuestion,
  parseLegacyQuestionOptions,
  transformPurchaseToEnrollment,
  transformQuizResultToAttempt,
  serializeRow,
} from "./migrate-legacy-transforms.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const TRUNCATE = args.has("--truncate");
const BOOTSTRAP = args.has("--bootstrap");
const SKIP_ARCHIVE = args.has("--skip-archive");
const USERS_ONLY = args.has("--users-only");

const LEGACY_URL = process.env.DATABASE_URL;
const NEW_URL = process.env.NEW_DATABASE_URL;

if (!LEGACY_URL) {
  console.error("Missing DATABASE_URL (legacy source)");
  process.exit(1);
}
if (!NEW_URL) {
  console.error("Missing NEW_DATABASE_URL (migration target)");
  process.exit(1);
}
if (LEGACY_URL === NEW_URL) {
  console.error("DATABASE_URL and NEW_DATABASE_URL must be different");
  process.exit(1);
}

const legacySql = neon(LEGACY_URL);
const newSql = neon(NEW_URL);
const legacyPool = new Pool({ connectionString: LEGACY_URL });
const newPool = new Pool({ connectionString: NEW_URL });

process.on("exit", () => {
  legacyPool.end().catch(() => {});
  newPool.end().catch(() => {});
});

const stats = {
  users: { source: 0, target: 0 },
  categories: { source: 0, target: 0 },
  courses: { source: 0, target: 0 },
  lessons: { source: 0, target: 0 },
  quizzes: { source: 0, target: 0 },
  quizAssignments: { source: 0, target: 0 },
  questions: { source: 0, target: 0 },
  questionOptions: { source: 0, target: 0 },
  enrollments: { source: 0, target: 0 },
  quizAttempts: { source: 0, target: 0 },
  payments: { source: 0, target: 0 },
  archived: 0,
  emailDedupes: 0,
  errors: [],
};

function log(msg) {
  console.log(msg);
}

function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inDollar = false;
  let dollarTag = "";

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText[i];
    if (!inDollar && ch === "$") {
      const match = sqlText.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
      if (match) {
        if (!dollarTag) {
          dollarTag = match[0];
          inDollar = true;
        } else if (sqlText.slice(i, i + dollarTag.length) === dollarTag) {
          inDollar = false;
          dollarTag = "";
        }
      }
    }
    current += ch;
    if (!inDollar && ch === ";") {
      const stmt = current.trim();
      if (stmt && !stmt.startsWith("--")) statements.push(stmt);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail && !tail.startsWith("--")) statements.push(tail);
  return statements;
}

async function runSqlFile(pool, filePath) {
  if (!existsSync(filePath)) throw new Error(`SQL file not found: ${filePath}`);
  const content = readFileSync(filePath, "utf8");
  const statements = splitSqlStatements(content);
  log(`  Running ${filePath} (${statements.length} statements)...`);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already exists|duplicate/i.test(msg)) continue;
      throw err;
    }
  }
}

async function bootstrapTarget() {
  log("\n=== Bootstrapping target schema ===");
  if (DRY_RUN) {
    log("  [dry-run] Would run init-neon-database.sql + bootstrap-new-database.sql");
    return;
  }
  const pool = new Pool({ connectionString: NEW_URL });
  try {
    await runSqlFile(pool, join(SCRIPTS_DIR, "init-neon-database.sql"));
    await runSqlFile(pool, join(SCRIPTS_DIR, "bootstrap-new-database.sql"));
    log("  Bootstrap complete.");
  } finally {
    await pool.end();
  }
}

async function tableExists(sql, tableName) {
  const rows = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${tableName}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function countTable(pool, tableName) {
  const sqlClient = pool === legacyPool ? legacySql : newSql;
  if (!(await tableExists(sqlClient, tableName))) return 0;
  const result = await pool.query(`SELECT COUNT(*)::int AS c FROM "${tableName}"`);
  return Number(result.rows[0]?.c ?? 0);
}

async function truncateTarget() {
  log("\n=== Truncating target tables ===");
  if (DRY_RUN) {
    log("  [dry-run] Would truncate all public tables");
    return;
  }
  const tables = await newPool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%'
    ORDER BY tablename
  `);
  if (tables.rows.length === 0) return;
  const names = tables.rows.map((r) => `"${r.tablename}"`).join(", ");
  await newPool.query(`TRUNCATE ${names} RESTART IDENTITY CASCADE`);
  log(`  Truncated ${tables.rows.length} tables.`);
}

async function ensureArchiveTable() {
  if (DRY_RUN || SKIP_ARCHIVE) return;
  await newSql`
    CREATE TABLE IF NOT EXISTS "_MigrationArchive" (
      id           TEXT PRIMARY KEY,
      source_table TEXT NOT NULL,
      source_id    TEXT NOT NULL,
      payload      JSONB NOT NULL,
      migrated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function archiveRow(sourceTable, row) {
  if (SKIP_ARCHIVE || DRY_RUN) {
    stats.archived++;
    return;
  }
  const id = `${sourceTable}:${row.id ?? row.source_id ?? stats.archived}`;
  await newSql`
    INSERT INTO "_MigrationArchive" (id, source_table, source_id, payload)
    VALUES (
      ${id},
      ${sourceTable},
      ${String(row.id ?? "")},
      ${JSON.stringify(serializeRow(row))}
    )
    ON CONFLICT (id) DO NOTHING
  `;
  stats.archived++;
}

async function archiveTable(sourceTable, rows) {
  for (const row of rows) {
    await archiveRow(sourceTable, row);
  }
  log(`  Archived ${rows.length} rows from ${sourceTable}`);
}

async function fetchAllLegacy(table) {
  if (!(await tableExists(legacySql, table))) return [];
  const result = await legacyPool.query(`SELECT * FROM "${table}"`);
  return result.rows;
}

async function insertUser(row) {
  await newSql`
    INSERT INTO "User" (
      id, email, password_hash, name, role, balance,
      student_number, guardian_number, grade, division, study_type, governorate,
      created_at, updated_at
    ) VALUES (
      ${row.id}, ${row.email}, ${row.password_hash}, ${row.name}, ${row.role}, ${row.balance},
      ${row.student_number}, ${row.guardian_number}, ${row.grade}, ${row.division},
      ${row.study_type}, ${row.governorate},
      ${row.created_at}, ${row.updated_at}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      student_number = EXCLUDED.student_number,
      guardian_number = EXCLUDED.guardian_number,
      grade = EXCLUDED.grade,
      division = EXCLUDED.division,
      study_type = EXCLUDED.study_type,
      governorate = EXCLUDED.governorate,
      updated_at = EXCLUDED.updated_at
  `;
}

async function migrateUsers() {
  log("\n=== Users ===");
  const rows = await fetchAllLegacy("User");
  stats.users.source = rows.length;
  const usedEmails = new Set();
  let dedupes = 0;

  for (const raw of rows) {
    const row = transformUser(raw, usedEmails);
    const plainEmail = `${String(raw.phoneNumber ?? raw.student_number ?? "").trim()}@phone.local`;
    if (row.email !== plainEmail && plainEmail) dedupes++;

    if (DRY_RUN) continue;
    await insertUser(row);
  }

  stats.emailDedupes = dedupes;
  if (!DRY_RUN) stats.users.target = await countTable(newPool, "User");
  log(`  ${stats.users.source} → ${DRY_RUN ? "(dry-run)" : stats.users.target} users (${dedupes} email dedupes)`);
}

async function migrateCategories() {
  log("\n=== Categories ===");
  if (!(await tableExists(legacySql, "Category"))) {
    log("  Skipped (no Category table on source)");
    return;
  }
  const rows = await fetchAllLegacy("Category");
  stats.categories.source = rows.length;
  for (const raw of rows) {
    const row = transformCategory(raw);
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "Category" (
        id, name, name_ar, slug, description, image_url, "order", created_by_id, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.name}, ${row.name_ar}, ${row.slug}, ${row.description}, ${row.image_url},
        ${row.order}, ${row.created_by_id}, ${row.created_at}, ${row.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.categories.target = await countTable(newPool, "Category");
  log(`  ${stats.categories.source} → ${DRY_RUN ? "(dry-run)" : stats.categories.target}`);
}

async function migrateCourses() {
  log("\n=== Courses ===");
  const rows = await fetchAllLegacy("Course");
  stats.courses.source = rows.length;
  for (const raw of rows) {
    const row = transformCourse(raw);
    if (row._archiveExtras && !SKIP_ARCHIVE && !DRY_RUN) {
      await archiveRow("Course_extras", { id: row.id, ...row._archiveExtras });
    }
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "Course" (
        id, title, title_ar, slug, description, description_en, short_desc, short_desc_en,
        image_url, price, duration, level, is_published, "order", max_quiz_attempts,
        category_id, created_by_id, accepts_homework, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.title}, ${row.title_ar}, ${row.slug}, ${row.description},
        ${row.description_en}, ${row.short_desc}, ${row.short_desc_en},
        ${row.image_url}, ${row.price}, ${row.duration}, ${row.level}, ${row.is_published},
        ${row.order}, ${row.max_quiz_attempts}, ${row.category_id}, ${row.created_by_id},
        ${row.accepts_homework}, ${row.created_at}, ${row.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.courses.target = await countTable(newPool, "Course");
  log(`  ${stats.courses.source} → ${DRY_RUN ? "(dry-run)" : stats.courses.target}`);
}

async function loadChapterAttachmentMap() {
  const map = new Map();
  if (!(await tableExists(legacySql, "ChapterAttachment"))) return map;
  const rows = await legacySql`SELECT * FROM "ChapterAttachment" ORDER BY position ASC, "createdAt" ASC`;
  for (const row of rows) {
    const chapterId = String(row.chapterId);
    if (!map.has(chapterId)) map.set(chapterId, String(row.url));
  }
  return map;
}

async function migrateLessons() {
  log("\n=== Chapters → Lessons ===");
  if (!(await tableExists(legacySql, "Chapter"))) {
    log("  Skipped (no Chapter table on source)");
    return;
  }
  const attachmentMap = await loadChapterAttachmentMap();
  const rows = await fetchAllLegacy("Chapter");
  stats.lessons.source = rows.length;

  for (const raw of rows) {
    const chapterId = String(raw.id);
    const pdfOverride =
      !raw.documentUrl && attachmentMap.has(chapterId) ? attachmentMap.get(chapterId) : null;
    const row = transformChapterToLesson(raw, pdfOverride);

    if (row._archiveExtras && !SKIP_ARCHIVE && !DRY_RUN) {
      await archiveRow("Chapter_metadata", { id: row.id, ...row._archiveExtras });
    }
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "Lesson" (
        id, course_id, title, title_ar, slug, content, video_url, pdf_url,
        duration, "order", accepts_homework, created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.course_id}, ${row.title}, ${row.title_ar}, ${row.slug},
        ${row.content}, ${row.video_url}, ${row.pdf_url}, ${row.duration}, ${row.order},
        ${row.accepts_homework}, ${row.created_at}, ${row.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.lessons.target = await countTable(newPool, "Lesson");
  log(`  ${stats.lessons.source} → ${DRY_RUN ? "(dry-run)" : stats.lessons.target}`);
}

async function migrateQuizzes() {
  log("\n=== Quizzes ===");
  const rows = await fetchAllLegacy("Quiz");
  stats.quizzes.source = rows.length;
  for (const raw of rows) {
    const row = transformQuiz(raw);
    if (row._archiveExtras && !SKIP_ARCHIVE && !DRY_RUN) {
      await archiveRow("Quiz_extras", { id: row.id, ...row._archiveExtras });
    }
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "Quiz" (
        id, course_id, title, "order", time_limit_minutes, quiz_type, parent_quiz_id,
        created_at, updated_at
      ) VALUES (
        ${row.id}, ${row.course_id}, ${row.title}, ${row.order}, ${row.time_limit_minutes},
        ${row.quiz_type}, ${row.parent_quiz_id}, ${row.created_at}, ${row.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.quizzes.target = await countTable(newPool, "Quiz");
  log(`  ${stats.quizzes.source} → ${DRY_RUN ? "(dry-run)" : stats.quizzes.target}`);
}

async function migrateQuizCourseAssignments() {
  log("\n=== QuizCourseAssignment ===");
  if (!(await tableExists(legacySql, "QuizCourseAssignment"))) {
    log("  Skipped (no QuizCourseAssignment on source)");
    return;
  }
  const rows = await fetchAllLegacy("QuizCourseAssignment");
  stats.quizAssignments.source = rows.length;
  for (const raw of rows) {
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "QuizCourseAssignment" (id, "quizId", "courseId", position, created_at, updated_at)
      VALUES (
        ${String(raw.id)},
        ${String(raw.quizId)},
        ${String(raw.courseId)},
        ${Number(raw.position ?? 0)},
        ${raw.createdAt ?? new Date()},
        ${raw.updatedAt ?? new Date()}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.quizAssignments.target = await countTable(newPool, "QuizCourseAssignment");
  log(`  ${stats.quizAssignments.source} → ${DRY_RUN ? "(dry-run)" : stats.quizAssignments.target}`);
}

async function migrateQuestions() {
  log("\n=== Questions + QuestionOption ===");
  const rows = await fetchAllLegacy("Question");
  stats.questions.source = rows.length;
  let optionCount = 0;

  for (const raw of rows) {
    const row = transformQuestion(raw);
    if (row._archiveExtras && !SKIP_ARCHIVE && !DRY_RUN) {
      await archiveRow("Question_extras", { id: row.id, ...row._archiveExtras });
    }
    if (!DRY_RUN) {
      await newSql`
        INSERT INTO "Question" (id, quiz_id, type, question_text, "order", image_url, created_at, updated_at)
        VALUES (
          ${row.id}, ${row.quiz_id}, ${row.type}, ${row.question_text}, ${row.order},
          ${row.image_url}, ${row.created_at}, ${row.updated_at}
        )
        ON CONFLICT (id) DO UPDATE SET
          image_url = COALESCE(EXCLUDED.image_url, "Question".image_url)
      `;
      const options = parseLegacyQuestionOptions(row._optionsJson, row.id, row._correctAnswer);
      for (const opt of options) {
        await newSql`
          INSERT INTO "QuestionOption" (id, question_id, text, is_correct, created_at, updated_at)
          VALUES (${opt.id}, ${opt.question_id}, ${opt.text}, ${opt.is_correct}, ${opt.created_at}, ${opt.updated_at})
          ON CONFLICT (id) DO NOTHING
        `;
        optionCount++;
      }
    } else {
      optionCount += parseLegacyQuestionOptions(row._optionsJson, row.id, row._correctAnswer).length;
    }
  }

  stats.questionOptions.source = optionCount;
  if (!DRY_RUN) {
    stats.questions.target = await countTable(newPool, "Question");
    stats.questionOptions.target = await countTable(newPool, "QuestionOption");
  }
  log(`  Questions: ${stats.questions.source} → ${DRY_RUN ? "(dry-run)" : stats.questions.target}`);
  log(`  Options:   ${optionCount} → ${DRY_RUN ? "(dry-run)" : stats.questionOptions.target}`);
}

async function migrateEnrollments() {
  log("\n=== Purchase → Enrollment ===");
  if (!(await tableExists(legacySql, "Purchase"))) {
    log("  Skipped (no Purchase table on source)");
    return;
  }
  const rows = await legacySql`SELECT * FROM "Purchase" WHERE status = 'ACTIVE'`;
  stats.enrollments.source = rows.length;
  for (const raw of rows) {
    const row = transformPurchaseToEnrollment(raw);
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "Enrollment" (id, user_id, course_id, enrolled_at)
      VALUES (${row.id}, ${row.user_id}, ${row.course_id}, ${row.enrolled_at})
      ON CONFLICT (user_id, course_id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.enrollments.target = await countTable(newPool, "Enrollment");
  log(`  ${stats.enrollments.source} → ${DRY_RUN ? "(dry-run)" : stats.enrollments.target}`);
}

async function migrateQuizAttemptsFromResults() {
  log("\n=== QuizResult → QuizAttempt ===");
  if (!(await tableExists(legacySql, "QuizResult"))) {
    log("  Skipped (no QuizResult on source)");
    return;
  }
  const rows = await fetchAllLegacy("QuizResult");
  stats.quizAttempts.source = rows.length;
  for (const raw of rows) {
    const row = transformQuizResultToAttempt(raw);
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "QuizAttempt" (id, user_id, quiz_id, score, total_questions, created_at, updated_at)
      VALUES (
        ${row.id}, ${row.user_id}, ${row.quiz_id}, ${row.score}, ${row.total_questions},
        ${row.created_at}, ${row.updated_at}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.quizAttempts.target = await countTable(newPool, "QuizAttempt");
  log(`  ${stats.quizAttempts.source} → ${DRY_RUN ? "(dry-run)" : stats.quizAttempts.target}`);
}

async function migratePayments() {
  log("\n=== Payments ===");
  if (!(await tableExists(legacySql, "Payment"))) {
    log("  Skipped (no Payment table on source)");
    return;
  }
  const rows = await fetchAllLegacy("Payment");
  stats.payments.source = rows.length;
  for (const raw of rows) {
    if (DRY_RUN) continue;
    await newSql`
      INSERT INTO "Payment" (id, user_id, course_id, amount, created_at)
      VALUES (
        ${String(raw.id)},
        ${String(raw.user_id ?? raw.userId)},
        ${String(raw.course_id ?? raw.courseId)},
        ${Number(raw.amount ?? 0)},
        ${raw.created_at ?? raw.createdAt ?? new Date()}
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }
  if (!DRY_RUN) stats.payments.target = await countTable(newPool, "Payment");
  log(`  ${stats.payments.source} → ${DRY_RUN ? "(dry-run)" : stats.payments.target}`);
}

async function migrateArchiveOnlyTables() {
  log("\n=== Archiving legacy-only tables ===");
  const archiveTables = [
    "Attachment",
    "ChapterAttachment",
    "UserProgress",
    "BalanceTransaction",
    "PromoCode",
    "PromoCodeCourse",
    "QuizAnswer",
    "QuizStudentSettings",
    "QuizAttempt",
  ];

  for (const table of archiveTables) {
    if (!(await tableExists(legacySql, table))) continue;
    const rows = await fetchAllLegacy(table);
    if (rows.length === 0) continue;
    if (DRY_RUN) {
      stats.archived += rows.length;
      log(`  [dry-run] Would archive ${rows.length} from ${table}`);
      continue;
    }
    await archiveTable(table, rows);
  }
}

async function migrateOptionalModernTables() {
  log("\n=== Optional tables (copy if present on source) ===");

  if (await tableExists(legacySql, "Review") && await tableExists(newSql, "Review")) {
    const sourceRows = await fetchAllLegacy("Review");
    if (sourceRows.length > 0 && !DRY_RUN) {
      for (const raw of sourceRows) {
        await newSql`
          INSERT INTO "Review" (
            id, text, text_en, author_name, author_title, author_title_en,
            avatar_letter, image_url, "order", created_at, updated_at
          ) VALUES (
            ${String(raw.id)},
            ${String(raw.text ?? "")},
            ${raw.text_en ?? raw.textEn ?? null},
            ${String(raw.author_name ?? raw.authorName ?? "")},
            ${raw.author_title ?? raw.authorTitle ?? null},
            ${raw.author_title_en ?? raw.authorTitleEn ?? null},
            ${raw.avatar_letter ?? raw.avatarLetter ?? null},
            ${raw.image_url ?? raw.imageUrl ?? null},
            ${Number(raw.order ?? 0)},
            ${raw.created_at ?? raw.createdAt ?? new Date()},
            ${raw.updated_at ?? raw.updatedAt ?? new Date()}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      }
      log(`  Review: copied ${sourceRows.length} rows`);
    } else if (sourceRows.length > 0) {
      log(`  [dry-run] Would copy ${sourceRows.length} Review rows`);
    }
  } else {
    log("  Skipped Review");
  }

  if (await tableExists(legacySql, "HomepageSetting") && await tableExists(newSql, "HomepageSetting")) {
    const sourceRows = await fetchAllLegacy("HomepageSetting");
    if (sourceRows.length > 0) {
      log(`  HomepageSetting: ${sourceRows.length} row(s) on source (default row created by init script)`);
    }
  }
}

async function printVerificationReport() {
  log("\n========================================");
  log("Migration Report");
  log("========================================");
  const fmt = (n) => (DRY_RUN ? "(dry-run)" : String(n));
  log(`Users:           ${stats.users.source} → ${fmt(stats.users.target)}`);
  log(`Categories:      ${stats.categories.source} → ${fmt(stats.categories.target)}`);
  log(`Courses:         ${stats.courses.source} → ${fmt(stats.courses.target)}`);
  log(`Lessons:         ${stats.lessons.source} → ${fmt(stats.lessons.target)} (from Chapter)`);
  log(`Quizzes:         ${stats.quizzes.source} → ${fmt(stats.quizzes.target)}`);
  log(`QuizAssignments: ${stats.quizAssignments.source} → ${fmt(stats.quizAssignments.target)}`);
  log(`Questions:       ${stats.questions.source} → ${fmt(stats.questions.target)}`);
  log(`Options:         ${stats.questionOptions.source} → ${fmt(stats.questionOptions.target)}`);
  log(`Enrollments:     ${stats.enrollments.source} → ${fmt(stats.enrollments.target)}`);
  log(`QuizAttempts:    ${stats.quizAttempts.source} → ${fmt(stats.quizAttempts.target)} (from QuizResult)`);
  log(`Payments:        ${stats.payments.source} → ${fmt(stats.payments.target)}`);
  log(`Archived rows:   ${stats.archived}`);
  log(`Email dedupes:   ${stats.emailDedupes}`);

  if (!DRY_RUN) {
    log("\n--- Sanity checks ---");
    try {
      const sampleStudent = await legacyPool.query(`
        SELECT u.id,
          u.name AS display_name,
          COALESCE(u.student_number, u."phoneNumber") AS phone,
          c.title
        FROM "Purchase" p
        JOIN "User" u ON u.id = p."userId"
        JOIN "Course" c ON c.id = p."courseId"
        WHERE p.status = 'ACTIVE'
        LIMIT 1
      `);
      if (sampleStudent.rows[0]) {
        const s = sampleStudent.rows[0];
        log(`  Sample enrollment: ${s.display_name} → ${s.title} (phone: ${s.phone})`);
      }
      const published = await legacyPool.query(`
        SELECT COUNT(*)::int AS c FROM "Course"
        WHERE COALESCE(is_published, "isPublished", false) = true
      `);
      log(`  Published courses on source: ${published.rows[0]?.c ?? 0}`);

      const targetUsers = await countTable(newPool, "User");
      const targetCourses = await countTable(newPool, "Course");
      log(`  Target DB: ${targetUsers} users, ${targetCourses} courses`);
    } catch (err) {
      stats.errors.push(`Sanity check: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!SKIP_ARCHIVE) {
      const archived = await countTable(newPool, "_MigrationArchive");
      log(`  Rows in _MigrationArchive: ${archived}`);
    }
  }

  if (stats.errors.length) {
    log("\nWarnings:");
    for (const e of stats.errors) log(`  - ${e}`);
  }

  log("\n--- Next steps ---");
  log("1. Spot-check login with a student phone number on the NEW database");
  log("2. Set DATABASE_URL = NEW_DATABASE_URL in .env");
  log("3. Restart the dev server");
  if (DRY_RUN) log("\n(dry-run mode — no data was written)");
}

async function main() {
  log("Legacy → New Database Migration");
  log(`Source: ${LEGACY_URL.replace(/:[^:@/]+@/, ":***@")}`);
  log(`Target: ${NEW_URL.replace(/:[^:@/]+@/, ":***@")}`);
  if (DRY_RUN) log("Mode: DRY RUN");
  if (TRUNCATE) log("Mode: TRUNCATE target before migrate");
  if (BOOTSTRAP) log("Mode: BOOTSTRAP target schema first");
  if (USERS_ONLY) log("Mode: USERS ONLY (re-sync names from source)");

  if (BOOTSTRAP) await bootstrapTarget();
  if (TRUNCATE) await truncateTarget();
  if (!USERS_ONLY) await ensureArchiveTable();

  await migrateUsers();
  if (USERS_ONLY) {
    await printVerificationReport();
    return;
  }

  await migrateCategories();
  await migrateCourses();
  await migrateLessons();
  await migrateQuizzes();
  await migrateQuizCourseAssignments();
  await migrateQuestions();
  await migrateEnrollments();
  await migrateQuizAttemptsFromResults();
  await migratePayments();
  await migrateArchiveOnlyTables();
  await migrateOptionalModernTables();

  await printVerificationReport();
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
