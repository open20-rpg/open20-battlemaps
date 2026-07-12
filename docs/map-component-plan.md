# OpenDraft — Plan del componente de mapa

*Fecha: 2026-07-12 · Estado: diseño acordado en sus puntos principales, sin implementación todavía.*

Este documento planifica el componente de mapa real (viewport + modelo de datos).
El modelo actual (`src/features/map/model/types.ts`: `MapDocument` con una lista
plana de `entities` que llevan un número de `layer`) fue un modelo de prueba y
vamos a redefinirlo por completo.

---

## 1. Requisitos

1. **Capas activables/desactivables**: cada capa puede mostrarse u ocultarse
   independientemente en el editor.
2. **Capas de naturaleza heterogénea**: no todas las capas contienen lo mismo.
   - Capas *raster*: su contenido es una imagen que se genera pintando
     (ej. terreno).
   - Capas *de entidades*: contienen elementos discretos (objetos, paths,
     muros, materiales…), cada uno con posición, rotación y parámetros.
3. **Capa de terreno (-500)**: es el fondo del mapa. El usuario pinta con las
   texturas configuradas en los slots; cada textura funciona como un pincel.
   - Las texturas se **superponen en cualquier orden**: césped → círculo de
     tierra encima → círculo de césped dentro de la tierra. No es un sistema
     de máscaras con orden fijo por slot: lo que manda es el **orden en que se
     pintó**, no el orden de los slots.
   - Los slots son **vivos**: cambiar la textura de un slot repinta todo lo
     que se pintó con ese slot (comportamiento Dungeondraft).
4. **Interactividad futura por herramienta** (no en esta fase, pero condiciona
   el diseño): con Select se seleccionan/mueven/rotan/escalan objetos, paths,
   buildings; con Building + toggle "edit paths" se arrastran los puntos del
   path del building; y así para cada tipo de entidad.

Además heredamos restricciones ya establecidas en el proyecto:

- El documento debe seguir siendo **serializable** (hoy JSON puro, sin
  funciones ni instancias) para que guardar/cargar y los snapshots de undo
  sigan siendo triviales.
- Toda mutación pasa por **comandos** (`features/map/commands/`), nunca
  `setState` directo desde componentes; zundo trackea la historia.
- Los buckets de capa estilo Godot (`MAP_LAYERS` en
  `features/tools/definitions.ts`: -500 terreno … 900 sobre techos) ya se usan
  en los params de las herramientas y conviene mantenerlos como identidad de
  capa.

---

## 2. Modelo de capas propuesto

### 2.1 La capa pasa a ser una entidad de primera clase

Hoy la "capa" es solo un número dentro de cada entidad. La propuesta es que el
documento tenga una colección de capas, y cada capa sepa qué tipo es y qué
contiene:

```ts
// Boceto conceptual, no código final
type MapLayer =
  | TerrainLayer      // raster pintado (hoy solo -500, pero el tipo lo permite en otras)
  | EntityLayer       // objetos, paths, muros, materiales…

interface LayerBase {
  id: number          // el bucket Godot: -500, -400, … 900 (identidad estable)
}

interface EntityLayer extends LayerBase {
  kind: "entities"
  entities: MapEntity[]   // orden del array = z-order dentro de la capa
}

interface TerrainLayer extends LayerBase {
  kind: "terrain"
  // ver §3 para el contenido
}

interface MapDocument {
  width: number
  height: number
  layers: MapLayer[]      // ordenadas de abajo hacia arriba (por id)
}
```

Decisiones dentro de este boceto:

- **`id` = bucket Godot.** No inventamos otro identificador: -500 es terreno,
  600 es muros, etc. Mantiene compatibilidad con los `paramKey` de capa que
  las herramientas ya usan, y con un eventual export a formato Dungeondraft.
- **Las entidades viven dentro de su capa**, no en una lista global con un
  campo `layer`. Ventajas: activar/desactivar u ocultar una capa es trivial,
  el z-order dentro de la capa es el orden del array (necesario para
  "enviar al frente/fondo"), y el render puede saltarse capas ocultas sin
  filtrar una lista global en cada frame. Mover una entidad de capa es un
  comando explícito (quitar de una, insertar en otra).
- **El documento nace con las 15 capas de `MAP_LAYERS` siempre presentes**:
  15 objetos vacíos son gratis y eliminan una clase entera de checks de
  "la capa no existe".

### 2.2 Visibilidad de capas

