# @open20/battlemaps-sdk

Crea extensiones seguras para Open20 Battle Maps. Cada extensión corre aislada
y solo puede usar los permisos que el usuario le concedió.

```ts
import { defineExtension } from "@open20/battlemaps-sdk"

export default defineExtension({
  async activate(ctx) {
    await ctx.ui.command({
      id: "hola",
      title: { es: "Hola", en: "Hello" },
      run: () => ctx.ui.notify("¡Hola!"),
    })
  },
})
```

- `ctx`: la API, agrupada por área (`map`, `editor`, `tools`, `render`, `ui`,
  `library`, `packs`, `files`, `folder`, `net`, `services`, `views`,
  `storage`, `settings`…). Ver `src/runtime.ts`.
- `@open20/battlemaps-sdk/testing`: `createTestHost`, para probar la extensión
  sin la app.
- `@open20/battlemaps-sdk/geometry`, `/random`, `/color`: utilidades puras.
- `cli/otbx.mjs`: `create`, `validate` y `build` (empaqueta en `.otbx`).

El diseño completo, los permisos y el estado de cada capacidad están en
[`docs/extensions-sdk.md`](../docs/extensions-sdk.md).
