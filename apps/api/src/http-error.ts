import type { ZodError } from "zod";

export type ErrorDetail = { path: string; message: string };

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
  }
}

export function fromZod(error: ZodError): HttpError {
  return new HttpError(
    400,
    "VALIDATION_ERROR",
    "Dados inválidos.",
    error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  );
}