La visibilidad vive en **`viewStore`** (mapa `layerId → boolean`, default
visible), no en el documento: es una preferencia de visualización, no
contenido del mapa. No se guarda con el archivo, no entra en el historial de
undo (ocultar/mostrar capa no debe ser un paso de undo). Si más adelante
queremos persistirla, se serializa aparte como metadato de editor.

---

## 3. La capa de terreno: pintura con texturas superpuestas

### 3.1 El problema

"Máscara por textura" no alcanza: si cada slot tuviera su propia máscara y se
compusieran en orden fijo de slots, el caso césped → tierra → césped-encima
sería imposible (el segundo césped quedaría debajo de la tierra o pisaría todo
el círculo de tierra). Lo que define el resultado es el **orden cronológico de
las pinceladas**, exactamente como pintar en una imagen normal donde cada
pincelada usa una textura como "tinta".

### 3.2 Representación elegida: pinceladas como fuente de verdad + raster como cache

Se evaluaron tres opciones (raster puro, lista de pinceladas pura, híbrido) y
se elige el **híbrido**. El documento (lo que se serializa y lo que trackea
zundo) guarda la lista de pinceladas; el renderer mantiene un **raster
bakeado** (render texture de Pixi) que es puro cache derivado:

- Pincelada nueva → se pinta incrementalmente sobre el bake (costo O(1)).
- Undo/redo/carga/cambio de textura de un slot/cambio de resolución →
  re-render completo de la lista (o desde un checkpoint).
