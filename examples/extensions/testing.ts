import {
  type Contribution,
  type ExtensionContext, type ExtensionDefinition, type Manifest } from "@open20/battlemaps-sdk"
import { useExtensionsStore } from "../../src/stores/extensionsStore"
import { createHarness, type Harness } from "../../src/features/extensions/testHarness"

/**
 * Runs an example extension against the app's real host and stores (what
 * its tests check), with the manifest it ships.
 */
export async function startExample(
  def: ExtensionDefinition,
  manifest: unknown,
  opts: { harness?: Harness; files?: Record<string, string | Uint8Array> } = {},
): Promise<{ h: Harness; ctx: ExtensionContext; id: string }> {
  const h = opts.harness ?? createHarness()
  const m = manifest as Manifest
  const enc = new TextEncoder()
  h.services.files.set(
    m.id,
    new Map(
      Object.entries({ "manifest.json": JSON.stringify(m), ...(opts.files ?? {}) }).map(([k, v]) => [
        k,
        typeof v === "string" ? enc.encode(v) : v,
      ]),
    ),
  )
  let ctx!: ExtensionContext
  const id = await h.start(
    {
      activate: async (c) => {
        ctx = c
        await def.activate(c)
      },
      deactivate: def.deactivate,
    },
    m,
  )
  return { h, ctx, id }
}

/** A live contribution of the example, by type and id (its callbacks call the extension). */
export function contribution<T extends Contribution["type"]>(
  type: T,
  id?: string,
): Extract<Contribution, { type: T }> {
  const c = useExtensionsStore
    .getState()
    .contributions.find(
      (x) => x.contribution.type === type && (id === undefined || (x.contribution as { id?: string }).id === id),
    )
  if (!c) throw new Error(`no ${type} ${id ?? ""}`)
  return c.contribution as Extract<Contribution, { type: T }>
}
