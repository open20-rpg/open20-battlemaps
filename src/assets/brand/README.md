# Marca Open20

El d20 con la pared derecha abierta como una puerta, en carmesí `#A70909`.

| Archivo                                                | Uso                                                   |
| ------------------------------------------------------ | ----------------------------------------------------- |
| `open20-on-dark.svg` / `open20-on-light.svg`           | Marca de la suite Open20 (con las caras del dado)     |
| `open20-icon.svg`                                      | Ícono de Open20: la marca sobre fondo negro           |
| `battle-maps-on-dark.svg` / `battle-maps-on-light.svg` | Marca de Open20 Battle Maps (ruta hasta una X)        |
| `battle-maps-icon.svg`                                 | Ícono de la app: fuente de `npx tauri icon` y favicon |

Dentro de la app las marcas se dibujan con `src/app/BrandMark.tsx` (mismo
trazado, colores del theme). Para regenerar los íconos de todas las
plataformas: `npx tauri icon src/assets/brand/battle-maps-icon.svg --ios-color "#0b0b0c"`.
