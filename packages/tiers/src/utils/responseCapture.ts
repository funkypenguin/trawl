import type { CapturedResponseEntry } from "@trawl/types"
import type { Page, Response } from "patchright"
import { captureLimit } from "./captureConfig"
import { isTextContentType } from "./response"

const MAX_PATTERNS = captureLimit(process.env.CAPTURE_MAX_PATTERNS, 10)
const MAX_RESPONSES = captureLimit(process.env.CAPTURE_MAX_RESPONSES, 5)
const MAX_BODY_BYTES = captureLimit(process.env.CAPTURE_MAX_BODY_BYTES, 5_242_880)
const MAX_TOTAL_BYTES = captureLimit(process.env.CAPTURE_MAX_TOTAL_BYTES, 10_485_760)
const MAX_READ_BYTES = captureLimit(process.env.CAPTURE_MAX_READ_BYTES, 10_485_760)
const BODY_TIMEOUT_MS = captureLimit(process.env.CAPTURE_BODY_TIMEOUT_MS, 5_000)
const SETTLE_MS = captureLimit(process.env.CAPTURE_SETTLE_MS, 15_000)
const MAX_SETTLE_MS = captureLimit(process.env.CAPTURE_MAX_SETTLE_MS, 60_000)
const IDLE_FLOOR_MS = captureLimit(process.env.CAPTURE_IDLE_FLOOR_MS, 5_000)
const MAX_STRING_CHARS = captureLimit(process.env.CAPTURE_MAX_METADATA_CHARS, 2_000)

const NEVER = new Promise<void>(() => {})
const COMPRESSED_ENCODINGS = new Set(["gzip", "br", "deflate", "zstd"])

export interface ResponseCaptureOptions {
  captureResponses?: string[]
  settleTimeout?: number
  waitForSelector?: string
}
export interface ResponseCapture {
  settle(budgetMs: number): Promise<void>
  drain(budgetMs?: number): Promise<CapturedResponseEntry[] | undefined>
}

const NO_RESPONSE_CAPTURE: ResponseCapture = { settle: async () => {}, drain: async () => undefined }
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const bounded = (value: string): string => value.slice(0, MAX_STRING_CHARS)

