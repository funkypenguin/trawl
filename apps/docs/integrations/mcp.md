---
title: Model Context Protocol (MCP)
description: Connect any MCP-compatible AI client to TRAWL's scraping tool.
---

# Model Context Protocol (MCP)

TRAWL has an optional, client-independent Model Context Protocol server. Any AI
application or agent that supports remote MCP servers over Streamable HTTP can
connect to it and use its reading, scraping, screenshot and inspection tools.

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

## Tools

TRAWL exposes a small set of purpose-specific, read-only tools:

| Tool | Use it for |
| --- | --- |
| `read` | Extracting the main page content as Markdown or plain text |
| `scrape` | Reading the original HTML and scrape metadata |
| `screenshot` | Rendering a viewport JPEG for visual or multimodal inspection |
| `inspect` | Browser console, network timing and redirect diagnostics |
| `scrape_url` | Backwards-compatible alias for `scrape` |

Every tool requires a public HTTP(S) `url` and optionally accepts `maxTimeout`
and `maxTier`. `scrape` also accepts `skipHttp`. Browser-only tools start at
Tier 2 and accept a `maxTier` from 2 through 4.

`read` defaults to Markdown and a 50,000-character response. Set `format` to
`text` for plain text, or set `maxCharacters` to a value from 1 through 100,000.
Its structured metadata includes the title and, when detected, the byline,
excerpt, site name and language.

`scrape` returns at most 50,000 characters of page HTML. Its structured output
includes the final URL, status, winning tier, content type, elapsed time,
per-tier attempt history, cache use, truncation and non-sensitive CAPTCHA/proxy
booleans.

`screenshot` returns an MCP `image` content block containing a base64 JPEG plus
structured scrape metadata. A client and its selected model must support image
tool results to make visual use of it.

`inspect` returns the bounded diagnostics already collected by TRAWL's browser
tiers. Credentials, query strings and fragments are stripped from network and
redirect URLs. Console messages are page-controlled and can themselves contain
tokens or personal data, so treat this explicit diagnostic tool as sensitive.

Private, loopback, link-local, and reserved destinations are rejected, including
redirect destinations and browser-loaded subresources. Request
headers, bodies, cookies, session IDs, and explicit proxies cannot be supplied by
the model.

Cookies, request headers, response bodies captured from background APIs, explicit
proxy details, browser identity and session data are never returned by these MCP
tools.
