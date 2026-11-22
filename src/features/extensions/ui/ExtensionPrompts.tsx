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

function PromptDialog({ prompt }: { prompt: PendingPrompt }) {
  const { t, i18n } = useTranslation()
  const ext = useExtensionsStore((s) => s.installed[prompt.extId])
  const name = ext ? localize(ext.manifest.name, i18n.language) : prompt.extId
  const [text, setText] = useState(prompt.kind === "prompt" ? prompt.value : "")
  const answer = (v: unknown) => extensionHost.answerPrompt(prompt.id, v)
  const cancel = () =>
    answer(
      prompt.kind === "confirm" || prompt.kind === "permission" || prompt.kind === "openUrl"
        ? false
        : null,
    )
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
              {prompt.kind === "permission"
                ? t("extensions.allow")
                : prompt.kind === "openUrl"
                  ? t("extensions.openLink")
                  : t("extensions.accept")}
            </Button>
          )}
        </HStack>
      }
    >
      <Stack gap="3">
        <Text fontSize="xs" color="fg.muted">
          {t("extensions.askedBy", { name })}
        </Text>
        {prompt.kind === "confirm" && <Text>{prompt.message}</Text>}
        {prompt.kind === "prompt" && (
          <Stack gap="1">
            <Text fontSize="sm">{prompt.label}</Text>
            <Input
              autoFocus
              value={text}
              maxLength={2000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && answer(text)}
            />
          </Stack>
        )}
        {prompt.kind === "choose" && (
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
        )}
        {prompt.kind === "permission" && <PermissionLine permission={prompt.permission} />}
        {prompt.kind === "openUrl" && (
          <Text fontSize="sm" wordBreak="break-all" fontFamily="mono">
            {prompt.url}
          </Text>
        )}
      </Stack>
    </Modal>
  )
}
