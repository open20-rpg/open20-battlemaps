# Open20 Battle Maps — Análisis crítico de arquitectura

*Fecha: 2026-07-11 · Versión analizada: 0.1.4 (~5.000 líneas TS/TSX + `pack.rs` de ~1.300 líneas)*

Este documento analiza la arquitectura actual, señala qué está bien y qué no, y propone
una estructura objetivo pensada para la fase que viene: el editor de mapas real. Cierra
con una propuesta concreta de `AGENTS.md` y de división de componentes en archivos.

---

## 1. Radiografía del estado actual

```
src/
├── App.tsx                  # Shell + diálogos de Preferencias/About inline (205 líneas)
├── main.tsx                 # 6 providers anidados
├── i18n.ts                  # es + en inline en un solo archivo (418 líneas)
├── theme.ts
├── components/              # 25 componentes, carpeta plana
│   ├── AssetSelector.tsx    # 620 líneas
│   ├── AssetsManager.tsx    # 586 líneas
│   ├── ToolsPanel.tsx       # 345 líneas
│   ├── *Control.tsx         # 10 controles de parámetros de herramienta
│   └── ...
├── context/                 # 6 contexts: map, tools, packs, preview, loading, modalStack
├── lib/                     # tools.ts (definiciones data-driven), packs.ts, library.ts, colors.ts, templates.ts
└── hooks/                   # useTemplates.ts

src-tauri/src/
├── lib.rs                   # registro de comandos
└── pack.rs                  # TODO el backend: formato, instalación, registry, búsqueda, recolor (44,5 KB)
```

Estado real del producto: la gestión de packs y la UI de herramientas están maduras;
`MapEditor.tsx` es todavía un placeholder (una imagen). **La decisión arquitectónica más
importante del proyecto —el modelo de documento del mapa y el motor de render— aún no
está tomada.** Ese es el contexto de todo lo que sigue: el objetivo no es solo ordenar lo
que hay, sino preparar el terreno para que el editor real no herede vicios.

---

## 2. Lo que está bien (y hay que conservar)

### 2.1 Definiciones de herramientas data-driven — la mejor decisión del proyecto

`src/lib/tools.ts` es el punto más fuerte de la base de código:

- El árbol `TOOL_TREE` describe la paleta completa (grupos, hojas, iconos, librería
  asociada, parámetros) como **datos**, no como JSX. Agregar una herramienta son ~5 líneas.
- `ToolParamSpec` es una unión discriminada de *kinds* (`layer`, `shape`, `assetPicker`,
  `slider`, …) y `ToolsPanel.tsx` la resuelve con un único `switch` a controles reutilizables.
- Los helpers (`shadow(true)`, `objectLayer(100)`, `sorting("over")`) hacen que las
  definiciones se lean como una DSL declarativa.
- `visibleWhen` (visibilidad condicionada a otros params, ej. Portal: `rotate180` vs
  `rotation` según `anchored`) y `normalizeParams` (reglas cross-field como
  `shapeVsEditPoints`, aplicadas *en la misma actualización*, sin efectos reactivos a
  posteriori) resuelven bien dos problemas que suelen degenerar en `useEffect`-spaghetti.

Esto debe conservarse y **extenderse al comportamiento** (§4.3), no solo a la UI.

### 2.2 Estados globales separados por dominio

Cada context tiene una responsabilidad clara: `map` (documento), `tools` (selección +
params), `packs` (caché de instalados), `preview`, `loading`, `modalStack`. No hay un
"AppContext" monolítico. La *separación* es correcta; el *mecanismo* (Context + `useState`)
es lo que no escala (§3.1).

### 2.3 Frontera limpia con Tauri

`lib/packs.ts` y `lib/library.ts` son las únicas piezas que conocen `invoke()`. Los
componentes consumen funciones tipadas (`installPacks`, `searchLibrary`, …). Esto hace el
frontend testeable y el IPC reemplazable. Detalles buenos: búsqueda paginada con caché en
el backend keyed por instancia de browser (varios browsers abiertos a la vez) con
`releaseLibrarySearch` al desmontar; protocolo `recolor://` con URL estable por
`(path, color)` para que el webview cachee; eventos de progreso de instalación.

### 2.4 Otras cosas correctas

- `PacksProvider` coalesciona refreshes concurrentes y muta la caché localmente
  (`addOrUpdate`/`applyEnabled`/`removePacks`) en vez de recargar de disco.
