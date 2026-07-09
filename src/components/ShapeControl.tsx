import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { LuCircle, LuSpline, LuSquare } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import type { Shape } from "../lib/tools"
import { useTools } from "../context/tools"

/**
 * Shape selector: which geometry a shape/area tool draws with. Three icon-only
 * toggle buttons — Rectangle, Ellipse, and (free-form) Path. The choice is
 * stored in the tool's params, falling back to `defaultValue`. `defaultValue`
 * may be null (no shape selected, e.g. the Water Brush before a shape is
 * picked); there is no UI to return to null once a shape is chosen.
 */
export function ShapeControl({
  toolId,
  defaultValue,
}: {
  toolId: string
  defaultValue: Shape | null
}) {
  const { t } = useTranslation()
  const { getToolParams, setToolParams } = useTools()
  const stored = getToolParams(toolId).shape as Shape | undefined
  const current: Shape | null = stored ?? defaultValue

  const options: { value: Shape; label: string; icon: typeof LuSquare }[] = [
    { value: "rectangle", label: t("tools.shapeRectangle"), icon: LuSquare },
    { value: "ellipse", label: t("tools.shapeEllipse"), icon: LuCircle },
    { value: "path", label: t("tools.shapePath"), icon: LuSpline },
  ]

  return (
    <Box px="3" py="3">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t("tools.shape")}
      </Text>
      <Flex gap="0" borderWidth="1px" borderColor="panel.border" borderRadius="md" overflow="hidden">
        {options.map((opt, i) => {
          const active = current === opt.value
          return (
            <Flex
              as="button"
              key={opt.value}
              flex="1"
              align="center"
              justify="center"
              py="1.5"
              borderLeftWidth={i === 0 ? "0" : "1px"}
              borderColor="panel.border"
              color={active ? "brand.fg" : "menubar.fg"}
              bg={active ? "panel.rowSelected" : "transparent"}
              _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
              onClick={() => setToolParams(toolId, { shape: opt.value })}
              aria-label={opt.label}
              aria-pressed={active}
            >
              <Icon as={opt.icon} boxSize="4" />
            </Flex>
          )
        })}
      </Flex>
    </Box>
  )
}
