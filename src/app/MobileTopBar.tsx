import { Flex, Icon, IconButton, Menu, Portal, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import type { IconType } from "react-icons"
import {
  LuFolderOpen,
  LuGem,
  LuHistory,
  LuInfo,
  LuLogOut,
  LuMenu,
  LuRedo2,
  LuSave,
  LuSaveAll,
  LuSettings,
  LuSquarePen,
  LuSquareX,
  LuUndo2,
  LuUpload,
} from "react-icons/lu"
import { BrandMark } from "./BrandMark"
import { type MenuBarProps } from "./MenuBar"

/** One entry of the phone menu. */
function Item({
  value,
  icon,
  label,
  disabled,
  onClick,
}: {
  value: string
  icon: IconType
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Menu.Item value={value} disabled={disabled} onClick={onClick} py="2.5">
      <Icon as={icon} boxSize="4" />
      <Text ml="2">{label}</Text>
    </Menu.Item>
  )
}

/**
 * The menu bar on a phone: the desktop bar's actions don't fit across a
 * narrow screen, so they go in one menu, with Undo, Redo and Save (the ones
 * used all the time) left at hand.
 */
export function MobileTopBar(props: MenuBarProps) {
  const { t } = useTranslation()
  const noMap = !props.mapOpen
  return (
    <Flex
      as="header"
      h="48px"
      flexShrink={0}
      align="center"
      gap="1"
      px="1"
      bg="menubar.bg"
      borderBottomWidth="1px"
      borderColor="panel.border"
    >
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger asChild>
          <IconButton aria-label={t("menu.menu")} variant="ghost" color="menubar.fg" size="md">
            <LuMenu />
          </IconButton>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content bg="panel.solid" borderColor="panel.border" minW="56">
              <Item value="new" icon={LuSquarePen} label={t("menu.new")} onClick={props.onNew} />
              <Item
                value="open"
                icon={LuFolderOpen}
                label={t("menu.open")}
                onClick={props.onOpen}
              />
              <Item
                value="recent"
                icon={LuHistory}
                label={t("menu.recent")}
                onClick={props.onOpenRecent}
              />
              <Item
                value="saveAs"
                icon={LuSaveAll}
                label={t("menu.saveAs")}
                disabled={noMap}
                onClick={props.onSaveAs}
              />
              <Item
                value="export"
                icon={LuUpload}
                label={t("menu.export")}
                disabled={noMap}
                onClick={props.onExport}
              />
              <Item
                value="closeMap"
                icon={LuSquareX}
                label={t("menu.closeMap")}
                disabled={noMap}
                onClick={props.onCloseMap}
              />
              <Menu.Separator />
              <Item
                value="assets"
                icon={LuGem}
                label={t("menu.assets")}
                onClick={props.onToggleAssets}
              />
              <Item
                value="prefs"
                icon={LuSettings}
                label={t("menu.preferences")}
                onClick={props.onOpenPreferences}
              />
              <Item
                value="about"
                icon={LuInfo}
                label={t("menu.about")}
                onClick={props.onOpenAbout}
              />
              <Menu.Separator />
              <Menu.Item
                value="exit"
                py="2.5"
                color="danger.fg"
                _hover={{ bg: "danger.muted", color: "danger.fg" }}
                onClick={props.onExit}
              >
                <Icon as={LuLogOut} boxSize="4" />
                <Text ml="2">{t("menu.exit")}</Text>
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <BrandMark variant="battleMaps" boxSize="6" color="menubar.fg" flexShrink={0} />
      <Text flex="1" minW="0" truncate fontSize="sm" fontWeight="medium" color="menubar.fg">
        {t("canvas.title")}
      </Text>

      <IconButton
        aria-label={t("menu.undo")}
        variant="ghost"
        color="menubar.fg"
        disabled={noMap || !props.canUndo}
        onClick={props.onUndo}
      >
        <LuUndo2 />
      </IconButton>
      <IconButton
        aria-label={t("menu.redo")}
        variant="ghost"
        color="menubar.fg"
        disabled={noMap || !props.canRedo}
        onClick={props.onRedo}
      >
        <LuRedo2 />
      </IconButton>
      <IconButton
        aria-label={t("menu.save")}
        variant="ghost"
        color="menubar.fg"
        disabled={noMap}
        onClick={props.onSave}
      >
        <LuSave />
      </IconButton>
    </Flex>
  )
}