const declaredLength = (response: Response): number | null => {
  const value = response.headers()["content-length"]
  if (value === undefined || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Linear wildcard matching: `*` spans characters, `?` spans exactly one. */
export const wildcardMatch = (pattern: string, value: string): boolean => {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let starValueIndex = -1
  while (valueIndex < value.length) {
    if (
      patternIndex < pattern.length &&
      (pattern[patternIndex] === "?" || pattern[patternIndex] === value[valueIndex])
    ) {
      patternIndex++
      valueIndex++
    } else if (patternIndex < pattern.length && pattern[patternIndex] === "*") {
      starIndex = patternIndex++
      starValueIndex = valueIndex
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1
      valueIndex = ++starValueIndex
    } else return false
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === "*") patternIndex++
  return patternIndex === pattern.length
}

const compile = (pattern: string): ((url: string) => boolean) =>
  /[*?]/.test(pattern) ? (url) => wildcardMatch(pattern, url) : (url) => url.includes(pattern)

const compilePatterns = (patterns: string[]): Array<(url: string) => boolean> => {
  const usable = patterns
    .filter((pattern) => typeof pattern === "string")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0 && pattern.length <= MAX_STRING_CHARS)
  if (usable.length !== patterns.length || usable.length > MAX_PATTERNS) {
    console.log(`[capture] honouring ${Math.min(usable.length, MAX_PATTERNS)} of ${patterns.length} response patterns`)
  }
  return usable.slice(0, MAX_PATTERNS).map(compile)
}

const snapshot = (entries: CapturedResponseEntry[]): CapturedResponseEntry[] =>
  entries.map((entry) => ({ ...entry, headers: { ...entry.headers } }))

export function attachResponseCapture(page: Page, options: ResponseCaptureOptions): ResponseCapture {
  const patterns = options.captureResponses
  if (!Array.isArray(patterns) || patterns.length === 0) return NO_RESPONSE_CAPTURE
  const matchers = compilePatterns(patterns)
  if (matchers.length === 0) return NO_RESPONSE_CAPTURE

  const entries: CapturedResponseEntry[] = []
  const pending: Promise<void>[] = []
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let storedBytes = 0
  let reservedReadBytes = 0
  let accepting = true
  let dropped = 0
  let markFirstBody: () => void = () => {}
  const firstBody = new Promise<void>((resolve) => {
    markFirstBody = resolve
  })
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        timers.delete(timer)
        resolve()
      }, ms)
      timers.add(timer)
    })

  const readBody = async (response: Response, entry: CapturedResponseEntry): Promise<void> => {
    try {
      const raw = Buffer.from(await response.body())
      if (!accepting) return
      const budget = Math.min(MAX_BODY_BYTES, MAX_TOTAL_BYTES - storedBytes)
      if (budget <= 0) {
        entry.error = "total capture budget exhausted"
        return
      }
      const kept = raw.length > budget ? raw.subarray(0, budget) : raw
      storedBytes += kept.length
      entry.truncated = kept.length < raw.length
      const contentType = response.headers()["content-type"] ?? ""
      if (contentType && isTextContentType(contentType)) entry.body = kept.toString("utf8").replace(/\uFFFD+$/, "")
      else {
        entry.body = kept.toString("base64")
        entry.base64Encoded = true
      }
      markFirstBody()
    } catch (err) {
      if (accepting) entry.error = bounded(`body read failed: ${message(err)}`)
    }
  }

  const onResponse = (response: Response) => {
    if (!accepting) return
    try {
      const rawUrl = response.url()
      if (!matchers.some((matches) => matches(rawUrl))) return
      const status = response.status()
      if (status >= 300 && status < 400) return
      if (entries.length >= MAX_RESPONSES) {
        dropped++
        return
      }
      const rawHeaders = response.headers()
      const headers = Object.fromEntries(
        Object.entries(rawHeaders).map(([name, value]) => [bounded(name), bounded(value)]),
      )
      const entry: CapturedResponseEntry = {
        url: bounded(rawUrl),
        status,
        headers,
        body: null,
        base64Encoded: false,
        truncated: false,
      }
      entries.push(entry)
      const encoding = (rawHeaders["content-encoding"] ?? "identity").trim().toLowerCase()
      if (encoding !== "identity") {
        entry.error = COMPRESSED_ENCODINGS.has(encoding)
          ? `compressed ${encoding} body was not read safely`
          : `content encoding ${bounded(encoding)} was not read safely`
        return
      }
      const size = declaredLength(response)
      if (size === null) {
        entry.error = "body size is unknown; body was not read safely"
        return
      }
      if (size > MAX_READ_BYTES) {
        entry.error = `body of ${size} bytes is past the ${MAX_READ_BYTES} byte read ceiling`
        return
      }
      if (reservedReadBytes + size > MAX_TOTAL_BYTES) {
        entry.error = "total capture read budget exhausted"
        return
      }
      reservedReadBytes += size
      pending.push(readBody(response, entry))
    } catch {
      dropped++
    }
  }

  const detach = () => {
    page.off("response", onResponse)
    page.off("close", detach)
  }
  page.on("response", onResponse)
  page.once("close", detach)

  return {
    async settle(budgetMs) {
      const requested = options.settleTimeout ?? SETTLE_MS
      const windowMs = Math.max(0, Math.min(requested, MAX_SETTLE_MS, Number.isFinite(budgetMs) ? budgetMs : 0))
      if (windowMs === 0) return
      try {
        await Promise.race([
          firstBody,
          sleep(windowMs),
          options.waitForSelector
            ? page
                .waitForSelector(options.waitForSelector, { timeout: windowMs })
                .then(() => undefined)
                .catch(() => NEVER)
            : NEVER,
          sleep(Math.min(IDLE_FLOOR_MS, windowMs)).then(() =>
            page.waitForLoadState("networkidle", { timeout: Math.max(0, windowMs - IDLE_FLOOR_MS) }).catch(() => NEVER),
          ),
        ])
      } catch (err) {
        console.log(`[capture] settle failed: ${message(err)}`)
      }
    },
    async drain(budgetMs = BODY_TIMEOUT_MS) {
      detach()
      const timeoutMs = Math.max(0, Math.min(BODY_TIMEOUT_MS, Number.isFinite(budgetMs) ? budgetMs : 0))
      if (pending.length > 0 && timeoutMs > 0) await Promise.race([Promise.allSettled(pending), sleep(timeoutMs)])
      accepting = false
      for (const entry of entries) if (entry.body === null && !entry.error) entry.error = "body read did not complete"
      if (dropped > 0) console.log(`[capture] dropped ${dropped} matched responses past the configured caps`)
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      return snapshot(entries)
    },
  }
}
