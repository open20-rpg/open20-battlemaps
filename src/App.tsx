import { useState } from "react"
import {
  Box,
  Button,
  Dialog,
  Flex,
  Group,
  Icon,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Trans, useTranslation } from "react-i18next"
import { LuGem, LuMap } from "react-icons/lu"
import { MenuBar } from "./components/MenuBar"
import { AssetsManager } from "./components/AssetsManager"
import { StatusBar, STATUS_BAR_HEIGHT } from "./components/StatusBar"
import { Toaster, toaster } from "./components/ui/toaster"

export default function App() {
  const { t, i18n } = useTranslation()
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const notImplemented = (label: string) =>
    toaster.create({ title: t("toast.soon", { label }), type: "info" })

  return (
    <Flex direction="column" h="100vh" pb={STATUS_BAR_HEIGHT} bg="app.bg">
      <MenuBar
        assetsOpen={assetsOpen}
        onToggleAssets={() => setAssetsOpen((v) => !v)}
        onOpenPreferences={() => setPrefsOpen(true)}
        onOpenAbout={() => setAboutOpen(true)}
        onOpenRecent={() => toaster.create({ title: t("toast.noRecent"), type: "info" })}
        onExit={() => getCurrentWindow().close()}
        onNew={() => notImplemented(t("toast.newMap"))}
        onOpen={() => notImplemented(t("toast.openMap"))}
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
              {t("canvas.title")}
            </Text>
            <Text fontSize="sm">
              <Trans i18nKey="canvas.subtitle">
                Creá o abrí un mapa para empezar. Gestioná tus paquetes desde <b>Activos</b>.
              </Trans>
            </Text>
          </Stack>
          <Button variant="subtle" colorPalette="blue" onClick={() => setAssetsOpen(true)}>
            <LuGem />
            {t("canvas.openAssets")}
          </Button>
        </Flex>

        {assetsOpen && <AssetsManager onClose={() => setAssetsOpen(false)} />}
      </Box>

      <StatusBar />

      {/* Preferences dialog */}
      <Dialog.Root open={prefsOpen} onOpenChange={(e) => setPrefsOpen(e.open)} placement="center">
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="panel.bg" borderColor="panel.border" borderWidth="1px">
              <Dialog.Header>
                <Dialog.Title>{t("prefs.title")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="4" fontSize="sm">
                  <Box>
                    <Text mb="2" color="fg.muted">
                      {t("prefs.language")}
                    </Text>
                    <Group attached>
                      <Button
                        size="sm"
                        variant={i18n.language.startsWith("es") ? "solid" : "outline"}
                        colorPalette="blue"
                        onClick={() => i18n.changeLanguage("es")}
                      >
                        Español
                      </Button>
                      <Button
                        size="sm"
                        variant={i18n.language.startsWith("en") ? "solid" : "outline"}
                        colorPalette="blue"
                        onClick={() => i18n.changeLanguage("en")}
                      >
                        English
                      </Button>
                    </Group>
                  </Box>
                  <Text color="fg.muted">{t("prefs.theme")}</Text>
                  <Text color="fg.muted">{t("prefs.more")}</Text>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button variant="subtle" onClick={() => setPrefsOpen(false)}>
                  {t("prefs.close")}
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* About dialog */}
      <Dialog.Root open={aboutOpen} onOpenChange={(e) => setAboutOpen(e.open)} placement="center">
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content bg="panel.bg" borderColor="panel.border" borderWidth="1px">
              <Dialog.Header>
                <Dialog.Title>{t("about.title")}</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body>
                <Stack gap="2" color="fg.muted" fontSize="sm">
                  <Text color="fg" fontWeight="semibold">
                    {t("about.version", { version: __APP_VERSION__ })}
                  </Text>
                  <Text>{t("about.desc")}</Text>
                  <Text>{t("about.compat")}</Text>
                </Stack>
              </Dialog.Body>
              <Dialog.Footer>
                <Button variant="subtle" onClick={() => setAboutOpen(false)}>
                  {t("prefs.close")}
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
