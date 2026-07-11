import { Flex, Icon, IconButton, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuPanelLeftClose } from "react-icons/lu"
import { useToolsStore } from "../../../stores/toolsStore"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { type ToolLeaf } from "../definitions"
import { paramGrows, resolveParams, type ToolParamSpec } from "../params"
import { ToolParamControl } from "../controls/ToolParamControl"

/** Stable key for a param, so toggling visibility doesn't reshuffle others. */
function paramKeyOf(spec: ToolParamSpec): string {
  return `${spec.kind}:${spec.paramKey}`
}

/** The selected tool's parameters, each rendered by its matching control. */
export function ParamsPanel({ tool, onHide }: { tool: ToolLeaf; onHide: () => void }) {
  const { t } = useTranslation()
  // The bag is materialized on selection; resolveParams here only covers the
  // (unreachable in practice) case of rendering a never-selected tool.
  const stored = useToolsStore((s) => s.paramsByTool[tool.id])
  const values = stored ?? resolveParams(tool.params)
  // Filter out params hidden by their visibleWhen predicate for the current
  // values (e.g. Portal shows Rotate 180 or Rotation depending on `anchored`).
  const params = (tool.params ?? []).filter((s) => !s.visibleWhen || s.visibleWhen(values))

  return (
    <VStack
      w="308px"
      h="full"
      flexShrink={0}
      gap="0"
      align="stretch"
      bg="panel.bg"
      borderRightWidth="1px"
      borderColor="panel.border"
    >
      <Flex
        align="center"
        gap="2"
        px="3"
        py="2.5"
        borderBottomWidth="1px"
        borderColor="panel.border"
        bg="panel.header"
        flexShrink={0}
      >
        <Icon as={tool.icon} color="brand.fg" boxSize="4" />
        <Text fontWeight="bold" fontSize="sm" truncate flex="1">
          {t(tool.nameKey)}
        </Text>
        <Tooltip content={t("tools.hideParams")} positioning={{ placement: "right" }} showArrow>
          <IconButton
            aria-label={t("tools.hideParams")}
            size="xs"
            variant="ghost"
            color="menubar.fg"
            onClick={onHide}
          >
            <LuPanelLeftClose />
          </IconButton>
        </Tooltip>
      </Flex>
      {params.length > 0 ? (
        // When a param grows (e.g. an asset picker), the column must not scroll
        // so the growing children can flex; otherwise let compact params scroll.
        <VStack
          align="stretch"
          gap="0"
          flex="1"
          minH="0"
          overflowY={params.some(paramGrows) ? "hidden" : "auto"}
        >
          {params.map((spec) => {
            const grows = paramGrows(spec)
            return (
              <Flex
                key={paramKeyOf(spec)}
                direction="column"
                flex={grows ? "1" : undefined}
                minH={grows ? "0" : undefined}
                flexShrink={grows ? 1 : 0}
              >
                <ToolParamControl toolId={tool.id} spec={spec} values={values} />
              </Flex>
            )
          })}
        </VStack>
      ) : (
        <Flex flex="1" align="center" justify="center" p="6">
          <Text fontSize="xs" color="fg.muted" textAlign="center">
            {t("tools.emptyParams")}
          </Text>
        </Flex>
      )}
    </VStack>
  )
}
