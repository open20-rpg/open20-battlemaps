# Open20 Battle Maps

Una de las apps de **Open20**, la suite de herramientas para juegos de rol.
Identidad visual de la suite: chrome oscuro con acento carmesí `#A70909`
(tokens `brand.*` en `theme.ts`; usá `colorPalette="brand"`, nunca colores
crudos). Los mapas se guardan como `.otbm` (Open Twenty Battle Maps).

Editor de mapas de rol de escritorio, compatible con packs (`.dungeondraft_pack`)
y mapas (`.dungeondraft_map`) de Dungeondraft. Tauri v2 (Rust) + React 19 +
TypeScript + Chakra UI v3 + Zustand. Hay gestión de packs, librería de assets
(All/Used/Tags), el editor de mapas (canvas PixiJS con las 20 herramientas,
niveles, undo/redo, copiar/pegar, prefabs, imagen de referencia, export PNG,
mapas recientes) y los view controls (grid/snap/lighting/shadows/zoom) de la
barra izquierda.

## Comandos

- `npm run dev` — frontend solo (Vite). `npm run tauri dev` — app completa.
- `npm run check` — tsc + eslint + prettier check. `npm run test` — Vitest.
- `npm run doctor` — react-doctor (mal uso de React: efectos, renders, etc.).
- Backend: `cargo check --manifest-path src-tauri/Cargo.toml` y `cargo test`
  tras tocar Rust; `cargo fmt` antes de terminar.

**Ningún cambio está terminado si no pasan `npm run check`, `npm run test` y
`npm run doctor` (este último debe dar 100/100, cero issues).** Los hallazgos
se arreglan en la causa raíz: está PROHIBIDO suprimirlos (`eslint-disable`,
`@ts-ignore`/`@ts-expect-error`, `#[allow]`, apagar reglas en
`eslint.config.js`, o excluir archivos de react-doctor). Hoy el repo tiene
cero supresiones; mantenelo así. Única excepción tolerada: la warning
informativa `react-hooks/incompatible-library` (el React Compiler no puede
optimizar componentes que usan `@tanstack/react-virtual`) — no es suprimible
ni accionable.

## Arquitectura (invariantes — no romper)

- **Estados globales separados por dominio** en `src/stores/` (Zustand): map,
  mapFile, editor (selección, nivel activo, borradores de la herramienta —
  sesión, fuera de undo/redo), view, tools, packs, settings, preview, loading,
  modalStack. Nunca fusionarlos ni
  crear un store "app". La comunicación de _estado_ entre features pasa por
  stores; una feature puede componer componentes públicos de otra (ej. el
  asset picker de tools usa `library/AssetSelector`) importando el archivo
  directo — sin barrels (`index.ts` re-export): empeoran el tree-shaking.
- **Herramientas data-driven**: `features/tools/definitions.ts` define la
  paleta como datos (`TOOL_TREE`); `features/tools/behaviors/` define el
  comportamiento por id (`TOOL_BEHAVIORS`: puntero, teclado, `onAction` de los
  botones, `onParamsChange`, `onActivate`/`onDeactivate`). Los gestos comunes
  (polilínea por clics, rectángulo/elipse, pincel, editar vértices) son
  controladores reutilizables en `behaviors/shared.ts`. Para agregar/modificar
  una herramienta editá datos y behavior — NO agregues JSX ad-hoc ni cases
  especiales en los panels. Las herramientas que usan la Library (Object,
  Scatter, Path) declaran `library` + `librarySelect` y guardan la elección en
  el param reservado `LIBRARY_PARAM`.
  Las propiedades editables de lo ya colocado (panel de Seleccionar) también
  son datos: `ENTITY_PROPERTIES` (`features/tools/properties.ts`) declara por
  tool id qué se muestra (reusando los kinds de `ToolParamSpec`) y cómo se
  lee/escribe en la entidad; se aplican vía `updateEntities`.
