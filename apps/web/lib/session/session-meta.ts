"use client";

import { sessionClientMetaSchema, type SessionClientMeta } from "@prism/contracts";

const SESSION_META_KEY = "prism.session.meta.v1";

function readMeta(storage: Storage): SessionClientMeta | null {
  try {
    const raw = storage.getItem(SESSION_META_KEY);
    if (!raw) return null;
    const parsed = sessionClientMetaSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeMeta(storage: Storage, value: SessionClientMeta | null): void {
  try {
    if (!value) {
      storage.removeItem(SESSION_META_KEY);
      return;
    }
    storage.setItem(SESSION_META_KEY, JSON.stringify(sessionClientMetaSchema.parse(value)));
  } catch {
    // Private mode / blocked storage — HttpOnly cookie remains authoritative.
  }
}

export function stashSessionMeta(meta: SessionClientMeta): void {
  if (typeof window === "undefined") return;
  writeMeta(window.sessionStorage, meta);
}

export function takeSessionMeta(sessionId: string): SessionClientMeta | null {
  if (typeof window === "undefined") return null;
  const handoff = readMeta(window.sessionStorage);
  if (handoff?.sessionId === sessionId) {
    writeMeta(window.sessionStorage, null);
    return handoff;
  }
  return null;
}

export function clearSessionMeta(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_META_KEY);
  } catch {
    // ignore
  }
}