- i18n desde el día uno, con claves (`nameKey`) dentro de las definiciones de datos.
- Virtualización (`@tanstack/react-virtual`) en el selector de assets.
- Comentarios que explican *por qué* (restricciones), no *qué*.
- Cada hook de context lanza error si se usa fuera de su provider.

---

## 3. Lo que está mal (crítico, en orden de importancia)

### 3.1 Context + `useState` no va a sobrevivir al editor real

`ToolsContext` reconstruye su `value` ante **cualquier** cambio de params (el `useMemo`
depende de `paramsByTool` vía `getToolParams`). Hoy re-renderiza todo el panel de
herramientas al mover un slider; es tolerable. Pero el plan implícito es que el editor
lea `activeTool` + params en cada interacción de puntero, y que `MapDoc` deje de ser
`{width, height}` para contener miles de entidades. Con Context:

- Cada pincelada dispararía re-render de todo árbol que consuma el context (no hay
  selectores; Context es todo-o-nada).
- El historial undo/redo, la serialización y las mutaciones por lote no tienen dónde
  vivir de forma natural.
- Un render-loop de canvas **no puede** suscribirse a un Context de React desde fuera de
  React; a un store externo sí (`store.subscribe`).

**Veredicto:** la separación por dominios está bien; el mecanismo hay que migrarlo a
stores externos con selectores (Zustand es el fit natural, §4.1) *antes* de construir el
editor, no después.

### 3.2 Los defaults de parámetros viven en dos lugares y el estado real nunca los tiene

Cada `ToolParamSpec` declara `default`, pero `paramsByTool` arranca **vacío** y cada
control aplica su fallback al leer (`(getToolParams(toolId).customColor as string) || DEFAULT`,
`stored?.color ?? defaultColor`, etc.). Consecuencias:

1. **Bug latente:** cualquier consumidor que no sea el control (el futuro editor, el
   guardado del mapa, un preset de herramienta) lee `{}` hasta que el usuario toca cada
   control. El editor tendría que re-implementar la resolución de defaults.
2. Los defaults están duplicados: en el spec y en el fallback de cada control.
3. `normalizeParams` recibe params parciales, así que las reglas cross-field deben
   tolerar `undefined` en campos que "tienen default".

**Arreglo:** una única función `resolveParams(tool, stored)` que materialice los defaults
desde los specs, usada por el store como única puerta de lectura. Los controles dejan de
recibir `defaultValue`.

### 3.3 `ToolParamValues = Record<string, unknown>` — cero seguridad de tipos en el corazón del sistema

Todo acceso a params es un cast a mano (`as string`, `as AssetPickerValue | undefined`).
Las claves son strings mágicos con una convención implícita e **inconsistente**: algunos
kinds escriben bajo clave fija derivada del kind (`customColor`, `shape`, `editPoints`,
`layer`…) y otros llevan `paramKey` explícito (`switch`, `slider`, `assetPicker`). Dos
`customColor` en una misma herramienta colisionarían silenciosamente. Renombrar una clave
es un grep sin ayuda del compilador. Con 20 herramientas y 30 params esto se vuelve la
principal fuente de bugs.

**Arreglo:** mapa `kind → tipo de valor` (`ParamValueByKind`), `paramKey` obligatorio en
todos los kinds, y lectores tipados (`getParam(tool, "rotation")`). No hace falta
genericidad exótica; con un lookup por kind alcanza.

### 3.4 `pack.rs`: un archivo Rust de 44,5 KB con cinco responsabilidades

Formato binario `.dungeondraft_pack` (lectura GDPC), instalación con progreso, registry
persistente, búsqueda/caché de librería, protocolo de recolor + parsing de `pack.json`/tags…
todo junto. Es exactamente el mismo anti-patrón que una carpeta plana de componentes, pero
en el backend, y es donde va a crecer el código cuando llegue guardar/exportar mapas.

**Arreglo:** dividir en módulos (`format.rs`, `registry.rs`, `install.rs`, `library.rs`,
`recolor.rs`, `commands.rs`) manteniendo `lib.rs` como registro. Es mecánico y barato hoy;
caro en seis meses.

### 3.5 Carpeta `components/` plana sin fronteras de feature

25 archivos al mismo nivel mezclan cuatro cosas distintas: shell de la app (`MenuBar`,
`StatusBar`, `Modal`, `FloatingWindow`), sistema de herramientas (`ToolsPanel` + 10
`*Control`), librería/assets (`AssetSelector`, `AssetsManager`, `LibraryPanel`,
`ObjectPreview`) y diálogos de mapa (`NewMapDialog`). Hoy se navega; con el editor real
(canvas, capas, selección, prefabs, texto…) la carpeta plana colapsa. Además el
acoplamiento real ya es por feature: los `*Control` solo tienen sentido junto a
`tools.ts` y `context/tools`.