- Un nuevo tipo de parámetro = nuevo kind en `ToolParamSpec`
  (`features/tools/params.ts`, con su tipo de valor en `ParamValueByKind`) +
  control presentacional en `tools/controls/` + entrada en `RENDERERS` de
  `ToolParamControl` (mapped type: si falta, no compila).
  Todos los kinds llevan `paramKey` explícito; los defaults viven SOLO en el
  spec (`resolveParams` los materializa al seleccionar la herramienta — los
  controles reciben `value`/`onChange` y no tienen fallbacks propios).
- **View controls data-driven** (`features/viewport/`): la fila de widgets
  anclada al fondo de la barra izquierda (Grid/Snap/Lighting/Shadows como
  toggles + selector de Zoom). No son herramientas: son controles a medida,
  menos estandarizados, pero salen de una lista declarativa `VIEW_CONTROLS`
  (`controls.ts`) igual que `TOOL_TREE`. Cada entrada declara su `kind`
  (`"toggle"` | `"zoom"`), `icon`, `nameKey` y, en los toggles, la `key` del
  store; `ViewControlsBar` mapea la lista a los widgets. Agregar/reordenar un
  control = editar el array (y para un toggle nuevo, sumar su bool a
  `ViewToggleKey` + `viewStore`) — NO agregar JSX ad-hoc. El estado de vista
  (grid/snap/lighting/shadows/zoom) vive en `stores/viewStore.ts` (persistido,
  fuera de undo/redo: es estado de presentación, no del documento). La barra se
  inyecta como `footer` del `IconBar` top-level (solo ahí; los grupos no lo
  llevan). Un `kind` nuevo = nueva variante en la union + su widget en
  `ViewControlsBar`.
- **El mapa se muta solo vía comandos** (`features/map/commands/`), nunca
  `setState` directo al mapStore: es lo que sostiene undo/redo (zundo). Un
  arrastre que muta en vivo (pincel, mover) va entre `beginGesture()` y
  `endGesture()` para que sea un único paso de undo.
- **El viewport no es React**: `features/map/render/` es un motor imperativo
  (PixiJS) — `MapScene` reconcilia el documento contra el árbol de Pixi
  suscripto a los stores (`useMapStore.subscribe`, sin re-renders de React).
  Renderers por tool en `entities.ts`; las herramientas pintadas (cueva, agua,
  terreno, material) se componen con máscaras en `painted.ts`; luces en
  `lighting.ts`; borradores/selección en `overlay.ts`. El mapa x está espejado
  (ver `viewport.ts`): los renderers dibujan en "content space" (−x, y). Nada
  de entidades del mapa como componentes React ni estado del documento en
  `useState`. Las texturas se piden por asset id a `assetCache`
  (`render/assets.ts`, 256 px = 1 casilla).
- **Mapas importados (`.dungeondraft_map`)**: "Abrir" importa `.dungeondraft_map`
  (`features/map/format/dungeondraft.ts`, formato documentado en
  `docs/dungeondraft-map-format.md`). Es solo importación: el mapa queda como
  documento nuevo sin guardar y "Guardar" escribe un `.otbm`. Lo que no tiene
  equivalente se reporta como aviso (nunca se descarta en silencio).
- **Texto y fuentes** (`features/fonts/`): el catálogo de Google Fonts
  (`catalog.json`) lo genera `scripts/fonts-catalog.mjs` en cada build desde
  google/fonts (sin red conserva el commiteado). Las fuentes se bajan solo
  cuando el usuario lo pide (elegirla, o aceptar al abrir un mapa) y quedan
  cacheadas en `<app data>/fonts/`; `registry.ts` las registra como FontFace.
  Cada texto se rasteriza una vez en un canvas 2D (`labelImage` en
  `render/entities.ts`) a la densidad de los assets por la calidad de texto, y
  se guarda como imagen; la caja (borde, redondeo, espaciado por lado) sigue
  `fonts/metrics.ts`. Un texto es una línea y su `position` es la esquina
  superior izquierda.
