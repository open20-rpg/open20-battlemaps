// Announces a release on Discord, turning the notes semantic-release wrote on
// the GitHub Release into a short message (scripts/discord-template.md).
// Usage: DISCORD_WEBHOOK_URL=... node scripts/notify-discord-release.mjs <tag> <notes-file>
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Discord rejects messages over 2000 characters.
export const DISCORD_LIMIT = 2000

// Headings written by conventional-changelog-conventionalcommits.
const SECTION_NAMES = {
  "⚠ BREAKING CHANGES": "⚠️ Cambios importantes",
  Features: "Novedades",
  "Bug Fixes": "Correcciones",
  "Performance Improvements": "Rendimiento",
  Reverts: "Reversiones",
}

/** One changelog line as a reader sees it: no commit link, scope or issue refs. */
export function cleanItem(text) {
  const clean = text
    .replace(/\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)/g, "")
    .replace(/,?\s*closes\s+\[[^\]]*\]\([^)]*\)/gi, "")
    .replace(/^\*\*[^*]+:\*\*\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

/** The release notes as sections of items, in the order they appear. */
export function parseNotes(notes) {
  const sections = []
  let current = null
  let last = null
  for (const line of notes.split("\n")) {
    const heading = /^###\s+(.+)$/.exec(line)
    if (heading) {
      const title = heading[1].trim()
      current = { title: SECTION_NAMES[title] ?? title, items: [] }
      sections.push(current)
      last = null
      continue
    }
    const item = /^\s*[*-]\s+(.+)$/.exec(line)
    if (item && current) {
      last = { raw: item[1] }
      current.items.push(last)
    } else if (line.trim() === "" || line.startsWith("#")) {
      last = null
    } else if (last) {
      // A BREAKING CHANGE footer can span several lines.
      last.raw += ` ${line.trim()}`
    }
  }
  return sections
    .map((s) => ({ title: s.title, items: [...new Set(s.items.map((i) => cleanItem(i.raw)))] }))
    .filter((s) => s.items.length > 0)
}

/** The Discord message for a release, cut to fit Discord's limit. */
export function buildMessage(template, tag, notes, limit = DISCORD_LIMIT) {
  const render = (changes) =>
    template.trim().replaceAll("{tag}", tag).replaceAll("{changes}", changes)
  const sections = parseNotes(notes)
  const total = sections.reduce((n, s) => n + s.items.length, 0)
  if (total === 0) return render("Correcciones y mejoras menores.")

  // Fill item by item; whatever doesn't fit is summed up in a last line.
  const kept = []
  let shown = 0
  const changes = (omitted) => {
    const body = kept
      .filter((s) => s.items.length > 0)
      .map((s) => `**${s.title}**\n${s.items.map((i) => `- ${i}`).join("\n")}`)
      .join("\n\n")
    return omitted > 0 ? `${body}\n\n…y ${omitted} cambios más.` : body
  }
  for (const section of sections) {
    const target = { title: section.title, items: [] }
    kept.push(target)
    for (const item of section.items) {
      target.items.push(item)
      shown++
      if (render(changes(total - shown)).length > limit) {
        target.items.pop()
        shown--
        return render(changes(total - shown))
      }
    }
  }
  return render(changes(0))
}

async function main() {
  const [tag, notesFile] = process.argv.slice(2)
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL
  if (!tag || !notesFile || !webhookUrl) {
    console.error(
      "usage: DISCORD_WEBHOOK_URL=... node scripts/notify-discord-release.mjs <tag> <notes-file>",
    )
    process.exit(1)
  }
  const template = readFileSync(new URL("./discord-template.md", import.meta.url), "utf8")
  const content = buildMessage(template, tag, readFileSync(notesFile, "utf8"))
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // SUPPRESS_EMBEDS: no preview cards for the links. No mentions: the text
    // comes from commit messages.
    body: JSON.stringify({ content, flags: 1 << 2, allowed_mentions: { parse: [] } }),
  })
  if (!response.ok) {
    console.error(`Discord webhook failed: ${response.status} ${await response.text()}`)
    process.exit(1)
  }
  console.log(`Discord notified about ${tag}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
