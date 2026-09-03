import { describe, expect, test } from "bun:test"
import { PoolExhaustedError } from "@trawl/browser"
import { ScrapeError } from "@trawl/tiers"
import type { ScrapeResult } from "@trawl/types"
import { MCP_HTML_LIMIT, mcpRoute } from "./mcp"

const baseResult: ScrapeResult = {
  url: "https://1.1.1.1/final",
  html: "<html>ok</html>",
  cookies: [
    { name: "secret", value: "cookie", domain: "1.1.1.1", path: "/", expires: 0, httpOnly: true, secure: true },
  ],
  userAgent: "secret-agent",
  statusCode: 200,
  tier: 2,
  sessionCached: true,
  timings: [{ tier: 1, status: "blocked", durationMs: 2 }],
  totalMs: 12,
  contentType: "text/html; charset=utf-8",
}

function rpc(method: string, params?: unknown, id = 1): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }),
  })
}

describe("MCP route", () => {
  test("initializes and lists only scrape_url", async () => {
    const app = mcpRoute({ poolReady: () => true, runScrape: async () => baseResult })
    const initialized = await app.handle(
      rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      }),
    )
    expect(initialized.status).toBe(200)
    expect((await initialized.json()).result.serverInfo.name).toBe("trawl")

    const listed = await app.handle(rpc("tools/list"))
    expect(listed.status).toBe(200)
    const body = await listed.json()
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["scrape_url"])
  })

  test("exposes the Streamable HTTP GET channel", async () => {
    const app = mcpRoute({ poolReady: () => true, runScrape: async () => baseResult })
    const response = await app.handle(new Request("http://localhost/mcp", { headers: { accept: "text/event-stream" } }))
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    await response.body?.cancel()
  })

  test("scrapes with safe arguments, truncates HTML, and omits secrets", async () => {
    let received: unknown
    const app = mcpRoute({
      poolReady: () => true,
      runScrape: async (input) => {
        received = input
        return { ...baseResult, html: `secret-cookie-${"x".repeat(MCP_HTML_LIMIT)}` }
      },
    })
    const response = await app.handle(
      rpc("tools/call", { name: "scrape_url", arguments: { url: "https://1.1.1.1", maxTier: 3, skipHttp: true } }),
    )
    const body = await response.json()
    expect(received).toEqual({ url: "https://1.1.1.1", maxTier: 3, skipHttp: true })
    expect(body.result.structuredContent).toEqual({
      url: baseResult.url,
      statusCode: 200,
      tier: 2,
      contentType: "text/html; charset=utf-8",
      totalMs: 12,
      truncated: true,
    })
    expect(body.result.content[0].text.length).toBe(MCP_HTML_LIMIT)
    expect(JSON.stringify(body)).not.toContain('cookie"')
    expect(JSON.stringify(body)).not.toContain("secret-agent")
  })

  test("rejects extra arguments, private targets, and disallowed origins", async () => {
    const app = mcpRoute({
      allowedOrigins: ["https://chat.example"],
      poolReady: () => true,
      runScrape: async () => baseResult,
    })
    const forbidden = await app.handle(
      rpc("tools/call", {
        name: "scrape_url",
        arguments: { url: "https://1.1.1.1", headers: { authorization: "secret" } },
      }),
    )
    expect((await forbidden.json()).result.isError).toBe(true)

    const privateTarget = await app.handle(
      rpc("tools/call", { name: "scrape_url", arguments: { url: "http://127.0.0.1" } }),
    )
    expect((await privateTarget.json()).result).toMatchObject({ isError: true })

    const originRequest = rpc("tools/list")
    originRequest.headers.set("origin", "https://evil.example")
    expect((await app.handle(originRequest)).status).toBe(403)
  })

  test("returns scrape, timeout, and pool failures as MCP tool errors", async () => {
    const failures = [
      new ScrapeError("All tiers exhausted. Last failure: blocked", [
        { tier: 1 as const, status: "blocked" as const, durationMs: 3 },
      ]),
      new ScrapeError("Scrape timed out after 1000ms", [
        { tier: 1 as const, status: "timeout" as const, durationMs: 1000 },
      ]),
      new PoolExhaustedError(),
    ]

    for (const failure of failures) {
      const app = mcpRoute({
        poolReady: () => true,
        runScrape: async () => {
          throw failure
        },
      })
      const response = await app.handle(
        rpc("tools/call", { name: "scrape_url", arguments: { url: "https://1.1.1.1" } }),
      )
      const result = (await response.json()).result
      expect(result.isError).toBe(true)
      expect(result.content[0].text.length).toBeGreaterThan(0)
    }
  })
})
