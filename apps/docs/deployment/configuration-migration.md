---
title: Configuration Migration
description: Breaking environment-variable and Docker build-argument renames introduced in TRAWL v1.5.0.
---

# Configuration migration

TRAWL v1.5.0 reorganizes configuration into short, subsystem-specific namespaces. The old
names are not retained as aliases: update `.env`, Compose overrides, container manifests, secrets,
and deployment automation before upgrading.

## Environment variables

| Previous name | New name |
| --- | --- |
| `SESSION_TTL_SECONDS` | `REDIS_SESSION_TTL_SECONDS` |
| `BROWSER_CONTENT_PROCESSES` | `BROWSER_MAX_CONTENT_PROCESSES` |
| `CAPTURE_MAX_CONSOLE_ENTRIES` | `DIAGNOSTICS_MAX_CONSOLE_ENTRIES` |
| `CAPTURE_MAX_NETWORK_ENTRIES` | `DIAGNOSTICS_MAX_NETWORK_ENTRIES` |
| `CAPTURE_SIZES_TIMEOUT_MS` | `DIAGNOSTICS_SIZE_TIMEOUT_MS` |
| `CAPTURE_MAX_REDIRECT_ENTRIES` | `REDIRECT_MAX_ENTRIES` |
| `CAPTURE_MAX_RESPONSE_PATTERNS` | `CAPTURE_MAX_PATTERNS` |
| `CAPTURE_MAX_RESPONSE_BYTES` | `CAPTURE_MAX_BODY_BYTES` |
| `CAPTURE_MAX_RESPONSE_TOTAL_BYTES` | `CAPTURE_MAX_TOTAL_BYTES` |
| `CAPTURE_SETTLE_IDLE_FLOOR_MS` | `CAPTURE_IDLE_FLOOR_MS` |
| `MITM_PROXY_ENABLED` | `MITM_ENABLED` |
| `MITM_PROXY_HOST` | `MITM_HOST` |
| `MITM_PROXY_PORT` | `MITM_PORT` |
| `MITM_PROXY_CA_DIR` | `MITM_CA_DIR` |
| `MITM_PROXY_MAX_TIER` | `MITM_MAX_TIER` |
| `MITM_PROXY_ALWAYS_SCRAPE` | `MITM_ALWAYS_SCRAPE` |
| `MITM_PROXY_DEBUG` | `MITM_DEBUG` |

Two previous shared limits now have independent settings. Copy the old value to every applicable
new variable if you want to preserve custom limits exactly:

| Previous shared name | New independent names |
| --- | --- |
| `CAPTURE_MAX_STRING_CHARS` | `DIAGNOSTICS_MAX_STRING_CHARS`, `REDIRECT_MAX_URL_CHARS`, `CAPTURE_MAX_METADATA_CHARS` |
| `CAPTURE_MAX_TOTAL_CHARS` | `DIAGNOSTICS_MAX_TOTAL_CHARS`, `REDIRECT_MAX_TOTAL_CHARS` |

`CHROME_EXECUTABLE` was unused and has been removed. TRAWL uses its packaged Camoufox Firefox
binary; there is no replacement variable.

## Redis opt-in behavior

`REDIS_URL` is now the cache switch as well as the connection address:

```text
empty or unset REDIS_URL  → session cache disabled, no connection attempts
non-empty REDIS_URL       → session cache enabled, background reconnects allowed
```

No separate enable flag is required. The standard Compose variants configure their bundled Redis;
the minimal variant defaults `REDIS_URL` to empty but can connect to an external Redis when given a URL.

## Docker build argument

The Camoufox-specific font-retention argument is now namespaced:

```text
KEEP_SPOOFED_OS_FONTS → CAMOUFOX_KEEP_SPOOFED_OS_FONTS
```

For example:

```bash
docker build \
  --build-arg CAMOUFOX_KEEP_SPOOFED_OS_FONTS=1 \
  -f apps/api/Dockerfile \
  -t trawl .
```

Keeping the spoofed macOS and Windows font bundles adds approximately 891 MB to the image. Enable
it only when rendered output must match those spoofed operating-system profiles.

## Compose `.env` behavior

The supplied Compose files explicitly pass every supported runtime setting from the adjacent `.env`
file into the TRAWL container. Unknown host variables are not forwarded. Run this after editing the
file to inspect the effective configuration:

```bash
docker compose config
```

`PORT` is intentionally used only for the host-side `PORT:8191` mapping; the container continues to
listen on `8191`. The Redis-backed Compose variants route `REDIS_URL` to their bundled `redis`
service, while the minimal variant passes an optional external URL and defaults it to empty.

Recreate the container after changing environment variables:

```bash
docker compose up -d --force-recreate trawl
```
