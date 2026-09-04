import type { Page } from "patchright"
import { captureLimit } from "./utils/captureConfig"

// A screenshot is a best-effort side artifact of a scrape, so every step is bounded:
// the settle wait, the capture itself, and the size of the image we are willing to
// carry in the response. All are env-tunable.
const SETTLE_MS = captureLimit(process.env.SCREENSHOT_SETTLE_MS, 3_000)
const CAPTURE_TIMEOUT_MS = captureLimit(process.env.SCREENSHOT_TIMEOUT_MS, 10_000)
const configuredQuality = captureLimit(process.env.SCREENSHOT_JPEG_QUALITY, 60)
const JPEG_QUALITY = configuredQuality >= 1 && configuredQuality <= 100 ? configuredQuality : 60
const MAX_BYTES = captureLimit(process.env.SCREENSHOT_MAX_BYTES, 4_000_000)

// Viewport only — never fullPage. A challenge wall or an infinite-scroll page stitches
// into a tall, mostly-empty canvas that costs seconds and shows less than the first
// screen does.
export async function capturePageScreenshot(
  page: Page,
  budgetMs = Number.POSITIVE_INFINITY,
): Promise<string | undefined> {
  const deadline = Date.now() + Math.max(budgetMs, 0)
  const remaining = (): number => Math.max(deadline - Date.now(), 0)

  try {
    // The HTML is read the moment a challenge clears, before late content (images,
    // fonts, lazy hydration) has painted. Give the page a bounded chance to settle,
    // then a short beat for whatever paints after the last request.
    if (remaining() <= 0) return undefined
    await page.waitForLoadState("networkidle", { timeout: Math.min(SETTLE_MS, remaining()) }).catch(() => {})
    const paintWaitMs = Math.min(300, remaining())
    if (paintWaitMs > 0) await new Promise((r) => setTimeout(r, paintWaitMs))

    const captureTimeout = Math.min(CAPTURE_TIMEOUT_MS, remaining())
    if (captureTimeout <= 0) return undefined

    const image = await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY, timeout: captureTimeout })
    if (image.length > MAX_BYTES) {
      console.log(`[screenshot] dropped: ${image.length}b exceeds SCREENSHOT_MAX_BYTES=${MAX_BYTES}`)
      return undefined
    }
    return Buffer.from(image).toString("base64")
  } catch (err) {
    console.log(`[screenshot] capture failed: ${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}
