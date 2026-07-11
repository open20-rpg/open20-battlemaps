import { useEffect, useState } from "react"
import { Box, NativeSelect, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { withLoading } from "../../../stores/loadingStore"
import { listSystemFonts } from "../api"

// System fonts don't change during a session — load once, share across mounts.
let fontsCache: string[] | null = null
let fontsPromise: Promise<string[]> | null = null

/** OS font-family selector; each option previews in its own font. */
export function FontControl({
  value,
  labelKey,
  onChange,
}: {
  value: string
  labelKey: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [fonts, setFonts] = useState<string[]>(fontsCache ?? [])

  useEffect(() => {
    if (fontsCache) return
    let cancelled = false
    if (!fontsPromise) {
      fontsPromise = withLoading(t("loading.loadingFonts"), () => listSystemFonts()).then(
        (list) => {
          fontsCache = list
          return list
        },
      )
    }
    void fontsPromise.then((list) => {
      if (!cancelled) setFonts(list)
    })
    return () => {
      cancelled = true
    }
  }, [t])

  return (
    <Box px="3" py="1.5">
      <Text mb="2" fontSize="xs" color="fg.muted">
        {t(labelKey)}
      </Text>
      <NativeSelect.Root size="sm">
        <NativeSelect.Field
          value={value}
          bg="panel.solid"
          borderColor="panel.border"
          style={{ fontFamily: value || undefined }}
          onChange={(e) => onChange(e.currentTarget.value)}
        >
          <option value="">{t("tools.fontDefault")}</option>
          {fonts.map((font) => (
            <option key={font} value={font} style={{ fontFamily: font }}>
              {font}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Box>
  )
}
