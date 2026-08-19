const SECRET_PATTERN =
  /(?:secret|token|credential|password|service[_-]?role|signing|apikey|api[_-]?key|bearer|authorization|cookie|pairing|code_hash|secret_hash|supabase)[^\s]*[\s:=]+[^\s,}"']+/gi;

/** Strip values that may resemble secrets before writing server logs. */
export function redactForServerLog(value: string): string {
  return value
    .replace(SECRET_PATTERN, "[redacted]")
    .replace(/[A-Za-z0-9_-]{20,}/g, (match) => (match.length > 24 ? "[redacted]" : match));
}

export function logSessionBackendEvent(input: {
  operation: string;
  category: string;
  code: string;
  detail?: string;
}): void {
  const payload = {
    scope: "session_backend",
    operation: input.operation,
    category: input.category,
    code: input.code,
    detail: input.detail ? redactForServerLog(input.detail) : undefined,
  };
  console.error(JSON.stringify(payload));
}
