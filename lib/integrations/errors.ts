export class IntegrationError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export function integrationFailure(error: unknown): IntegrationError {
  if (error instanceof IntegrationError) return error;
  if (
    error instanceof Error &&
    "status" in error &&
    typeof error.status === "number" &&
    [400, 401, 403, 404, 409, 413, 415, 422, 429, 503].includes(error.status)
  ) {
    const code =
      "code" in error &&
      typeof error.code === "string" &&
      /^[a-z0-9_-]{1,80}$/.test(error.code)
        ? error.code
        : "request_failed";
    return new IntegrationError(error.status, code);
  }
  const cause = error instanceof Error && error.cause ? error.cause : error;
  if (cause && typeof cause === "object" && "code" in cause) {
    if (cause.code === "42501") return new IntegrationError(404, "not_found");
    if (cause.code === "23503" || cause.code === "23505")
      return new IntegrationError(409, "conflict");
  }
  return new IntegrationError(500, "internal_error");
}
