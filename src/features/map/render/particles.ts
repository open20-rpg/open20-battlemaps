import { Container, Graphics, Sprite, type Texture } from "pixi.js"
import { type ParticleEmitter } from "@open20/battlemaps-sdk"
import { hexToPixiColor } from "../../../lib/colors"

/** Most particles alive at once (all emitters together). */
export const MAX_PARTICLES = 3000

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: number
  alpha: number
  emitter: number
}

const rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0])
const colorOf = (c: string | string[]) => {
  const list = Array.isArray(c) ? c : [c]
  return hexToPixiColor(list[Math.floor(Math.random() * list.length)] ?? "#ffffff").color
}

/**
 * Extensions' particle effects (rain, snow, embers…), simulated on the CPU
 * and drawn as dots or the emitter's image, in map tiles. Steps only while
 * Animations is on; an export draws them as they are (frozen).
 */
export class ParticleLayer {
  readonly view = new Container()
  private dots = new Graphics()
  private particles: Particle[] = []
  private emitters: ParticleEmitter[] = []
  private carry: number[] = []
  private sprites: Sprite[] = []

  constructor(private texture: (assetId: string) => Texture | undefined) {
    this.view.addChild(this.dots)
  }

  setEmitters(
    emitters: readonly ParticleEmitter[],
    mapSize: { width: number; height: number },
  ): void {
    if (
      emitters.length === this.emitters.length &&
      emitters.every((e, i) => e === this.emitters[i])
    )
      return
    this.emitters = emitters.slice(0, 32)
    this.carry = this.emitters.map(() => 0)
    this.particles = this.particles.filter((p) => p.emitter < this.emitters.length)
    this.mapSize = mapSize
  }

  private mapSize = { width: 1, height: 1 }

  get active(): boolean {
    return this.emitters.length > 0
  }

  private spawn(i: number): Particle {
    const e = this.emitters[i]
    let x: number
    let y: number
    if (e.area === "map") {
      x = Math.random() * this.mapSize.width
      y = Math.random() * this.mapSize.height
    } else if ("w" in e.area) {
      x = e.area.x + Math.random() * e.area.w
      y = e.area.y + Math.random() * e.area.h
    } else {
      x = e.area.x
      y = e.area.y
    }
    const dir = (rnd(e.direction) * Math.PI) / 180
    const speed = rnd(e.speed)
    return {
      x,
      y,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      age: 0,
      life: Math.max(0.05, rnd(e.lifetime)),
      size: Math.max(0.005, rnd(e.size)),
      color: colorOf(e.color),
      alpha: e.alpha ? rnd(e.alpha) : 1,
      emitter: i,
    }
  }

  /** Advance `dt` seconds and redraw. */
  step(dt: number): void {
    const t = Math.min(dt, 0.1)
    this.emitters.forEach((e, i) => {
      this.carry[i] += Math.min(e.rate, 1000) * t
      while (this.carry[i] >= 1 && this.particles.length < MAX_PARTICLES) {
        this.carry[i] -= 1
        this.particles.push(this.spawn(i))
      }
      this.carry[i] = Math.min(this.carry[i], 1)
    })
    const alive: Particle[] = []
    for (const p of this.particles) {
      const e = this.emitters[p.emitter]
      p.age += t
      if (p.age >= p.life) continue
      p.vx += (e.gravity?.x ?? 0) * t
      p.vy += (e.gravity?.y ?? 0) * t
      p.x += p.vx * t
      p.y += p.vy * t
      alive.push(p)
    }
    this.particles = alive
    this.draw()
  }

  private draw(): void {
    this.dots.clear()
    let used = 0
    for (const p of this.particles) {
      const e = this.emitters[p.emitter]
      const fade = p.alpha * (1 - p.age / p.life)
      const tex = e.asset ? this.texture(e.asset) : undefined
      if (tex) {
        let s = this.sprites[used]
        if (!s) {
          s = new Sprite(tex)
          s.anchor.set(0.5)
          this.sprites.push(s)
          this.view.addChild(s)
        }
        s.texture = tex
        s.visible = true
        s.position.set(-p.x, p.y)
        s.width = s.height = p.size
        s.tint = p.color
        s.alpha = fade
        used++
      } else this.dots.circle(-p.x, p.y, p.size / 2).fill({ color: p.color, alpha: fade })
    }
    for (let i = used; i < this.sprites.length; i++) this.sprites[i].visible = false
  }

  destroy(): void {
    this.view.destroy({ children: true })
  }
}
