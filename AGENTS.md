# OpenDraft

Clon de Dungeondraft: editor de mapas de rol de escritorio. Tauri v2 (Rust) +
React 19 + TypeScript + Chakra UI v3 + Zustand. Compatible con packs
`.dungeondraft_pack`. El editor de mapas real (canvas) todavía no existe; hoy
hay gestión de packs, librería de assets y el sistema de herramientas/params.

## Comandos

- `npm run dev` — frontend solo (Vite). `npm run tauri dev` — app completa.
- `npm run check` — tsc + eslint + prettier check. `npm run test` — Vitest.
  Corré ambos antes de terminar cualquier cambio.
- `npm run doctor` — react-doctor (mal uso de React: efectos, renders, etc.).
- Backend: `cargo check --manifest-path src-tauri/Cargo.toml` y `cargo test`
  tras tocar Rust; `cargo fmt` antes de terminar.

## Arquitectura (invariantes — no romper)

- **Estados globales separados por dominio** en `src/stores/` (Zustand): map,
  tools, packs, settings, preview, loading, modalStack. Nunca fusionarlos ni
  crear un store "app". La comunicación de _estado_ entre features pasa por
  stores; una feature puede componer componentes públicos de otra (ej. el
  asset picker de tools usa `library/AssetSelector`) importando el archivo
  directo — sin barrels (`index.ts` re-export): empeoran el tree-shaking.
- **Herramientas data-driven**: `features/tools/definitions.ts` define la
  paleta como datos (`TOOL_TREE`); `features/tools/behaviors/` define el
  comportamiento por id (registry, hoy vacío hasta que llegue el editor). Para
  agregar/modificar una herramienta editá datos y behavior — NO agregues JSX
  ad-hoc ni cases especiales en los panels.
- Un nuevo tipo de parámetro = nuevo kind en `ToolParamSpec`
  (`features/tools/params.ts`, con su tipo de valor en `ParamValueByKind`) +
  control presentacional en `tools/controls/` + case en `ToolParamControl`.
  Todos los kinds llevan `paramKey` explícito; los defaults viven SOLO en el
  spec (`resolveParams` los materializa al seleccionar la herramienta — los
  controles reciben `value`/`onChange` y no tienen fallbacks propios).
- **El mapa se muta solo vía comandos** (`features/map/commands/`), nunca
  `setState` directo al mapStore: es lo que sostiene undo/redo (zundo).
- **El futuro viewport no es React**: el documento (`features/map/model/`) se
  dibujará con un motor imperativo suscripto al store
  (`useMapStore.subscribe`). Nada de entidades del mapa como componentes React
  ni estado del documento en `useState`.
- Solo `features/*/api.ts` llama `invoke()` de Tauri.
- `localStorage` solo a través de `useSettingsStore` (clave versionada
  `opendraft.settings`).
- Rust: la lógica vive en `src-tauri/src/pack/{format,registry,install,library,recolor}.rs`;
  los `#[tauri::command]` en `commands.rs` son finos y delegan. Los nombres de
  comandos y los shapes serde camelCase son API del frontend — no cambiarlos
  sin actualizar `features/*/api.ts`.

## Estructura

- `src/app/` — shell: App, MenuBar, StatusBar, EmptyState, dialogs/.
- `src/features/{map,tools,library,packs}/` — una carpeta por dominio.
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

## Verificación

- Cambios en tools/params: probá en `npm run tauri dev` — seleccionar la
  herramienta, cambiar params, cambiar de herramienta y volver (los params
  persisten por tool), y el caso Portal (Rotate 180 vs Rotation según
  `anchored`) si tocaste visibilidad/normalizers.
- Cambios en packs/librería: necesitás un `.dungeondraft_pack` instalado; la
  búsqueda y el recolor (`recolor://`) se prueban desde el panel Library con
  un asset colorable.