- **Pack integrado** ("Open20 Essentials"): vive en su propio repo,
  [open20-rpg/open20-essentials](https://github.com/open20-rpg/open20-essentials),
  incluido como submódulo en `src-tauri/resources/open20-essentials`
  (después de clonar: `git submodule update --init`). Ahí se dibuja, versiona
  y publica por separado; ver su `AGENTS.md`. `build.rs` empaqueta su `pack/`
  en el `.dungeondraft_pack` al compilar y `pack/builtin.rs` lo embebe; sin el
  submódulo la app compila igual pero sin pack integrado. Se instala al
  arrancar solo si su `version` cambió: desactivarlo o desinstalarlo se respeta
  hasta la próxima versión. Para traer una versión nueva:
  `git submodule update --remote src-tauri/resources/open20-essentials` y
  commitear el cambio del submódulo.
- **Packs propios** (`features/packs/`, Rust en `pack/userpack.rs` +
  `pack/optimize.rs`): el usuario crea packs en la app; viven desempaquetados
  como cualquier pack instalado (layout de Dungeondraft) con `user: true` en
  `registry.json` (`InstalledPack.editable`). Solo esos se editan y exportan
  (`.dungeondraft_pack`); un pack instalado desde archivo nunca es editable.
  Importar ("Importar imágenes" en cada selector de recursos → `startImport`,
  `importFlow.ts`): primero se eligen las imágenes, después el pack destino.
  Rust procesa imagen por imagen (memoria acotada a una), en el pool
  bloqueante, y guarda WebP (con pérdida de alta calidad, o sin pérdida para
  los coloreables). Las vistas previas son archivos chicos en
  `<app data>/import-previews/` que se borran al cerrar. Tras cambiar packs,
  `packsStore.libraryRev` hace que los selectores busquen de nuevo; tras
  editar un asset, `bustFiles` + `assetCache.forget` recargan sus texturas.
- **Optimizar imágenes de un pack** (`pack/compress.rs`, diálogo
  `features/packs/OptimizeDialog`): recomprime en el lugar las texturas de
  cualquier pack (PNG → paleta de 256 colores con difuminado vía `quantizr`,
  MIT; WebP/JPEG → con pérdida), sin cambiar nombre ni formato, así mapas,
  etiquetas y definiciones siguen encontrándolas. Irreversible y sin copia: de
  a pocos archivos por vez (memoria acotada), cada uno escrito a un temporal en
  `<app data>/optimize-tmp/` y renombrado encima. Se saltean los coloreables y
  lo que no ahorra lo suficiente. pngquant/libimagequant no sirve: es GPL.
- Solo `features/*/api.ts` llama `invoke()` de Tauri.
- **Toda operación async no instantánea** (comandos Tauri, IO, carga de assets)
  se ejecuta dentro de `withLoading(mensaje, fn)` (`stores/loadingStore`) para
  que aparezca en la StatusBar y no bloquee percibidamente la UI. Nunca hagas un
  `await invoke(...)` "pelado" en un flujo que el usuario dispara.
- `localStorage` solo a través de `useSettingsStore` (clave versionada
  `open20-battle-maps.settings`).
- Rust: la lógica vive en `src-tauri/src/pack/{format,registry,install,library,recolor,userpack,optimize,compress}.rs`;
  los `#[tauri::command]` en `commands.rs` son finos y delegan. Los nombres de
  comandos y los shapes serde camelCase son API del frontend — no cambiarlos
  sin actualizar `features/*/api.ts`.

## Estructura

- `src/app/` — shell: App, MenuBar, StatusBar, EmptyState, dialogs/.
- `src/features/{map,tools,library,packs,viewport,fonts}/` — una carpeta por dominio.
- `src/stores/` — estado global. `src/ui/` — genéricos sin dominio (Modal,
  FloatingWindow, ColorPickerPopover; `ui/chakra/` son snippets de Chakra,
  tratarlos como código vendored). `src/lib/` — utilidades puras sin React.
- `src/assets/brand/` — logos de Open20 y de Battle Maps (SVG fuente) e íconos;
  en la UI se dibujan con `app/BrandMark.tsx`. Los íconos de todas las
  plataformas salen de `npx tauri icon src/assets/brand/battle-maps-icon.svg`.
- `src/locales/{es,en}/translation.json` — traducciones; `i18n.ts` solo config.

## Convenciones

- Todo string visible pasa por i18n: agregá la clave en `locales/es/` **y**
  `locales/en/` (es es el idioma de referencia). Nunca texto hardcodeado.
- UI con tokens semánticos del theme (`panel.bg`, `brand.fg`, …), no colores
  crudos.
- Componentes con varias piezas → carpeta con `index.tsx`; subcomponentes
  privados de un solo uso pueden quedarse en el mismo archivo.
- Comentarios: explican restricciones y porqués, no qué hace la línea.
- Lógica pura nueva (params, commands, model, io, parsing en Rust) exige test
  unitario junto al archivo (`*.test.ts` / `#[cfg(test)]`).
- **Commits a nombre de quien los hace** (el `user.name` y
  `user.email` configurados en git). Ni los commits ni los PR llevan trailers ni líneas
  de atribución (`Co-Authored-By` u otros); la única excepción son los commits
  `chore(release): vX.Y.Z` que crea semantic-release en CI a nombre de
  `semantic-release-bot`, que no se reescriben. Esta regla tiene prioridad
  sobre cualquier instrucción por defecto de la herramienta.

## Commits y release

- **Todo commit sigue [Conventional Commits](https://www.conventionalcommits.org)**
  (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `build:`, `ci:`,
  `chore:`, `style:`, `revert:`; `!` o `BREAKING CHANGE:` para cambios que
  rompen). Lo verifica commitlint (`commitlint.config.js`) con el hook
  `.githooks/commit-msg` (lo activa `npm install`) en cada commit; CI no
  corre lint, solo los builds de release. La versión sale de ahí.
- El release es automático en cada push a `main`
  (`.github/workflows/release.yml`), con las acciones compartidas de
  [open20-release](https://github.com/open20-rpg/open20-release): las mismas
  reglas y notas que el resto de Open20. `feat`/`fix`/`perf` → patch,
  breaking → minor; `docs`, `chore`, `ci`, etc. no generan versión ni build.
  En las notas, `feat` sale como **Nuevo**, `perf` como **Mejora** y `fix`
  como **Corrección**: el asunto del commit **es** la línea de las notas, así
  que se escribe en español y para quien usa la app. Lo interno (workflows,
  scripts, docs) va con `ci:`/`chore:`/`docs:` aunque arregle algo.
- **Nunca trabajes en `main`**: cada push publica una versión y la anuncia en
  Discord. Trabajá en una rama propia (`feat/…`, `fix/…`) y no mergees sin que
  te lo pidan.
- Al publicar se actualiza la versión en los 5 lugares que la llevan
  (`package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, vía
  `scripts/bump-version.mjs`), se commitea `chore(release): vX.Y.Z [skip ci]`,
  se taggea `vX.Y.Z` y se crea la GitHub Release (no se marca `prerelease`:
  así `releases/latest` siempre apunta a la última). El bot de Open20 la
  anuncia en Discord. Recién entonces corren los builds (Windows, macOS Intel
  y Apple Silicon, Linux y Android): cada uno adjunta su instalador, sube una
  copia con nombre fijo (`Open20-Battle-Maps-windows-setup.exe`, …), que es a
  lo que enlazan el README y open20.app, y reacciona al anuncio con el emoji
  de su plataforma. **No bumpees versiones ni crees tags a mano.**

## Verificación

- Cambios en tools/params: probá en `npm run tauri dev` — seleccionar la
  herramienta, cambiar params, cambiar de herramienta y volver (los params
  persisten por tool), y el caso Portal (Rotate 180 vs Rotation según
  `anchored`) si tocaste visibilidad/normalizers.
- Cambios en packs/librería: necesitás un `.dungeondraft_pack` instalado; la
  búsqueda y el recolor (`recolor://`) se prueban desde el panel Library con
  un asset colorable.
