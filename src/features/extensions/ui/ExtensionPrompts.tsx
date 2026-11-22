import { useState } from "react"
import { Badge, Button, HStack, Input, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { localize, permissionRisk, type Permission } from "@open20/battlemaps-sdk"
import { Modal } from "../../../ui/Modal"
import { useExtensionsStore, type PendingPrompt } from "../../../stores/extensionsStore"
import { extensionHost } from "../extensionsApp"

/** How a permission is named and explained to the user. */
export function PermissionLine({ permission }: { permission: Permission }) {
  const { t } = useTranslation()
  const risk = permissionRisk(permission)
  const host = permission.startsWith("network:") ? permission.slice(8) : null
  return (
    <HStack align="start" gap="2">
      <Badge
        colorPalette={risk === "high" ? "red" : risk === "medium" ? "orange" : "gray"}
        flexShrink={0}
      >
        {t(`extensions.risk.${risk}`)}
      </Badge>
      <Text fontSize="sm">
        {host
          ? t("extensions.permissions.network", { host })
          : t(`extensions.permissions.${permission.replace(":", "_")}`)}
      </Text>
    </HStack>
  )
}

/** The questions extensions ask, one at a time, attributed to the extension. */
export function ExtensionPrompts() {
  const prompt = useExtensionsStore((s) => s.prompts[0])
  if (!prompt) return null
  return <PromptDialog key={prompt.id} prompt={prompt} />
}

/** What cancelling a prompt answers: "no" to yes/no questions, nothing to the rest. */
const cancelValue = (p: PendingPrompt) =>
  p.kind === "confirm" || p.kind === "permission" || p.kind === "openUrl" ? false : null

/** The i18n key of a prompt's accept button. */
const acceptKey = (p: PendingPrompt) =>
  p.kind === "permission"
    ? "extensions.allow"
    : p.kind === "openUrl"
      ? "extensions.openLink"
      : "extensions.accept"

function PromptDialog({ prompt }: { prompt: PendingPrompt }) {
  const { t, i18n } = useTranslation()
  const ext = useExtensionsStore((s) => s.installed[prompt.extId])
  const name = ext ? localize(ext.manifest.name, i18n.language) : prompt.extId
  const [text, setText] = useState(prompt.kind === "prompt" ? prompt.value : "")
  const answer = (v: unknown) => extensionHost.answerPrompt(prompt.id, v)
  const cancel = () => answer(cancelValue(prompt))
  const title =
    prompt.kind === "permission"
      ? t("extensions.askPermission", { name })
      : prompt.kind === "openUrl"
        ? t("extensions.openUrlTitle", { name })
        : prompt.title
  return (
    <Modal
      open
      onClose={cancel}
      closeOnBackdrop={false}
      size="sm"
      title={title}
      footer={
        <HStack justify="flex-end">
          <Button variant="ghost" onClick={cancel}>
            {t("extensions.cancel")}
          </Button>
          {prompt.kind !== "choose" && (
            <Button
              colorPalette={prompt.kind === "confirm" && prompt.danger ? "red" : "brand"}
              onClick={() => answer(prompt.kind === "prompt" ? text : true)}
            >
              {t(acceptKey(prompt))}
            </Button>
          )}
        </HStack>
      }
    >
      <Stack gap="3">
        <Text fontSize="xs" color="fg.muted">
          {t("extensions.askedBy", { name })}
        </Text>
        <PromptBody prompt={prompt} text={text} setText={setText} answer={answer} />
      </Stack>
    </Modal>
  )
}

/** What the prompt asks, by kind. */
function PromptBody({
  prompt,
  text,
  setText,
  answer,
}: {
  prompt: PendingPrompt
  text: string
  setText: (v: string) => void
  answer: (v: unknown) => void
}) {
  switch (prompt.kind) {
    case "confirm":
      return <Text>{prompt.message}</Text>
    case "prompt":
      return (
        <Stack gap="1">
          <Text fontSize="sm">{prompt.label}</Text>
          <Input
            autoFocus
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && answer(text)}
          />
        </Stack>
      )
    case "choose":
      return (
        <Stack gap="1">
          {prompt.options.map((o) => (
            <Button
              key={o.id}
              variant="outline"
              justifyContent="flex-start"
              onClick={() => answer(o.id)}
            >
              {o.label}
            </Button>
          ))}
        </Stack>
      )
    case "permission":
      return <PermissionLine permission={prompt.permission} />
    case "openUrl":
      return (
        <Text fontSize="sm" wordBreak="break-all" fontFamily="mono">
          {prompt.url}
        </Text>
      )
  }
}
