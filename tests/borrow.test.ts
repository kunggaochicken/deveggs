import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Basket, parseEgg } from "../src/basket.ts";
import { type Checkout, findShared, formatBaskets, formatItems, parseRef, sharedBasket, sharedBaskets, sharedUsers, withBaskets } from "../src/borrow.ts";
import { DEFAULT_SHARE_REPO, originRepos } from "../src/share.ts";
import { cli, fakePath, git, sandbox, subjects } from "./sandbox.ts";

const plain = { width: 120, color: false };
const from = { user: "alice", repo: DEFAULT_SHARE_REPO };

const item = (id: string, opts: { kind?: string; tags?: string; good?: number; body?: string; fact: string }): string =>
  [
    "---",
    `id: ${id}`,
    `kind: ${opts.kind ?? "preference"}`,
    `tags: ${opts.tags ?? ""}`,
    "harnesses: claude-code",
    `good: ${opts.good ?? 0}`,
    "bad: 0",
    "laid: 2026-09-01",
    "updated: 2026-09-20",
    "---",
    opts.fact,
    ...(opts.body ? ["", opts.body] : []),
    "",
  ].join("\n");

/** A checkout of a baskets repo with two shared baskets, written to `dir`. */
function writeBaskets(dir: string): string {
  const put = (path: string, text: string): void => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  put("README.md", "# deveggs baskets\n");
  put("baskets/.gitkeep", "");
  put("baskets/alice/README.md", "# Alice\n\nSmall PRs, lots of diagrams.\n");
  put("baskets/alice/chickens/small-prs.md", item("small-prs", {
    tags: "git",
    good: 4,
    fact: "Keep PRs under 300 lines",
    body: "## Origin\n\n> keep them small\n\n## Trials\n\n- 2026-09-10 ✓ (codex) easy review",
  }));
  put("baskets/alice/eggs/diagrams.md", item("diagrams", { tags: "explaining", good: 1, fact: "Explain with a diagram" }));
  put("baskets/alice/eggs/diagrams.history.md", [
    "# diagrams: history",
    "",
    "## 2026-09-01 · laid · v1",
    "",
    "- fact: Explain with a picture",
    "",
    "## 2026-09-02 · trial ✓ · v1",
    "",
    "- note: someone else's trial",
    "",
    "## 2026-09-03 · evolved · v2",
    "",
    "- was: Explain with a picture",
    "- now: Explain with a diagram",
    "",
  ].join("\n"));
  put("baskets/alice/chickens/review.md", item("review", { kind: "skill", tags: "git", fact: "Review a PR before merging" }));
  put("baskets/alice/skills/chickens/review/SKILL.md", "---\nname: review\ndescription: Review a PR before merging\n---\n\n# review\n");
  put("baskets/alice/cracked/tabs.md", item("tabs", { fact: "Use tabs" }));
  put("baskets/alice/eggs/broken.md", "no frontmatter\n");
  put("baskets/bob/eggs/tests-first.md", item("tests-first", { kind: "workflow", tags: "testing", fact: "Write the failing test first" }));
  return dir;
}

const checkout = (): string => writeBaskets(mkdtempSync(join(tmpdir(), "deveggs-baskets-")));

test("sharedBaskets reads each user's chickens, eggs and skills, and skips cracked and broken items", () => {
  const dir = checkout();
  assert.deepEqual(sharedUsers(dir), ["alice", "bob"]);
  const alice = sharedBasket(dir, "alice");
  assert.equal(alice.about, "Small PRs, lots of diagrams.");
  assert.deepEqual(alice.items.map((i) => `${i.egg.tier}:${i.egg.id}`), ["chicken:review", "chicken:small-prs", "egg:diagrams"]);
  assert.ok(alice.items.find((i) => i.egg.id === "review")?.skill?.endsWith(join("skills", "chickens", "review")));
  assert.equal(sharedBaskets(dir).length, 2);
  assert.throws(() => sharedBasket(dir, "carol"), /no shared basket for carol/);
  assert.throws(() => findShared(dir, "alice", "tabs"), /no egg or chicken named tabs/);
  assert.deepEqual(sharedUsers(mkdtempSync(join(tmpdir(), "deveggs-baskets-"))), []);
});

test("parseRef takes <username>/<id> and rejects anything else", () => {
  assert.deepEqual(parseRef("alice/small-prs"), { user: "alice", id: "small-prs" });
  for (const bad of [undefined, "alice", "alice/", "/x", "a/b/c", "alice/../x", "bad name/x", "alice/Not_An_Id"]) {
    assert.throws(() => parseRef(bad), Error, String(bad));
  }
});

