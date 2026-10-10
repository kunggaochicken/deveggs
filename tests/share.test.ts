import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Basket, parseEgg } from "../src/basket.ts";
import { formatHistory } from "../src/history.ts";
import { autoTerms, cleanTerms, DEFAULT_SHARE_REPO, formatPreview, planShare, redact, sanitizeEgg, shareDir, writeShare } from "../src/share.ts";
import { cli, fakePath, git, sandbox } from "./sandbox.ts";

// Fake secrets are assembled at runtime so no secret scanner mistakes this file for a leak.
const GHP = "ghp_" + "A1b2C3d4E5".repeat(4);
const PAT = "github_pat_" + "11AbCdEfG0".repeat(3);
const SK = "sk-" + "ant-api03-" + "Zz9Yy8Xx7W".repeat(3);
const AKIA = "AKIA" + "ABCDEFGH23456789";
const SLACK = "xoxb-" + "1234567890-abcdefghij";
const HEX = "deadbeef".repeat(5);
const B64 = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7bC0eF3hJ6kL9n";
const KEY = ["-----BEGIN OPENSSH PRIVATE KEY-----", "b3BlbnNzaC1rZXktdjE", "-----END OPENSSH PRIVATE KEY-----"].join("\n");
const SESSION = "f4d588c7-b411-4631-b003-6e69a897a6c3";

const plain = { width: 200, color: false };

function redacts(input: string, label: string, gone: string, terms: string[] = [], home?: string): string {
  const hits = new Map<string, number>();
  const out = redact(input, terms, home, hits);
  assert.ok(!out.includes(gone), `${JSON.stringify(gone)} survived in ${JSON.stringify(out)}`);
  assert.ok((hits.get(label) ?? 0) > 0, `expected a ${label} hit for ${JSON.stringify(input)}, got ${JSON.stringify([...hits])}`);
  return out;
}

test("redact removes tokens and secrets", () => {
  for (const token of [GHP, PAT, SK, AKIA, SLACK, HEX, B64]) {
    assert.equal(redacts(`use ${token} here`, "token", token), "use <token> here");
  }
  assert.equal(redacts(`key:\n${KEY}\nend`, "secret", "b3BlbnNzaC1rZXktdjE"), "key:\n<secret>\nend");
  assert.equal(redacts("export API_KEY=hunter2hunter2", "secret", "hunter2"), "export API_KEY=<secret>");
  assert.equal(redacts('password: "s3cr3t-value"', "secret", "s3cr3t"), 'password: "<secret>"');
});

test("redact removes emails, repo URLs and URLs", () => {
  assert.equal(redacts("mail james@example.co.uk now", "email", "james@"), "mail <email> now");
  assert.equal(redacts("as 42872088+someone@users.noreply.github.com", "email", "someone"), "as <email>");
  assert.equal(redacts("clone git@github.com:acme/secret-repo.git", "repo-url", "secret-repo"), "clone <repo-url>");
  assert.equal(redacts("see https://github.com/acme/internal/pull/12.", "url", "acme"), "see <url>.");
  assert.equal(redacts("(ssh://git@host.internal/x)", "url", "host.internal"), "(<url>)");
});

test("redact removes session ids and home paths", () => {
  assert.equal(redacts(`session ${SESSION}`, "session", SESSION), "session <session>");
  assert.equal(redacts("at /Users/jane/Projects/app/x.ts", "path", "jane"), "at ~/Projects/app/x.ts");
  assert.equal(redacts("at /home/jane/app", "path", "jane"), "at ~/app");
  assert.equal(redacts("at C:\\Users\\jane\\app", "path", "jane"), "at ~\\app");
  assert.equal(redacts("run /srv/me/x", "path", "/srv/me", [], "/srv/me"), "run ~/x");
  assert.equal(redact("system paths stay: /usr/bin/env, /bin/bash"), "system paths stay: /usr/bin/env, /bin/bash");
});

test("redact removes private terms as whole words, case-insensitively", () => {
  assert.equal(redacts("Deploy Acme Corp's acme-api", "private", "Acme", cleanTerms(["acme corp", "acme"])), "Deploy <private>'s <private>-api");
  assert.equal(redact("acmeish stays", ["acme"]), "acmeish stays");
});

test("redact leaves ordinary text alone", () => {
  const text = "Always land changes through a PR; ids like everything-related-to-deveggs-the-deveggs-repo stay.";
  const hits = new Map<string, number>();
  assert.equal(redact(text, [], undefined, hits), text);
  assert.equal(hits.size, 0);
});

