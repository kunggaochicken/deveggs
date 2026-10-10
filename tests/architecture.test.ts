import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { architectureOf, archFiles, formatArchitecture, isScaffold, scaffold, withArchitecture, withoutArchitecture } from "../src/architecture.ts";
import { Basket } from "../src/basket.ts";
import { planShare, sanitizeEgg } from "../src/share.ts";
import { displayWidth } from "../src/table.ts";
import { formatShow } from "../src/view.ts";
import { cli, sandbox } from "./sandbox.ts";

const fresh = (): Basket => new Basket(mkdtempSync(join(tmpdir(), "deveggs-arch-")));
const plain = { width: 100, color: false };

const GUARD = [
  "```text",
  "⚡ launchd, every 15 s ──▶ 🛡 scripts/memory-guardian ──▶ ✅ machine stays up",
  "```",
  "",
  "```mermaid",
  "flowchart LR",
  "  launchd --> guardian",
  "```",
  "",
  "- ⚡ **Fires when:** memory pressure rises",
  "- 🔗 **Works with:** `fan-out`",
  "",
  "### 📁 Files",
  "",
  "- `scripts/guard`: one pass",
  "- `scripts/guard.plist`: the launchd job",
].join("\n");

test("lay starts every item with an Architecture section right after the fact, scaffolded by kind", () => {
  const b = fresh();
  const pref = b.lay({ id: "terse", summary: "Be terse", note: "seen in grover" });
  assert.match(pref.body, /^## Architecture\n\n```text\n⚡ ‹when it applies› ──▶ 🤖 ‹what the agent does› ──▶ ✅ ‹outcome›\n```/);
  assert.match(pref.body, /\n\n## Notes\n\nseen in grover$/);
  assert.ok(isScaffold(architectureOf(pref.body)));
  const raw = readFileSync(join(b.root, "eggs", "terse.md"), "utf8");
  assert.match(raw, /^---\n[\s\S]*\n---\nBe terse\n\n## Architecture\n/);

  const script = b.lay({ id: "guard", kind: "script", summary: "Guard memory" });
  assert.match(architectureOf(script.body) ?? "", /📜 ‹script or skill›[\s\S]*### 📁 Files\n\n- `scripts\/guard`/);
  const skill = b.lay({ id: "ship", kind: "skill", summary: "Ship it", chicken: true });
  assert.deepEqual(archFiles(architectureOf(skill.body)), ["skills/chickens/ship/SKILL.md"]);
  assert.deepEqual(archFiles(scaffold("workflow", "w")), [], "placeholders aren't files");
});

test("lay takes a drawn architecture, and draw replaces it keeping everything else", () => {
  const b = fresh();
  b.lay({ id: "guard", kind: "script", summary: "Guard memory", architecture: GUARD, origin: { quote: "protect the machine" } });
  b.feedback("guard", { good: true, today: "2026-10-09" });
  const before = b.get("guard");
  assert.equal(architectureOf(before.body), GUARD);
  assert.deepEqual(archFiles(architectureOf(before.body)), ["scripts/guard", "scripts/guard.plist"]);
  const after = b.draw("guard", "## Architecture\n\n```text\n⚡ a ──▶ ✅ b\n```", "2026-10-10");
  assert.equal(architectureOf(after.body), "```text\n⚡ a ──▶ ✅ b\n```");
  assert.equal(withoutArchitecture(after.body), withoutArchitecture(before.body));
  assert.equal(after.good, 1);
  assert.equal(after.updated, "2026-10-10");
  assert.throws(() => b.draw("guard", "  "), /empty/);
  assert.throws(() => b.draw("guard", "x\n\n## Trials"), /## /);
});

test("withArchitecture moves leading notes under ## Notes", () => {
  assert.equal(withArchitecture("old note\n\n## Origin\n\n- 2026", "A"), "## Architecture\n\nA\n\n## Notes\n\nold note\n\n## Origin\n\n- 2026");
});

test("hatch and rename repoint the skill path in the item's own architecture", () => {
  const b = fresh();
  b.lay({ id: "ship", kind: "skill", summary: "Ship it" });
  assert.deepEqual(archFiles(architectureOf(b.hatch("ship").body)), ["skills/chickens/ship/SKILL.md"]);
  const { egg } = b.rename("ship", "ship-it");
  assert.deepEqual(archFiles(architectureOf(egg.body)), ["skills/chickens/ship-it/SKILL.md"]);
});

test("render indexes the drawn component maps and lists the items still to draw", () => {
  const b = fresh();
  b.lay({ id: "guard", kind: "script", summary: "Guard memory", architecture: GUARD });
  b.lay({ id: "terse", summary: "Be terse", chicken: true });
  b.lay({ id: "small", summary: "Small PRs", architecture: "```text\n⚡ PR ──▶ ✅ small\n```" });
  const out = b.render();
  assert.match(out, /## 🗺 Architecture\n\nEvery item opens with a diagram of what it automates: `deveggs arch <id>`\./);
  assert.match(out, /\| 📜 \| \[guard\]\(eggs\/guard\.md#architecture\) \| `scripts\/guard`, `scripts\/guard\.plist` \|/);
  assert.doesNotMatch(out, /\[small\]/, "simple preferences stay out of the table");
  assert.match(out, /✏️ To draw: `terse`$/m);
});

test("share keeps a drawn architecture, redacted, hides left-out items, and drops a scaffold", () => {
  const b = fresh();
  b.lay({ id: "secret-acct", summary: "Use my work account", tags: ["private"] });
  b.lay({
    id: "guard",
    kind: "script",
    summary: "Guard memory",
    architecture: "```text\n⚡ /Users/jane/x ──▶ ✅ ok\n```\n\n- 🔗 **Works with:** `secret-acct`, `terse`",
  });
  b.lay({ id: "terse", summary: "Be terse" });
  const plan = planShare(b.root, { home: "/Users/jane" });
  const guard = plan.files.find((f) => f.path === "eggs/guard.md")?.content ?? "";
  assert.match(guard, /\nGuard memory\n\n## Architecture\n\n```text\n⚡ ~\/x ──▶ ✅ ok\n```\n\n- 🔗 \*\*Works with:\*\* `<private>`, `terse`\n/);
  assert.ok(plan.items.find((i) => i.path === "eggs/guard.md")?.redactions.includes("private item"));
  const terse = sanitizeEgg(b.get("terse"), "");
  assert.equal(terse.egg.body, "");
  assert.ok(terse.redactions.includes("unfinished diagram"));
});

test("formatArchitecture frames the text diagram, drops mermaid and bold markers (snapshot)", () => {
  const out = formatArchitecture({ id: "guard", kind: "script", body: withArchitecture("", GUARD) }, plain);
  assert.equal(
    out,
    [
      "╭─ 🗺  guard · 📜 script ──────────────────────────────────────────────────────",
      "│ ⚡ launchd, every 15 s ──▶ 🛡 scripts/memory-guardian ──▶ ✅ machine stays up",
      "│",
      "│   ⚡ Fires when: memory pressure rises",
      "│   🔗 Works with: `fan-out`",
      "│",
      "│ 📁 Files",
      "│",
      "│   `scripts/guard`: one pass",
      "│   `scripts/guard.plist`: the launchd job",
      "╰──────────────────────────────────────────────────────────────────────────────",
    ].join("\n"),
  );
  for (const line of out.split("\n")) assert.ok(displayWidth(line) <= 100);
  assert.ok(!out.includes("\x1b["), "no color unless asked");
  assert.match(formatArchitecture({ id: "x", kind: "preference", body: "" }, plain), /no architecture yet; draw it: deveggs arch x --set <file>/);
  assert.match(formatArchitecture({ id: "x", kind: "preference", body: withArchitecture("", scaffold("preference", "x")) }, plain), /✏️ {2}still a sketch/);
  assert.match(formatArchitecture({ id: "guard", kind: "script", body: withArchitecture("", GUARD) }, { width: 100, color: true }), /\x1b\[1mFires when:/);
});

test("show leads with the architecture, before the metadata", () => {
  const b = fresh();
  b.lay({ id: "guard", kind: "script", summary: "Guard memory", architecture: GUARD });
  const out = formatShow(b.get("guard"), plain);
  assert.ok(out.indexOf("╭─ 🗺  guard") < out.indexOf("fact "), out);
  assert.match(out, /kind +📜 script/);
  assert.equal(out.match(/Fires when/g)?.length, 1, "the diagram is printed once");
});

test("the CLI shows the diagram on lay, feedback, hatch, arch, list of one, and draws with arch --set", () => {
  const box = sandbox();
  const lay = cli(box, "lay", "Guard memory", "--id", "guard", "--kind", "script");
  assert.equal(lay.status, 0, lay.stderr);
  assert.match(lay.stdout, /🥚 guard {2}\(script, ✓0 ✗0\)\n {5}Guard memory\n\n╭─ 🗺  guard · 📜 script/);
  assert.match(lay.stdout, /✏️ {2}still a sketch: fill in the ‹…› parts with deveggs arch guard --set <file>/);

  const file = join(box.dir, "guard-arch.md");
  writeFileSync(file, GUARD);
  const set = cli(box, "arch", "guard", "--set", file);
  assert.equal(set.status, 0, set.stderr);
  assert.match(set.stdout, /🗺 {2}architecture drawn\n\n╭─ 🗺  guard · 📜 script[\s\S]*⚡ launchd, every 15 s/);
  assert.doesNotMatch(set.stdout, /still a sketch/);
  assert.match(readFileSync(join(box.basket, "PREFERENCES.md"), "utf8"), /\[guard\]\(eggs\/guard\.md#architecture\)/);

  assert.match(cli(box, "arch", "guard").stdout, /^╭─ 🗺  guard · 📜 script[\s\S]*Files/);
  assert.match(cli(box, "feedback", "guard", "--good").stdout, /✓1 ✗0[\s\S]*╭─ 🗺  guard/);
  assert.match(cli(box, "list", "--kind", "script").stdout, /╭─ 🗺  guard/);
  cli(box, "lay", "Be terse", "--id", "terse");
  assert.doesNotMatch(cli(box, "list").stdout, /╭─/, "a list of several items stays a table");
  assert.match(cli(box, "hatch", "guard").stdout, /🐔 guard[\s\S]*╭─ 🗺  guard/);
  const evolve = cli(box, "evolve", "guard", "Guard memory harder", "--quote", "harder");
  assert.match(evolve.stdout, /╭─ 🗺  guard[\s\S]*did what it does change\? redraw it: deveggs arch guard --set <file>/);
  assert.match(cli(box, "arch", "nope").stderr, /nothing in the basket named "nope"/);
});

test("formatArchitecture wraps long prose to the width but never a diagram line", () => {
  const long = "x".repeat(30) + " ──▶ " + "y".repeat(30);
  const arch = `\`\`\`text\n${long}\n\`\`\`\n\n- ⚡ **Fires when:** ${"word ".repeat(30).trim()}`;
  const out = formatArchitecture({ id: "w", kind: "preference", body: withArchitecture("", arch) }, { width: 50, color: false }).split("\n");
  assert.ok(out.includes(`│ ${long}`), "the diagram line is kept whole");
  const prose = out.filter((l) => l.includes("word"));
  assert.ok(prose.length > 1, "the bullet wrapped");
  for (const l of prose) assert.ok(displayWidth(l) <= 50, l);
  assert.match(prose[1] ?? "", /^│ {6}word/, "continuation lines hang under the label");
});

test("share redacts URLs and emails before hiding left-out ids, and hides any spelling of them", () => {
  const b = fresh();
  b.lay({ id: "acme-deploy", summary: "Deploy acme", tags: ["private"] });
  b.lay({
    id: "ship",
    summary: "Ship it",
    architecture: "```text\n⚡ https://acme-deploy.internal.corp/hook ──▶ ✅ ok\n```\n\n- mail acme-deploy@corp.example.com · Acme_Deploy · acme deploy",
  });
  const ship = planShare(b.root).files.find((f) => f.path === "eggs/ship.md")?.content ?? "";
  for (const gone of ["internal.corp", "corp.example", "Acme_Deploy", "acme deploy"]) assert.ok(!ship.includes(gone), `${gone} leaked:\n${ship}`);
  assert.match(ship, /⚡ <url> ──▶/);
  assert.match(ship, /mail <email> · <private> · <private>/);
});

test("import points the diagram's skill path at skills/eggs/, and repointing leaves longer ids alone", () => {
  const b = fresh();
  b.lay({ id: "ship", kind: "skill", summary: "Ship it", chicken: true, architecture: "- `skills/chickens/ship/SKILL.md` · `skills/chickens/ship` · `skills/chickens/ship-it/SKILL.md`" });
  const source = b.get("ship");
  const other = fresh();
  const egg = other.borrow(source, { user: "someone", repo: "x/y" });
  assert.equal(architectureOf(egg.body), "- `skills/eggs/ship/SKILL.md` · `skills/eggs/ship` · `skills/chickens/ship-it/SKILL.md`");
});

test("lay refuses an Architecture section smuggled in through --note", () => {
  assert.throws(() => fresh().lay({ id: "x", summary: "X", note: "## Architecture\n\nboxes" }), /--arch/);
});

test("the CLI says which --arch or --set file it couldn't read, and lays nothing", () => {
  const box = sandbox();
  const r = cli(box, "lay", "Guard memory", "--id", "guard", "--arch", join(box.dir, "missing.md"));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /can't read the --arch file .*missing\.md: ENOENT/);
  assert.equal(existsSync(box.basket), false, "the basket isn't even created");
});

test("archFiles lists top-level bullets only, and bold text with $ renders as written", () => {
  assert.deepEqual(archFiles("### 📁 Files\n\n- `a.sh`: does\n  - `nested`: detail"), ["a.sh"]);
  const out = formatArchitecture({ id: "x", kind: "preference", body: withArchitecture("", "- **costs $$ and $& more:** yes") }, { width: 100, color: true });
  assert.match(out.replace(/\x1b\[[0-9;]*m/g, ""), /costs \$\$ and \$& more: yes/);
});
