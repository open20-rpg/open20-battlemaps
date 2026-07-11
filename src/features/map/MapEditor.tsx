import { Box, Image } from "@chakra-ui/react"
import mapCover from "../assets/map-placeholder.png"

/**
 * The map editor. For now it only shows a placeholder cover image; the real
 * canvas/rendering will replace this later.
 */
export function MapEditor() {
  return (
    <Box position="absolute" inset="0" bg="app.bg">
      <Image src={mapCover} alt="" draggable={false} w="100%" h="100%" objectFit="cover" />
    </Box>
  )
}
