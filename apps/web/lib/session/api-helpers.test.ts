import { describe, expect, it } from "vitest";

import {
  getGuestTokenFromRequest,
  guestCredentialClearCookieHeader,
  guestCredentialCookieName,
  guestCredentialSetCookieHeader,
} from "./api-helpers";
import { getSessionTransport, isDurableSessionBackend } from "./config";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("guest credential cookies", () => {
  it("builds session-scoped Secure HttpOnly SameSite=Lax cookies in production-like envs", () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    const header = guestCredentialSetCookieHeader(
      SESSION_ID,
      "sess.dev.secret",
      new Date(Date.now() + 60_000).toISOString(),
    );
    process.env.VERCEL = previous;
    expect(header).toContain(`${guestCredentialCookieName(SESSION_ID)}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/api/session");
    expect(header).toContain("Secure");
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it("clears the session-scoped guest cookie", () => {
    const header = guestCredentialClearCookieHeader(SESSION_ID);
    expect(header).toContain(`${guestCredentialCookieName(SESSION_ID)}=`);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Path=/api/session");
  });

  it("reads the matching session cookie before bearer", () => {
    const request = new Request("https://example.test/api/session/x", {
      headers: {
        authorization: "Bearer bearer-token",
        cookie: `${guestCredentialCookieName(SESSION_ID)}=cookie-token`,
      },
    });
    expect(getGuestTokenFromRequest(request, SESSION_ID)).toBe("cookie-token");
  });

  it("does not use another session's cookie", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const request = new Request("https://example.test/api/session/x", {
      headers: {
        cookie: `${guestCredentialCookieName(other)}=${encodeURIComponent("other-session-token")}`,
      },
    });
    expect(getGuestTokenFromRequest(request, SESSION_ID)).toBeNull();
  });

  it("falls back to bearer when the session cookie is absent", () => {
    const request = new Request("https://example.test/api/session/x", {
      headers: {
        authorization: "Bearer bearer-token",
      },
    });
    expect(getGuestTokenFromRequest(request, SESSION_ID)).toBe("bearer-token");
  });
});

describe("session transport selection", () => {
  it("does not claim supabase transport without service-role admin env", () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const previousBackend = process.env.PRISM_SESSION_BACKEND;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.PRISM_SESSION_BACKEND;
    expect(isDurableSessionBackend()).toBe(false);
    expect(getSessionTransport()).toBe("memory");
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
    process.env.PRISM_SESSION_BACKEND = previousBackend;
  });
});
