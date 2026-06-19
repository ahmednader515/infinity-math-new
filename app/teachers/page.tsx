import { redirect } from "next/navigation";
import { getTeachersFeatureEnabled } from "@/lib/db";
import { listTeachersForHomepageCached } from "@/lib/public-data-cache";
import { TeachersBrowseClient } from "./TeachersBrowseClient";

export const revalidate = 60;

export const metadata = {
  title: "اختر المدرسين | منصتي التعليمية",
  description: "تصفح مدرسي المنصة والدورات المتاحة لكل مدرس",
};

export default async function TeachersPage() {
  const enabled = await getTeachersFeatureEnabled();
  if (!enabled) {
    redirect("/");
  }
  const teachers = await listTeachersForHomepageCached().catch(() => []);

  return <TeachersBrowseClient initialTeachers={teachers} />;
}
