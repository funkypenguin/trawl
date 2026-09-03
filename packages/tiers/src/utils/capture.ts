import type { ConsoleLogEntry, NetworkLogEntry } from "@trawl/types"
import type { ConsoleMessage, Page, Request } from "patchright"
import { captureLimit } from "./captureConfig"

// Captured evidence lives in memory alongside a browser slot, so every dimension is
// bounded: entry counts, the length of any single captured string, and the total across
// both arrays. Anything past a cap is dropped whole rather than silently truncated, and
// the drop count is logged when the capture is drained. All caps are env-tunable.
const MAX_CONSOLE_ENTRIES = captureLimit(process.env.CAPTURE_MAX_CONSOLE_ENTRIES, 500)
const MAX_NETWORK_ENTRIES = captureLimit(process.env.CAPTURE_MAX_NETWORK_ENTRIES, 1_000)
const MAX_STRING_CHARS = captureLimit(process.env.CAPTURE_MAX_STRING_CHARS, 2_000)
const MAX_TOTAL_CHARS = captureLimit(process.env.CAPTURE_MAX_TOTAL_CHARS, 1_000_000)
const SIZES_TIMEOUT_MS = captureLimit(process.env.CAPTURE_SIZES_TIMEOUT_MS, 2_000)

// Console types that carry a severity of their own; everything else is informational.
const CONSOLE_LEVELS: Record<string, ConsoleLogEntry["level"]> = {
  error: "SEVERE",
  assert: "SEVERE",
  warning: "WARNING",
  debug: "DEBUG",
}

// Mirrors the opt-in flags on ScrapeRequest. `redirectChain` is served by
// MainDocumentResponseTracker (the response listener already exists there) rather than
// by this module — it travels in the same bag so a tier takes one capture argument.
export interface CaptureOptions {
  consoleLogs?: boolean
  networkLogs?: boolean
  redirectChain?: boolean
}

export interface CapturedPageEvidence {
  consoleLogs?: ConsoleLogEntry[]
  networkLogs?: NetworkLogEntry[]
}

export interface PageCapture {
  drain(budgetMs?: number): Promise<CapturedPageEvidence>
}

const NO_CAPTURE: PageCapture = { drain: async () => ({}) }

const ms = (value: number): number => Math.round(value * 100) / 100

/**
 * Records console messages and per-request timings for one page. Attaches nothing at
 * all unless asked, detaches on drain and again on page close, and never throws into
 * the caller — a capture failure degrades that field, not the scrape.
 */
export function attachPageCapture(page: Page, options: CaptureOptions): PageCapture {
  if (!options.consoleLogs && !options.networkLogs) return NO_CAPTURE

  const consoleLogs: ConsoleLogEntry[] = []
  const networkLogs: NetworkLogEntry[] = []
  const pendingSizes: Promise<unknown>[] = []
  const attachedAt = Date.now()
  let charsUsed = 0
  let dropped = 0
  let acceptingSizes = true

  const claim = (text: string): boolean => {
    if (text.length > MAX_STRING_CHARS || charsUsed + text.length > MAX_TOTAL_CHARS) {
      dropped++
      return false
    }
    charsUsed += text.length
    return true
  }

  const onConsole = (message: ConsoleMessage) => {
    try {
      if (consoleLogs.length >= MAX_CONSOLE_ENTRIES) {
        dropped++
        return
      }
      const text = message.text()
      if (!claim(text)) return
      consoleLogs.push({
        level: CONSOLE_LEVELS[message.type()] ?? "INFO",
        message: text,
        timestamp: message.timestamp(),
        source: message.type(),
      })
    } catch {
      // A console message can outlive the execution context that produced it.
      dropped++
    }
  }

  const onRequestDone = (request: Request) => {
    try {
      if (networkLogs.length >= MAX_NETWORK_ENTRIES) {
        dropped++
        return
      }
      const name = request.url()
      if (!claim(name)) return
      const timing = request.timing()
      const entry: NetworkLogEntry = {
        name,
        entryType: request.isNavigationRequest() ? "navigation" : "resource",
        startTime: ms(Math.max(timing.startTime - attachedAt, 0)),
        duration: timing.responseEnd > 0 ? ms(timing.responseEnd) : 0,
        initiatorType: request.resourceType(),
        transferSize: null,
        encodedBodySize: null,
        decodedBodySize: null,
      }
      networkLogs.push(entry)
      // sizes() is a round trip per request, so it fills the entry in the background and
      // drain() waits for whatever has landed. A request that never reports sizes (cache
      // hit, aborted, page gone) keeps its nulls.
      pendingSizes.push(
        request
          .sizes()
          .then((sizes) => {
            if (!acceptingSizes) return
            entry.transferSize = sizes.responseBodySize + sizes.responseHeadersSize
            entry.encodedBodySize = sizes.responseBodySize
          })
          .catch(() => {}),
      )
    } catch {
      dropped++
    }
  }

  const detach = () => {
    page.off("console", onConsole)
    page.off("requestfinished", onRequestDone)
    page.off("requestfailed", onRequestDone)
    page.off("close", detach)
  }

  if (options.consoleLogs) page.on("console", onConsole)
  if (options.networkLogs) {
    page.on("requestfinished", onRequestDone)
    page.on("requestfailed", onRequestDone)
  }
  page.once("close", detach)

  return {
    async drain(budgetMs = SIZES_TIMEOUT_MS) {
      try {
        detach()
        const timeoutMs = Math.max(0, Math.min(SIZES_TIMEOUT_MS, Number.isFinite(budgetMs) ? budgetMs : 0))
        if (pendingSizes.length > 0 && timeoutMs > 0) {
          await Promise.race([Promise.all(pendingSizes), new Promise((r) => setTimeout(r, timeoutMs))])
        }
        acceptingSizes = false
        if (dropped > 0) console.log(`[capture] dropped ${dropped} entries past the configured caps`)
        return {
          consoleLogs: options.consoleLogs ? consoleLogs.map((entry) => ({ ...entry })) : undefined,
          networkLogs: options.networkLogs ? networkLogs.map((entry) => ({ ...entry })) : undefined,
        }
      } catch (err) {
        acceptingSizes = false
        console.log(`[capture] drain failed: ${err instanceof Error ? err.message : String(err)}`)
        return {}
      }
    },
  }
}
