import { neon } from "@neondatabase/serverless";
import "dotenv/config";

const sql = neon(process.env.DATABASE_URL);

console.log("=== Legacy DB verification ===\n");

// Courses
const courses = await sql`
  SELECT id, title, "isPublished" FROM "Course" WHERE "isPublished" = true ORDER BY "createdAt" DESC LIMIT 3
`;
console.log(`Published courses: ${courses.length}`);
for (const c of courses) {
  const chapters = await sql`
    SELECT COUNT(*)::int as c FROM "Chapter" WHERE "courseId" = ${c.id} AND "isPublished" = true
  `;
  const purchases = await sql`
    SELECT COUNT(*)::int as c FROM "Purchase" WHERE "courseId" = ${c.id} AND status = 'ACTIVE'
  `;
  console.log(`  - ${c.title} (${chapters[0].c} chapters, ${purchases[0].c} purchases)`);
}

// User login lookup
const admin = await sql`SELECT * FROM "User" WHERE role = 'ADMIN' LIMIT 1`;
if (admin[0]) {
  const phone = admin[0].phoneNumber;
  const found = await sql`SELECT id FROM "User" WHERE "phoneNumber" = ${phone} LIMIT 1`;
  console.log(`\nAdmin phone lookup: ${found.length > 0 ? "OK" : "FAIL"} (${phone})`);
}

// Student with purchase
const enrolled = await sql`
  SELECT u."fullName", u."phoneNumber", c.title
  FROM "Purchase" p
  JOIN "User" u ON u.id = p."userId"
  JOIN "Course" c ON c.id = p."courseId"
  WHERE p.status = 'ACTIVE'
  LIMIT 1
`;
if (enrolled[0]) {
  console.log(`\nSample enrollment: ${enrolled[0].fullName} -> ${enrolled[0].title}`);
}

console.log("\nDone.");
