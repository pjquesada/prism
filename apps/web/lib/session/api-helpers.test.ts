import { describe, expect, it } from "vitest";

import {
  GUEST_CREDENTIAL_COOKIE,
  getGuestTokenFromRequest,
  guestCredentialClearCookieHeader,
  guestCredentialSetCookieHeader,
} from "./api-helpers";
import { getSessionTransport, isDurableSessionBackend } from "./config";

describe("guest credential cookies", () => {
  it("builds Secure HttpOnly SameSite=Lax cookies in production-like envs", () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    const header = guestCredentialSetCookieHeader(
      "sess.dev.secret",
      new Date(Date.now() + 60_000).toISOString(),
    );
    process.env.VERCEL = previous;
    expect(header).toContain(`${GUEST_CREDENTIAL_COOKIE}=`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).toMatch(/Max-Age=\d+/);
  });

  it("clears the guest cookie", () => {
    const header = guestCredentialClearCookieHeader();
    expect(header).toContain(`${GUEST_CREDENTIAL_COOKIE}=`);
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });

  it("prefers bearer tokens over cookies", () => {
    const request = new Request("https://example.test/api/session/x", {
      headers: {
        authorization: "Bearer bearer-token",
        cookie: `${GUEST_CREDENTIAL_COOKIE}=cookie-token`,
      },
    });
    expect(getGuestTokenFromRequest(request)).toBe("bearer-token");
  });

  it("falls back to the guest cookie when bearer is absent", () => {
    const request = new Request("https://example.test/api/session/x", {
      headers: {
        cookie: `${GUEST_CREDENTIAL_COOKIE}=${encodeURIComponent("sess.dev.secret")}`,
      },
    });
    expect(getGuestTokenFromRequest(request)).toBe("sess.dev.secret");
  });
});

describe("session transport selection", () => {
  it("does not claim supabase transport without service-role admin env", () => {
    const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const previousService = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isDurableSessionBackend()).toBe(false);
    expect(getSessionTransport()).toBe("memory");
    process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previousService;
  });
});