const raw = [
  "---",
  "id: ship-it",
  "kind: preference",
  "tags: git, acme",
  "harnesses: claude-code, codex",
  "good: 2",
  "bad: 0",
  "laid: 2026-10-07",
  "updated: 2026-10-08",
  "context: laid in acme-web",
  "---",
  "Ship small PRs to acme often; ping jane@acme.io",
  "",
  "A note about the acme deploy.",
  "",
  "## Origin",
  "",
  "> ship it from /Users/jane/acme with " + GHP,
  "",
  `- 2026-10-07 · claude-code · acme-web · session ${SESSION}`,
  "",
  "## Trials",
  "",
  "- 2026-10-08 ✓ (codex) shipped acme#12 fine",
].join("\n");

test("sanitizeEgg keeps the fact and drops quote, context, harness, notes and trial notes", () => {
  const egg = parseEgg(raw, "egg");
  const { egg: clean, redactions } = sanitizeEgg(egg, raw, { home: "/Users/jane" }, ["acme"]);
  assert.equal(clean.summary, "Ship small PRs to <private> often; ping <email>");
  assert.deepEqual(clean.tags, ["git"]);
  assert.deepEqual(clean.harnesses, []);
  assert.equal(clean.body, "");
  assert.equal(clean.good, 2);
  for (const label of ["quote", "context", "harness", "trial notes", "notes", "email", "private×2"]) assert.ok(redactions.includes(label), label);
});

test("sanitizeEgg keeps a redacted quote only with keepQuotes", () => {
  const egg = parseEgg(raw, "egg");
  const { egg: clean, history, redactions } = sanitizeEgg(egg, raw, { keepQuotes: true, home: "/Users/jane" }, ["acme"]);
  assert.equal(clean.body, "");
  assert.deepEqual(history, [{ date: "2026-10-07", event: "laid", version: 1, quote: "ship it from ~/<private> with <token>", fields: { fact: "Ship small PRs to <private> often; ping <email>" } }]);
  assert.ok(!redactions.includes("quote"));
  assert.ok(redactions.includes("token") && redactions.includes("path"));
  const text = formatHistory("ship-it", history);
  assert.ok(!text.includes(SESSION) && !text.includes("acme-web") && !text.includes("codex") && !text.includes("shipped"));
});

test("autoTerms picks up origin repos and the home folder, but not public names", () => {
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-share-")));
  b.lay({ summary: "One", harness: "claude-code", origin: { repo: "cuskeel", session: "abc" } });
  b.lay({ summary: "Two", origin: { repo: "deveggs" } });
  b.lay({ summary: "Three", origin: { repo: "jane" } });
  b.lay({ summary: "Four", origin: { repo: "ab" } });
  const histories = new Map(b.all().map((e) => [e.id, b.history(e.id)]));
  assert.deepEqual(autoTerms(b.all(), "/Users/jdoe", ["jane"], histories), ["cuskeel", "jdoe"]);
});

