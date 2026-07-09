import { Button, Flex, Icon, Menu, Portal, Text } from "@chakra-ui/react"
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
            <Text>Menu</Text>
          </Button>
        </Menu.Trigger>
        <Portal>
          <Menu.Positioner>
            <Menu.Content bg="panel.bg" borderColor="panel.border" minW="52">
              <Menu.Item value="recent" onClick={props.onOpenRecent}>
                <LuFolderOpen />
                <Text ml="2">Abrir recientes</Text>
              </Menu.Item>
              <Menu.Item value="prefs" onClick={props.onOpenPreferences}>
                Preferencias
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item
                value="exit"
                color="red.300"
                _hover={{ bg: "red.900/40", color: "red.200" }}
                onClick={props.onExit}
              >
                Salir
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Portal>
      </Menu.Root>

      <BarButton icon={LuSquarePen} label="Nuevo" onClick={props.onNew} />
      <BarButton icon={LuFolderOpen} label="Abrir" onClick={props.onOpen} />
      <BarButton icon={LuSave} label="Guardar" disabled />
      <BarButton icon={LuUpload} label="Exportar" disabled />
      <BarButton icon={LuUndo2} label="Deshacer" disabled />
      <BarButton icon={LuRedo2} label="Rehacer" disabled />
      <BarButton
        icon={LuGem}
        label="Activos"
        active={props.assetsOpen}
        onClick={props.onToggleAssets}
      />
      <BarButton icon={LuBlocks} label="Extensiones" disabled />
      <BarButton icon={LuInfo} label="Acerca de" onClick={props.onOpenAbout} />
    </Flex>
  )
}
