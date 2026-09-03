import { Elysia } from "elysia"
import { MCP_ENABLED } from "./config"
import { healthRoute } from "./routes/health"
import { indexRoute } from "./routes/index"
import { mcpRoute } from "./routes/mcp"
import { proxyCaRoute } from "./routes/proxy-ca"
import { scrapeRoute } from "./routes/scrape"
import { statsRoute } from "./routes/stats"
import { v1Route } from "./routes/v1"

export function createApiApp({ mcpEnabled = MCP_ENABLED }: { mcpEnabled?: boolean } = {}) {
  const app = new Elysia()
    .use(indexRoute())
    .use(healthRoute())
    .use(statsRoute())
    .use(v1Route())
    .use(scrapeRoute())
    .use(proxyCaRoute())

  if (mcpEnabled) app.use(mcpRoute())
  return app
}
