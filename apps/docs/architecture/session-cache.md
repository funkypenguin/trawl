---
title: Session Cache
description: How TRAWL caches solved browser sessions in Redis to avoid unnecessary challenge work.
---

# Session Cache

The session cache is what makes Tier 2 possible. After a successful Tier 3 or Tier 4 solve, TRAWL
saves the extracted cookies and browser user agent in Redis. The next request to the same hostname
injects that state into a browser context and attempts to reuse the solved session.

## Storage format

Key: `session:{hostname}` (e.g. `session:nowsecure.nl`)

Value (JSON):
```typescript
interface SessionData {
  cookies: Cookie[]
  userAgent: string
  savedAt: number    // unix timestamp ms
}
```

TTL: `SESSION_TTL_SECONDS` (default 3600 seconds / 1 hour).

## Session key

The key is the **hostname only** — no path, no port, no protocol. This means all pages on a domain share one session:

```
https://example.com/        → session:example.com
https://example.com/page    → session:example.com  (same key)
https://sub.example.com/    → session:sub.example.com  (different key)
```

Subdomains have separate sessions because WAF and application cookies can differ per subdomain.

## Lifecycle

```
Tier 3 succeeds
  │
  ├── extract cookies from browser context
  ├── REDIS SET session:hostname → JSON  EX SESSION_TTL_SECONDS
  │
  └── next request to same domain:
        REDIS GET session:hostname
          ├── hit  → Tier 2: inject cookies and navigate
          └── miss → Tier 3: fresh solve, save to cache
```

## Invalidation

If Tier 2 navigates with cached state and still receives a recognized challenge wall, the orchestrator:

1. Calls `sessionCache.invalidate(domain)` — deletes the Redis key
2. Escalates to Tier 3 to get a fresh session

This handles provider cookies expiring or being rejected before the Redis TTL ends.

## Redis

TRAWL's cache backend is Redis 8.8. TRAWL talks to it with `new RedisClient(REDIS_URL)` from Bun's native Redis client (not ioredis).

Each connection attempt is bounded by `REDIS_CONNECT_TIMEOUT_MS` (default 5 seconds). If Redis is
not ready, scraping continues without Tier 2 while TRAWL retries in the background every
`REDIS_RETRY_DELAY_MS` (default 5 seconds). Set the retry delay to `0` when Redis is intentionally
absent.

```typescript
import { RedisClient } from 'bun'

const redis = new RedisClient('redis://localhost:6379')
await redis.set('session:example.com', JSON.stringify(data), 'EX', 3600)
const raw = await redis.get('session:example.com')
```
