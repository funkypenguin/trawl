import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { PoolExhaustedError } from "@trawl/browser"
import { RequestValidationError, ScrapeError, scrape } from "@trawl/tiers"
import type { ScrapeResult } from "@trawl/types"
import { Elysia } from "elysia"
import * as z from "zod/v4"
import pkg from "../../package.json"
import { MCP_ALLOWED_ORIGINS } from "../config"
import { getDeps, getPool } from "../deps"
import { assertPublicHttpUrl, createPublicUrlValidator } from "../outbound-policy"

export const MCP_HTML_MAX_CHARS = 50_000

type RunScrape = (input: {
  url: string
  maxTimeout?: number
  maxTier?: 1 | 2 | 3 | 4
  skipHttp?: boolean
}) => Promise<ScrapeResult>

interface McpRouteOptions {
  allowedOrigins?: string[]
  poolReady?: () => boolean
  runScrape?: RunScrape
}

function errorResult(error: unknown) {
  let message = error instanceof Error ? error.message : String(error)
  if (error instanceof PoolExhaustedError) message = "Browser pool saturated, retry shortly"
  else if (!(error instanceof RequestValidationError || error instanceof ScrapeError)) message = "Scrape failed"
  return { content: [{ type: "text" as const, text: message }], isError: true }
}

function createServer(poolReady: () => boolean, runScrape: RunScrape): McpServer {
  const server = new McpServer({ name: "trawl", version: pkg.version })
  server.registerTool(
    "scrape_url",
    {
      title: "Scrape URL",
      description: "Fetch a known public HTTP(S) URL, escalating through TRAWL's anti-bot tiers when necessary.",
      inputSchema: z.strictObject({
        url: z.string().min(1).describe("Public HTTP(S) URL to scrape"),
        maxTimeout: z.number().int().positive().optional().describe("Maximum scrape time in milliseconds"),
        maxTier: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        skipHttp: z.boolean().optional().describe("Skip the plain HTTP tier"),
      }),
      outputSchema: {
        url: z.string(),
        statusCode: z.number().int(),
        tier: z.number().int(),
        contentType: z.string(),
        totalMs: z.number(),
        truncated: z.boolean(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (input) => {
      try {
        await assertPublicHttpUrl(input.url)
        if (!poolReady()) throw new Error("Browser pool initializing, retry in a few seconds")
        const result = await runScrape(input)
        // A redirect can reveal a policy violation even if the initial URL was public.
        // Reject it from the model output as a second line of defense.
        await assertPublicHttpUrl(result.url)
        const truncated = result.html.length > MCP_HTML_MAX_CHARS
        const html = result.html.slice(0, MCP_HTML_MAX_CHARS)
        const structuredContent = {
          url: result.url,
          statusCode: result.statusCode,
          tier: result.tier,
          contentType: result.contentType ?? result.responseHeaders?.["content-type"] ?? "text/html",
          totalMs: result.totalMs,
          truncated,
        }
        return { content: [{ type: "text", text: html }], structuredContent }
      } catch (error) {
        return errorResult(error)
      }
    },
  )
  return server
}

export function mcpRoute({
  allowedOrigins = MCP_ALLOWED_ORIGINS,
  poolReady = () => Boolean(getPool()),
  runScrape = (input) => {
    const validateOutboundUrl = createPublicUrlValidator()
    return scrape(input, {
      ...getDeps(),
      validateOutboundUrl: async (url) => void (await validateOutboundUrl(url)),
    })
  },
}: McpRouteOptions = {}) {
  const origins = new Set(allowedOrigins)
  const handle = async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin")
    if (origin && !origins.has(origin)) {
      return Response.json({ error: "Origin not allowed" }, { status: 403 })
    }
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    const server = createServer(poolReady, runScrape)
    try {
      await server.connect(transport)
      return await transport.handleRequest(request)
    } catch {
      await server.close().catch(() => {})
      return Response.json(
        { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
        { status: 500 },
      )
    }
  }
  return new Elysia().get("/mcp", ({ request }) => handle(request)).post("/mcp", ({ request }) => handle(request))
}
