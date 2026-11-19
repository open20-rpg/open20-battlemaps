import { Matrix, RenderTexture, Sprite, type Application, type Container } from "pixi.js"

/**
 * A picture of the map kept between frames, so a frame where only the
 * editor overlay changed (the cursor's circle, a hover, a draft, the
 * selection) redraws just the overlay over it: one textured quad instead of
 * every layer again (drop shadows and their blur, painted-layer filters,
 * the light map, the water's screen copy…). Moving the pointer over the map
 * then costs next to nothing, which matters most on phones and tablets.
 *
 * The picture is redrawn when the map changed (the scene says so), the
 * view moved, or the canvas changed size; the overlay is always drawn live.
 */
export class MapLayerCache {
  private rt: RenderTexture | null = null
  private readonly sprite = new Sprite()
  /** The view (world transform) and canvas the picture was drawn for. */
  private key = ""
  /** The map's layers (ground, content, grid): what the picture holds. */
  private readonly layers: ReadonlySet<Container>

  constructor(
    private readonly app: Application,
    private readonly world: Container,
    /** The map's layers (ground, content, grid): what the picture holds. */
    layers: readonly Container[],
    /** Multisample the picture (what the canvas would do with antialiasing on). */
    private readonly antialias: boolean,
  ) {
    this.layers = new Set(layers)
    this.sprite.visible = false
    // Under the world: the overlay (in the world) draws on top of it.
    app.stage.addChildAt(this.sprite, 0)
  }

  /** Draw a frame: the map's picture (redrawn when `stale`) and the live overlay on it. */
  render(stale: boolean): void {
    const { renderer, screen } = this.app
    this.world.updateLocalTransform()
    const m = this.world.localTransform
    const key = [m.a, m.b, m.c, m.d, m.tx, m.ty, screen.width, screen.height, renderer.resolution]
      .map((v) => v.toFixed(4))
      .join(",")
    if (stale || key !== this.key || !this.rt) {
      if (!this.rt || this.rt.width !== screen.width || this.rt.height !== screen.height) {
        this.rt?.destroy(true)
        this.rt = RenderTexture.create({
          width: screen.width,
          height: screen.height,
          resolution: renderer.resolution,
          antialias: this.antialias,
        })
        this.sprite.texture = this.rt
      }
      // The map's layers alone, as the screen shows them.
      const overlays = this.world.children.filter((c) => !this.layers.has(c) && c.visible)
      for (const c of overlays) c.visible = false
      try {
        renderer.render({
          container: this.app.stage,
          target: this.rt,
          clear: true,
          transform: new Matrix(),
        })
      } finally {
        for (const c of overlays) c.visible = true
      }
      this.key = key
    }
    // The picture, and the overlay drawn live over it.
    const shown = [...this.layers].filter((c) => c.visible)
    for (const c of shown) c.visible = false
    this.sprite.visible = true
    try {
      this.app.render()
    } finally {
      this.sprite.visible = false
      for (const c of shown) c.visible = true
    }
  }

  destroy(): void {
    this.sprite.destroy()
    this.rt?.destroy(true)
    this.rt = null
  }
}
