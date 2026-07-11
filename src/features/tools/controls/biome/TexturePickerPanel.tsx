import { useState } from "react"
import { Box, Flex, Spinner, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuMountain } from "react-icons/lu"
import { FloatingWindow } from "../../../../ui/FloatingWindow"
import { thumbUrl, type LibItem } from "../../../library/api"
import { type BiomeTexture } from "../../params"
import { useTerrainTextures } from "./useTerrainTextures"

const TILE = 100

/**
 * Floating terrain-texture browser: installed packs (that ship terrain) on the
 * left, the selected pack's textures as a 100×100 grid on the right. Picking a
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
  const { loading, packs } = useTerrainTextures()
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null)

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
      initialSize={{ w: 640, h: 460 }}
      minSize={{ w: 420, h: 300 }}
      resizable
      modal
    >
      <Flex flex="1" minH="0">
        {/* Left: packs that include terrain textures. */}
        <VStack
          w="180px"
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
        </VStack>

        {/* Right: textures of the active pack. */}
        <Box flex="1" minW="0" overflowY="auto" p="3">
          {loading ? (
            <Flex h="full" align="center" justify="center">
              <Spinner color="brand.fg" />
            </Flex>
          ) : packs.length === 0 ? (
            <Flex h="full" align="center" justify="center">
              <Text fontSize="sm" color="fg.muted" textAlign="center">
                {t("tools.noTerrainPacks")}
              </Text>
            </Flex>
          ) : (
            <Flex wrap="wrap" gap="3">
              {activePack?.items.map((item) => (
                <VStack
                  as="button"
                  key={item.id}
                  w={`${TILE}px`}
                  gap="1"
                  onClick={() => pick(item)}
                >
                  <Box
                    boxSize={`${TILE}px`}
                    borderWidth="1px"
                    borderColor="panel.border"
                    borderRadius="md"
                    overflow="hidden"
                    bg="panel.header"
                    _hover={{ borderColor: "brand.fg" }}
                  >
                    <img
                      src={thumbUrl(item.thumb)}
                      alt=""
                      draggable={false}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </Box>
                  <Text fontSize="xs" color="fg.muted" lineClamp={2} textAlign="center">
                    {item.name}
                  </Text>
                </VStack>
              ))}
            </Flex>
          )}
        </Box>
      </Flex>
    </FloatingWindow>
  )
}
