import { useEffect, useEffectEvent, useRef, useState } from "react"
import { Box, Image, Text } from "@chakra-ui/react"
import { useTranslation } from "react-i18next"
import { localize, type Contribution } from "@open20/battlemaps-sdk"
import { FloatingWindow } from "../../../ui/FloatingWindow"
import {
  scopedKey,
  useExtensionsStore,
  type LiveContribution,
} from "../../../stores/extensionsStore"
import { useMapStore } from "../../../stores/mapStore"
import { extensionHost } from "../extensionsApp"
import { frameBus } from "../host"
import { SANDBOX_CSP } from "../runtime"
import { extensionIcon } from "../icons"
import { UiNodeView } from "./UiNodeView"

type Panel = LiveContribution<Extract<Contribution, { type: "panel" }>>
type FramePanel = LiveContribution<Extract<Contribution, { type: "iframePanel" }>>
type View = LiveContribution<Extract<Contribution, { type: "view" }>>

const panelKey = (c: LiveContribution) => scopedKey(c.extId, (c.contribution as { id: string }).id)

/** The open panels of every extension: declarative ones, frames and extra views. */
export function ExtensionPanels() {
  const contributions = useExtensionsStore((s) => s.contributions)
  const panels = useExtensionsStore((s) => s.panels)
  const close = (key: string) => useExtensionsStore.getState().setPanel(key, { open: false })
  return (
    <>
      {contributions.map((c) => {
        const t = c.contribution.type
        if (t === "panel") {
          const key = panelKey(c)
          return panels[key]?.open ? (
            <DeclarativePanel key={c.key} c={c as Panel} onClose={() => close(key)} />
          ) : null
        }
        if (t === "iframePanel") {
          const key = panelKey(c)
          return panels[key]?.open ? (
            <FramePanelWindow key={c.key} c={c as FramePanel} onClose={() => close(key)} />
          ) : null
        }
        if (t === "view") {
          const key = scopedKey(c.extId, `view:${c.contribution.id}`)
          return panels[key]?.open ? (
            <ViewWindow key={c.key} c={c as View} onClose={() => close(key)} />
          ) : null
        }
        return null
      })}
    </>
  )
}

function DeclarativePanel({ c, onClose }: { c: Panel; onClose: () => void }) {
  const { i18n } = useTranslation()
  const key = panelKey(c)
  const ui = useExtensionsStore((s) => s.panels[key]?.ui ?? null)
  const loadFirst = useEffectEvent(() => {
    if (ui) return
    void Promise.resolve(c.contribution.render())
      .then((tree) => useExtensionsStore.getState().setPanel(key, { ui: tree }))
      .catch(() => {})
  })
  useEffect(() => loadFirst(), [])
  return (
    <FloatingWindow
      title={localize(c.contribution.title, i18n.language)}
      icon={c.contribution.icon ? extensionIcon(c.contribution.icon) : undefined}
      initialSize={{ w: 340, h: 420 }}
      resizable
      onClose={onClose}
    >
      <Box p="3">{ui && <UiNodeView extId={c.extId} node={ui} />}</Box>
    </FloatingWindow>
  )
}