test("sanitizeEgg keeps an evolution's was/now but drops its quote, context and why unless keepQuotes", () => {
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-share-")));
  b.lay({ id: "terse", summary: "One-line summaries for acme", harness: "claude", origin: { quote: "one line", repo: "moonjelly" } });
  b.evolve("terse", {
    summary: "One-line summaries, except decisions",
    quote: `options please, see /Users/jane/notes with ${GHP}`,
    note: "narrow: the acme review",
    harness: "codex",
    repo: "moonjelly",
    session: SESSION,
    today: "2026-10-08",
  });
  b.feedback("terse", { good: false, harness: "codex", repo: "moonjelly", scenario: "acme review", cause: "too broad", today: "2026-10-09" });
  b.hatch("terse", { today: "2026-10-10", note: "acme says yes", quote: "hatch it" });
  const egg = b.get("terse");
  const history = b.history("terse");
  assert.deepEqual(autoTerms([egg], undefined, [], new Map([["terse", history]])), ["moonjelly"], "the evolve repo is a private term; harnesses aren't");
  const plain = sanitizeEgg(egg, "", { home: "/Users/jane" }, ["acme", "moonjelly"], history);
  assert.equal(plain.egg.body, "");
  assert.equal(
    formatHistory("terse", plain.history).split("-->\n\n")[1],
    "## 2026-10-10 · laid · v1\n\n- fact: One-line summaries for <private>\n\n" +
      "## 2026-10-08 · evolved · v2\n\n- was: One-line summaries for <private>\n- now: One-line summaries, except decisions\n\n" +
      "## 2026-10-10 · hatched · v2\n\n- trials: ✓0 ✗1 (v2)\n",
  );
  assert.equal(plain.egg.version, 2);
  for (const label of ["quote", "evolution quote", "context", "notes", "trial notes"]) assert.ok(plain.redactions.includes(label), label);
  const kept = sanitizeEgg(egg, "", { keepQuotes: true, home: "/Users/jane" }, ["acme", "moonjelly"], history);
  const text = formatHistory("terse", kept.history);
  assert.match(text, /## 2026-10-08 · evolved · v2\n\n> options please, see ~\/notes with <token>\n\n- was:/);
  assert.match(text, /> one line\n/);
  assert.match(text, /> hatch it\n/);
  assert.ok(!kept.redactions.includes("evolution quote"));
  for (const gone of ["moonjelly", SESSION, "codex", "acme", GHP, "too broad", "says yes"]) assert.ok(!text.includes(gone), `${gone} leaked`);
});

/** A basket with one of everything `share` has to decide about. */
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "deveggs-share-"));
  const b = new Basket(root);
  b.lay({ id: "small-prs", summary: "Prefer small PRs", chicken: true, harness: "codex", origin: { quote: "keep PRs small, like in moonjelly", repo: "moonjelly", session: SESSION } });
  b.lay({ id: "diagrams", summary: "Explain with diagrams", tags: ["explaining"], origin: { quote: "draw it" } });
  b.feedback("diagrams", { good: true, note: "helped on the acme migration" });
  b.lay({ id: "rejected", summary: "Always use tabs" });
  b.crack("rejected");
  b.lay({ id: "client-zeta-deploy", summary: "Deploy via the zeta pipeline" });
  b.lay({ id: "skip-me", summary: "Something embarrassing" });
  b.lay({ id: "work-account", summary: "Use the work GitHub account", tags: ["git", "private"] });
  b.lay({ id: "local-tool", kind: "skill", summary: "Run the in-house tool", tags: ["private"] });
  b.lay({ id: "review", kind: "skill", summary: "Review a PR", chicken: true });
  writeFileSync(join(b.skillDir("chicken", "review"), "SKILL.md"), `---\nname: review\n---\nRun /home/jdoe/bin/lint with ${GHP}\n`);
  b.lay({ id: "old-skill", kind: "skill", summary: "Old skill" });
  b.crack("old-skill");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "guard"), "#!/bin/sh\nexec /Users/jdoe/.deveggs/scripts/run --mail me@corp.example\n");
  chmodSync(join(root, "scripts", "guard"), 0o755);
  writeFileSync(join(root, "scripts", "blob.bin"), Buffer.from([1, 0, 2]));
  mkdirSync(join(root, "logs"));
  writeFileSync(join(root, "logs", "guard.log"), "secret log\n");
  writeFileSync(join(root, "private-terms.txt"), "# clients\nzeta\n\n");
  b.render();
  return root;
}

const byPath = (plan: ReturnType<typeof planShare>, path: string) => {
  const item = plan.items.find((i) => i.path === path);
  assert.ok(item, `no item ${path} in ${plan.items.map((i) => i.path).join(", ")}`);
  return item;
};

test("planShare shares sanitized chickens, eggs and skills, and leaves out the rest", () => {
  const root = fixture();
  const plan = planShare(root, { skip: ["skip-me"], home: "/Users/jdoe" });
  const paths = plan.files.map((f) => f.path).sort();
  assert.deepEqual(paths, [
    "chickens/review.history.md",
    "chickens/review.md",
    "chickens/small-prs.history.md",
    "chickens/small-prs.md",
    "eggs/diagrams.history.md",
    "eggs/diagrams.md",
    "skills/chickens/review/SKILL.md",
  ]);
  assert.ok(!paths.some((p) => /work-account|local-tool|rejected|skip-me|zeta/.test(p)), "no history for items left out");
  assert.equal(byPath(plan, "cracked/rejected.md").why, "cracked");
  assert.equal(byPath(plan, "cracked/old-skill.md").why, "cracked");
  assert.equal(byPath(plan, "skills/cracked/old-skill/SKILL.md").why, "cracked");
  assert.equal(byPath(plan, "eggs/skip-me.md").why, "skipped (--skip)");
  assert.equal(byPath(plan, "eggs/work-account.md").why, "tagged private");
  assert.equal(byPath(plan, "eggs/local-tool.md").why, "tagged private");
  assert.equal(byPath(plan, "skills/eggs/local-tool/SKILL.md").why, "tagged private");
  assert.match(byPath(plan, "eggs/client-zeta-deploy.md").why ?? "", /private term/);
  assert.match(byPath(plan, "scripts/guard").why ?? "", /--include-scripts/);
  assert.ok(plan.terms.includes("zeta") && plan.terms.includes("moonjelly") && plan.terms.includes("jdoe"));
  const all = plan.files.map((f) => f.content).join("\n");
  for (const gone of ["moonjelly", SESSION, GHP, "/home/jdoe", "acme", "keep PRs small", "codex", "secret log"]) {
    assert.ok(!all.includes(gone), `${gone} leaked`);
  }
  const small = plan.files.find((f) => f.path === "chickens/small-prs.md")?.content ?? "";
  assert.equal(parseEgg(small, "chicken").summary, "Prefer small PRs");
  assert.ok(!paths.some((p) => p.startsWith("logs/") || p === "PREFERENCES.md" || p === "README.md" || p === "private-terms.txt"));
});

