import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import { RequestValidationError } from "@trawl/tiers"

const PRIVATE_V4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0)
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4Number(address)
  return PRIVATE_V4.some(([network, prefix]) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    return (value & mask) === (ipv4Number(network) & mask)
  })
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0]
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized)
  if (isIP(normalized) !== 6) return true

  // Unspecified, loopback, link-local, unique-local, multicast, documentation,
  // and IPv4-mapped addresses are not valid public scrape targets.
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  return mapped ? isPrivateIpv4(mapped[1]) : false
}

function parsePublicHttpUrl(rawUrl: string): { url: URL; hostname: string } {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new RequestValidationError("url must be a valid absolute URL", 400)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RequestValidationError("url scheme must be http or https", 400)
  }
  if (url.username || url.password) {
    throw new RequestValidationError("url credentials are not allowed", 400)
  }
  const hostname = url.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "")
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new RequestValidationError("url must not target a private or local network", 400)
  }

  return { url, hostname }
}

async function assertPublicHostname(hostname: string): Promise<void> {
  let addresses: { address: string }[]
  try {
    addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true })
  } catch {
    throw new RequestValidationError("url hostname could not be resolved", 400)
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new RequestValidationError("url must not target a private or local network", 400)
  }
}

export function createPublicUrlValidator(): (rawUrl: string) => Promise<URL> {
  const validatedHosts = new Map<string, Promise<void>>()
  return async (rawUrl) => {
    const { url, hostname } = parsePublicHttpUrl(rawUrl)
    let validation = validatedHosts.get(hostname)
    if (!validation) {
      validation = assertPublicHostname(hostname)
      validatedHosts.set(hostname, validation)
    }
    await validation
    return url
  }
}

export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  return createPublicUrlValidator()(rawUrl)
}