- El bake **no vive en el store** (violaría "JSON-serializable, sin
  instancias") y **no se serializa**; vive en el renderer, keyed por una
  revisión de la lista de strokes + los inputs de render (slots, resolución).

Ventajas: documento chico y JSON puro, undo natural (deshacer = quitar el
último stroke), redimensionar el mapa o cambiar la resolución de trabajo no
pierde información, y los slots pueden ser vivos (§3.3) porque repintar es
solo re-ejecutar la lista.

Mitigaciones del costo de replay en mapas muy pintados:

- **Checkpoints**: cada N pinceladas el renderer guarda una copia del bake;
  un undo re-renderiza solo desde el último checkpoint anterior. (Los
  checkpoints multiplican memoria raster — medir con el panel de debug, §6.)
- **Compactación opcional al guardar** (futuro): bakear strokes viejos a una
  imagen base + strokes recientes encima, si los archivos crecen demasiado.
  No es necesario para la v1.

### 3.3 Slots vivos y anatomía de una pincelada

**Decisión: los slots son vivos, no congelados.** Una pincelada guarda solo el
número de slot; si el usuario cambia la textura asignada a un slot, todo lo
pintado con ese slot se repinta con la textura nueva (re-render de la lista).
Consecuencia: la **definición de slots (slot → textura) forma parte del
documento** (dentro de `TerrainLayer`), porque sin ella un mapa guardado no
puede renderizarse.

```ts
interface TerrainLayer extends LayerBase {
  kind: "terrain"
  slots: (TextureRef | null)[]   // slot → asset (packId + ruta); parte del documento
  background: number             // slot que rellena el mapa; por defecto slot 1
  strokes: TerrainStroke[]       // orden cronológico
}

interface TerrainStroke {
  id: string
  slot: number            // referencia viva al slot
  brush: {
    size: number          // en tiles (float)
    // la forma (smooth / texturizado) NO se guarda por stroke por ahora:
    // se lee del param "smooth blending" en render (ver §3.5) — a revisar
    // si en el futuro debe congelarse por pincelada
  }
  points: Vec2[]          // polyline del gesto, en coordenadas de mapa (tiles)
}
```

- Cambiar la textura de un slot es un **comando de documento**
  (`setTerrainSlot(slot, textureRef)`) y por lo tanto es undoable y dispara el
  re-render del bake.
- Coordenadas de strokes (y de entidades) en **tiles float**; el renderer
  convierte a píxeles según la resolución activa (§3.6).

### 3.4 Fondo por defecto y botón Rellenar

- Un mapa nuevo nace **relleno con el slot 1** (`background: 1`, sin
  pinceladas). El fondo se dibuja siempre antes que todos los strokes.
- El botón **Rellenar** no es "una pincelada gigante": **borra todo el estado
  de la textura** — vacía `strokes` y reinicializa el fondo con la textura
  elegida (`background = slot activo`). Es un solo comando
  (`fillTerrain(slot)`), un solo paso de undo que restaura strokes + fondo
  anteriores.

### 3.5 Forma del pincel: param "smooth blending"

El param **smooth blending** de la herramienta Terrain Brush se lee
**directamente en el render** (desde el estado de tools, no del documento) y
cambia la forma del pincel:

- *Smooth*: pincel circular normal con poca dureza (borde difuminado).
- *No smooth*: pincel más estilizado, con textura propia.

**Por ahora se implementa siempre smooth**, pero el renderer debe recibir la
forma del pincel como input intercambiable para que agregar el pincel
texturizado no toque el modelo.

### 3.6 Resolución del raster: píxeles por cuadro

La resolución del bake depende de la resolución del mapa y se define en
**píxeles por cuadro de grid**:

- **Default: 100 px/cuadro.** Un mapa de 30×20 tiles bakea a 3000×2000 px.
- Es un **parámetro numérico de la herramienta Map Settings**, rango
  **50–250**, con **debounce** (el usuario arrastra el número sin disparar un
  re-render por tick).
- El renderer **lee el valor directamente**; si cambia, se **re-renderiza** el
  bake completo a la nueva resolución (los strokes son vectoriales, no se
  pierde nada).
- Esto habilita separar **resolución de trabajo** (más baja, fluida) de
  **resolución de export**: el proceso de exportar re-bakea la lista de
  strokes a la resolución de salida, independiente de la de trabajo.

Dónde vive el valor: al ser un param de tool ya tiene su lugar en el sistema
de params (`features/tools/params.ts`). Queda por decidir si además se
persiste con el mapa (probablemente sí, como ajuste del documento en Map
Settings — igual que width/height).

---

## 4. Render del viewport: PixiJS desde el inicio

**Decisión: empezar directamente con una librería/motor**, no con canvas 2D
artesanal. Motivos:

- **Performance manejada por el motor** (GPU, render textures, culling) desde
  el día uno, en lugar de migrar después.
- **Conversión de coordenadas**: el usuario pinta con zoom/pan aplicados y las
  coordenadas de mapa tienen que seguir teniendo sentido. Un scene graph con
  transforms (screen → world → tiles) resuelve esto de forma robusta; hacerlo
  a mano es fuente clásica de bugs.

**PixiJS es la opción candidata** (v8, WebGL/WebGPU). Piezas que usaríamos:

- Un `Container` raíz "mundo" con el transform de cámara (pan/zoom);
  `toLocal`/`toGlobal` para convertir coordenadas de eventos a tiles.
- Un `Container` por capa de mapa, ordenados por `id`; ocultar capa =
  `container.visible = false`.
- Terreno: `RenderTexture` como bake; pintar = renderizar el trazo con la
  textura en modo tile sobre la render texture (stencil/máscara para la forma
  del pincel).
- Entidades: sprites/graphics dentro del container de su capa.

Integración con React: React es dueño del DOM y los stores; Pixi es dueño del
canvas. Un componente monta la `Application` y un módulo renderer (no-React)
se suscribe a los stores de zustand (`mapStore`, `viewStore`, `toolsStore`) y
reconcilia la escena. El modelo no sabe nada de Pixi.

### 4.1 Diseño para la interactividad futura

No se implementa interactividad de entidades ahora, pero el renderer se
estructura para eso:

- Cada entidad se renderiza como un **display object identificable**
  (mapeo `entityId ↔ objeto de escena`), para hit-testing y para poder
  colgarle handles después.
- La interacción será **por herramienta activa**: Select → seleccionar y
  mover/rotar/escalar; Building con "edit paths" → arrastrar puntos del path;
  etc. Esto sugiere una capa de "modos de interacción" del renderer que se
  activa según la tool (patrón strategy: la tool activa decide qué eventos de
  puntero se interpretan y sobre qué entidades), separada del dibujo.
- Los eventos de puntero siempre se traducen a coordenadas de mapa (tiles)
  antes de llegar a la lógica de herramienta.

---

## 5. Impacto en el estado y los comandos

- `mapStore` sigue igual (documento + zundo), pero **hay que revisar el costo
  de los snapshots**: zundo hoy snapshotea el documento entero. Con listas de
  strokes largas conviene pasar a un `partialize`/diff más fino o a límite de
  historial. Primer paso barato: limitar la profundidad de historial y medir.
- **Una pincelada = un comando** (`paintTerrainStroke(stroke)`), commiteado al
  soltar el mouse — los puntos intermedios del gesto se acumulan en estado
  efímero del renderer (y se previsualizan sobre el bake) sin generar pasos
  de undo por punto.
- Comandos nuevos previsibles:
  - Documento: `addEntity/moveEntity/removeEntity` reescritos contra
    `layers[i].entities`, `paintTerrainStroke`, `fillTerrain(slot)`,
    `setTerrainSlot(slot, textureRef)`.
  - viewStore (no undoable): `setLayerVisible`, cámara (pan/zoom).
  - Params de tool leídos directo por el render (no comandos): smooth
    blending, píxeles por cuadro (este último probablemente también se
    persista en el documento, ver §3.6).
- `packUsage.ts` (detección de packs en uso para el borrado con confirmación)
  debe aprender a mirar también los `slots` del terreno, no solo los params de
  entidades.

---

## 6. Panel de debug

Necesitamos medir de verdad cuánto consumen los rasters completos (bake +
checkpoints, a distintas resoluciones y tamaños de mapa). Para eso, un **panel
de debug** en el editor (ej. FloatingWindow toggleable, solo en dev o detrás
de un flag) que muestre **en tiempo real**:

- **Memoria**: tamaño estimado del bake y de cada checkpoint
  (ancho × alto × 4 bytes), total de texturas GPU vivas, `performance.memory`
  donde esté disponible, memoria estimada de texturas de assets cargadas.
- **Estado del documento**: cantidad de strokes, entidades por capa,
  profundidad del historial de undo, revisión del bake.
- **Render**: FPS, tiempo del último re-bake completo, resolución activa
  (px/cuadro), tamaño del raster resultante.
- **Stores en vivo**: vista de los estados de zustand relevantes
  (mapStore/viewStore/toolsStore) actualizándose en tiempo real.

Este panel llega **temprano** (junto con el primer bake) porque sus números
deciden cosas del diseño: cuántos checkpoints podemos permitirnos, si la
resolución de trabajo default (100) es viable en mapas grandes, etc.

---

## 7. Serialización

- El documento (capas + entidades + slots + strokes) sigue siendo JSON puro →
  `io.ts` casi no cambia para el formato propio.
- El bake raster **no se serializa** (es cache derivado; se reconstruye de los
  strokes). Si en el futuro agregamos compactación (§3.2), la imagen base se
  guardaría como PNG embebido (base64) o archivo hermano — decisión para ese
  momento.
- **Export**: re-bake de la lista de strokes a la resolución de export
  (independiente de la de trabajo) + render de las capas de entidades encima.
- Compatibilidad Dungeondraft (import/export) queda explícitamente **fuera de
  alcance de esta fase**; el modelo por buckets Godot deja la puerta abierta.

---

## 8. Preguntas abiertas (menores, decidir sobre la marcha)

1. **¿Smooth blending se congela por stroke?** Hoy se lee en vivo del param;
   si algún día conviven pinceles smooth y texturizados en un mismo mapa,
   probablemente haya que guardar la forma en cada stroke. Por ahora siempre
   smooth, no bloquea.
2. **¿Px/cuadro se guarda en el documento?** Propuesta: sí (es un ajuste de
   Map Settings del mapa, como width/height), pero confirmar al implementar.
3. **Historial de zundo con documentos grandes**: ¿límite de profundidad,
   diffs, o snapshots está bien para la v1? Medir con el panel de debug.
4. **¿Otras capas raster además de -500?** El tipo `TerrainLayer` lo permite;
   por ahora se restringe a -500.
5. **Texturas `.tex` de Godot**: la decodificación sigue siendo TODO; mientras
   tanto el terreno puede limitarse a texturas PNG.

---

## 9. Fases sugeridas

1. **Fase 0 — Modelo**: nuevo `MapDocument` (capas tipadas, terrain con
   slots/background/strokes), migrar comandos y tests existentes, visibilidad
   en viewStore. Sin render nuevo todavía.
2. **Fase 1 — Viewport Pixi**: montar Pixi + React, cámara pan/zoom con
   conversión de coordenadas, grid, containers por capa, toggle de
   visibilidad, **panel de debug** con las métricas base.
3. **Fase 2 — Terreno**: bake en RenderTexture, fondo por slot, pincelada
   smooth incremental + comando, botón Rellenar, slots vivos
   (`setTerrainSlot`), resolución px/cuadro debounceada desde Map Settings,
   checkpoints. Medir memoria con el panel.
4. **Fase 3 — Entidades**: dibujo de las capas de entidades (objetos, paths…)
   con display objects identificables por entidad. Sin interacción todavía.
5. **Fase 4 — Interactividad** (incremental, fuera de este documento): modos
   de interacción por herramienta — Select (mover/rotar/escalar), Building
   edit paths, etc., tipo por tipo.
