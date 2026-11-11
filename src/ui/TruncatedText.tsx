import { useRef, useState } from "react"
import { Text, type TextProps } from "@chakra-ui/react"
import { Tooltip } from "./chakra/tooltip"

/**
 * One line of text, cut with an ellipsis when it doesn't fit; hovering it
 * then shows the whole text in a tooltip (and only then: text that fits
 * shows none).
 */
export function TruncatedText({ children, ...props }: TextProps) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const cut = () => !!ref.current && ref.current.scrollWidth > ref.current.clientWidth
  return (
    <Tooltip
      content={children}
      open={open}
      onOpenChange={(e) => setOpen(e.open && cut())}
      openDelay={300}
      positioning={{ placement: "right" }}
      showArrow
    >
      <Text ref={ref} truncate {...props}>
        {children}
      </Text>
    </Tooltip>
  )
}
