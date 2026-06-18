import { getMessages, makeTranslator } from "./core";
import type { Locale } from "./types";

/** Arabic-only site — locale is always `ar`. */
export async function getLocaleFromCookie(): Promise<Locale> {
  return "ar";
}

export async function getServerMessages() {
  return getMessages();
}

export async function getServerTranslator() {
  return makeTranslator();
}
