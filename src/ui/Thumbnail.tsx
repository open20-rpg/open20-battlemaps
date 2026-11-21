import { Box, Icon, Image, type BoxProps } from "@chakra-ui/react"
import { LuMap } from "react-icons/lu"

/**
 * A map's small picture, cropped to fill its box; a map icon in its place
 * when there's none (maps saved before they carried one).
 */
export function Thumbnail({ src, ...box }: { src?: string | null } & BoxProps) {
  return (
    <Box
      bg="panel.header"
      borderRadius="md"
      overflow="hidden"
      display="flex"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      {...box}
    >
      {src ? (
        <Image src={src} alt="" w="full" h="full" objectFit="cover" draggable={false} />
      ) : (
        <Icon as={LuMap} color="fg.subtle" boxSize="40%" maxW="8" maxH="8" />
      )}
    </Box>
  )
}