test("planShare includes scripts only with includeScripts, redacted, and never binaries", () => {
  const plan = planShare(fixture(), { includeScripts: true, home: "/Users/jdoe" });
  const script = plan.files.find((f) => f.path === "scripts/guard");
  assert.ok(script);
  assert.equal(script.content, "#!/bin/sh\nexec ~/.deveggs/scripts/run --mail <email>\n");
  assert.equal(script.executable, true);
  assert.deepEqual(byPath(plan, "scripts/guard").redactions, ["path", "email"]);
  assert.equal(byPath(plan, "scripts/blob.bin").why, "binary file");
});

test("the preview lists every item with what was removed or redacted", () => {
  const plan = planShare(fixture(), { home: "/Users/jdoe" });
  const out = formatPreview(plan, "acme/baskets: baskets/tester/", plain);
  assert.match(out, /nothing has left your machine/);
  assert.match(out, /chickens\/small-prs\.md\s+quote, context, harness, unfinished diagram\s+Prefer small PRs/);
  assert.match(out, /eggs\/diagrams\.md\s+quote, trial notes, unfinished diagram\s+Explain with diagrams/);
  assert.match(out, /skills\/chickens\/review\/SKILL\.md\s+token, path/);
  assert.match(out, /cracked\/rejected\.md\s+left out: cracked/);
  assert.match(out, /scripts\/guard\s+left out: scripts/);
  assert.match(out, /private terms redacted: .*moonjelly/);
});

test("writeShare replaces the folder with exactly the planned files", () => {
  const plan = planShare(fixture(), { includeScripts: true });
  const dir = join(mkdtempSync(join(tmpdir(), "deveggs-share-")), "baskets", "tester");
  mkdirSync(join(dir, "eggs"), { recursive: true });
  writeFileSync(join(dir, "eggs", "stale.md"), "old");
  writeShare(plan, dir);
  assert.equal(existsSync(join(dir, "eggs", "stale.md")), false);
  assert.ok(existsSync(join(dir, "skills", "chickens", "review", "SKILL.md")));
  assert.ok((statSync(join(dir, "scripts", "guard")).mode & 0o100) !== 0);
});

// --- the command ---------------------------------------------------------------

function layBasket(box: ReturnType<typeof sandbox>): void {
  cli(box, "lay", "Prefer small PRs", "--id", "small-prs", "--quote", "keep them small", "--repo", "moonjelly", "--session", SESSION, "--harness", "codex");
  cli(box, "lay", "Use tabs", "--id", "tabs");
  cli(box, "crack", "tabs");
}

/** A local stand-in for GitHub: <base>/<owner>/<name>.git bare repos, and a fake gh. */
function fakeGitHub(box: ReturnType<typeof sandbox>, canPush: boolean): { base: string; upstream: string; fork: string; ghLog: string } {
  const base = join(box.dir, "github") + "/";
  const upstream = join(base, DEFAULT_SHARE_REPO + ".git");
  const fork = join(base, "tester", "deveggs-baskets.git");
  const seed = join(box.dir, "seed");
  mkdirSync(seed);
  git(box, seed, "init", "-q", "-b", "main");
  writeFileSync(join(seed, "README.md"), "baskets\n");
  git(box, seed, "add", "-A");
  git(box, seed, "commit", "-q", "-m", "init");
  mkdirSync(join(base, "kunggaochicken"), { recursive: true });
  git(box, box.dir, "clone", "-q", "--bare", seed, upstream);
  mkdirSync(join(base, "tester"), { recursive: true });
  git(box, box.dir, "clone", "-q", "--bare", seed, fork);
  const ghLog = join(box.dir, "gh.log");
  const bin = fakePath(box, {
    gh: [
      `echo "$@" >> ${ghLog}`,
      `case "$1" in api) echo ${canPush};; pr) echo https://github.com/${DEFAULT_SHARE_REPO}/pull/7;; esac`,
    ].join("\n"),
  });
  box.env["PATH"] = bin;
  box.env["DEVEGGS_GIT_BASE"] = base;
  return { base, upstream, fork, ghLog };
}

