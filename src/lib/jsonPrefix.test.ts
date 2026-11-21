import { describe, expect, it } from "vitest"
import { leadingJsonValue } from "./jsonPrefix"

describe("leadingJsonValue", () => {
  it("recovers a document followed by the tail of an older one", () => {
    const doc = '{\n  "a": [1, {"b": "x}"}],\n  "c": "q\\"}"\n}'
    const raw = `${doc}          {\n  "id": "old"\n  }\n]\n}\n`
    expect(leadingJsonValue(raw)).toBe(doc)
    expect(JSON.parse(leadingJsonValue(raw)!)).toEqual({ a: [1, { b: "x}" }], c: 'q"}' })
  })

  it("returns null when nothing follows the value", () => {
    expect(leadingJsonValue('  {"a": 1}\n  ')).toBeNull()
  })

  it("returns null for an incomplete or non-container value", () => {
    expect(leadingJsonValue('{"a": [1, 2')).toBeNull()
    expect(leadingJsonValue('"text" junk')).toBeNull()
    expect(leadingJsonValue("")).toBeNull()
  })
})
