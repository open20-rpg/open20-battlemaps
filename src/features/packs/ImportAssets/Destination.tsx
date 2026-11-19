import { Input, Text, VStack } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { Select } from "../../../ui/Select"
import { FieldLabel } from "../AdjustFields"
import { NEW_PACK, type useDestination } from "./useDestination"

/** The destination pack picker (an existing pack of the user's, or a new one, named here). */
export function DestinationField({ d }: { d: ReturnType<typeof useDestination> }) {
  const { t } = useTranslation()
  return (
    <VStack align="stretch" gap="1.5">
      <FieldLabel>{t("userPacks.destination")}</FieldLabel>
      <Select
        value={d.dest}
        items={[
          ...d.editable.map((p) => ({ value: p.id, label: p.name })),
          { value: NEW_PACK, label: t("userPacks.newPack") },
        ]}
        onChange={d.setDest}
      />
      {d.dest === NEW_PACK && (
        <Input
          size="sm"
          value={d.newName}
          placeholder={t("userPacks.packName")}
          onChange={(e) => d.setNewName(e.currentTarget.value)}
          aria-label={t("userPacks.packName")}
        />
      )}
      {d.editable.length === 0 && (
        <Text fontSize="2xs" color="fg.subtle">
          {t("userPacks.firstPackHint")}
        </Text>
      )}
    </VStack>
  )
}
