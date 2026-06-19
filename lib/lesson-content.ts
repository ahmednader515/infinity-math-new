/** هل النص يحتوي وسوم HTML (مثل محتوى منسوخ من محرر أو استيراد قديم) */
function hasHtmlMarkup(content: string): boolean {
  return /<[a-z][^>]*>/i.test(content);
}

/** إزالة وسوم فقرة مكسورة شائعة في البيانات القديمة */
function normalizeBrokenParagraphTags(content: string): string {
  return content
    .replace(/<p\s*\/>\s*/gi, "")
    .replace(/\s*<p>\s*$/gi, "")
    .replace(/^\s*<\/p>\s*/gi, "")
    .trim();
}

/** تحضير محتوى الحصة للعرض — نص عادي أو HTML منسّق */
export function prepareLessonContentForDisplay(content: string): {
  mode: "html" | "text";
  value: string;
} {
  const raw = content.trim();
  if (!raw) return { mode: "text", value: "" };

  if (!hasHtmlMarkup(raw)) {
    return { mode: "text", value: raw };
  }

  let html = normalizeBrokenParagraphTags(raw);

  if (!html) return { mode: "text", value: "" };

  if (!/<(p|div|br|ul|ol|li|strong|em|b|i|h[1-6]|blockquote)\b/i.test(html)) {
    return { mode: "text", value: html.replace(/<[^>]+>/g, "").trim() };
  }

  if (!/<(p|div|ul|ol|h[1-6])/i.test(html)) {
    html = `<p>${html}</p>`;
  }

  return { mode: "html", value: html };
}
