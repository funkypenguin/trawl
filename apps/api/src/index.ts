import { createApiApp } from "./app"
import {
  MITM_ALWAYS_SCRAPE,
  MITM_CA_DIR,
  MITM_DEBUG,
  MITM_ENABLED,
  MITM_HOST,
  MITM_MAX_TIER,
  MITM_PORT,
  POOL_SIZE,
  PORT,
} from "./config"
import { getDeps, initPool } from "./deps"
import { registerLifecycleHandlers } from "./lifecycle"
import { type MitmProxyHandle, shutdownMitmProxy, startMitmProxy } from "./proxy/server"

createApiApp().listen(PORT)

console.log(`[api] TRAWL starting on :${PORT}  (pool: ${POOL_SIZE} browser${POOL_SIZE === 1 ? "" : "s"})`)

const state: { proxyHandle?: MitmProxyHandle } = {}

const poolReady = initPool()

// Tier 0 does not need a browser, and browser-backed requests already have a
// bounded acquire queue. Start accepting proxy traffic while the pool warms.
if (MITM_ENABLED) {
  state.proxyHandle = startMitmProxy({
    port: MITM_PORT,
    host: MITM_HOST,
    caDir: MITM_CA_DIR,
    deps: getDeps(),
    maxTier: MITM_MAX_TIER,
    alwaysScrape: MITM_ALWAYS_SCRAPE,
    debug: MITM_DEBUG,
  })
}

poolReady.catch((err) => {
  console.error("[api] startup failed:", err)
  process.exit(1)
})

registerLifecycleHandlers({
  onShutdown: async () => {
    if (state.proxyHandle) await shutdownMitmProxy(state.proxyHandle)
  },
})