### 3.6 `i18n.ts` con todos los idiomas inline

418 líneas con `es` y `en` en el mismo módulo TS. Cada string nuevo toca un archivo
gigante, no hay lazy-loading, y un tercer idioma lo duplica. Además hay texto en español
hardcodeado como fallback de `<Trans>` en `App.tsx:86`. Mover a `src/locales/{es,en}/…json`
(o `public/locales` con backend HTTP) y tipar las claves con `i18next` typegen.

### 3.7 Cero red de seguridad

No hay ESLint, ni Prettier/Biome, ni un solo test, ni typecheck/lint en CI (solo
`release.yml`). Para código de UI es discutible; para lo que viene —formato binario de
mapas, undo/redo, normalización de params— es imprudente. La lógica pura ya existente
(`findToolPath`, `shapeVsEditPoints`, `formatBytes`, futura `resolveParams`) es
trivialmente testeable con Vitest.

### 3.8 Menores pero reales

- **`App.tsx` hace de cajón de sastre:** contiene los diálogos de Preferencias y About
  inline, el estado de 4 modales y la preferencia `panel-alpha` con su efecto de CSS var.
  Extraer `PreferencesDialog`, `AboutDialog`, `EmptyState`.
- **`localStorage` disperso:** una clave `panel-alpha` suelta en `App.tsx`, presets de color en
  `lib/colors.ts`. Falta un módulo `settings` único (clave, schema, migración futura).
- **`normalizeParams` re-busca la herramienta en el árbol en cada cambio**
  (`findToolPath` dentro de `setToolParams`). Trivial hoy; con un índice `Map<id, ToolLeaf>`
  construido una vez desaparece.
- **`visibleWhen`/`normalizeParams` son funciones dentro de "datos".** Es pragmático y
  está bien *hoy*, pero cierra la puerta a serializar definiciones (herramientas
  definidas en JSON por packs/mods). Si esa puerta importa, migrar a condiciones
  declarativas (`{ param: "anchored", equals: false }`). Si no importa, documentarlo como
  decisión consciente.
- **Strings mágicos de categorías** (`"tilesets"`, `"walls"`, `"portals"`…) repartidos
  entre `tools.ts`, componentes y el backend Rust sin un tipo/const compartido.

---

## 4. Arquitectura objetivo

### 4.1 Estado: stores Zustand por dominio (misma separación, mejor mecanismo)

Se conserva el principio "estados globales separados" tal cual, cambiando Context por
stores externos:

```
stores/
├── useMapStore.ts       # documento: entidades, capas, dimensiones + undo/redo (zundo)
├── useToolsStore.ts     # path de selección + paramsByTool + resolveParams
├── usePacksStore.ts     # caché de packs instalados
├── useSettingsStore.ts  # idioma, panel-alpha, presets de color (persist middleware)
└── usePreviewStore.ts   # hover-preview de la librería
```

Por qué Zustand y no Context/Redux/Jotai:

- **Selectores:** `useToolsStore(s => s.params[toolId]?.rotation)` re-renderiza solo ese
  control. Con Context, todo consumidor.
- **Lectura/suscripción fuera de React:** `useMapStore.getState()` y
  `useMapStore.subscribe(...)` son exactamente lo que necesita un render-loop de canvas.
  Este es el argumento decisivo para un editor.
- **Middleware resuelto:** `persist` (settings, presets) y `temporal`/zundo (undo/redo
  del mapa) vienen gratis.
- Sin providers: `main.tsx` deja de ser una pirámide de 6 niveles.
- Frente a Redux: sin boilerplate, mismo patrón mental que ya usan los contexts actuales.
  Frente a Jotai: el modelo "store por dominio con acciones" mapea 1:1 a lo que ya hay.

`loading` y `modalStack` pueden quedarse como contexts (son UI pura, baja frecuencia) o
migrar por uniformidad; indiferente.

**Regla de oro para `useMapStore`:** el documento se muta solo a través de **comandos**
(`addEntity`, `moveEntities`, `setTerrain`…), nunca con `set` arbitrario desde
componentes. Eso da un único punto para undo/redo, dirty-flags y (futuro) autosave.

### 4.2 El editor: React para el chrome, imperativo para el canvas

