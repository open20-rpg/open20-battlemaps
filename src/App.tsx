import { useState } from "react"
import {
  Box,
  Button,
  Dialog,
  Flex,
  Icon,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { LuGem, LuMap } from "react-icons/lu"
import { MenuBar } from "./components/MenuBar"
import { AssetsManager } from "./components/AssetsManager"
import { Toaster, toaster } from "./components/ui/toaster"

const APP_VERSION = "0.1.0"

export default function App() {
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const notImplemented = (label: string) =>
    toaster.create({ title: `${label}: próximamente`, type: "info" })

  return (
    <Flex direction="column" h="100vh" bg="app.bg">
      <MenuBar
        assetsOpen={assetsOpen}
        onToggleAssets={() => setAssetsOpen((v) => !v)}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenRecent={() =>
          toaster.create({ title: "No hay archivos recientes", type: "info" })
        }
        onExit={() => getCurrentWindow().close()}
        onNew={() => notImplemented("Nuevo mapa")}
        onOpen={() => notImplemented("Abrir mapa")}
      />

      {/* Empty editor canvas placeholder */}
      <Box flex="1" position="relative" overflow="hidden">
        <Flex
          direction="column"
          align="center"
          justify="center"
          h="full"
          color="fg.muted"
          gap="4"
          css={{
            backgroundImage:
              "linear-gradient(#1c1c20 1px, transparent 1px), linear-gradient(90deg, #1c1c20 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        >
          <Icon as={LuMap} boxSize="16" opacity={0.35} />
          <Stack gap="1" align="center">
            <Text fontSize="lg" fontWeight="medium">
              OpenDraft
            </Text>
            <Text fontSize="sm">
              Creá o abrí un mapa para empezar. Gestioná tus paquetes desde{" "}
              <b>Activos</b>.
            </Text>
          </Stack>
          <Button
            variant="subtle"
            colorPalette="blue"
            onClick={() => setAssetsOpen(true)}
          >
            <LuGem />
            Abrir Activos
          </Button>
        </Flex>

        {assetsOpen && <AssetsManager onClose={() => setAssetsOpen(false)} />}
      </Box>

      {/* Preferences dialog */}
      <Dialog.Root
        open={prefsOpen}
        onOpenChange={(e) => setPrefsOpen(e.open)}
        placement="center"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="panel.bg" borderColor="panel.border" borderWidth="1px">
              <Dialog.Header>
                <Dialog.Title>Preferencias</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="3" color="fg.muted" fontSize="sm">
                  <Text>Tema: Oscuro (fijo)</Text>
                  <Text>
                    Más opciones de configuración estarán disponibles próximamente.
                  </Text>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button variant="subtle" onClick={() => setPrefsOpen(false)}>
                  Cerrar
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* About dialog */}
      <Dialog.Root
        open={aboutOpen}
        onOpenChange={(e) => setAboutOpen(e.open)}
        placement="center"
      >
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="panel.bg" borderColor="panel.border" borderWidth="1px">
              <Dialog.Header>
                <Dialog.Title>Acerca de OpenDraft</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="2" color="fg.muted" fontSize="sm">
                  <Text color="fg" fontWeight="semibold">
                    OpenDraft v{APP_VERSION}
                  </Text>
                  <Text>
                    Editor de mapas para juegos de rol, de código abierto e
                    inspirado en Dungeondraft.
                  </Text>
                  <Text>Compatible con paquetes .dungeondraft_pack.</Text>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button variant="subtle" onClick={() => setAboutOpen(false)}>
                  Cerrar
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      <Toaster />
    </Flex>
  )
}
