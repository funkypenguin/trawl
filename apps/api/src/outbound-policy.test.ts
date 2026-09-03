import { describe, expect, test } from "bun:test"
import { assertPublicHttpUrl } from "./outbound-policy"

describe("MCP outbound URL policy", () => {
  for (const url of [
    "file:///etc/passwd",
    "http://localhost/admin",
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://user:password@example.com/",
  ]) {
    test(`rejects ${url}`, async () => {
      expect(assertPublicHttpUrl(url)).rejects.toThrow()
    })
  }

  test("accepts a public literal address", async () => {
    expect((await assertPublicHttpUrl("https://1.1.1.1/path")).hostname).toBe("1.1.1.1")
  })
})