test("share --dry-run prints the preview and writes nothing", () => {
  const box = sandbox();
  layBasket(box);
  const before = git(box, box.basket, "rev-parse", "HEAD");
  const r = cli(box, "share", "--dry-run", "--as", "tester");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /kunggaochicken\/deveggs-baskets: baskets\/tester\//);
  assert.match(r.stdout, /eggs\/small-prs\.md\s+quote, context, harness/);
  assert.match(r.stdout, /cracked\/tabs\.md\s+left out: cracked/);
  assert.match(r.stdout, /--dry-run: nothing written or pushed/);
  assert.equal(git(box, box.basket, "rev-parse", "HEAD"), before);
  assert.equal(git(box, box.basket, "status", "--porcelain"), "");
});

test("share without --yes and without a terminal stops before pushing", () => {
  const box = sandbox();
  layBasket(box);
  const gh = fakeGitHub(box, true);
  const r = cli(box, "share", "--as", "tester");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /rerun with --yes/);
  assert.equal(existsSync(gh.ghLog), false);
  assert.throws(() => git(box, box.dir, "--git-dir", gh.upstream, "rev-parse", "--verify", "share/tester"));
});

test("share --yes commits only baskets/<user>/ on a branch, pushes it and opens a PR", () => {
  const box = sandbox();
  layBasket(box);
  const gh = fakeGitHub(box, true);
  const r = cli(box, "share", "--as", "tester", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /opened https:\/\/github\.com\/kunggaochicken\/deveggs-baskets\/pull\/7/);
  const files = git(box, box.dir, "--git-dir", gh.upstream, "diff", "--name-only", "main", "share/tester").split("\n");
  assert.deepEqual(files, ["baskets/tester/eggs/small-prs.history.md", "baskets/tester/eggs/small-prs.md"]);
  const shared = ["small-prs.md", "small-prs.history.md"]
    .map((f) => git(box, box.dir, "--git-dir", gh.upstream, "show", `share/tester:baskets/tester/eggs/${f}`))
    .join("\n");
  assert.ok(!shared.includes("moonjelly") && !shared.includes(SESSION) && !shared.includes("keep them small"));
  assert.equal(git(box, box.dir, "--git-dir", gh.upstream, "log", "-1", "--format=%s", "share/tester"), "baskets: tester's basket");
  const calls = readFileSync(gh.ghLog, "utf8");
  assert.match(calls, /pr create --repo kunggaochicken\/deveggs-baskets --base main --head share\/tester/);
  assert.doesNotMatch(calls, /repo fork/);
});

test("share pushes to the developer's fork when they can't push to the repo", () => {
  const box = sandbox();
  layBasket(box);
  const gh = fakeGitHub(box, false);
  const r = cli(box, "share", "--as", "tester", "--yes");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(box, box.dir, "--git-dir", gh.fork, "ls-tree", "-r", "--name-only", "share/tester", "baskets"), "baskets/tester/eggs/small-prs.history.md\nbaskets/tester/eggs/small-prs.md");
  const calls = readFileSync(gh.ghLog, "utf8");
  assert.match(calls, /repo fork kunggaochicken\/deveggs-baskets --clone=false/);
  assert.match(calls, /--head tester:share\/tester/);
});

test("share --repo and --dir pick another destination; bad values are rejected", () => {
  const box = sandbox();
  layBasket(box);
  const r = cli(box, "share", "--dry-run", "--as", "tester", "--repo", "me/my-baskets", "--dir", "people/tester");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /me\/my-baskets: people\/tester\//);
  assert.match(cli(box, "share", "--dry-run", "--as", "tester", "--repo", "nope").stderr, /invalid --repo/);
  assert.match(cli(box, "share", "--dry-run", "--as", "bad name").stderr, /invalid --as/);
  assert.match(cli(box, "share", "--dry-run", "--as", "tester", "--dir", "../x").stderr, /invalid --dir/);
  assert.equal(shareDir("tester"), "baskets/tester");
});

test("sanitizeEgg keeps a rename in the history, redacting the old id", () => {
  const b = new Basket(mkdtempSync(join(tmpdir(), "deveggs-share-")));
  b.lay({ id: "acme-terse", summary: "One-line summaries" });
  b.rename("acme-terse", "terse", { today: "2026-10-08", note: "drop the acme" });
  const { history } = sanitizeEgg(b.get("terse"), "", {}, ["acme"], b.history("terse"));
  assert.deepEqual(history.at(-1), { date: "2026-10-08", event: "renamed", version: 1, fields: { from: "<private>-terse", to: "terse" } });
});
