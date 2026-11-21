import { useEffect, useState } from "react"
import { Badge, Box, Button, Flex, Icon, SimpleGrid, Spinner, Stack, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { ask } from "@tauri-apps/plugin-dialog"
import { LuArchiveRestore, LuArrowLeft, LuDatabaseBackup, LuTrash2 } from "react-icons/lu"
import { Modal } from "../../../ui/Modal"
import { Thumbnail } from "../../../ui/Thumbnail"
import { useIsPhone } from "../../../ui/useIsPhone"
import { withLoading } from "../../../stores/loadingStore"
import { deleteBackups, listBackups, type BackupEntry, type BackupMap } from "../api"
import { groupByTime, relativeTime } from "../time"

export interface BackupsDialogProps {
  onClose: () => void
  /**
   * Opened because the app closed unexpectedly: this map's backups come
   * first, its newest one picked, with a word on why the dialog is open.
   */
  recovery?: BackupMap | null
  onRestore: (mapId: string, backup: BackupEntry) => void
}

/**
 * The automatic backups: the maps that have them, and the picked map's
 * backups as pictures grouped by when they were taken (many recent ones,
 * fewer further back — see `backups.rs`). Picking one and Restore opens
 * it. On a phone the two lists are one screen each.
 */
export function BackupsDialog({ onClose, recovery, onRestore }: BackupsDialogProps) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const [maps, setMaps] = useState<BackupMap[] | null>(null)
  const [revision, setRevision] = useState(0)
  const [pickedMap, setPickedMap] = useState<string | null>(recovery?.mapId ?? null)
  const [pickedBackup, setPickedBackup] = useState<string | null>(recovery?.backups[0]?.id ?? null)
  // A phone shows the maps or one map's backups.
  const [showBackups, setShowBackups] = useState(!!recovery)
  // Times read from one clock for the whole list.
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const load = async () => {
      const list = await withLoading(t("loading.loadingBackups"), listBackups).catch(() => [])
      if (alive) setMaps(list)
    }
    void load()
    return () => {
      alive = false
    }
  }, [revision, t])

  const { map, backup } = picked(maps ?? [], pickedMap, pickedBackup)

  const pickMap = (mapId: string) => {
    setPickedMap(mapId)
    setPickedBackup(null)
    setShowBackups(true)
  }

  const restore = (target: BackupEntry | null) => {
    if (!map || !target) return
    onClose()
    onRestore(map.mapId, target)
  }

  const deleteMap = async () => {
    if (!map) return
    const sure = await ask(t("backups.deleteBody", { name: map.backups[0].name }), {
      title: t("backups.deleteTitle"),
      kind: "warning",
      okLabel: t("backups.delete"),
      cancelLabel: t("mapFile.cancel"),
    })
    if (!sure) return
    await withLoading(t("loading.deletingBackups"), () => deleteBackups(map.mapId))
    setPickedMap(null)
    setPickedBackup(null)
    setShowBackups(false)
    setRevision((r) => r + 1)
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={t(recovery ? "backups.recoveryTitle" : "backups.title")}
      footer={
        <>
          {map && (!phone || showBackups) && (
            <Button
              variant="ghost"
              size="sm"
              color="danger.fg"
              _hover={{ bg: "danger.muted" }}
              onClick={() => void deleteMap()}
            >
              <LuTrash2 />
              {phone ? t("backups.delete") : t("backups.deleteMap")}
            </Button>
          )}
          <Box flex="1" />
          <Button variant="subtle" onClick={onClose}>
            {t("prefs.close")}
          </Button>
          <Button colorPalette="brand" disabled={!backup} onClick={() => restore(backup)}>
            <LuArchiveRestore />
            {t("backups.restore")}
          </Button>
        </>
      }
    >
      <Stack gap="4">
        {recovery && <RecoveryNote />}
        {maps === null ? (
          <Flex justify="center" py="10">
            <Spinner color="fg.muted" />
          </Flex>
        ) : maps.length === 0 || !map ? (
          <Stack align="center" gap="2" py="10" textAlign="center" color="fg.muted">
            <Icon as={LuDatabaseBackup} boxSize="8" />
            <Text fontSize="sm">{t("backups.empty")}</Text>
          </Stack>
        ) : (
          <BackupsBrowser
            maps={maps}
            map={map}
            backup={backup}
            now={now}
            phone={phone}
            showBackups={showBackups}
            onPickMap={pickMap}
            onPickBackup={setPickedBackup}
            onRestore={restore}
            onBack={() => setShowBackups(false)}
          />
        )}
      </Stack>
    </Modal>
  )
}

/**
 * The map and backup shown as picked: the ones asked for, else the first
 * map and its newest backup (so Restore is always one click away).
 */
function picked(
  maps: BackupMap[],
  mapId: string | null,
  backupId: string | null,
): { map: BackupMap | null; backup: BackupEntry | null } {
  const map = maps.find((m) => m.mapId === mapId) ?? maps[0] ?? null
  if (!map) return { map: null, backup: null }
  return { map, backup: map.backups.find((b) => b.id === backupId) ?? map.backups[0] }
}

/** Why the dialog opened by itself (the app closed unexpectedly). */
function RecoveryNote() {
  const { t } = useTranslation()
  return (
    <Flex
      gap="3"
      p="3"
      borderRadius="md"
      borderWidth="1px"
      borderColor="brand.muted"
      bg="brand.subtle"
    >
      <Icon as={LuDatabaseBackup} boxSize="5" color="brand.fg" flexShrink={0} mt="0.5" />
      <Text fontSize="sm">{t("backups.recoveryBody")}</Text>
    </Flex>
  )
}

