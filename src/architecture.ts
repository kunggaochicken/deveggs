import { BasketError, type Egg, type Kind } from "./basket.ts";
import { displayWidth, type Palette, palette } from "./table.ts";

/**
 * Every item's file opens with an `## Architecture` section, right after the fact: a
 * diagram of the preference or workflow it automates, so the developer (and the next
 * agent) can see at a glance what it does and find the files that belong to it.
 *
 *   ## Architecture
 *
 *   ```text
 *   ⚡ PR touches UI ──▶ 🤖 capture before/after ──▶ ✅ screenshots in the PR
 *   ```
 *
 *   - ⚡ **Fires when:** a PR changes something on screen
 *   - 🎯 **Judged by:** ✓ reviewers see the change · ✗ screenshots of nothing
 *   - 🔗 **Works with:** `land-via-pr`
 *
 *   ### 📁 Files
 *
 *   - `scripts/<id>`: what it does
 *
 * Simple preferences get a one-line flow; workflows, scripts and skills get a component
 * map (triggers, steps, each file, inputs/outputs, external systems). A ```mermaid block
 * may follow the text diagram for GitHub; the terminal shows only the text one.
 */

export const ARCH_HEADING = "Architecture";

/** One icon per kind, used in headers and the item's own diagram. */
export const KIND_ICON: Record<Kind, string> = { preference: "🧠", workflow: "🔁", script: "📜", skill: "🧩" };

/** Placeholders in a scaffold are wrapped in ‹ ›, so an undrawn architecture is easy to spot. */
const PLACEHOLDER = /‹[^›\n]*›/;

const heading = (part: string): string => part.split("\n")[0] ?? "";
const isArchHeading = (line: string): boolean => new RegExp(`^## ${ARCH_HEADING}\\s*$`).test(line);