Decisión a tomar *ya*, porque condiciona todo: **el mapa no se renderiza con React.**
React maneja paneles, diálogos y overlays; el viewport es un canvas (2D o WebGL —
PixiJS es el candidato obvio dado el volumen de sprites de un mapa) manejado por una
clase/módulo imperativo que:

1. Se monta en un `<canvas>` vía un componente contenedor fino (`MapViewport.tsx`).
2. Se suscribe a `useMapStore.subscribe` para redibujar en cambios del documento.
3. Lee `useToolsStore.getState()` en los eventos de puntero y despacha al *behavior* de
   la herramienta activa (§4.3).

Nada de estado del documento en `useState`, nada de una entidad = un componente React.

### 4.3 Extender el data-driven a comportamiento: registry de behaviors

Hoy `tools.ts` define la UI de cada herramienta. Al editor le falta la otra mitad: qué
hace la herramienta sobre el mapa. Para no romper la pureza de los datos, separarlo en un
**registry paralelo indexado por id**:

```ts
// features/tools/behaviors/types.ts
export interface ToolBehavior {
  onPointerDown?(ctx: ToolCtx, e: PointerInfo): void
  onPointerMove?(ctx: ToolCtx, e: PointerInfo): void
  onPointerUp?(ctx: ToolCtx, e: PointerInfo): void
  renderOverlay?(ctx: ToolCtx, g: OverlayGfx): void   // ghost/preview del trazo
  cursor?(params: ResolvedParams): string
}
// ToolCtx: { params: ResolvedParams, map: MapCommands, viewport: ViewportInfo }

// features/tools/behaviors/index.ts
export const TOOL_BEHAVIORS: Record<string, ToolBehavior> = {
  wall: wallBehavior,
  water: waterBehavior,
  // ...
}
```

Así una herramienta nueva sigue siendo: (1) entrada en `TOOL_TREE` (datos), (2) entrada
en `TOOL_BEHAVIORS` (comportamiento), (3) claves i18n. Los behaviors comunes se componen
con helpers (`shapeDrawing(behavior)` para todo lo que usa el param `shape`, etc.), igual
que hoy se componen los param specs.

### 4.4 Estructura de carpetas objetivo: por feature, no por tipo

```
src/
├── app/                        # shell y arranque
│   ├── App.tsx                 # composición, sin lógica
│   ├── MenuBar.tsx
│   ├── StatusBar.tsx
│   ├── EmptyState.tsx          # el "creá o abrí un mapa" extraído de App
│   └── dialogs/
│       ├── PreferencesDialog.tsx
│       └── AboutDialog.tsx
├── features/
│   ├── map/                    # EL dominio central
│   │   ├── model/              # tipos del documento, entidades, capas (TS puro, sin React)
│   │   ├── commands/           # mutaciones nombradas + undo/redo
│   │   ├── io/                 # (de)serialización formato de mapa
│   │   ├── viewport/           # motor de render imperativo (Pixi/canvas), cámara, grid
│   │   ├── MapViewport.tsx     # puente React ⇄ motor
│   │   └── NewMapDialog.tsx
│   ├── tools/
│   │   ├── definitions.ts      # el actual lib/tools.ts (datos puros)
│   │   ├── params.ts           # tipos de params, resolveParams, normalizers
│   │   ├── behaviors/          # §4.3
│   │   ├── ToolsPanel.tsx      # orquestación (IconBar + GroupPanel + ParamsPanel)
│   │   ├── panels/             # IconBar.tsx, GroupPanel.tsx, ParamsPanel.tsx
│   │   └── controls/           # los 10 *Control.tsx + ToolParamControl (el switch)
│   ├── library/
│   │   ├── LibraryPanel.tsx
│   │   ├── AssetSelector/      # dividido: index.tsx, ThumbCell, ListCell, useAssetSearch
│   │   └── ObjectPreview.tsx
│   └── packs/
│       ├── AssetsManager/      # dividido: index, PackList, PackPreview, useInstall
│       └── api.ts              # el actual lib/packs.ts
├── stores/                     # §4.1
├── ui/                         # genéricos sin dominio: Modal, FloatingWindow, Tooltip,
│                               # ColorPickerPopover, toaster, provider, color-mode
├── lib/                        # utilidades puras: colors.ts, format.ts (formatBytes)
├── locales/
│   ├── es/translation.json
│   └── en/translation.json
├── i18n.ts                     # solo configuración
├── theme.ts
└── main.tsx

src-tauri/src/
├── lib.rs                      # solo registro de comandos/plugins
└── pack/
    ├── mod.rs
    ├── format.rs               # lectura del binario GDPC
    ├── registry.rs             # registry persistente de packs
    ├── install.rs              # instalación + eventos de progreso
    ├── library.rs              # búsqueda, caché, paginación
    ├── recolor.rs              # protocolo recolor:// + ColorCfg/tags
    └── commands.rs             # los #[tauri::command] (finos, delegan)
```

