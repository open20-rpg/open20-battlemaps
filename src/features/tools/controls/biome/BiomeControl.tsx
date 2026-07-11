import { useState } from "react"
import { Box, Button, Flex, Icon, NativeSelect, Switch, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuLayoutGrid, LuPaintBucket } from "react-icons/lu"
import { thumbUrl } from "../../../library/api"
import { toaster } from "../../../../ui/chakra/toaster-instance"
import { BIOME_MAX_SLOTS, type BiomeSelection, type BiomeTexture } from "../../params"
import { BIOMES } from "./biomes"
import { TexturePickerPanel } from "./TexturePickerPanel"

/**
 * Biome selector for the Terrain Brush: a fixed biome dropdown plus terrain
 * texture slots. Each slot opens a floating browser to pick its texture; the
 * "unlock 4 more slots" toggle reveals slots 5–8. The Fill action awaits the
 * map engine, so it currently only signals "coming soon".
 */
export function BiomeControl({
  value,
  labelKey,
  onChange,
}: {
  value: BiomeSelection
  labelKey: string
  onChange: (value: BiomeSelection) => void
}) {
  const { t } = useTranslation()
  const [openSlot, setOpenSlot] = useState<number | null>(null)

  // Slots belong to the selected biome; switching biomes swaps them.
  const stored = value.slotsByBiome[value.biome] ?? []
  const count = value.unlocked ? BIOME_MAX_SLOTS : 4
  const slots = Array.from({ length: count }, (_, i) => stored[i] ?? null)

  const setBiome = (biome: string) => onChange({ ...value, biome })
  const setUnlocked = (unlocked: boolean) => onChange({ ...value, unlocked })
  const setSlot = (index: number, texture: BiomeTexture) => {
    const next = stored.slice()
    next[index] = texture
    onChange({ ...value, slotsByBiome: { ...value.slotsByBiome, [value.biome]: next } })
  }
  const fill = () =>
    toaster.create({ title: t("toast.soon", { label: t("tools.fill") }), type: "info" })

  return (
    <Flex direction="column" flex="1" minH="0" px="3" py="1.5" gap="2">
      <Text fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>

      <NativeSelect.Root size="sm">
        <NativeSelect.Field
          value={value.biome}
          bg="panel.solid"
          borderColor="panel.border"
          onChange={(e) => setBiome(e.currentTarget.value)}
        >
          {BIOMES.map((biome) => (
            <option key={biome} value={biome}>
              {t(`biomes.${biome}`)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>

      {/* Texture slots (scroll when they overflow). */}
      <VStack align="stretch" gap="1.5" flex="1" minH="0" overflowY="auto">
        {slots.map((slot, i) => (
          <Flex
            key={i}
            align="center"
            h="64px"
            borderWidth="1px"
            borderColor="panel.border"
            borderRadius="md"
            overflow="hidden"
            flexShrink={0}
          >
            <Box boxSize="64px" flexShrink={0} bg="panel.header">
              {slot && (
                <img
                  src={thumbUrl(slot.thumb)}
                  alt=""
                  draggable={false}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )}
            </Box>
            <Text flex="1" px="2.5" fontSize="sm" truncate color={slot ? "fg" : "fg.muted"}>
              {slot ? slot.name : t("tools.noTexture")}
            </Text>
            <Flex
              as="button"
              align="center"
              justify="center"
              w="48px"
              h="full"
              flexShrink={0}
              color="menubar.fg"
              _hover={{ bg: "panel.rowHover", color: "brand.fg" }}
              onClick={() => setOpenSlot(i)}
              aria-label={t("tools.pickTexture")}
            >
              <Icon as={LuLayoutGrid} boxSize="4" />
            </Flex>
          </Flex>
        ))}
      </VStack>

      <Button variant="subtle" size="sm" onClick={fill} flexShrink={0}>
        <LuPaintBucket />
        {t("tools.fill")}
      </Button>

      <Flex align="center" justify="space-between" flexShrink={0}>
        <Text fontSize="xs" color="fg.muted">
          {t("tools.unlockSlots")}
        </Text>
        <Switch.Root checked={value.unlocked} onCheckedChange={(e) => setUnlocked(e.checked)}>
          <Switch.HiddenInput />
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Root>
      </Flex>

      {openSlot !== null && (
        <TexturePickerPanel
          onSelect={(texture) => setSlot(openSlot, texture)}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </Flex>
  )
}
