import { Box, Flex, Grid, Icon, IconButton, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { LuPanelLeftClose } from "react-icons/lu"
import { useToolsStore } from "../../../stores/toolsStore"
import { Tooltip } from "../../../ui/chakra/tooltip"
import { type ToolLeaf } from "../definitions"
import { paramGrows, paramRuns, resolveParams, type ToolParamSpec } from "../params"
import { ToolParamControl } from "../controls/ToolParamControl"

/** Height of a growing param (asset picker, terrain slots) when the panel scrolls. */
const GROWING_PARAM_H = "340px"

/** Stable key for a param, so toggling visibility doesn't reshuffle others. */
function paramKeyOf(spec: ToolParamSpec): string {
  return `${spec.kind}:${spec.paramKey}`
}

/** The selected tool's parameters, each rendered by its matching control. */
export function ParamsPanel({
  tool,
  onHide,
  width = "308px",
  scroll = false,
  header = true,
}: {
  tool: ToolLeaf
  onHide: () => void
  /** Column width (the phone layout's sheet spans the screen). */
  width?: string
  /**
   * Always scroll, giving growing params (asset pickers, terrain slots) a
   * fixed height: the phone's sheet is too short to share among them.
   */
  scroll?: boolean
  /** Its own title bar (the phone's sheet brings its own). */
  header?: boolean
}) {
  const { t } = useTranslation()
  // Which params show: those whose visibleWhen predicate passes for the
  // current values (e.g. Portal shows Rotate 180 or Rotation depending on
  // `anchored`). Subscribed as a key string, so a value change that shows or
  // hides nothing (the brush size on every wheel notch) doesn't re-render
  // the panel; each control subscribes to its own value.
  const shown = useToolsStore((s) => {
    const values = s.paramsByTool[tool.id] ?? resolveParams(tool.params)
    return (tool.params ?? [])
      .filter((p) => !p.visibleWhen || p.visibleWhen(values))
      .map(paramKeyOf)
      .join("|")
  })
  const visible = new Set(shown.split("|"))
  const params = (tool.params ?? []).filter((p) => visible.has(paramKeyOf(p)))

  return (
    <VStack
      w={width}
      h="full"
      flexShrink={0}
      gap="0"
      align="stretch"
      bg="panel.bg"
      borderRightWidth="1px"
      borderColor="panel.border"
    >
      {header && (
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
          <Text truncate fontWeight="bold" fontSize="sm" flex="1">
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
      )}
      {params.length > 0 ? (
        // When a param grows (e.g. an asset picker), the column must not scroll
        // so the growing children can flex; otherwise let compact params scroll.
        <VStack
          align="stretch"
          gap="0"
          flex="1"
          minH="0"
          overflowY={!scroll && params.some(paramGrows) ? "hidden" : "auto"}
        >
          {paramRuns(params).map((run) => {
            if (run.kind === "buttons") {
              return (
                <Box key={run.specs.map(paramKeyOf).join("|")} px="3" py="1.5" flexShrink={0}>
                  <Text mb="1.5" fontSize="xs" color="fg.muted">
                    {t("tools.actions")}
                  </Text>
                  <Grid
                    templateColumns="repeat(auto-fill, minmax(68px, 1fr))"
                    // Every row as tall as the tallest: all the buttons alike.
                    gridAutoRows="1fr"
                    gap="1"
                  >
                    {run.specs.map((spec) => (
                      <ToolParamControl
                        key={paramKeyOf(spec)}
                        toolId={tool.id}
                        spec={spec}
                        compact
                      />
                    ))}
                  </Grid>
                </Box>
              )
            }
            const spec = run.spec
            const grows = paramGrows(spec)
            return (
              <Flex
                key={paramKeyOf(spec)}
                direction="column"
                flex={grows && !scroll ? "1" : undefined}
                minH={grows && !scroll ? "0" : undefined}
                h={grows && scroll ? GROWING_PARAM_H : undefined}
                flexShrink={grows && !scroll ? 1 : 0}
              >
                <ToolParamControl toolId={tool.id} spec={spec} />
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