Reglas de dependencia (lo que hace que esto escale):

1. `features/*` puede importar de `stores`, `ui`, `lib`; **nunca de otra feature**
   (la comunicación entre features pasa por los stores — exactamente lo que hoy hace
   `preview` entre library y tools panel).
2. `map/model`, `map/commands`, `tools/definitions`, `tools/params` son **TS puro sin
   React ni Chakra**: testeables con Vitest sin DOM.
3. `ui/` no importa de `features/` ni de `stores/`.
4. Solo `features/*/api.ts` (y `map/io`) tocan `invoke()`.

### 4.5 Criterio de división de componentes en archivos

No dividir por número de líneas sino por estas señales, en orden:

1. **Más de un motivo de cambio.** `AssetsManager.tsx` (586 líneas) mezcla lista de
   packs, preview de pack, flujo de instalación con progreso y manejo de teclado: cuatro
   motivos → carpeta con 4-5 archivos.
2. **Subcomponente con estado o memo propio** (`ThumbCell`/`ListCell` en
   `AssetSelector`) → archivo propio; ya son `memo()` con contrato claro.
3. **Lógica no visual dentro del componente** (la búsqueda paginada + virtualización de
   `AssetSelector`) → hook (`useAssetSearch`) separado del render.
4. **En cambio, NO dividir** helpers privados de un solo uso (`DetailRow`, `NullCell`) ni
   crear archivos de <30 líneas por dogma: `ToolIcon` dentro de `IconBar.tsx` está bien.

Convención: componente con piezas → carpeta con `index.tsx` (público) + piezas privadas.
Un componente = un export público por archivo. Los `*Control` deberían volverse
**presentacionales** (reciben `value`/`onChange` resueltos) y dejar que `ToolParamControl`
sea el único punto que conoce el store — hoy cada control repite el patrón
`getToolParams`/`setToolParams`/fallback de default (10 veces).

### 4.6 Herramientas de calidad (mínimo viable, un día de trabajo)

- **Biome** (lint + format en una herramienta, rápido, sin ecosistema de plugins que
  mantener) o ESLint flat + Prettier si se prefiere lo estándar.
- **Vitest** con primeros tests sobre lo puro: `resolveParams`, `shapeVsEditPoints`,
  `findToolPath`, y en Rust `#[cfg(test)]` para `format.rs` (parsing del binario — lo más
  delicado que hay).
- **CI de PR:** `tsc --noEmit` + lint + vitest + `cargo check` + `cargo test`. El
  `release.yml` existente no protege nada en desarrollo.
- Scripts npm: `check`, `lint`, `test` para que humanos y agentes tengan un comando único.

---

## 5. El AGENTS.md perfecto para este proyecto

Principios: corto (se lee completo en cada sesión), **imperativo**, solo lo que no se
deduce del código, y con las invariantes del proyecto explícitas. Propuesta:

```markdown
# Open20 Battle Maps

Editor de mapas de rol de escritorio. Tauri v2 (Rust) + React 19 + TypeScript +
Chakra UI v3. Compatible con packs `.dungeondraft_pack`.

## Comandos

- `npm run dev` — frontend solo (Vite). `npm run tauri dev` — app completa.
- `npm run check` — tsc + lint. `npm run test` — Vitest. Corré ambos antes de terminar.
- Backend: `cargo check --manifest-path src-tauri/Cargo.toml` tras tocar Rust.

## Arquitectura (invariantes — no romper)

- **Estados globales separados por dominio** en `src/stores/` (Zustand): map, tools,
  packs, settings, preview. Nunca fusionarlos ni crear un store "app". La comunicación
  entre features pasa por stores, jamás por imports cruzados entre `features/*`.
- **Herramientas data-driven**: `features/tools/definitions.ts` define la paleta como
  datos (`TOOL_TREE`, `ToolParamSpec`); `behaviors/` define el comportamiento por id.
  Para agregar/modificar una herramienta editá datos y behavior — NO agregues JSX
  ad-hoc ni cases especiales en `ToolsPanel`.
- Un nuevo tipo de parámetro = nuevo kind en la unión `ToolParamSpec` + control en
  `tools/controls/` + case en `ToolParamControl`. Todos los kinds llevan `paramKey`;
  los defaults viven SOLO en el spec (los materializa `resolveParams`, los controles
  no llevan fallbacks propios).
- **El mapa se muta solo vía comandos** (`features/map/commands/`), nunca `set`
  directo al store: es lo que sostiene undo/redo.
- **El viewport no es React**: el documento se dibuja en el motor de
  `features/map/viewport/` (suscripto al store). Nada de entidades del mapa como
  componentes React ni estado del documento en `useState`.
- Solo `features/*/api.ts` y `map/io/` llaman `invoke()` de Tauri.
- Rust: la lógica vive en módulos de `src-tauri/src/pack/`; los `#[tauri::command]`
  en `commands.rs` son finos y delegan.

