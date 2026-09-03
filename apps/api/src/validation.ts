import {
  isValidMethod,
  RequestValidationError,
  requireContentTypeForBody,
  SUPPORTED_METHODS,
  sanitizeHeaders,
} from "@trawl/tiers"
import type { FlareSolverrRequest, ScrapeRequest } from "@trawl/types"

type RequestRecord = Record<string, unknown>

function requireRequestRecord(body: unknown): asserts body is RequestRecord {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RequestValidationError("Request body must be a JSON object", 400)
  }
}

function requireUrl(req: RequestRecord): void {
  if (typeof req.url !== "string" || req.url.trim().length === 0) {
    throw new RequestValidationError("url must be a non-empty string", 400)
  }
}

export function requestUrl(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return ""
  const url = (body as RequestRecord).url
  return typeof url === "string" ? url : ""
}

export function validateFlareSolverrRequest(body: unknown): asserts body is FlareSolverrRequest {
  requireRequestRecord(body)
  requireUrl(body)
}

export function validateScrapeRequest(body: unknown): asserts body is ScrapeRequest {
  requireRequestRecord(body)
  requireUrl(body)
  const req = body as RequestRecord & Partial<ScrapeRequest>
  if (!isValidMethod(req.method)) {
    throw new RequestValidationError(
      `Unsupported method: ${String(req.method)} (allowed: ${SUPPORTED_METHODS.join(", ")})`,
      400,
    )
  }
  if (req.screenshot !== undefined && typeof req.screenshot !== "boolean") {
    throw new RequestValidationError("screenshot must be a boolean", 400)
  }
  for (const field of ["consoleLogs", "networkLogs", "redirectChain"] as const) {
    if (req[field] !== undefined && typeof req[field] !== "boolean") {
      throw new RequestValidationError(`${field} must be a boolean`, 400)
    }
  }
  requireContentTypeForBody(sanitizeHeaders(req.headers), Boolean(req.body))
}
