import { useId } from "react"
import { Box, Flex, Icon, Text } from "@chakra-ui/react"
import { LuBrush, LuCircle, LuSpline, LuSquare } from "react-icons/lu"
import { useTranslation } from "react-i18next"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { type Shape } from "../params"

/**
 * Shape selector: which geometry a shape/area tool draws with. Icon-only toggle
 * buttons — Rectangle, Ellipse, (free-form) Path, and, when `allowBrush` is set,
 * a free-paint Brush option. `value` may be null (no shape selected, e.g.
 * Building's shape-vs-editPoints); there is no UI to return to null once chosen.
 */
export function ShapeControl({
  value,
  allowBrush = false,
  onChange,
}: {
  value: Shape | null
  allowBrush?: boolean
  onChange: (value: Shape) => void
}) {
  const { t } = useTranslation()
  const labelId = useId()

  const options: { value: Shape; label: string; icon: typeof LuSquare }[] = [
    { value: "rectangle", label: t("tools.shapeRectangle"), icon: LuSquare },
    { value: "ellipse", label: t("tools.shapeEllipse"), icon: LuCircle },
    { value: "path", label: t("tools.shapePath"), icon: LuSpline },
    ...(allowBrush
      ? [{ value: "brush" as Shape, label: t("tools.shapeBrush"), icon: LuBrush }]
      : []),
  ]

  return (
    <Box px="3" py="1.5">
      <Text id={labelId} mb="2" fontSize="xs" color="fg.muted">
        {t("tools.shape")}
      </Text>
      <Flex
        role="radiogroup"
        aria-labelledby={labelId}
        gap="0"
        borderWidth="1px"
        borderColor="panel.border"
        borderRadius="md"
        overflow="hidden"
      >
        {options.map((opt, i) => {
          const active = value === opt.value
          return (
            <Tooltip
              key={opt.value}
              content={opt.label}
              positioning={{ placement: "top" }}
              openDelay={200}
              showArrow
            >
              <Flex
                as="button"
                flex="1"
                align="center"
                justify="center"
                py="1.5"
                borderLeftWidth={i === 0 ? "0" : "1px"}
                borderColor="panel.border"
                color={active ? "brand.fg" : "menubar.fg"}
                bg={active ? "panel.rowSelected" : "transparent"}
                _hover={{ bg: active ? "panel.rowSelected" : "panel.rowHover" }}
                _focusVisible={{
                  outline: "2px solid",
                  outlineColor: "brand.fg",
                  outlineOffset: "-2px",
                }}
                onClick={() => onChange(opt.value)}
                role="radio"
                aria-label={opt.label}
                aria-checked={active}
              >
                <Icon as={opt.icon} boxSize="4" aria-hidden />
              </Flex>
            </Tooltip>
          )
        })}
      </Flex>
    </Box>
  )
}