/** The body split into its leading prose and its `## ` sections. */
function parts(body: string): string[] {
  return body.split(/^(?=## )/m).map((p) => p.trim()).filter(Boolean);
}

/** The Architecture section's content (without its heading), or undefined if the item has none. */
export function architectureOf(body: string): string | undefined {
  const part = parts(body).find((p) => isArchHeading(heading(p)));
  if (part === undefined) return undefined;
  return part.split("\n").slice(1).join("\n").trim();
}

/** The body without its Architecture section. */
export function withoutArchitecture(body: string): string {
  return parts(body).filter((p) => !isArchHeading(heading(p))).join("\n\n");
}

/** Accept an architecture with or without its `## Architecture` heading. */
export function cleanArchitecture(text: string): string {
  const lines = text.trim().split("\n");
  return (isArchHeading(lines[0] ?? "") ? lines.slice(1) : lines).join("\n").trim();
}

/**
 * Put an architecture first in the body, replacing any it had. Leading prose (notes
 * written before sections had headings) moves under `## Notes`, so it stays its own
 * section instead of running into the diagram.
 */
export function withArchitecture(body: string, architecture: string): string {
  const arch = cleanArchitecture(architecture);
  if (!arch) throw new BasketError("the architecture is empty");
  if (/^## /m.test(arch)) throw new BasketError("the architecture can't contain `## ` headings; use `### ` for its parts");
  const rest = parts(body)
    .filter((p) => !isArchHeading(heading(p)))
    .map((p) => (p.startsWith("## ") ? p : `## Notes\n\n${p}`));
  return [`## ${ARCH_HEADING}\n\n${arch}`, ...rest].join("\n\n");
}

/** True for an architecture still holding ‹placeholders› from the scaffold. */
export function isScaffold(architecture: string | undefined): boolean {
  return architecture !== undefined && PLACEHOLDER.test(architecture);
}

/** The files an architecture names under its `### … Files` heading: each bullet's first `path`. */
export function archFiles(architecture: string | undefined): string[] {
  if (!architecture) return [];
  const at = architecture.split("\n").findIndex((l) => /^### .*Files\s*$/.test(l));
  if (at < 0) return [];
  const files: string[] = [];
  for (const line of architecture.split("\n").slice(at + 1)) {
    if (line.startsWith("### ")) break;
    const m = /^- `([^`]+)`/.exec(line.trim());
    if (m?.[1] && !PLACEHOLDER.test(m[1])) files.push(m[1]);
  }
  return files;
}

/** Where an item's own files live in the basket, by kind. */
function ownFiles(kind: Kind, id: string, skillTier: string): string[] {
  if (kind === "script") return [`- \`scripts/${id}\`: ‹what it does, how it's run›`];
  if (kind === "skill") return [`- \`skills/${skillTier}/${id}/SKILL.md\`: the skill agents load`];
  return ["- ‹scripts or skills this workflow runs, or “none”›"];
}

/**
 * The architecture `deveggs lay` starts an item with, by kind: a one-line flow for a
 * preference, a component map for a workflow, script or skill. The agent replaces the
 * ‹placeholders› with the real thing (`deveggs arch <id> --set <file>`).
 */
export function scaffold(kind: Kind, id: string, skillTier = "eggs"): string {
  if (kind === "preference") {
    return [
      "```text",
      "⚡ ‹when it applies› ──▶ 🤖 ‹what the agent does› ──▶ ✅ ‹outcome›",
      "```",
      "",
      "- ⚡ **Fires when:** ‹the situation›",
      "- 🎯 **Judged by:** ✓ ‹it helped when…› · ✗ ‹it got in the way when…›",
    ].join("\n");
  }
  const icon = KIND_ICON[kind];
  return [
    "```text",
    "⚡ TRIGGER              🤖 STEPS                          ✅ OUTCOME",
    "‹when it starts› ──▶ 1. ‹step› ──▶ 2. ‹step› ──▶ ‹result›",
    "                        │",
    `                        └──▶ ${icon} ‹script or skill› ──▶ 🌐 ‹gh, launchd, a hook…›`,
    "```",
    "",
    "- ⚡ **Fires when:** ‹what starts it›",
    "- 📥 **Inputs:** ‹what it reads› · 📤 **Outputs:** ‹what it writes or changes›",
    "- 🎯 **Judged by:** ✓ ‹it helped when…› · ✗ ‹it got in the way when…›",
    "- 🔗 **Works with:** ‹other items, or none›",
    "",
    "### 📁 Files",
    "",
    ...ownFiles(kind, id, skillTier),
  ].join("\n");
}

// --- terminal ---------------------------------------------------------------------

export interface ArchView {
  width: number;
  color: boolean;
}

/** Turn the Markdown into terminal lines: text diagrams unfenced, mermaid dropped, bold markers gone. */
function terminalLines(architecture: string, p: Palette): string[] {
  const out: string[] = [];
  let fence: "text" | "mermaid" | undefined;
  for (const line of architecture.split("\n")) {
    const open = /^```\s*(\w*)\s*$/.exec(line);
    if (open && fence === undefined) {
      fence = open[1] === "mermaid" ? "mermaid" : "text";
      continue;
    }
    if (open && fence !== undefined) {
      fence = undefined;
      continue;
    }
    if (fence === "mermaid") continue;
    if (fence === "text") {
      out.push(line);
      continue;
    }
    if (line.startsWith("### ")) {
      out.push(p.bold(line.slice(4)));
      continue;
    }
    out.push(line.replace(/\*\*([^*]+)\*\*/g, (_m, text: string) => p.bold(text)).replace(/^- /, "  "));
  }
  while (out.length && !out[0]?.trim()) out.shift();
  while (out.length && !out.at(-1)?.trim()) out.pop();
  return out.reduce<string[]>((acc, l) => (!l.trim() && !acc.at(-1)?.trim() ? acc : [...acc, l]), []);
}

/**
 * An item's architecture, framed for the terminal:
 *
 *   ╭─ 🗺  memory-guardian · 📜 script ─────────────
 *   │ ⚡ every 15 s ──▶ …
 *   ╰─────────────────────────────────────────────
 *
 * Without one (or with only the scaffold) it says how to draw it.
 */
export function formatArchitecture(egg: Pick<Egg, "id" | "kind" | "body">, view: ArchView): string {
  const p = palette(view.color);
  const arch = architectureOf(egg.body);
  const title = `🗺  ${egg.id} · ${KIND_ICON[egg.kind]} ${egg.kind}`;
  if (!arch) return `${title}\n   ${p.dim(`no architecture yet; draw it: deveggs arch ${egg.id} --set <file>`)}`;
  const lines = terminalLines(arch, p);
  const inner = Math.max(displayWidth(title) + 2, ...lines.map(displayWidth));
  const rule = Math.max(4, Math.min(view.width, inner + 2) - displayWidth(title) - 4);
  const out = [
    p.dim("╭─ ") + p.bold(title) + p.dim(` ${"─".repeat(rule)}`),
    ...lines.map((l) => `${p.dim("│")} ${l}`.trimEnd()),
    p.dim(`╰${"─".repeat(Math.max(4, Math.min(view.width, inner + 2) - 1))}`),
  ];
  if (isScaffold(arch)) out.push(p.yellow(`✏️  still a sketch: fill in the ‹…› parts with deveggs arch ${egg.id} --set <file>`));
  return out.join("\n");
}
