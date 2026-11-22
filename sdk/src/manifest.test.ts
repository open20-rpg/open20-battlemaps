import { describe, expect, it } from "vitest"
import { declaredPermissions, isSafePath, localize, validateManifest } from "./manifest"
import { allowsUrl, isNetworkHost, isPermission, permissionRisk } from "./permissions"
import { compareVersions, parseVersion, satisfies } from "./semver"

const base = {
  manifestVersion: 1,
  id: "open20.ejemplo",
  name: { es: "Ejemplo", en: "Example" },
  version: "1.2.3",
  author: { name: "Open20" },
  engines: { battlemaps: "^1.0.0" },
  main: "main.js",
  permissions: ["map:read", "network:api.open20.app"],
}

describe("validateManifest", () => {
  it("accepts a complete manifest", () => {
    const r = validateManifest(base)
    expect(r.ok).toBe(true)
  })

  it("lists every problem with its path", () => {
    const r = validateManifest({
      ...base,
      id: "Bad Id",
      version: "1.0",
      permissions: ["map:read", "root", "network:*.evil.com"],
      main: "../escape.js",
      homepage: "http://insecure",
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    const paths = r.issues.map((i) => i.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        "id",
        "version",
        "permissions[1]",
        "permissions[2]",
        "main",
        "homepage",
      ]),
    )
  })

  it("rejects permissions on data-only extensions", () => {
    const noMain: Record<string, unknown> = { ...base }
    delete noMain.main
    const r = validateManifest(noMain)
    expect(r.ok).toBe(false)
  })

  it("validates contributed paths, fonts and shaders", () => {
    const r = validateManifest({
      ...base,
      contributes: {
        fonts: [{ family: "X", path: "fonts/x.ttf", license: "" }],
        shaders: [{ id: "s", name: "S", target: "sky", path: "/abs.glsl" }],
        locales: { es: "locales/es.json" },
      },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        "contributes.fonts[0].license",
        "contributes.shaders[0].path",
        "contributes.shaders[0].target",
      ]),
    )
  })

  it("rejects non objects", () => {
    expect(validateManifest(null).ok).toBe(false)
    expect(validateManifest([]).ok).toBe(false)
  })

  it("lists required and optional permissions", () => {
    const r = validateManifest({ ...base, optionalPermissions: ["clipboard"] })
    if (!r.ok) throw new Error("invalid")
    expect(declaredPermissions(r.manifest)).toEqual([
      "map:read",
      "network:api.open20.app",
      "clipboard",
    ])
  })
})

describe("paths and texts", () => {
  it("only allows relative paths inside the package", () => {
    expect(isSafePath("a/b.js")).toBe(true)
    expect(isSafePath("../a.js")).toBe(false)
    expect(isSafePath("a/../../b")).toBe(false)
    expect(isSafePath("/etc/passwd")).toBe(false)
    expect(isSafePath("C:/x")).toBe(false)
    expect(isSafePath("a\\b")).toBe(false)
  })

  it("localizes with a Spanish fallback", () => {
    expect(localize({ es: "Hola", en: "Hi" }, "en")).toBe("Hi")
    expect(localize({ es: "Hola", en: "Hi" }, "en-US")).toBe("Hi")
    expect(localize({ es: "Hola" }, "fr")).toBe("Hola")
    expect(localize("Texto", "en")).toBe("Texto")
  })
})

describe("permissions", () => {
  it("knows static and network permissions", () => {
    expect(isPermission("map:write")).toBe(true)
    expect(isPermission("network:api.example.com")).toBe(true)
    expect(isPermission("network:localhost")).toBe(false)
    expect(isPermission("network:192.168.0.1")).toBe(false)
    expect(isPermission("network:*.example.com")).toBe(false)
    expect(isPermission("everything")).toBe(false)
  })

  it("rates network access as high risk", () => {
    expect(permissionRisk("network:a.example.com")).toBe("high")
    expect(permissionRisk("map:read")).toBe("low")
    expect(permissionRisk("folder")).toBe("high")
  })

  it("matches URLs by exact host over https only", () => {
    const g = ["network:api.example.com" as const]
    expect(allowsUrl(g, "https://api.example.com/x?y=1")).toBe(true)
    expect(allowsUrl(g, "wss://api.example.com/socket")).toBe(true)
    expect(allowsUrl(g, "http://api.example.com/")).toBe(false)
    expect(allowsUrl(g, "https://evil.api.example.com/")).toBe(false)
    expect(allowsUrl(g, "https://api.example.com:8443/")).toBe(false)
    expect(allowsUrl(g, "https://user:pw@api.example.com/")).toBe(false)
    expect(allowsUrl(g, "not a url")).toBe(false)
    expect(isNetworkHost("intranet.local")).toBe(false)
  })
})

describe("semver", () => {
  it("parses and compares", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3])
    expect(parseVersion("1.2")).toBeNull()
    expect(compareVersions([1, 2, 3], [1, 10, 0])).toBeLessThan(0)
  })

  it("checks ranges like npm", () => {
    expect(satisfies("1.4.0", "^1.0.0")).toBe(true)
    expect(satisfies("2.0.0", "^1.0.0")).toBe(false)
    expect(satisfies("0.3.9", "^0.3.1")).toBe(true)
    expect(satisfies("0.4.0", "^0.3.1")).toBe(false)
    expect(satisfies("1.2.9", "~1.2.0")).toBe(true)
    expect(satisfies("1.3.0", "~1.2.0")).toBe(false)
    expect(satisfies("3.0.0", ">=2.1.0")).toBe(true)
    expect(satisfies("1.0.0", "1.0.0")).toBe(true)
    expect(satisfies("1.0.1", "1.0.0")).toBe(false)
    expect(satisfies("9.9.9", "*")).toBe(true)
    expect(satisfies("x", "*")).toBe(false)
  })
})
