import { arMessages } from "./messages/ar";
import type { MessageValue, Messages } from "./types";

function isMessagesObject(value: MessageValue | undefined): value is Messages {
  return typeof value === "object" && value !== null;
}

function resolveMessage(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let current: MessageValue | undefined = messages;
  for (const part of parts) {
    if (!isMessagesObject(current)) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

export function getDir(): "rtl" {
  return "rtl";
}

export function getMessages(): Messages {
  return arMessages;
}

export function makeTranslator() {
  const messages = getMessages();
  return (key: string, fallback?: string): string => {
    return resolveMessage(messages, key) ?? fallback ?? key;
  };
}

/** Static Arabic translator for modules that cannot use hooks. */
export const t = makeTranslator();
