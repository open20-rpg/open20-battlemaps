import { describe, expect, it } from "vitest"
import { mapFileName } from "./mapName"

describe("mapFileName", () => {
  it("drops the folder and the extension", () => {
    expect(mapFileName("/home/me/maps/Cueva.otbm")).toBe("Cueva")
    expect(mapFileName("C:\\maps\\Torre del mago.otbm")).toBe("Torre del mago")
    expect(mapFileName("/x/old.dungeondraft_map")).toBe("old.dungeondraft_map")
  })

  it("decodes Android content URIs", () => {
    expect(
      mapFileName(
        "content://com.android.externalstorage.documents/document/primary%3ADownload%2Fmap2.otbm",
      ),
    ).toBe("map2")
  })

  it("keeps names that aren't percent-encoded", () => {
    expect(mapFileName("/maps/100%.otbm")).toBe("100%")
  })
})