test("withBaskets hands over the checkout and always cleans it up", () => {
  let cleaned = 0;
  const fake = (repo: string): Checkout => {
    assert.equal(repo, "acme/baskets");
    return { dir: checkout(), cleanup: () => cleaned++ };
  };
  assert.deepEqual(withBaskets(fake, "acme/baskets", sharedUsers), ["alice", "bob"]);
  assert.throws(() => withBaskets(fake, "acme/baskets", () => {
    throw new Error("boom");
  }));
  assert.equal(cleaned, 2);
});

test("formatBaskets lists usernames with counts, or says there are none", () => {
  const out = formatBaskets(sharedBaskets(checkout()), DEFAULT_SHARE_REPO, plain);
  assert.match(out, /^shared baskets in kunggaochicken\/deveggs-baskets/);
  assert.match(out, /alice\s+2\s+1\s+1\s+Small PRs, lots of diagrams\./);
  assert.match(out, /bob\s+0\s+1\s+0/);
  assert.match(out, /deveggs import <username>\/<id>/);
  assert.equal(formatBaskets([], "o/n", plain), "no shared baskets in o/n yet. Share yours: deveggs share --dry-run");
});

test("formatItems shows tier, id, kind, tags and fact", () => {
  const dir = checkout();
  const out = formatItems(sharedBasket(dir, "alice").items, "alice's basket", plain, "alice");
  assert.match(out, /🐔\s+small-prs\s+preference\s+git\s+Keep PRs under 300 lines/);
  assert.match(out, /🥚\s+diagrams\s+preference\s+explaining\s+Explain with a diagram/);
  assert.match(out, /deveggs import alice\/<id>/);
  const all = formatItems(sharedBaskets(dir).flatMap((b) => b.items), "all", plain);
  assert.match(all, /bob\/tests-first\s+workflow/);
  assert.match(formatItems([], "none", plain), /nothing matches/);
});

