# OpenDraft

Editor de mapas de rol de escritorio, open source, compatible con los packs de
assets de Dungeondraft (`.dungeondraft_pack`). Hecho con Tauri v2 (Rust) +
React 19 + TypeScript + PixiJS.

## Qué incluye

- **Packs**: instalar, activar/desactivar y desinstalar `.dungeondraft_pack`.
- **Librería** de assets con búsqueda difusa/exacta, recoloreo de assets
  coloreables y pestañas _Todos_, _Usados_ (lo que ya está en el mapa) y
  _Etiquetas_ (tags del pack).
- **Editor** (canvas PixiJS) con las herramientas:
  - Diseño: Construcción (piso + paredes), Pared, Portal (se ancla a la pared
    y la corta), Cueva (excavar/detonar), Patrón, Techo (rápido o manual;
    a dos aguas, a cuatro aguas o buhardilla, con sombreado por sol).
  - Terreno: Pincel de terreno (biomas, ranuras de textura, Rellenar), Agua
    (pincel o formas, color profundo/poco profundo), Material, Camino.
  - Objetos: Objeto y Dispersión (rotación/escala aleatorias).
  - Efectos: Entorno (luz ambiente) y Luz.
  - Ajustes: Ajustes del mapa (estilo/color de grilla), Niveles e Imagen de
    referencia.
  - Texto, Prefabricados y Seleccionar (mover, selección por recuadro, rotar
    con `[`/`]`).
- Deshacer/rehacer, copiar/cortar/pegar, guardar/abrir `.opdr`, mapas
  recientes y exportar a PNG.

## Atajos

| Atajo                            | Acción                                |
| -------------------------------- | ------------------------------------- |
| `Ctrl+Z` / `Ctrl+Y`              | Deshacer / rehacer                    |
| `Ctrl+S` / `Ctrl+Shift+S`        | Guardar / guardar como                |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V`   | Copiar / cortar / pegar la selección  |
| `Ctrl+A`                         | Seleccionar todo el nivel             |
| `Supr`                           | Borrar la selección                   |
| `Enter` / doble clic / clic der. | Terminar una pared, camino o polígono |
| `Esc`                            | Cancelar el trazo / deseleccionar     |
| Clic derecho + arrastrar         | Borrar con los pinceles               |
| Rueda del medio / `Ctrl`+rueda   | Desplazar / zoom                      |

## Desarrollo

Requiere Node 26 (ver `.nvmrc`) y Rust estable.

```sh
npm ci
npm run tauri dev   # app completa
npm run dev         # solo el frontend (Vite)
npm run check       # tsc + eslint + prettier
npm run test        # Vitest
npm run doctor      # react-doctor
cargo test --manifest-path src-tauri/Cargo.toml
```

Las convenciones y la arquitectura están en [`AGENTS.md`](AGENTS.md).
