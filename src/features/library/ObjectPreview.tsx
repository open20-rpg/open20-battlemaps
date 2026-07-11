import { useEffect, useState } from "react"
import { Box, Text } from "@chakra-ui/react"
import { usePreview } from "../context/preview"

// Keep a very large preview from spilling off-screen while still honouring
// "full size" for the common (small texture) case.
const imgMax = {
  maxWidth: "min(60vw, 900px)",
  maxHeight: "calc(100vh - 140px)",
} as const

/**
 * Small standalone panel shown just to the right of the tools panel while an
 * object is hovered (mouse) or pressed (touch) in the library. Renders the
 * full-size texture — falling back to the already-loaded thumbnail until the
 * full image arrives — with the object name underneath. Sized to its content.
 */
export function ObjectPreview() {
  const { preview } = usePreview()
  const [fullLoaded, setFullLoaded] = useState(false)

  // Preload the full image via a detached Image so load detection is reliable
  // even when the browser already has it cached (a rendered <img>'s onLoad can
  // silently not fire for cached sources, leaving us stuck on the thumbnail).
  useEffect(() => {
    setFullLoaded(false)
    if (!preview) return
    const img = new Image()
    const onDone = () => setFullLoaded(true)
    img.onload = onDone
    img.src = preview.fullUrl
    if (img.complete && img.naturalWidth > 0) onDone()
    return () => {
      img.onload = null
    }
  }, [preview])

  if (!preview) return null

  const src = fullLoaded ? preview.fullUrl : preview.thumbUrl

  return (
    <Box
      position="absolute"
      left="100%"
      top="0"
      ml="2"
      mt="2"
      p="2"
      bg="panel.bg"
      borderWidth="1px"
      borderColor="panel.border"
      borderRadius="md"
      pointerEvents="none"
      zIndex="docked"
      display="inline-flex"
      flexDirection="column"
      alignItems="center"
      gap="1.5"
      maxW="min(60vw, 916px)"
    >
      <Box lineHeight="0">
        <img src={src} alt="" draggable={false} style={{ display: "block", ...imgMax }} />
      </Box>
      <Text fontSize="xs" color="fg" textAlign="center" maxW="100%" lineClamp={2}>
        {preview.name}
      </Text>
    </Box>
  )
}