test("Basket.borrow adds a chicken as an egg with trials reset and a borrowed-from origin", () => {
  const dir = checkout();
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-basket-")));
  const egg = b.borrow(findShared(dir, "alice", "small-prs").egg, from, undefined, "2026-10-08");
  assert.equal(egg.tier, "egg");
  assert.deepEqual([egg.good, egg.bad, egg.harnesses, egg.tags, egg.laid], [0, 0, [], ["git"], "2026-10-08"]);
  const text = readFileSync(join(b.root, "eggs", "small-prs.md"), "utf8");
  assert.equal(existsSync(join(b.root, "chickens", "small-prs.md")), false);
  assert.doesNotMatch(text, /## Trials|## Origin|easy review/);
  assert.deepEqual(parseEgg(text, "egg").summary, "Keep PRs under 300 lines");
  const history = b.history("small-prs");
  assert.deepEqual(history.map((e) => [e.date, e.event, e.quote]), [["2026-09-01", "laid", "keep them small"], ["2026-10-08", "imported", undefined]]);
  assert.deepEqual(history[1]?.fields, { fact: "Keep PRs under 300 lines", from: "alice", basket: "kunggaochicken/deveggs-baskets", note: "was their chicken" });
  assert.doesNotMatch(readFileSync(join(b.root, "eggs", "small-prs.history.md"), "utf8"), /easy review/, "their trials stay theirs");
  assert.deepEqual(originRepos(egg, history), [], "an import is not a private repo to redact");
});

test("Basket.borrow brings a shared history file along, without its trials", () => {
  const dir = checkout();
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-basket-")));
  const shared = findShared(dir, "alice", "diagrams");
  assert.equal(shared.history?.length, 3);
  b.borrow(shared.egg, from, undefined, "2026-10-08", shared.history);
  assert.deepEqual(b.history("diagrams").map((e) => `${e.date} ${e.event} v${e.version}`), ["2026-09-01 laid v1", "2026-09-03 evolved v2", "2026-10-08 imported v1"]);
});

test("Basket.borrow starts a history when the shared item has none, and copies its skill as an egg skill", () => {
  const dir = checkout();
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-basket-")));
  const review = findShared(dir, "alice", "review");
  b.borrow(review.egg, from, review.skill, "2026-10-08");
  assert.deepEqual(b.history("review").map((e) => e.event), ["imported"]);
  const skill = readFileSync(join(b.skillDir("egg", "review"), "SKILL.md"), "utf8");
  assert.match(skill, /^description: \[egg: on trial\] Review a PR before merging$/m);
  b.hatch("review");
  assert.match(readFileSync(join(b.skillDir("chicken", "review"), "SKILL.md"), "utf8"), /^description: Review a PR before merging$/m);
});

test("Basket.borrow refuses an id already in the basket, or cracked there", () => {
  const dir = checkout();
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-basket-")));
  b.lay({ id: "small-prs", summary: "Mine" });
  assert.throws(() => b.borrow(findShared(dir, "alice", "small-prs").egg, from), /already an egg/);
  b.lay({ id: "diagrams", summary: "Nope" });
  b.crack("diagrams");
  assert.throws(() => b.borrow(findShared(dir, "alice", "diagrams").egg, from), /cracked/);
  assert.equal(b.get("small-prs").summary, "Mine");
});

// --- the commands --------------------------------------------------------------

/** A local stand-in for GitHub holding the baskets repo, and a PATH with only git. */
function fakeBasketsRepo(box: ReturnType<typeof sandbox>, empty = false): void {
  const base = join(box.dir, "github") + "/";
  const seed = join(box.dir, "seed");
  mkdirSync(seed);
  if (empty) {
    mkdirSync(join(seed, "baskets"));
    writeFileSync(join(seed, "baskets", ".gitkeep"), "");
  } else writeBaskets(seed);
  git(box, seed, "init", "-q", "-b", "main");
  git(box, seed, "add", "-A");
  git(box, seed, "commit", "-q", "-m", "init");
  mkdirSync(join(base, "kunggaochicken"), { recursive: true });
  git(box, box.dir, "clone", "-q", "--bare", seed, join(base, `${DEFAULT_SHARE_REPO}.git`));
  box.env["PATH"] = fakePath(box, {});
  box.env["DEVEGGS_GIT_BASE"] = base;
  box.env["COLUMNS"] = "120";
}

test("browse lists shared baskets, one basket's items, and filters by tag and kind", () => {
  const box = sandbox();
  fakeBasketsRepo(box);
  const all = cli(box, "browse");
  assert.equal(all.status, 0, all.stderr);
  assert.match(all.stdout, /alice\s+2\s+1\s+1/);
  const alice = cli(box, "browse", "alice");
  assert.match(alice.stdout, /^alice's basket in kunggaochicken\/deveggs-baskets: Small PRs, lots of diagrams\./);
  assert.match(alice.stdout, /🐔\s+small-prs\s+preference\s+git\s+Keep PRs under 300 lines/);
  const tagged = cli(box, "browse", "alice", "--tag", "git").stdout;
  assert.match(tagged, /small-prs/);
  assert.doesNotMatch(tagged, /Explain with a diagram/);
  const kind = cli(box, "browse", "--kind", "workflow").stdout;
  assert.match(kind, /🥚\s+bob\/tests-first\s+workflow\s+testing\s+Write the failing test first/);
  assert.doesNotMatch(kind, /alice\//);
  assert.match(cli(box, "browse", "carol").stderr, /no shared basket for carol/);
  assert.match(cli(box, "browse", "--repo", "nope").stderr, /invalid --repo/);
  assert.match(cli(box, "browse", "--repo", "acme/missing").stderr, /couldn't fetch acme\/missing/);
  assert.equal(existsSync(box.basket), false, "browse never creates the basket");
});

test("browse says when the baskets repo is empty", () => {
  const box = sandbox();
  fakeBasketsRepo(box, true);
  const r = cli(box, "browse");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "no shared baskets in kunggaochicken/deveggs-baskets yet. Share yours: deveggs share --dry-run");
});

test("import borrows a chicken and its skill as an egg, commits it and re-renders PREFERENCES.md", () => {
  const box = sandbox();
  fakeBasketsRepo(box);
  const r = cli(box, "import", "alice/review");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /🥚 review {2}\(skill, ✓0 ✗0\) \[git\]/);
  assert.match(r.stdout, /borrowed from alice's basket in kunggaochicken\/deveggs-baskets/);
  assert.ok(existsSync(join(box.basket, "eggs", "review.md")));
  assert.match(readFileSync(join(box.basket, "skills", "eggs", "review", "SKILL.md"), "utf8"), /\[egg: on trial\] Review a PR/);
  assert.equal(subjects(box)[0], "egg: import review from alice");
  assert.match(readFileSync(join(box.basket, "PREFERENCES.md"), "utf8"), /`review`.*✓0 ✗0/);
  assert.equal(git(box, box.basket, "status", "--porcelain"), "");
});

test("import refuses an id already in the basket or cracked, and unknown items", () => {
  const box = sandbox();
  fakeBasketsRepo(box);
  cli(box, "lay", "My own", "--id", "small-prs");
  assert.match(cli(box, "import", "alice/small-prs").stderr, /already has small-prs \(egg\)/);
  cli(box, "lay", "Old", "--id", "diagrams");
  cli(box, "crack", "diagrams");
  assert.match(cli(box, "import", "alice/diagrams").stderr, /diagrams was cracked/);
  assert.match(cli(box, "import", "alice/tabs").stderr, /no egg or chicken named tabs/);
  assert.match(cli(box, "import", "alice").stderr, /usage: deveggs import/);
  assert.equal(subjects(box)[0], "crack: diagrams");
});
