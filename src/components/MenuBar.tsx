import { Button, Flex, Icon, Menu, Portal, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import type { IconType } from "react-icons"
import {
  LuBlocks,
  LuFolderOpen,
  LuGem,
  LuInfo,
  LuMenu,
  LuRedo2,
  LuSave,
  LuSquarePen,
  LuUndo2,
  LuUpload,
} from "react-icons/lu"

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
  onToggleAssets: () => void
  onOpenPreferences: () => void
  onOpenAbout: () => void
  onOpenRecent: () => void
  onExit: () => void
  onNew: () => void
  onOpen: () => void
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
      css={{ WebkitUserSelect: "none" }}
    >
      {/* "Menu" dropdown */}
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger asChild>
          <Button
            variant="plain"
            h="46px"
            px="3.5"
            gap="2"
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
            <Menu.Content bg="panel.bg" borderColor="panel.border" minW="52">
              <Menu.Item value="recent" onClick={props.onOpenRecent}>
                <LuFolderOpen />
                <Text ml="2">{t("menu.recent")}</Text>
              </Menu.Item>
              <Menu.Item value="prefs" onClick={props.onOpenPreferences}>
                {t("menu.preferences")}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                value="exit"
                color="red.300"
                _hover={{ bg: "red.900/40", color: "red.200" }}
                onClick={props.onExit}
              >
                {t("menu.exit")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <BarButton icon={LuSquarePen} label={t("menu.new")} onClick={props.onNew} />
      <BarButton icon={LuFolderOpen} label={t("menu.open")} onClick={props.onOpen} />
      <BarButton icon={LuSave} label={t("menu.save")} disabled />
      <BarButton icon={LuUpload} label={t("menu.export")} disabled />
      <BarButton icon={LuUndo2} label={t("menu.undo")} disabled />
      <BarButton icon={LuRedo2} label={t("menu.redo")} disabled />
      <BarButton
        icon={LuGem}
        label={t("menu.assets")}
        active={props.assetsOpen}
        onClick={props.onToggleAssets}
      />
      <BarButton icon={LuBlocks} label={t("menu.extensions")} disabled />
      <BarButton icon={LuInfo} label={t("menu.about")} onClick={props.onOpenAbout} />
    </Flex>
  )
}
