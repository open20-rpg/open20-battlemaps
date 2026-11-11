import { describe, expect, it } from "vitest"
import { bumpCargoLock, bumpCargoToml, bumpTauriConf } from "./bump-version.mjs"

describe("bump-version", () => {
  it("bumps tauri.conf.json", () => {
    const out = bumpTauriConf(
      '{\n  "productName": "Open20 Battle Maps",\n  "version": "0.1.9"\n}\n',
      "0.1.10",
    )
    expect(JSON.parse(out).version).toBe("0.1.10")
  })

  it("bumps only the [package] version in Cargo.toml", () => {
    const toml =
      '[package]\nname = "open20-battle-maps"\nversion = "0.1.9"\n\n[dependencies]\nserde = { version = "1" }\n'
    const out = bumpCargoToml(toml, "0.2.0")
    expect(out).toContain('version = "0.2.0"')
    expect(out).toContain('serde = { version = "1" }')
  })

  it("bumps only the app crate in Cargo.lock", () => {
    const lock =
      '[[package]]\nname = "once_cell"\nversion = "0.1.9"\n\n[[package]]\nname = "open20-battle-maps"\nversion = "0.1.9"\n'
    const out = bumpCargoLock(lock, "0.1.10")
    expect(out).toContain('name = "once_cell"\nversion = "0.1.9"')
    expect(out).toContain('name = "open20-battle-maps"\nversion = "0.1.10"')
  })
})
