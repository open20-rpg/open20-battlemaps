import { useEffect, useMemo, useState } from "react"
import { Box, Button, Flex, Spinner, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuImagePlus, LuMountain } from "react-icons/lu"
import { startImport } from "../../../packs/importFlow"
import { FloatingWindow } from "../../../../ui/FloatingWindow"
import { usePacksStore } from "../../../../stores/packsStore"
import { withLoading } from "../../../../stores/loadingStore"
import { packsWithCategory, type LibItem } from "../../../library/api"
import { type BiomeTexture } from "../../params"
import { TerrainTextureGrid } from "./TerrainTextureGrid"

/**
 * Floating terrain-texture browser: packs that ship terrain on the left, the
 * selected pack's textures (virtualized 180×180 grid) on the right. Picking a
 * texture assigns it to the slot that opened the panel.
 */
export function TexturePickerPanel({
  onSelect,
  onClose,
}: {
  onSelect: (texture: BiomeTexture) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const installed = usePacksStore((s) => s.packs)
  // null = still loading the pack list.
  const [packIds, setPackIds] = useState<string[] | null>(null)
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
  // Packs changed (terrain imported): list them again.
  const libraryRev = usePacksStore((s) => s.libraryRev)

  useEffect(() => {
    let cancelled = false
    void withLoading(t("loading.loadingAssets"), async () => {
      usePacksStore.getState().ensureLoaded()
      const ids = await packsWithCategory("terrain")
      if (!cancelled) setPackIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [t, libraryRev])

  // Resolve pack names and keep a stable, name-sorted order.
  const packs = useMemo(() => {
    const nameById = new Map(installed.map((p) => [p.id, p.name]))
    return (packIds ?? [])
      .map((id) => ({ id, name: nameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [packIds, installed])

  // Derive the active pack so no effect is needed to seed a default.
  const activePack = packs.find((p) => p.id === selectedPackId) ?? packs[0]

  const pick = (item: LibItem) => {
    onSelect({ id: item.id, name: item.name, thumb: item.thumb })
    onClose()
  }

  return (
    <FloatingWindow
      title={t("tools.terrainTextures")}
      icon={LuMountain}
      onClose={onClose}
      initialSize={{ w: 720, h: 500 }}
      minSize={{ w: 480, h: 320 }}
      resizable
      modal
    >
      <Flex flex="1" minH="0">
        {/* Left: packs that ship terrain textures. */}
        <VStack
          w="190px"
          flexShrink={0}
          align="stretch"
          gap="0.5"
          p="2"
          overflowY="auto"
          borderRightWidth="1px"
          borderColor="panel.border"
          bg="panel.header"
        >
          {packs.map((pack) => {
            const active = pack.id === activePack?.id
            return (
              <Flex
                as="button"
                key={pack.id}
                align="center"
                px="2.5"
                py="2"
                borderRadius="md"
                color={active ? "brand.fg" : "menubar.fg"}
                bg={active ? "panel.rowSelected" : "transparent"}
                _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
                onClick={() => setSelectedPackId(pack.id)}
              >
                <Text fontSize="sm" textAlign="left" truncate>
                  {pack.name}
                </Text>
              </Flex>
            )
          })}
          {packIds === null && (
            <Flex justify="center" p="4">
              <Spinner size="sm" color="brand.fg" />
            </Flex>
          )}
          {packIds !== null && packs.length === 0 && (
            <Text fontSize="xs" color="fg.muted" p="2">
              {t("tools.noTerrainPacks")}
            </Text>
          )}
          <Box flex="1" />
          <Button
            size="xs"
            variant="subtle"
            mt="2"
            onClick={() =>
              void startImport({
                category: "terrain",
                // Open the pack they went to, to pick one.
                onImported: (ids) => setSelectedPackId(ids[0]?.split("|")[0] ?? null),
              })
            }
          >
            <LuImagePlus />
            {t("userPacks.importImages")}
          </Button>
        </VStack>

        {/* Right: virtualized 180×180 grid for the active pack. */}
        <Flex flex="1" minW="0" direction="column">
          {activePack && <TerrainTextureGrid packId={activePack.id} onPick={pick} />}
        </Flex>
      </Flex>
    </FloatingWindow>
  )
}
