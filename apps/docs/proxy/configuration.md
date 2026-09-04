---
title: Proxy Configuration
description: Enable and configure TRAWL's challenge-bypassing HTTP/HTTPS proxy.
---

# Proxy configuration

## Environment variables

| Variable                   | Default          | Purpose                                                  |
| -------------------------- | ---------------- | -------------------------------------------------------- |
| `MITM_ENABLED`       | `false`          | Starts the forward-proxy listener                        |
| `MITM_HOST`          | `0.0.0.0`        | Listener bind address                                    |
| `MITM_PORT`          | `8192`           | Listener port                                            |
| `MITM_CA_DIR`        | `/data/proxy-ca` | Persistent root CA certificate and private-key directory |
| `MITM_MAX_TIER`      | `4`              | Highest solver tier available to proxy escalation        |
| `MITM_ALWAYS_SCRAPE` | `false`          | Skip direct Tier 0 and enter the scraper immediately     |
| `MITM_DEBUG`         | `false`          | Logs proxied requests and tier attempts                  |

Example:

```ini
MITM_ENABLED=true
MITM_HOST=127.0.0.1
MITM_PORT=8192
MITM_CA_DIR=/data/proxy-ca
MITM_MAX_TIER=4
MITM_ALWAYS_SCRAPE=false
MITM_DEBUG=false
```

Use `127.0.0.1` for a local installation. Docker clients on a bridge network normally require
`0.0.0.0`; restrict access with container networking or a host firewall.

`MITM_MAX_TIER=3` prevents proxy requests from consuming a configured residential Tier 4
proxy. An empty or invalid value uses the normal maximum of Tier 4.

Set `MITM_ALWAYS_SCRAPE=true` for targets where the proxy's initial direct Tier 0 request is
itself enough to trigger a temporary ban. This skips only proxy Tier 0: the normal scraper ladder
still starts at its Tier 1 plain fetch and escalates when necessary. WebSocket upgrades remain
direct relays.

Always-scrape mode also bypasses Tier 0's media and large-file streaming path. Do not enable it on
a general download or media proxy: video, archives, Range requests, and other large responses may
instead be buffered by the scraper, and request bodies pass through the scraper's text-oriented
request interface. Prefer a separate TRAWL instance or narrowly scoped proxy rule for affected
sites.

## Docker Compose

The supplied Compose files publish the API and proxy ports and persist the root CA:

```yaml
services:
  trawl:
    ports:
      - "8191:8191"
      - "8192:8192"
    environment:
      MITM_ENABLED: "true"
      MITM_HOST: 0.0.0.0
      MITM_PORT: 8192
      MITM_CA_DIR: /data/proxy-ca
      MITM_ALWAYS_SCRAPE: "false"
    volumes:
      - trawl_proxy_ca:/data/proxy-ca

volumes:
  trawl_proxy_ca:
```

Start or recreate the service after changing proxy variables:

```bash
docker compose up -d --force-recreate trawl
```

## Upstream proxy interaction

Tier 0 direct traffic leaves from the TRAWL host directly. `PROXY_URL` and
`RESIDENTIAL_PROXY_URL` apply when a challenged request escalates into the scrape tiers; they do
not turn the entire forward proxy into a chain through another proxy.

The normal sticky-per-domain rotation and failure cooldown rules apply during escalation. Use
`MITM_MAX_TIER` to cap which tiers the forward proxy may reach.

## Verify the listener

Download the CA and test an HTTPS request:

```bash
curl http://127.0.0.1:8191/proxy-ca.crt -o trawl-ca.crt
curl --proxy http://127.0.0.1:8192 \
  --cacert ./trawl-ca.crt \
  https://example.com/
```

Test plain HTTP:

```bash
curl --proxy http://127.0.0.1:8192 http://neverssl.com/
```

Test Range forwarding:

```bash
curl --proxy http://127.0.0.1:8192 \
  --cacert ./trawl-ca.crt \
  -H 'Range: bytes=0-99' \
  -D - https://httpbin.org/range/1024
```

The Range request should return `206` and a 100-byte body when the upstream supports it.

## Debug logging

Set `MITM_DEBUG=true` to log direct forwarding, streaming decisions, challenge escalation,
winning scrape tiers, statuses, content types, and payload sizes. Disable it after troubleshooting;
general proxy clients can generate a large volume of requests.

The proxy has no authentication layer. Never publish port `8192` directly to the internet.