/** The theme as CSS variables for a frame (so the extension's page looks like the app). */
function themeCss(): string {
  const theme = extensionHost.hooks.theme?.() ?? { mode: "dark", tokens: {} }
  const vars = Object.entries(theme.tokens)
    .filter(([k, v]) => /^[\w-]+$/.test(k) && /^[\w\s#(),.%-]+$/.test(v))
    .map(([k, v]) => `--open20-${k}: ${v};`)
    .join(" ")
  return `:root { color-scheme: ${theme.mode}; ${vars} } body { margin: 0; font-family: system-ui, sans-serif; background: var(--open20-panel-bg, #1e1e1e); color: var(--open20-fg, #eee); }`
}

/**
 * An extension's own HTML page: a sandboxed frame (opaque origin, no
 * network, no access to the app) whose only channel is postMessage, checked
 * to come from that very frame.
 */
function FramePanelWindow({ c, onClose }: { c: FramePanel; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const ref = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const key = panelKey(c)
  useEffect(() => {
    let alive = true
    extensionHost.services
      .readFile(c.extId, c.contribution.html)
      .then((bytes) => {
        if (!alive) return
        const page = new TextDecoder().decode(bytes)
        const head = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP.replace("style-src 'none'", "style-src 'unsafe-inline'").replace("img-src 'none'", "img-src data: blob:")}"><style>${themeCss()}</style>`
        setHtml(page.includes("<head>") ? page.replace("<head>", `<head>${head}`) : head + page)
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [c.extId, c.contribution.html])
  const onMessage = useEffectEvent((e: MessageEvent) => {
    if (e.source !== ref.current?.contentWindow) return
    const fn = c.contribution.onMessage
    if (fn) void Promise.resolve(fn(e.data)).catch(() => {})
    extensionHost
      .connection(c.extId)
      ?.emit("ui.frameMessage", { panel: c.contribution.id, message: e.data })
  })
  useEffect(() => {
    const listener = (e: MessageEvent) => onMessage(e)
    window.addEventListener("message", listener)
    frameBus.listeners.set(key, (message) => ref.current?.contentWindow?.postMessage(message, "*"))
    return () => {
      window.removeEventListener("message", listener)
      frameBus.listeners.delete(key)
    }
  }, [key])
  return (
    <FloatingWindow
      title={localize(c.contribution.title, i18n.language)}
      icon={c.contribution.icon ? extensionIcon(c.contribution.icon) : undefined}
      initialSize={{ w: 420, h: 480 }}
      resizable
      onClose={onClose}
    >
      {error ? (
        <Text p="3" color="danger.fg">
          {t("extensions.frameError")}
        </Text>
      ) : (
        html !== null && (
          <iframe
            ref={ref}
            title={localize(c.contribution.title, i18n.language)}
            sandbox="allow-scripts"
            srcDoc={html}
            style={{ border: 0, width: "100%", height: "100%" }}
          />
        )
      )}
    </FloatingWindow>
  )
}

/**
 * An extra read-only view of the map (a players' screen): a picture of the
 * map with what the view hides left out and, with fog, only what was
 * revealed. Redrawn when the map changes.
 */
function ViewWindow({ c, onClose }: { c: View; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const map = useMapStore((s) => s.map)
  const fog = useExtensionsStore((s) => s.overlays[scopedKey(c.extId, `fog:${c.contribution.id}`)])
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!map) return
    let alive = true
    let url: string | null = null
    const timer = setTimeout(() => {
      void extensionHost.hooks
        .renderToImage?.({ format: "jpeg", pxPerTile: 32 })
        .then((bytes) => {
          if (!alive) return
          url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/jpeg" }))
          setSrc(url)
        })
        .catch(() => {})
    }, 400)
    return () => {
      alive = false
      clearTimeout(timer)
      if (url) URL.revokeObjectURL(url)
    }
  }, [map])
  const revealed = fog?.primitives ?? []
  return (
    <FloatingWindow
      title={localize(c.contribution.title, i18n.language)}
      initialSize={{ w: 520, h: 420 }}
      resizable
      onClose={onClose}
    >
      <Box position="relative" w="full" h="full" bg="black">
        {src ? (
          <Image src={src} alt={t("extensions.viewAlt")} w="full" h="full" objectFit="contain" />
        ) : (
          <Text p="3" color="fg.muted">
            {t("extensions.viewLoading")}
          </Text>
        )}
        {c.contribution.fog && map && (
          <svg
            viewBox={`0 0 ${map.width} ${map.height}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            aria-hidden
          >
            <defs>
              <mask id={`fog-${c.key}`}>
                <rect width={map.width} height={map.height} fill="white" />
                {revealed.map((p, i) =>
                  p.type === "path" ? (
                    // Map x is mirrored on screen.
                    <polygon
                      key={i}
                      points={p.points.map((q) => `${map.width - q.x},${q.y}`).join(" ")}
                      fill="black"
                    />
                  ) : null,
                )}
              </mask>
            </defs>
            <rect width={map.width} height={map.height} fill="black" mask={`url(#fog-${c.key})`} />
          </svg>
        )}
      </Box>
    </FloatingWindow>
  )
}
