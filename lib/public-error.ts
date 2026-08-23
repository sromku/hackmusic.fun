export class PublicError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "PublicError";
  }
}

export function publicErrorDetails(error: unknown, fallback: string, fallbackStatus = 500) {
  if (error instanceof PublicError) return { message: error.message, status: error.status };
  return { message: fallback, status: fallbackStatus };
}
