# SDK de extensiones de Open20 Battle Maps

Las extensiones agregan capacidades a la app sin poder dañarla. A diferencia de
los mods de Dungeondraft, que ejecutaban código de Godot con acceso a todo,
una extensión de Battle Maps corre **aislada** y solo puede hacer lo que el
usuario le permite.

- SDK: `sdk/` (paquete `@open20/battlemaps-sdk`).
- Host dentro de la app: `src/features/extensions/`, y la parte nativa en
  `src-tauri/src/extensions.rs`.
- Ejemplos con tests: `examples/extensions/`.

## Seguridad

1. **Sandbox.** Cada extensión corre en un `Worker` creado dentro de un
   `<iframe sandbox="allow-scripts">`. El iframe tiene origen opaco, así que no
   tiene cookies, almacenamiento, acceso al DOM de la app ni IPC de Tauri.
   Además tiene una CSP estricta: sin red, sin `eval`, solo `blob:` y
   WebAssembly. Antes de que corra el código, un preludio
   (`runtime.ts › WORKER_PRELUDE`) borra del worker la red, el almacenamiento y
   los canales a otros contextos.
2. **Una sola puerta.** La extensión solo puede mandar mensajes por un
   `MessagePort`, con el protocolo de `sdk/src/protocol.ts`. El host
   (`sdk/src/hostkit.ts`) chequea cada pedido contra los permisos concedidos
   *en ese momento*, así que revocar un permiso aplica de inmediato.
3. **Permisos declarados.** El manifiesto declara los permisos; el usuario
   los ve con su riesgo al instalar y puede quitarlos después. Los
   `optionalPermissions` se piden recién cuando la extensión los usa. La red
   es `network:<host exacto>`, solo https/wss y sin comodines.
4. **Todo es dato.** Las extensiones no tocan React ni Pixi. Mandan
   herramientas, primitivas, estilos, GLSL y árboles de UI declarativa, y el
   host los dibuja con los componentes de la app. Los SVG se sanitizan y se
   dibujan como máscara; los iframes de UI van aislados igual que el worker.
5. **El mapa cambia solo con comandos.** Los `MapOp` se aplican con funciones
   puras (`ops.ts`) y se confirman como **un solo paso de undo**. Una
   extensión solo escribe sus propios datos (`entity.ext[<id>]`) y solo crea
   entidades de sus propios tipos.
6. **Límites.** Hay tope de contribuciones, de primitivas, de ops por pedido,
   de tamaño de shaders e imágenes y de almacenamiento (10 MB). Los callbacks
   tienen timeout y `activate` también (15 s). Todo lo que la extensión pide,
   y lo que se le niega, queda en su registro de actividad.
7. **Nativo acotado.** Los comandos Rust validan ids y rutas (sin `..`, sin
   rutas absolutas, sin seguir links) y solo permiten https, aunque el host ya
   lo haya chequeado antes.

**Verificado en un navegador real** (`npm run extensions:build && npm run
sandbox:check`, Chromium): el ejemplo `tint` empaquetado activa y registra sus
contribuciones. Una extensión hostil queda bloqueada en `fetch`, XHR,
WebSocket, `importScripts`, IndexedDB, caches, BroadcastChannel, workers
anidados, `eval`, `new Function`, `import()` (remoto y de blob), `document`,
`parent` y `__TAURI_INTERNALS__`. Solo puede usar WebAssembly, que está
permitido a propósito. Falta repetir la prueba en los WebViews de cada
plataforma (WebKitGTK, WKWebView, WebView2, Android).

## Manifiesto y paquete

Un paquete `.otbx` es un zip con `manifest.json` en la raíz. Ver `Manifest`
en `sdk/src/manifest.ts`:

- `id` (`autor.nombre`), `name`, `version`, `author`, `license`, `homepage`,
  `issues` (lo usa el botón «Reportar un problema»).
