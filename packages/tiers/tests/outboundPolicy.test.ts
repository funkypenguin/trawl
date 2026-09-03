import { describe, expect, test } from "bun:test"
import { installOutboundPolicy } from "../src/utils/outboundPolicy"

describe("browser outbound policy", () => {
  test("continues allowed requests and aborts rejected requests", async () => {
    let handler: ((route: any) => Promise<void>) | undefined
    const page = {
      route: async (_pattern: string, callback: (route: any) => Promise<void>) => {
        handler = callback
      },
    }
    await installOutboundPolicy(page, async (url) => {
      if (url.includes("private")) throw new Error("blocked")
    })

    const actions: string[] = []
    const route = (url: string) => ({
      request: () => ({ url: () => url }),
      fallback: async () => void actions.push("fallback"),
      abort: async () => void actions.push("abort"),
    })
    await handler?.(route("https://public.example"))
    await handler?.(route("http://private.example"))
    expect(actions).toEqual(["fallback", "abort"])
  })
})
