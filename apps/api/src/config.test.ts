import { describe, expect, test } from "bun:test"

type ConfigSnapshot = {
  redisUrl: string | null
  redisSessionTtlSeconds: number
  poolSize: number
  maxContentProcesses: number
  acquireTimeoutMs: number
  recycleAfterContexts: number
  headfulPoolSize: number
  stallTimeoutMs: number
  closeTimeoutMs: number
  launchTimeoutMs: number
  port: number
  mitmPort: number
}

const readConfig = (overrides: Record<string, string>): ConfigSnapshot => {
  const script = `
    const config = await import("./config.ts")
    console.log(JSON.stringify({
      redisUrl: config.REDIS_URL ?? null,
      redisSessionTtlSeconds: config.REDIS_SESSION_TTL_SECONDS,
      poolSize: config.POOL_SIZE,
      maxContentProcesses: config.BROWSER_MAX_CONTENT_PROCESSES,
      acquireTimeoutMs: config.ACQUIRE_TIMEOUT_MS,
      recycleAfterContexts: config.RECYCLE_AFTER_TEMPORARY_CONTEXTS,
      headfulPoolSize: config.HEADFUL_POOL_SIZE,
      stallTimeoutMs: config.STALL_TIMEOUT_MS,
      closeTimeoutMs: config.CLOSE_TIMEOUT_MS,
      launchTimeoutMs: config.LAUNCH_TIMEOUT_MS,
      port: config.PORT,
      mitmPort: config.MITM_PORT,
    }))
  `
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    cwd: import.meta.dir,
    env: { ...process.env, ...overrides },
  })
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout.toString()) as ConfigSnapshot
}

describe("environment configuration", () => {
  test("reads the renamed variables and trims REDIS_URL", () => {
    expect(
      readConfig({
        REDIS_URL: "  redis://cache.test:6379/2  ",
        REDIS_SESSION_TTL_SECONDS: "7200",
        BROWSER_POOL_SIZE: "4",
        BROWSER_MAX_CONTENT_PROCESSES: "3",
        BROWSER_ACQUIRE_TIMEOUT_MS: "12000",
        BROWSER_RECYCLE_AFTER_CONTEXTS: "0",
        BROWSER_HEADFUL_POOL_SIZE: "2",
        BROWSER_STALL_TIMEOUT_MS: "90000",
        BROWSER_CLOSE_TIMEOUT_MS: "8000",
        BROWSER_LAUNCH_TIMEOUT_MS: "45000",
        PORT: "9000",
        MITM_PORT: "9001",
      }),
    ).toEqual({
      redisUrl: "redis://cache.test:6379/2",
      redisSessionTtlSeconds: 7200,
      poolSize: 4,
      maxContentProcesses: 3,
      acquireTimeoutMs: 12000,
      recycleAfterContexts: 0,
      headfulPoolSize: 2,
      stallTimeoutMs: 90000,
      closeTimeoutMs: 8000,
      launchTimeoutMs: 45000,
      port: 9000,
      mitmPort: 9001,
    })
  })

  test("disables Redis for a blank URL and safely rejects malformed numeric values", () => {
    expect(
      readConfig({
        REDIS_URL: "   ",
        REDIS_SESSION_TTL_SECONDS: "-1",
        SESSION_TTL_SECONDS: "99",
        BROWSER_POOL_SIZE: "NaN",
        BROWSER_MAX_CONTENT_PROCESSES: "0",
        BROWSER_CONTENT_PROCESSES: "99",
        BROWSER_ACQUIRE_TIMEOUT_MS: "-5",
        BROWSER_RECYCLE_AFTER_CONTEXTS: "-1",
        BROWSER_HEADFUL_POOL_SIZE: "1.5",
        BROWSER_STALL_TIMEOUT_MS: "Infinity",
        BROWSER_CLOSE_TIMEOUT_MS: "0",
        BROWSER_LAUNCH_TIMEOUT_MS: "unsafe",
        PORT: "70000",
        MITM_PORT: "0",
      }),
    ).toEqual({
      redisUrl: null,
      redisSessionTtlSeconds: 3600,
      poolSize: 3,
      maxContentProcesses: 2,
      acquireTimeoutMs: 15000,
      recycleAfterContexts: 8,
      headfulPoolSize: 0,
      stallTimeoutMs: 180000,
      closeTimeoutMs: 10000,
      launchTimeoutMs: 90000,
      port: 8191,
      mitmPort: 8192,
    })
  })
})
