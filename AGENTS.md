# OpenDraft

Clon de Dungeondraft: editor de mapas de rol de escritorio. Tauri v2 (Rust) +
React 19 + TypeScript + Chakra UI v3 + Zustand. Compatible con packs
`.dungeondraft_pack`. Hay gestión de packs, librería de assets (All/Used/Tags),
el editor de mapas (canvas PixiJS con las 20 herramientas, niveles, undo/redo,
copiar/pegar, prefabs, imagen de referencia, export PNG, mapas recientes) y los
view controls (grid/snap/lighting/shadows/zoom) de la barra izquierda.

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
- Solo `features/*/api.ts` llama `invoke()` de Tauri.
- **Toda operación async no instantánea** (comandos Tauri, IO, carga de assets)
  se ejecuta dentro de `withLoading(mensaje, fn)` (`stores/loadingStore`) para
  que aparezca en la StatusBar y no bloquee percibidamente la UI. Nunca hagas un
  `await invoke(...)` "pelado" en un flujo que el usuario dispara.
- `localStorage` solo a través de `useSettingsStore` (clave versionada
  `opendraft.settings`).
- Rust: la lógica vive en `src-tauri/src/pack/{format,registry,install,library,recolor}.rs`;
  los `#[tauri::command]` en `commands.rs` son finos y delegan. Los nombres de
  comandos y los shapes serde camelCase son API del frontend — no cambiarlos
  sin actualizar `features/*/api.ts`.

## Estructura

- `src/app/` — shell: App, MenuBar, StatusBar, EmptyState, dialogs/.
- `src/features/{map,tools,library,packs,viewport}/` — una carpeta por dominio.
- `src/stores/` — estado global. `src/ui/` — genéricos sin dominio (Modal,
  FloatingWindow, ColorPickerPopover; `ui/chakra/` son snippets de Chakra,
  tratarlos como código vendored). `src/lib/` — utilidades puras sin React.
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
  `user.email` configurados en git). No agregues trailers de co-autoría ni de asistentes
  (`Co-Authored-By` u otros).
- Nunca trabajes en worktrees, siempre sobre la rama principal.
- **Nunca hagas `git commit` ni `git push` sin permiso explícito para ese
  cambio puntual** — ni siquiera en tareas que impliquen git de por sí (bump
  de versión, releases, fixes ya verificados). Dejá el cambio hecho y sin
  commitear, y pedí confirmación antes de commitear/pushear.

## Release

Sin CHANGELOG ni versionado semántico estricto (todo bump es de patch,
`0.1.x`, mientras no se llegue a 1.0). Pasos, en orden:

1. Incrementar la versión en los 5 lugares que la llevan: `package.json`,
   `package-lock.json` (`version` de nivel superior y de `packages[""]`),
   `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
   (entrada `name = "opendraft"`). Los 5 valores deben coincidir siempre.
2. Verificar (`npm run typecheck` y `cargo check --manifest-path
src-tauri/Cargo.toml` alcanza; no hace falta correr la suite completa solo
   para el bump).
3. Commitear solo esos 5 archivos: `chore: bump version to X.Y.Z`.
4. Taggear ese commit como `vX.Y.Z` y pushear la rama **y** el tag
   (`git push origin main && git push origin vX.Y.Z`).
5. El push del tag dispara `.github/workflows/release.yml`, que compila
   Windows/Linux/macOS (Intel+ARM)/Android y crea la GitHub Release (siempre
   `prerelease: true` mientras no haya versión 1.0 estable) con los
   instaladores adjuntos — no hay paso manual de "crear la release en
   GitHub", lo hace el workflow.

## Verificación

- Cambios en tools/params: probá en `npm run tauri dev` — seleccionar la
  herramienta, cambiar params, cambiar de herramienta y volver (los params
  persisten por tool), y el caso Portal (Rotate 180 vs Rotation según
  `anchored`) si tocaste visibilidad/normalizers.
- Cambios en packs/librería: necesitás un `.dungeondraft_pack` instalado; la
  búsqueda y el recolor (`recolor://`) se prueban desde el panel Library con
  un asset colorable.