## Convenciones

- Todo string visible pasa por i18n: agregá la clave en `src/locales/es/` **y**
  `src/locales/en/` (es es el idioma de referencia). Nunca texto hardcodeado.
- UI con tokens semánticos del theme (`panel.bg`, `brand.fg`, …), no colores crudos.
- Componentes con piezas → carpeta con `index.tsx`; subcomponentes privados de un
  solo uso pueden quedarse en el mismo archivo.
- Preferencias de usuario/localStorage: solo a través de `useSettingsStore`.
- Comentarios: explican restricciones y porqués, no qué hace la línea.

## Verificación

- Cambios en tools/params: probá la herramienta en `npm run tauri dev` (seleccionar,
  cambiar params, cambiar de herramienta y volver — los params persisten por tool).
- Cambios en packs/librería: necesitás un `.dungeondraft_pack` instalado; la búsqueda
  y el recolor (`recolor://`) se prueban desde el panel Library con un asset colorable.
- Lógica pura (params, commands, io, formato GDPC) exige test unitario.
```

Notas sobre esta propuesta:

- Describe la arquitectura **objetivo**; si se adopta incrementalmente, el AGENTS.md se
  actualiza con cada fase (un AGENTS.md que miente es peor que ninguno).
- Lo más valioso para un agente son las **invariantes** ("no rompas X") y los flujos de
  extensión ("para agregar una herramienta hacé A+B+C"), porque es exactamente lo que no
  se infiere leyendo dos archivos.
- Deliberadamente NO incluye: tour de archivos (se descubre con búsqueda), estilo de
  código genérico (lo impone el linter), ni documentación de APIs (está en el código).

---

## 6. Plan de migración sugerido (incremental, sin big-bang)

| Fase | Trabajo | Riesgo |
|---|---|---|
| 1 | Biome/ESLint + Vitest + CI de PR + scripts `check`/`test` | Nulo |
| 2 | Partir `pack.rs` en módulos; `i18n.ts` → `locales/*.json` | Bajo (mecánico) |
| 3 | Contexts → stores Zustand (uno por PR, empezando por `tools`); introducir `resolveParams` y `paramKey` obligatorio | Medio |
| 4 | Reorganizar `src/` por features; dividir `AssetSelector`/`AssetsManager`/`ToolsPanel`; extraer diálogos de `App.tsx` | Bajo (mover + imports) |
| 5 | `map/model` + `commands` + undo/redo + `MapViewport` con motor imperativo (PixiJS) | Alto — aquí paga todo lo anterior |
| 6 | Registry de `behaviors` por herramienta | Medio |

Las fases 1–2 no bloquean nada y se pueden hacer ya. La fase 3 conviene terminarla
**antes** de escribir la primera línea del editor: es mucho más barato migrar 6 contexts
chicos hoy que desacoplar un canvas de Context mañana.

---

## 7. Resumen ejecutivo

**Bien:** definiciones de herramientas data-driven ejemplares (`TOOL_TREE` + param specs +
`visibleWhen` + `normalizeParams`), estados separados por dominio, frontera IPC limpia y
un backend de librería bien diseñado (caché por browser, recolor con URLs cacheables).

**Mal:** el mecanismo de estado (Context) no soporta el editor que viene; los defaults de
params están duplicados y el estado real nunca los contiene; params sin tipos (`unknown` +
casts + claves mágicas inconsistentes); `pack.rs` monolítico; carpeta de componentes
plana; i18n inline; y cero linter/tests/CI.

**La jugada clave:** migrar a stores con selectores y a un modelo documento+comandos
*antes* de construir el editor de mapas, y extender la filosofía data-driven del proyecto
—su mayor acierto— también al comportamiento de las herramientas.
