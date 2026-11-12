import { Matrix, RenderTexture, Sprite, type Application, type Container } from "pixi.js"

/** Extra area captured around the screen (fraction of its size per side), so a pan shows map, not blank. */
const MARGIN = 0.25

/**
 * A snapshot of the canvas shown while the view is moved by a gesture: the
 * map (with its filters, shadows, lights, terrain…) is drawn once into a
 * texture, then only that texture is moved and scaled to follow the view —
 * one quad a frame instead of the whole map, which is what keeps pinching
 * and panning smooth on phones and tablets. The real map is drawn again,
 * sharp, when the gesture ends.
 */
export class ViewSnapshot {
  private sprite: Sprite | null = null
  private rt: RenderTexture | null = null
  /** The world's transform when the snapshot was taken, inverted. */
  private fromWorld = new Matrix()
  private offset = { x: 0, y: 0 }

  constructor(
    private readonly app: Application,
    private readonly world: Container,
  ) {}

  get active(): boolean {
    return this.sprite !== null
  }

  take(): void {
    if (this.sprite) return
    const { renderer, screen, stage } = this.app
    this.offset = { x: screen.width * MARGIN, y: screen.height * MARGIN }
    this.rt = RenderTexture.create({
      width: Math.ceil(screen.width + 2 * this.offset.x),
      height: Math.ceil(screen.height + 2 * this.offset.y),
      resolution: renderer.resolution,
    })
    renderer.render({
      container: stage,
      target: this.rt,
      clear: true,
      transform: new Matrix().translate(this.offset.x, this.offset.y),
    })
    this.world.updateLocalTransform()
    this.fromWorld = this.world.localTransform.clone().invert()
    this.sprite = new Sprite(this.rt)
    stage.addChild(this.sprite)
    this.world.visible = false
    this.follow()
  }

  /** Place the snapshot where the view now puts what it showed. */
  follow(): void {
    if (!this.sprite) return
    this.world.updateLocalTransform()
    const m = this.world.localTransform
      .clone()
      .append(this.fromWorld)
      .append(new Matrix().translate(-this.offset.x, -this.offset.y))
    this.sprite.setFromMatrix(m)
  }

  drop(): void {
    if (!this.sprite) return
    this.app.stage.removeChild(this.sprite)
    this.sprite.destroy()
    this.rt?.destroy(true)
    this.sprite = null
    this.rt = null
    this.world.visible = true
  }
}
