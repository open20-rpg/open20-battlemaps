import { Button, Flex, Icon, Menu, Portal, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import type { IconType } from "react-icons"
import {
  LuFolderOpen,
  LuDatabaseBackup,
  LuGem,
  LuInfo,
  LuKeyboard,
  LuLogOut,
  LuMenu,
  LuRedo2,
  LuSave,
  LuSettings,
  LuSquarePen,
  LuSquareX,
  LuUndo2,
  LuUpload,
} from "react-icons/lu"
import { ExtensionsMenu } from "../features/extensions/ui/ExtensionsMenu"

interface BarButtonProps {
  icon: IconType
  label: string
  disabled?: boolean
  active?: boolean
  onClick?: () => void
}

function BarButton({ icon, label, disabled, active, onClick }: BarButtonProps) {
  return (
    <Button
      variant="plain"
      h="46px"
      px="3.5"
      gap="2"
      flexShrink={0}
      borderRadius="0"
      fontWeight="medium"
      fontSize="sm"
      color={disabled ? "menubar.fgMuted" : "menubar.fg"}
      bg={active ? "menubar.hover" : "transparent"}
      cursor={disabled ? "not-allowed" : "pointer"}
      _hover={{ bg: disabled ? "transparent" : "menubar.hover" }}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon as={icon} boxSize="5" />
      <Text>{label}</Text>
    </Button>
  )
}

export interface MenuBarProps {
  assetsOpen: boolean
  /** Whether a map is currently open (enables Save/Export/Undo/Redo). */
  mapOpen: boolean
  onToggleAssets: () => void
  onOpenPreferences: () => void
  onOpenShortcuts: () => void
  onOpenAbout: () => void
  onOpenRecent: () => void
  onOpenBackups: () => void
  onExit: () => void
  onNew: () => void
  onOpen: () => void
  onCloseMap: () => void
  onSave: () => void
  onSaveAs: () => void
  onExport: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onOpenExtensions: () => void
  onOpenPalette: () => void
}

export function MenuBar(props: MenuBarProps) {
  const { t } = useTranslation()
  return (
    <Flex
      as="header"
      bg="menubar.bg"
      borderBottomWidth="1px"
      borderColor="panel.border"
      align="stretch"
      flexShrink={0}
      overflowX="auto"
      overflowY="hidden"
      // Let a plain vertical wheel scroll the bar horizontally (no Shift needed).
      onWheel={(e) => {
        const el = e.currentTarget
        if (el.scrollWidth > el.clientWidth && e.deltaY !== 0) {
          el.scrollLeft += e.deltaY
        }
      }}
      css={{
        WebkitUserSelect: "none",
        // Scrollable when the items don't fit, but hide the scrollbar.
        scrollbarWidth: "none",
        "&::-webkit-scrollbar": { display: "none" },
      }}
    >
      {/* "Menu" dropdown */}
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger asChild>
          <Button
            variant="plain"
            h="46px"
            px="3.5"
            gap="2"
            flexShrink={0}
            borderRadius="0"
            fontWeight="medium"
            fontSize="sm"
            color="menubar.fg"
            _hover={{ bg: "menubar.hover" }}
            _open={{ bg: "menubar.hover" }}
          >
            <Icon as={LuMenu} boxSize="5" />
            <Text>{t("menu.menu")}</Text>
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content bg="panel.solid" borderColor="panel.border" minW="52">
              <Menu.Item value="recent" onClick={props.onOpenRecent}>
                <LuFolderOpen />
                <Text ml="2">{t("menu.recent")}</Text>
              </Menu.Item>
              <Menu.Item value="backups" onClick={props.onOpenBackups}>
                <LuDatabaseBackup />
                <Text ml="2">{t("menu.backups")}</Text>
              </Menu.Item>
              <Menu.Item value="closeMap" disabled={!props.mapOpen} onClick={props.onCloseMap}>
                <LuSquareX />
                <Text ml="2">{t("menu.closeMap")}</Text>
              </Menu.Item>
              <Menu.Item value="saveAs" disabled={!props.mapOpen} onClick={props.onSaveAs}>
                <LuSave />
                <Text ml="2">{t("menu.saveAs")}</Text>
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item value="prefs" onClick={props.onOpenPreferences}>
                <LuSettings />
                <Text ml="2">{t("menu.preferences")}</Text>
              </Menu.Item>
              <Menu.Item value="shortcuts" onClick={props.onOpenShortcuts}>
                <LuKeyboard />
                <Text ml="2">{t("menu.shortcuts")}</Text>
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                value="exit"
                color="danger.fg"
                _hover={{ bg: "danger.muted", color: "danger.fg" }}
                onClick={props.onExit}
              >
                <LuLogOut />
                <Text ml="2">{t("menu.exit")}</Text>
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <BarButton icon={LuSquarePen} label={t("menu.new")} onClick={props.onNew} />
      <BarButton icon={LuFolderOpen} label={t("menu.open")} onClick={props.onOpen} />
      <BarButton
        icon={LuSave}
        label={t("menu.save")}
        disabled={!props.mapOpen}
        onClick={props.onSave}
      />
      <BarButton
        icon={LuUpload}
        label={t("menu.export")}
        disabled={!props.mapOpen}
        onClick={props.onExport}
      />
      <BarButton
        icon={LuUndo2}
        label={t("menu.undo")}
        disabled={!props.mapOpen || !props.canUndo}
        onClick={props.onUndo}
      />
      <BarButton
        icon={LuRedo2}
        label={t("menu.redo")}
        disabled={!props.mapOpen || !props.canRedo}
        onClick={props.onRedo}
      />
      <BarButton
        icon={LuGem}
        label={t("menu.assets")}
        active={props.assetsOpen}
        onClick={props.onToggleAssets}
      />
      <ExtensionsMenu onManage={props.onOpenExtensions} onPalette={props.onOpenPalette} />
      <BarButton icon={LuInfo} label={t("menu.about")} onClick={props.onOpenAbout} />
    </Flex>
  )
}
