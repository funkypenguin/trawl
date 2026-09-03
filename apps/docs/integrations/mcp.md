---
title: Model Context Protocol (MCP)
description: Connect any MCP-compatible AI client to TRAWL's scraping tool.
---

# Model Context Protocol (MCP)

TRAWL has an optional, client-independent Model Context Protocol server. Any AI
application or agent that supports remote MCP servers over Streamable HTTP can
connect to it and use the `scrape_url` tool.

This is a scraper, not a web search engine. The caller must already know the URL.
Search discovery and reranking require a separate provider such as SearXNG; TRAWL
can then load the selected result URLs.

## Enable the endpoint

```ini
MCP_ENABLED=true
```

The endpoint is `http://<trawl-host>:8191/mcp`. Keep it on a private network. MCP
v1 has no authentication and is not supported as a public internet endpoint. If a
browser-based client calls it directly, add the exact origin:

```ini
MCP_ALLOWED_ORIGINS=https://chat.example.com
```

Requests without an `Origin` header are supported for server-to-server clients.
Use the following generic connection details in your MCP client:

```text
Name: trawl
Transport: Streamable HTTP
URL: http://trawl:8191/mcp
```

The exact configuration syntax belongs to the client. If the client blocks private
network addresses by default, allow the TRAWL hostname or address in that client's
network policy. TRAWL does not require or assume any specific AI frontend.

## Tool contract

`scrape_url` accepts only:

- `url` — required public HTTP(S) URL
- `maxTimeout` — optional positive timeout in milliseconds
- `maxTier` — optional escalation cap from 1 through 4
- `skipHttp` — optionally skip the plain HTTP tier

Private, loopback, link-local, and reserved destinations are rejected, including
redirect destinations and browser-loaded subresources. Request
headers, bodies, cookies, session IDs, and explicit proxies cannot be supplied by
the model.

The response contains at most 50,000 characters of page HTML plus structured
metadata: final URL, status code, tier, content type, elapsed time, and whether the
HTML was truncated. Cookies, proxy details, browser identity, and session data are
never returned.