- `engines.battlemaps`: rango de la API. Hoy la API es `1.0.0`.
- `main`: un único script, normalmente el bundle de `src/main.ts`. Sin
  `main`, la extensión es **solo de datos**: no ejecuta código y no puede
  pedir permisos.
- `permissions`, `optionalPermissions`, `dependencies` (servicios de otras
  extensiones).
- `activation`: `onStartup` (es el valor si no se indica nada), `onMapOpen`,
  `onFile:<ext>`, y `onTool:` / `onCommand:`, que arrancan cuando la app queda
  ociosa después de abrir.
- `contributes`: locales, idiomas, esquemas de atajos, presets de
  herramientas, de luz y de post-proceso, paletas, prefabs, plantillas
  `.otbm`, tamaños de mapa, fuentes (con licencia), shaders, carpeta de assets
  y ajustes con su esquema.

## Para empezar

```sh
node sdk/cli/otbx.mjs create mi-extension autor.mi-extension
# editar mi-extension/src/main.ts, probar con vitest y @open20/battlemaps-sdk/testing
node sdk/cli/otbx.mjs build mi-extension --out dist-extensions
```

En la app: Extensiones › Gestionar extensiones › **Instalar** (el `.otbx`) o
**Cargar carpeta (desarrollo)**. Con una carpeta cargada, «Recargar» la vuelve
a leer.

```ts
import { defineExtension } from "@open20/battlemaps-sdk"

export default defineExtension({
  async activate(ctx) {
    await ctx.tools.register({
      id: "sello",
      name: { es: "Sello", en: "Stamp" },
      icon: "LuStamp",
      group: "objects",
      gesture: "click",
      onShape: (_t, shape) => ctx.map.add([{ kind: "object", position: shape.points[0] }]),
    })
  },
})
```

Para tests hay dos opciones:

- `createTestHost` (SDK, en memoria), para autores fuera del repo.
- `createHarness` (`src/features/extensions/testHarness.ts`), que usa el host
  y los stores reales de la app.

Los ejemplos usan las dos.

## Ejemplos

| Ejemplo | Qué muestra |
| --- | --- |
| `tint` | Propiedad «Tinte», reglas de estilo con datos, función de estilo, comando con atajo, menú contextual, modo de selección. También tiene un test con el host del SDK. |
| `dungeon-generator` | Generador con semilla, mapa nuevo, entidad paramétrica (escalera) con handles, regla de colocación, antorcha que agrega su luz, reacciones, análisis (habitaciones, transitable, camino, visibilidad). |
| `hex-grid` | Tipo de grilla, snap a esquinas, capa, servicio para otras extensiones, overlay de coordenadas, toggle de vista, puntero en la barra de estado. |
| `effects` | Shaders de entidad, post, capa y relleno, estilo de agua, lluvia y brasas, tipos de luz, imagen generada en runtime. |
| `vtt-export` | Export/import Universal VTT, perfil «Jugadores», hook de export, aviso al guardar, archivos soltados, traductor de mods de Dungeondraft, carpeta y portapapeles con permisos opcionales. |
| `stamp-tools` | Herramientas con cada gesto (clic, polilínea, pincel, rectángulo, eventos crudos con teclas y botón), puntas de pincel, distribución de Scatter, estilo de muro y de camino, regla de terreno, y todas las operaciones de mapa y editor. |
| `dm-notes` | Panel declarativo, iframe aislado, vista de jugadores con niebla, ítem de estado, tour, estadísticas, validador, diálogos y progreso, ajustes. |
| `online-tokens` | Red a un host permitido, WebSocket con permiso opcional, pestaña de la Librería, packs editables, metadatos, enlaces, preferencias, fuentes, almacenamiento, traducciones propias y el servicio de `hex-grid`. |
| `content-pack` | Solo datos: idioma (portugués), atajos, presets, paletas, prefabs, plantilla, tamaños, fuente propia (CC0), shader y assets. |

