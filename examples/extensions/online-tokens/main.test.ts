import { afterEach, describe, expect, it } from "vitest"
import { useExtensionsStore } from "../../../src/stores/extensionsStore"
import { createHarness } from "../../../src/features/extensions/testHarness"
import { contribution, startExample } from "../testing"
import manifest from "./manifest.json"
import tokensEs from "./locales/es.json"
import tokens from "./src/main"
import hexManifest from "../hex-grid/manifest.json"
import hex, { toAxial } from "../hex-grid/src/main"

let stop: (() => void) | undefined
afterEach(() => stop?.())
const enc = new TextEncoder()

async function setup() {
  const h = createHarness()
  stop = () => h.stop()
  // The fake server: a token list and its images.
  h.services.fetch = async (req) => {
    h.services.fetched.push(req.url)
    const body = req.url.includes("?q=")
      ? enc.encode(
          JSON.stringify({
            tokens: [
              { id: "t1", name: "goblin", image: "" },
              { id: "t2", name: "orc", image: "" },
            ],
          }),
        )
      : new Uint8Array([137, 80, 78, 71])
    return { status: 200, headers: {}, body }
  }
  await startExample(hex, hexManifest, { harness: h })
  const r = await startExample(tokens, manifest, {
    harness: h,
    files: { "locales/es.json": JSON.stringify(tokensEs) },
  })
  return r
}

describe("online tokens", () => {
  it("adds a Library tab with local and online results", async () => {
    const { h } = await setup()
    const results = await contribution("libraryTab", "online").search({ query: "gob" })
    expect(results.map((r) => r.id)).toContain("remote:t1")
    expect(h.services.fetched[0]).toBe("https://api.open20.app/tokens?q=gob&limit=40")
    expect(contribution("assetMetadata", "token").fields).toHaveLength(1)
  })

  it("saves found tokens into an editable pack, tagged, in its own words", async () => {
    const { h } = await setup()
    await contribution("command", "save-tokens").run()
    await h.flush()
    const log = useExtensionsStore
      .getState()
      .activity.map((a) => a.text)
      .join("\n")
    expect(log).toContain("notify: 2 tokens encontrados · Guardados en pack1")
    expect(h.services.storage.get("open20.online-tokens")?.get("lastSearch")).toEqual({
      query: "goblin",
      count: 2,
    })
  })

  it("syncs the table over a socket it asked for, using the hex grid's service", async () => {
    const { h } = await setup()
    const live = contribution("command", "live").run()
    await h.answer(true)
    await live
    await h.flush()
    const log = useExtensionsStore
      .getState()
      .activity.map((a) => a.text)
      .join("\n")
    expect(log).toContain(`table: echo:${JSON.stringify({ cell: toAxial({ x: 1, y: 1 }) })}`)
  })

  it("opens its website after asking, and loads its font", async () => {
    const { h } = await setup()
    const about = contribution("command", "about").run()
    await h.answer(true)
    await about
    expect(h.services.opened).toEqual(["https://open20.app/tokens?lang=es"])
  })

  it("can't reach hosts it wasn't granted", async () => {
    const { h, ctx } = await setup()
    await expect(ctx.net.fetch("https://evil.example.com/")).rejects.toMatchObject({
      code: "permission",
    })
    await expect(ctx.services.call("open20.other/x", "y")).rejects.toMatchObject({
      code: "permission",
    })
    void h
  })
})