/** The maps beside the picked map's backups; on a phone, one or the other. */
function BackupsBrowser({
  maps,
  map,
  backup,
  now,
  phone,
  showBackups,
  onPickMap,
  onPickBackup,
  onRestore,
  onBack,
}: {
  maps: BackupMap[]
  map: BackupMap
  backup: BackupEntry | null
  now: number
  phone: boolean
  showBackups: boolean
  onPickMap: (mapId: string) => void
  onPickBackup: (id: string) => void
  onRestore: (backup: BackupEntry) => void
  onBack: () => void
}) {
  const mapList = <MapList maps={maps} selected={map.mapId} now={now} onPick={onPickMap} />
  const backupList = (
    <BackupGrid
      map={map}
      selected={backup?.id ?? null}
      now={now}
      onPick={onPickBackup}
      onRestore={onRestore}
      onBack={phone ? onBack : undefined}
    />
  )
  if (phone) return showBackups ? backupList : mapList
  return (
    <Flex gap="4" h="min(520px, 60vh)">
      <Box w="250px" flexShrink={0} overflowY="auto" pr="1">
        {mapList}
      </Box>
      <Box flex="1" minW="0" overflowY="auto" pr="1">
        {backupList}
      </Box>
    </Flex>
  )
}

/** The maps that have backups, the most recently backed up first. */
function MapList({
  maps,
  selected,
  now,
  onPick,
}: {
  maps: BackupMap[]
  selected: string | null
  now: number
  onPick: (mapId: string) => void
}) {
  const { t, i18n } = useTranslation()
  return (
    <Stack gap="1">
      {maps.map((m) => {
        const newest = m.backups[0]
        return (
          <Flex
            key={m.mapId}
            as="button"
            align="center"
            gap="3"
            p="2"
            borderRadius="md"
            textAlign="left"
            bg={m.mapId === selected ? "panel.rowSelected" : undefined}
            _hover={{ bg: m.mapId === selected ? "panel.rowSelected" : "panel.rowHover" }}
            onClick={() => onPick(m.mapId)}
          >
            <Thumbnail src={newest.thumbnail} w="64px" h="44px" />
            <Box flex="1" minW="0">
              <Text fontSize="sm" fontWeight="medium" truncate>
                {newest.name}
              </Text>
              <Text fontSize="xs" color="fg.muted" truncate>
                {relativeTime(newest.createdAt, now, i18n.language)} ·{" "}
                {t("backups.count", { count: m.backups.length })}
              </Text>
            </Box>
          </Flex>
        )
      })}
    </Stack>
  )
}

/** One map's backups as pictures, grouped by when they were taken. */
function BackupGrid({
  map,
  selected,
  now,
  onPick,
  onRestore,
  onBack,
}: {
  map: BackupMap
  selected: string | null
  now: number
  onPick: (id: string) => void
  onRestore: (backup: BackupEntry) => void
  /** On a phone: back to the maps. */
  onBack?: () => void
}) {
  const { t } = useTranslation()
  const newest = map.backups[0]
  return (
    <Stack gap="4">
      <Flex align="center" gap="2">
        {onBack && (
          <Button size="xs" variant="ghost" onClick={onBack} aria-label={t("backups.maps")}>
            <LuArrowLeft />
          </Button>
        )}
        <Box minW="0">
          <Text fontWeight="semibold" truncate>
            {newest.name}
          </Text>
          {newest.sourcePath && (
            <Text fontSize="2xs" color="fg.muted" truncate>
              {newest.sourcePath}
            </Text>
          )}
        </Box>
      </Flex>
      {groupByTime(map.backups, now).map(({ group, items }) => (
        <Stack key={group} gap="2">
          <Text fontSize="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase">
            {t(`backups.group.${group}`)}
          </Text>
          <SimpleGrid templateColumns="repeat(auto-fill, minmax(130px, 1fr))" gap="3">
            {items.map((b) => (
              <BackupCard
                key={b.id}
                backup={b}
                selected={b.id === selected}
                now={now}
                onPick={() => onPick(b.id)}
                onRestore={() => onRestore(b)}
              />
            ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  )
}

/** One backup: its picture, when it was taken and whether it held unsaved changes. */
function BackupCard({
  backup,
  selected,
  now,
  onPick,
  onRestore,
}: {
  backup: BackupEntry
  selected: boolean
  now: number
  onPick: () => void
  onRestore: () => void
}) {
  const { t, i18n } = useTranslation()
  const when = new Date(backup.createdAt).toLocaleString(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  })
  return (
    <Box
      as="button"
      textAlign="left"
      borderRadius="lg"
      borderWidth="2px"
      borderColor={selected ? "brand.solid" : "panel.border"}
      bg="panel.solid"
      overflow="hidden"
      _hover={{ borderColor: selected ? "brand.solid" : "fg.subtle" }}
      onClick={onPick}
      onDoubleClick={onRestore}
    >
      <Thumbnail src={backup.thumbnail} w="full" aspectRatio={4 / 3} borderRadius="0" />
      <Stack gap="1" p="2">
        <Text fontSize="sm" fontWeight="medium" truncate>
          {relativeTime(backup.createdAt, now, i18n.language)}
        </Text>
        <Text fontSize="2xs" color="fg.muted" truncate>
          {when}
        </Text>
        <Box>
          <Badge size="xs" variant="subtle" colorPalette={backup.unsaved ? "orange" : "green"}>
            {t(backup.unsaved ? "backups.unsaved" : "backups.saved")}
          </Badge>
        </Box>
      </Stack>
    </Box>
  )
}