`examples/extensions/coverage.test.ts` verifica que, entre todos, los ejemplos
usen **cada método del host, cada tipo de contribución, cada tipo de
contenido** y **cada permiso**. Si se agrega uno al SDK sin usarlo en algún
ejemplo, ese test falla.

## Las capacidades y su estado

✅ funciona de punta a punta en la app · 🟡 la API existe y se prueba, pero la
integración con el core es parcial (se detalla qué falta) · ⏳ pendiente.

| # | Capacidad | API | Estado |
| --- | --- | --- | --- |
| 1–4 | Leer el mapa, selección, eventos, consultas | `ctx.map.get/query/hitTest`, `ctx.on` | ✅ |
| 5–8 | Modificar entidades, transacciones, niveles, ajustes | `ctx.map.apply` (`MapOp`) | ✅ un paso de undo |
| 9 | Datos propios por entidad, nivel y mapa | `setData`, `setLevelData`, `setMapData` | ✅ se conservan sin la extensión |
| 10–12 | Herramientas, handlers y gestos de la app | `ctx.tools.register` | ✅ |
| 13 | Propiedades en Seleccionar | `ctx.tools.properties` | ✅ |
| 14–15 | Generadores (mapa, área = selección, mapa nuevo) | `ctx.generators.register` | ✅ desde el menú Extensiones |
| 16 | Overlays | `ctx.render.setOverlay` | ✅ |
| 17 | Toggles de vista | `ctx.ui.viewToggle` | ✅ |
| 18–20 | Librería, assets propios, prefabs, plantillas, presets | `ctx.library`, `contributes` | ✅ |
| 21 | Menú y atajos | `ctx.ui.command` | ✅ |
| 22–23 | Paneles declarativos e iframe | `ctx.ui.panel/iframePanel` | ✅ |
| 24–26 | Diálogos, avisos, progreso, i18n | `ctx.ui.*`, `ctx.t` | ✅ |
| 27–29 | Formatos de import/export, pickers | `ctx.files.*` | ✅ |
| 30 | Hooks al guardar y al abrir | `ctx.files.documentHook` | ✅ avisos sin bloquear |
| 31–32 | Ajustes y almacenamiento | `ctx.settings`, `ctx.storage` | ✅ |
| 33 | Red a hosts permitidos | `ctx.net.fetch` | ✅ |
| 34 | Utilidades puras | `sdk/geometry`, `random`, `color` | ✅ |
| 35, 37, 38 | Estilos, funciones de estilo, filtros incluidos | `styleRule/styleFunction` | ✅ |
| 36 | Reglas por tipo, asset, pack, nivel o datos | `EntityMatch` | 🟡 `tags` todavía no matchea |
| 39, 41 | Shaders de entidad y de post-proceso | `render.shader/postShader` | ✅ |
| 40 | Shaders por capa | `render.layerShader` | 🟡 se registra; el render todavía no lo aplica a la capa |
| 42 | Shaders de relleno | `render.fillShader` | 🟡 se registra; las herramientas pintadas no lo ofrecen todavía |
| 43–44 | Uniforms tipados y estándar | `uniforms`, `uTime`, `uInputSize` | 🟡 faltan uniforms de textura y de mapa/grilla/luz |
| 45 | Entidades propias | `render.entityType` | ✅ |
| 46 | Capas propias | `render.layer` | 🟡 se listan; la entidad usa su `layer` |
| 47 | Bloquear luz y proyectar sombra | `blocksLight/castsShadow` | ⏳ |
| 48–49 | API estable y versión | `Entity`, `engines` | ✅ |
| 50 | Migrar datos `ext.*` | — | 🟡 a cargo de la extensión (versionando sus datos) |
| 51 | El mapa declara sus extensiones | `map.extensions` | ✅ avisa al abrir; ofrecer instalarla espera al catálogo |
| 52–55 | Grupos, links, bloqueo, orden, transformar, portapapeles | `MapOp`, `editor.copy/paste` | ✅ |
| 56–57 | Reacciones y validadores | `map.addReaction/addValidator` | ✅ mismo paso de undo, el veto deshace |
| 58 | Nombrar pasos de undo | `label` | 🟡 se acepta, pero la app no muestra historial con nombres |
| 59–62 | Herramienta, nivel, cámara, vista, cursor, puntero | `ctx.editor.*` | ✅ |
| 63 | Lápiz y táctil | `pressure/tiltX/tiltY/pointerType` | 🟡 multitouch (`touches`) siempre vale 1 |
| 64 | Menú contextual | `ui.contextMenu` | 🟡 en el menú Extensiones sobre la selección, no con clic derecho |
| 65–66 | Handles y forma de selección propios | `handles/onHandle/hitShape` | 🟡 se calculan y prueban; Seleccionar todavía no los dibuja ni arrastra |
| 67 | Proveedores de snap | `editor.snapProvider` | ✅ (se pide al mover el puntero) |
| 68 | Grillas propias | `render.gridType` | 🟡 dibujo y snap ✅; Medir no usa todavía su `distance/label` |
| 69 | Unidades del mapa | `setGrid` | 🟡 se guardan; Medir sigue en 5 pies |
| 70–73 | Assets en runtime, pestañas de Librería, packs editables, metadatos | `render.registerImage`, `library.tab`, `packs.*` | ✅ salvo `setMetadata`, que todavía no persiste en el pack |
| 74 | Mapa a imagen | `render.toImage` | ✅ |
| 75 | Tipos de luz | `render.lightType` | 🟡 se registran; la herramienta Luz no los ofrece todavía |
| 76–77 | Íconos SVG, estadísticas | `icon`, `stats.register` | ✅ (estadísticas en el menú Extensiones) |
| 78 | Soltar archivos | `files.handler.drop` | ✅ |
| 79 | Abrir tipos propios | `files.handler.open` | 🟡 `openWithHandler` existe; «Abrir» todavía no filtra esos tipos |
| 80–82 | WebSocket, enlaces, portapapeles | `net.socket`, `app.openUrl`, `clipboard` | ✅ |
| 83 | Vista de jugadores | `views.*` | 🟡 ventana flotante con niebla; falta aplicar `hide` y una ventana del sistema |
| 84 | Mapa nuevo desde un preset o generador | `newMapPreset` | ✅ (menú Extensiones) |
| 85–86 | Servicios y eventos entre extensiones | `services.*` | ✅ solo entre dependencias declaradas |
| 87 | Activación diferida | `activation` | 🟡 falta `onService:` |
| 88–89 | Limpieza al desactivar, tareas y timers | `withProgress` | ✅ |
| 90 | Límites | timeouts, cuotas | 🟡 no hay tope de memoria del worker; uno colgado se mata solo al activar |
| 91 | Revocar permisos | diálogo de extensiones | ✅ |
| 92 | Idioma y formatos | `ctx.lang`, `Intl` | ✅ |
| 93 | Atajos reasignables | `shortcutOverrides` | 🟡 se guardan con los de la app; el diálogo de atajos todavía no los lista |
| 94–97 | Modo desarrollo, host de pruebas, CLI, docs y ejemplos | `otbx`, `testing` | ✅ |
| 98–101 | Entidades paramétricas, adjuntar, reglas de colocación, semillas | | ✅ (la semilla la guarda la extensión en sus datos) |
| 102–103 | Metadatos y comportamientos de assets | `packs.metadata`, `tools.assetBehavior` | ✅ / 🟡 (ver 70–73) |
| 104 | Un pack recomienda una extensión | — | ⏳ |
| 105–106, 109 | Puntas de pincel, distribución de Scatter, reglas de terreno | `tools.*` | 🟡 se registran; las herramientas del core no las ofrecen todavía |
| 107 | Estilos de muro | `tools.wallStyle` | ✅ propiedad «Estilo» en Seleccionar |
| 108 | Estilos y ruteo de caminos | `tools.pathStyle` | 🟡 el estilo ✅; el ruteo todavía no lo usa la herramienta Camino |
| 110 | Estilos de agua | `tools.waterStyle` | 🟡 se registran |
| 111–112 | Modos de selección, buscar y reemplazar | `selectionMode`, `replaceAsset` | ✅ |
| 113–115 | Habitaciones, transitabilidad, camino, visibilidad | `ctx.analysis` | ✅ |
| 116 | Geometría avanzada en el host | `sdk/geometry` | 🟡 faltan booleanas, Voronoi y triangulación |
| 117 | Procesar imágenes en el host | — | ⏳ |
| 118, 120 | Partículas, clima | `render.particles` | ✅ con el toggle Animaciones |
| 119 | Assets animados | — | ⏳ |
| 121 | Elementos anclados al marco | `anchor: "frame"` | ⏳ |
| 122, 125 | Coordenadas, numeración, tablas del mapa | overlays, datos, paneles | ✅ por composición |
| 123–124 | Notas del DM y perfiles de export | `exportProfile` | 🟡 los perfiles se registran; el diálogo de Exportar todavía no los ofrece |
| 126 | Impresión en mosaico | `render.toImage({ area })` + `exportFormat` | ✅ posible; sin ejemplo propio |
| 127 | Hooks del export PNG | `files.exportHook` | 🟡 se registran; el export a PNG todavía no los aplica |
| 128–129 | Datos por nivel, capas con nombre | `setLevelData`, `layer` | ✅ / 🟡 sin control de visibilidad por capa |
| 130–131 | Traducir mods de Dungeondraft | `files.dungeondraftTranslator` | ✅ |
| 135–138 | Idiomas, atajos, presets y fuentes en paquetes de datos | `contributes` | ✅ |
| 139–140 | Carpeta elegida, importar imágenes a un pack | `folder.*`, `packs.importImages` | ✅ |
| 141–146 | Paleta, barra de estado, tours, ayuda, tokens del theme, accesibilidad | | ✅ (los tours apuntan a zonas fijas de la pantalla) |
| 147 | Gamepad | — | ⏳ |
| 148–149 | Permisos al usarlos, registro de actividad | | ✅ |
| 150 | Actualizaciones firmadas desde un catálogo | — | 🟡 actualizar desde archivo ✅ (vuelve a preguntar por permisos nuevos); falta el catálogo con firma |
| 151 | Créditos y «Reportar un problema» | | 🟡 en el diálogo de extensiones; «Acerca de» todavía no las lista |
| 152 | Leer preferencias | `app.preferences` | 🟡 `gridColor` todavía es fijo |

(132–134, colaboración, quedaron fuera de alcance por pedido.)

## Arquitectura del host

```text
extensión (worker en iframe aislado)
   │  postMessage (protocol.ts)
   ▼
HostConnection (hostkit.ts) ── chequeo de permisos, callbacks con timeout, eventos
   ▼
ExtensionHost (host.ts) ── stores y comandos de la app, servicios de plataforma
   ├─ ops.ts             MapOp → MapDocument, puro (un paso de undo)
   ├─ renderBridge.ts    estilos, primitivas y shaders para el render (map/render/extensionRender.ts)
   ├─ tools.ts           herramientas → TOOL_TREE + behaviors + propiedades
   ├─ manager.ts         instalar, activar, permisos, contenido de datos
   └─ tauriServices.ts   api.ts → src-tauri/src/extensions.rs
```

El estado vive en `stores/extensionsStore.ts`: instaladas, contribuciones
vivas, overlays, paneles, prompts y actividad. Los componentes de la app leen
las contribuciones de ese store.
