import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatArchitecture } from "./architecture.ts";
import { Basket, BasketError, type Egg, type EventInput, isKind, isReady, KINDS, READY_AFTER, TIERS } from "./basket.ts";
import { cloneBaskets, type FetchBaskets, findShared, formatBaskets, formatItems, isGitHubUser, matches, parseRef, sharedBasket, sharedBaskets, withBaskets } from "./borrow.ts";
import { EVENTS, filterHistory, type HistoryEntry, type HistoryEvent, type LoggedMove, movesFromLog } from "./history.ts";
import { hasContent, legacyBasket, lnCommand, migrate, relink, renameLinks } from "./migrate.ts";
import { autopushEnabled, basketPath, ensureBasket, originUrl, pushBasket, run, saveBasket, setAutopush, webUrl } from "./store.ts";
import { DEFAULT_SHARE_REPO, formatPreview, planShare, publishShare, shareDir } from "./share.ts";
import { formatList, formatShow, formatTimeline, mark, terminalOptions, trialCounts } from "./view.ts";

const USAGE = `deveggs: a basket of eggs for the agentic developer

  🥚 egg      on trial: a new preference/workflow/script/skill you're playing with
  🐔 chicken  hatched: you liked it, so it's permanent
  💥 cracked  rejected: kept so it's never laid again

usage:
  deveggs lay "<one-sentence fact>" [--id short-name] [--kind ${KINDS.join("|")}]
                                     [--tag t1,t2] [--harness name] [--note text] [--chicken]
                                     (tag "private" keeps it out of deveggs share)
                                     [--quote "<developer's words>"] [--repo name] [--session id]
                                     [--arch <file|->]  its architecture diagram (default: a
                                     scaffold for its kind to fill in with deveggs arch)
  deveggs feedback <id> --good|--bad [--harness name] [--note text]
                [--scenario text] [--result text] [--cause text] [--tuning text]
                [--quote "<developer's reaction>"] [--repo name] [--session id]
                                     record a trial and its verdict in the item's history
  deveggs evolve <id> "<new fact>" --quote "<developer's words>" [--note "<why: the tuning>"]
                [--harness name] [--repo name] [--session id]
                                     change an egg's or chicken's rule: keeps its id, tier,
                                     tags and history, logs was/now/why, and restarts
                                     trials for the new version
  deveggs rename <old-id> <new-id> [--note why] [--quote text]
                                     rename an egg, chicken or cracked item: moves its file,
                                     history and skill (and harness skill links), logs the
                                     old id, and rewrites \`old-id\` and [[old-id]]
                                     references in other items
  deveggs hatch <id> [--quote text] [--note why] [--harness name]   egg -> chicken (permanent)
  deveggs crack <id> [--quote text] [--note why] [--harness name]   reject an egg, or retire a chicken
  deveggs arch <id> [--set <file|->]  print an item's architecture diagram, or (with --set)
                                     draw it: the ## Architecture section after its fact
  deveggs list [--tier egg|chicken|cracked|ready] [--kind k]
  deveggs show <id>
  deveggs history <id> [--trials] [--event e1,e2] [--since YYYY-MM-DD] [--version N] [--json]
                                     how an item evolved, oldest first: its origin, every
                                     trial and verdict, evolve, hatch, crack, rename and
                                     import (events: ${EVENTS.join(", ")})
  deveggs render                       rebuild PREFERENCES.md in the basket
  deveggs where                        print the basket's path
  deveggs push [--repo owner/name]     save the basket to GitHub (first time: creates
                                     a private repo with gh, default name my-basket)
  deveggs autopush on|off|status       push the basket after every change (default off;
                                     needs deveggs push first)
  deveggs share [--dry-run] [--as github-user] [--yes] [--keep-quotes] [--include-scripts]
                [--private t1,t2] [--skip id1,id2] [--repo owner/name] [--dir path]
                                     share a sanitized copy of your basket by PR (default
                                     ${DEFAULT_SHARE_REPO}, baskets/<you>/). Prints
                                     what's shared and redacted first; run --dry-run first
  deveggs browse [<username>] [--tag t] [--kind k] [--repo owner/name]
                                     list shared baskets, or one basket's items (default
                                     ${DEFAULT_SHARE_REPO}; read-only)
  deveggs import <username>/<id> [--repo owner/name]
                                     borrow a shared egg or chicken (and its skill) into
                                     your basket as an egg on trial, trials ✓0 ✗0
  deveggs migrate [--relink]           move an old <deveggs>/my-basket/ to the basket;
                                     --relink repoints harness skill links to it. Also
                                     moves items' old ## Origin/Evolution/Trials sections
                                     into <tier>/<id>.history.md (write commands do this
                                     on their own the first time)

An egg is "ready" to propose hatching after ${READY_AFTER} good trials and no bad ones,
counting only trials since its last evolve.
Every change re-renders PREFERENCES.md and is committed in the basket's own git repo
(pushed too only when deveggs autopush is on).

env:
  DEVEGGS_BASKET  your basket, a git repo of its own (default: ~/.deveggs)
  DEVEGGS_HOME    deveggs checkout holding skills/ and templates/ (default: this one)`;

const repoRoot = resolve(process.env["DEVEGGS_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const basketRoot = basketPath();
const basket = new Basket(basketRoot);

const warn = (message: string): void => console.error(`deveggs: warning: ${message}`);

/** Read a file, or stdin for "-". */
const readText = (file: string): string => readFileSync(file === "-" ? 0 : file, "utf8");

/** Every time an item is shown, its diagram comes with it: what it automates, at a glance. */
function diagram(egg: Egg): void {
  console.log("");
  console.log(formatArchitecture(egg, terminalOptions()));
}

/** Create the basket on first write and say where it went; move any legacy history into history files. */
function prepare(): void {
  const { created, warnings } = ensureBasket(basketRoot, join(repoRoot, "templates"));
  if (created) console.log(`🧺 started your basket at ${basketRoot} (its own git repo; save it to GitHub with: deveggs push)`);
  warnings.forEach(warn);
  migrateHistory();
}

/**
 * Move items' legacy Origin/Evolution/Trials sections into `<tier>/<id>.history.md`, with
 * the hatches and cracks the basket's git log recorded, and commit that on its own.
 */
function migrateHistory(): string[] {
  if (!basket.needsHistoryMigration().length) return [];
  const ids = basket.migrateHistory(loggedMoves());
  if (ids.length) {
    console.log(`📜 moved the history of ${ids.length} item${ids.length === 1 ? "" : "s"} into <tier>/<id>.history.md (see: deveggs history <id>)`);
    save(`history: move origin, evolution and trials of ${ids.length} item${ids.length === 1 ? "" : "s"} into history files`);
  }
  return ids;
}

/** Hatches and cracks from the basket's git log, for items whose history isn't migrated yet. */
function loggedMoves(): LoggedMove[] {
  if (!existsSync(basketRoot) || !basket.needsHistoryMigration().length) return [];
  const log = run("git", ["log", "--format=%ad%x09%s", "--date=short"], basketRoot);
  return log.status === 0 ? movesFromLog(log.stdout) : [];
}

const histories = (eggs: Egg[]): Map<string, HistoryEntry[]> => {
  const moves = loggedMoves();
  return new Map(eggs.map((e) => [e.id, basket.history(e.id, moves)]));
};

/** Commit a write in the basket repo, and push it when autopush is on. Warns, never fails. */
function save(message: string): void {
  const warning = saveBasket(basketRoot, message);
  if (warning) warn(warning);
}

const missing = (): boolean => !existsSync(basketRoot);
const emptyNote = (): string => `basket is empty; it will live at ${basketRoot} (created by your first deveggs lay)`;

function line(egg: Egg): string {
  const tags = egg.tags.length ? ` [${egg.tags.join(", ")}]` : "";
  const trials = egg.tier === "egg" ? `, ${trialCounts(egg, basket.history(egg.id))}` : egg.version > 1 ? `, v${egg.version}` : "";
  return `${mark(egg)} ${egg.id}  (${egg.kind}${trials})${tags}\n     ${egg.summary}`;
}

/** Name of the git repo the command runs in, used as the egg's origin when --repo is absent. */
function currentRepo(): string | undefined {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return basename(top.trim()) || undefined;
  } catch {
    return undefined;
  }
}

function requireId(positionals: string[]): string {
  const id = positionals[0];
  if (!id) throw new BasketError("missing <id>");
  return id;
}

const csv = (value: string | undefined): string[] => value?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];

/** Read one line from stdin, synchronously (stdin is a terminal here). */
function ask(question: string): string {
  process.stdout.write(question);
  const byte = Buffer.alloc(1);
  let answer = "";
  for (;;) {
    let n = 0;
    try {
      n = readSync(0, byte, 0, 1, null);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EAGAIN") continue;
      throw err;
    }
    if (n === 0 || byte[0] === 10) return answer.trim();
    answer += String.fromCharCode(byte[0] ?? 0);
  }
}

/** The GitHub login gh is signed in as, if any. */
function ghUser(): string | undefined {
  const r = run("gh", ["api", "user", "--jq", ".login"]);
  return r.status === 0 ? r.stdout.trim() || undefined : undefined;
}

interface ShareFlags {
  "dry-run": boolean;
  as?: string | undefined;
  yes: boolean;
  "keep-quotes": boolean;
  "include-scripts": boolean;
  private?: string | undefined;
  skip?: string | undefined;
  repo?: string | undefined;
  dir?: string | undefined;
}

/** Where repos are cloned from; tests point it at local bare repos. */
const gitBase = process.env["DEVEGGS_GIT_BASE"] ?? "https://github.com/";

const fetchBaskets: FetchBaskets = (repo) => cloneBaskets(repo, gitBase);

function bagRepo(repo: string | undefined): string {
  const name = repo ?? DEFAULT_SHARE_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw new BasketError(`invalid --repo ${JSON.stringify(name)}; expected owner/name`);
  return name;
}

function browse(user: string | undefined, values: { tag?: string | undefined; kind?: string | undefined; repo?: string | undefined }): void {
  if (values.kind !== undefined && !isKind(values.kind)) {
    throw new BasketError(`invalid kind ${JSON.stringify(values.kind)}; expected one of ${KINDS.join(", ")}`);
  }
  const repo = bagRepo(values.repo);
  const filter = { tag: values.tag, kind: values.kind };
  const out = withBaskets(fetchBaskets, repo, (dir) => {
    if (user !== undefined) {
      const b = sharedBasket(dir, user);
      const heading = `${user}'s basket in ${repo}${b.about ? `: ${b.about}` : ""}`;
      return formatItems(b.items.filter((i) => matches(i, filter)), heading, terminalOptions(), user);
    }
    const baskets = sharedBaskets(dir);
    if (!filter.tag && !filter.kind) return formatBaskets(baskets, repo, terminalOptions());
    const what = [filter.tag && `tag ${filter.tag}`, filter.kind && `kind ${filter.kind}`].filter(Boolean).join(", ");
    const items = baskets.flatMap((b) => b.items).filter((i) => matches(i, filter));
    return formatItems(items, `shared items in ${repo} with ${what}`, terminalOptions());
  });
  console.log(out);
}

function borrow(ref: string | undefined, repoFlag: string | undefined): void {
  const { user, id } = parseRef(ref);
  const repo = bagRepo(repoFlag);
  // Refuse before fetching anything when the id is already taken (or was cracked).
  const here = existsSync(basketRoot) ? basket.tierOf(id) : undefined;
  if (here === "cracked") throw new BasketError(`${id} was cracked (rejected) in your basket before; it isn't borrowed again`);
  if (here) throw new BasketError(`your basket already has ${id} (${here}); deveggs show ${id}`);
  const egg = withBaskets(fetchBaskets, repo, (dir) => {
    const item = findShared(dir, user, id);
    prepare();
    return basket.borrow(item.egg, { user, repo }, item.skill, undefined, item.history);
  });
  basket.render();
  save(`egg: import ${egg.id} from ${user}`);
  console.log(line(egg));
  console.log(`     borrowed from ${user}'s basket in ${repo}; on trial in your basket`);
  const skill = join(basket.skillDir("egg", egg.id), "SKILL.md");
  if (existsSync(skill)) console.log(`     skill: ${skill}`);
  diagram(egg);
}

function share(values: ShareFlags): void {
  if (missing()) throw new BasketError(`nothing to share; ${emptyNote()}`);
  const repo = values.repo ?? DEFAULT_SHARE_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new BasketError(`invalid --repo ${JSON.stringify(repo)}; expected owner/name`);
  const user = values.as ?? ghUser() ?? (values["dry-run"] ? "you" : undefined);
  if (!user) throw new BasketError("who are you sharing as? pass --as <github-username> (or log in with gh auth login)");
  if (!isGitHubUser(user)) throw new BasketError(`invalid --as ${JSON.stringify(user)}; expected a GitHub username`);
  const dir = (values.dir ?? shareDir(user)).replace(/^\/+|\/+$/g, "");
  if (!dir || dir.split("/").some((part) => part === ".." || part === "." || part === "")) throw new BasketError(`invalid --dir ${JSON.stringify(values.dir)}`);
  const plan = planShare(
    basketRoot,
    {
      keepQuotes: values["keep-quotes"],
      includeScripts: values["include-scripts"],
      privateTerms: csv(values.private),
      skip: csv(values.skip),
      home: homedir(),
      moves: loggedMoves(),
    },
    [user],
  );
  console.log(formatPreview(plan, `${repo}: ${dir}/`, terminalOptions()));
  if (values["dry-run"]) {
    console.log("\n--dry-run: nothing written or pushed. Share it with: deveggs share" + (values.as ? ` --as ${user}` : ""));
    return;
  }
  if (!plan.files.length) throw new BasketError("nothing to share: every item was left out");
  if (!values.yes && !process.stdin.isTTY) throw new BasketError("not pushing without a yes: review the preview above, then rerun with --yes");
  const result = publishShare(plan, {
    repo,
    dir,
    user,
    gitBase,
    log: (l) => console.log(l),
    confirm: (review) => {
      console.log(`\n${review}`);
      if (values.yes) return true;
      return /^y(es)?$/i.test(ask(`Push to ${repo} and open a PR? [y/N] `));
    },
  });
  console.log(result.pushed ? `🧺 ${result.message}` : result.message);
}

function main(argv: string[]): void {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      kind: { type: "string" },
      id: { type: "string" },
      tag: { type: "string" },
      harness: { type: "string" },
      note: { type: "string" },
      quote: { type: "string" },
      repo: { type: "string" },
      session: { type: "string" },
      chicken: { type: "boolean", default: false },
      relink: { type: "boolean", default: false },
      good: { type: "boolean", default: false },
      bad: { type: "boolean", default: false },
      tier: { type: "string" },
      scenario: { type: "string" },
      result: { type: "string" },
      cause: { type: "string" },
      tuning: { type: "string" },
      trials: { type: "boolean", default: false },
      event: { type: "string" },
      since: { type: "string" },
      version: { type: "string" },
      json: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      as: { type: "string" },
      yes: { type: "boolean", default: false },
      "keep-quotes": { type: "boolean", default: false },
      "include-scripts": { type: "boolean", default: false },
      private: { type: "string" },
      skip: { type: "string" },
      dir: { type: "string" },
      arch: { type: "string" },
      set: { type: "string" },
    },
  });
  const legacy = legacyBasket(repoRoot);
  if (command !== "migrate" && hasContent(legacy) && !hasContent(basketRoot)) {
    console.error(`deveggs: your basket is still in ${legacy}; move it to ${basketRoot} with: deveggs migrate`);
  }
  const harness = values.harness !== undefined ? { harness: values.harness } : {};
  /** The developer's say-so and context for a hatch, crack or rename. */
  const eventInput = (): EventInput => {
    const repo = values.repo ?? currentRepo();
    return {
      ...harness,
      ...note,
      ...(repo !== undefined && { repo }),
      ...(values.session !== undefined && { session: values.session }),
      ...(values.quote !== undefined && { quote: values.quote }),
    };
  };
  const note = values.note !== undefined ? { note: values.note } : {};

  switch (command) {
    case "lay": {
      const summary = positionals.join(" ").trim();
      if (!summary) throw new BasketError('usage: deveggs lay "<one-sentence fact>"');
      if (values.kind !== undefined && !isKind(values.kind)) {
        throw new BasketError(`invalid kind ${JSON.stringify(values.kind)}; expected one of ${KINDS.join(", ")}`);
      }
      const repo = values.repo ?? currentRepo();
      prepare();
      const egg = basket.lay({
        summary,
        ...(values.id !== undefined && { id: values.id }),
        chicken: values.chicken,
        origin: {
          ...(values.quote !== undefined && { quote: values.quote }),
          ...(repo !== undefined && { repo }),
          ...(values.session !== undefined && { session: values.session }),
        },
        tags: values.tag?.split(",").map((t) => t.trim()).filter(Boolean) ?? [],
        ...(values.kind !== undefined && { kind: values.kind }),
        ...(values.arch !== undefined && { architecture: readText(values.arch) }),
        ...harness,
        ...note,
      });
      basket.render();
      save(`${egg.tier}: lay ${egg.id}`);
      console.log(line(egg));
      if (egg.kind === "skill") console.log(`     write it: ${join(basket.skillDir(egg.tier, egg.id), "SKILL.md")}`);
      diagram(egg);
      return;
    }
    case "feedback": {
      if (values.good === values.bad) throw new BasketError("pass exactly one of --good or --bad");
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      prepare();
      const repo = values.repo ?? currentRepo();
      const egg = basket.feedback(id, {
        good: values.good,
        ...harness,
        ...note,
        ...(repo !== undefined && { repo }),
        ...(values.session !== undefined && { session: values.session }),
        ...(values.scenario !== undefined && { scenario: values.scenario }),
        ...(values.result !== undefined && { result: values.result }),
        ...(values.cause !== undefined && { cause: values.cause }),
        ...(values.tuning !== undefined && { tuning: values.tuning }),
        ...(values.quote !== undefined && { quote: values.quote }),
      });
      basket.render();
      save(`trial: ${values.good ? "good" : "bad"} ${egg.id}`);
      console.log(line(egg));
      if (isReady(egg)) console.log(`     🐣 ready to hatch: deveggs hatch ${egg.id}`);
      diagram(egg);
      return;
    }
    case "evolve": {
      const [id, ...words] = positionals;
      const summary = words.join(" ").trim();
      if (!id || !summary) throw new BasketError('usage: deveggs evolve <id> "<new fact>" --quote "<developer\'s words>" [--note "<why>"]');
      if (!values.quote?.trim()) throw new BasketError("evolve needs --quote: the developer's own words asking for the change");
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      const repo = values.repo ?? currentRepo();
      prepare();
      const was = basket.get(id);
      const egg = basket.evolve(id, {
        summary,
        quote: values.quote,
        ...(repo !== undefined && { repo }),
        ...(values.session !== undefined && { session: values.session }),
        ...harness,
        ...note,
      });
      basket.render();
      save(`${egg.tier}: evolve ${egg.id} to v${egg.version}`);
      console.log(line(egg));
      console.log(`     was (v${was.version}): ${was.summary}`);
      if (egg.tier === "egg") {
        console.log(`     trials restart at ✓0 ✗0 for v${egg.version} (v${was.version}'s ✓${was.good} ✗${was.bad} stay in the log); hatching needs ${READY_AFTER} ✓ and no ✗ from here`);
      }
      diagram(egg);
      console.log(`🗺  did what it does change? redraw it: deveggs arch ${egg.id} --set <file>`);
      return;
    }
    case "rename": {
      const [from, to] = positionals;
      if (!from || !to || positionals.length > 2) throw new BasketError("usage: deveggs rename <old-id> <new-id>");
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(from)}; ${emptyNote()}`);
      prepare();
      const { egg, rewrote } = basket.rename(from, to, eventInput());
      let links: ReturnType<typeof renameLinks> = { moved: [], skipped: [] };
      try {
        links = renameLinks(basket.skillDir(egg.tier, from), basket.skillDir(egg.tier, to), from, to);
      } catch (err) {
        warn(`couldn't repoint harness skill links named ${from} (${(err as Error).message}); relink them to ${basket.skillDir(egg.tier, to)} by hand`);
      }
      basket.render();
      save(`${egg.tier}: rename ${from} to ${to}`);
      console.log(line(egg));
      console.log(`     renamed from ${from}`);
      for (const file of rewrote) console.log(`     updated references in ${file}`);
      for (const r of links.moved) console.log(`     relinked ${r.from} -> ${r.link}`);
      for (const l of links.skipped) console.log(`     left ${l} alone: ${to} is already taken there; relink it by hand`);
      diagram(egg);
      return;
    }
    case "hatch":
    case "crack": {
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      prepare();
      const egg = command === "hatch" ? basket.hatch(id, eventInput()) : basket.crack(id, eventInput());
      basket.render();
      save(command === "hatch" ? `chicken: hatch ${egg.id}` : `crack: ${egg.id}`);
      console.log(line(egg));
      diagram(egg);
      return;
    }
    case "show": {
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      console.log(formatShow(basket.get(id), terminalOptions(), basket.history(id, loggedMoves())));
      return;
    }
    case "history": {
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      const events = csv(values.event);
      const bad = events.find((e) => !(EVENTS as readonly string[]).includes(e));
      if (bad) throw new BasketError(`invalid event ${JSON.stringify(bad)}; expected one of ${EVENTS.join(", ")}`);
      if (values.trials) events.push("trial");
      if (values.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(values.since)) throw new BasketError(`invalid --since ${JSON.stringify(values.since)}; expected YYYY-MM-DD`);
      const version = values.version === undefined ? undefined : Number(values.version.replace(/^v/, ""));
      if (version !== undefined && !(Number.isInteger(version) && version > 0)) throw new BasketError(`invalid --version ${JSON.stringify(values.version)}; expected a number like 2`);
      const egg = basket.get(id);
      const all = basket.history(id, loggedMoves());
      const entries = filterHistory(all, {
        events: events as HistoryEvent[],
        ...(values.since !== undefined && { since: values.since }),
        ...(version !== undefined && { version }),
      });
      if (values.json) console.log(JSON.stringify({ id: egg.id, tier: egg.tier, version: egg.version, fact: egg.summary, entries }, null, 2));
      else console.log(formatTimeline(egg, entries, terminalOptions(), entries.length !== all.length));
      return;
    }
    case "arch": {
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      if (values.set === undefined) {
        console.log(formatArchitecture(basket.get(id), terminalOptions()));
        return;
      }
      prepare();
      const egg = basket.draw(id, readText(values.set));
      basket.render();
      save(`${egg.tier}: draw ${egg.id}`);
      console.log(`${line(egg)}\n     🗺  architecture drawn`);
      diagram(egg);
      return;
    }
    case "list": {
      const tier = values.tier;
      if (tier !== undefined && tier !== "ready" && !(TIERS as readonly string[]).includes(tier)) {
        throw new BasketError(`invalid tier ${JSON.stringify(tier)}; expected one of ${TIERS.join(", ")}, ready`);
      }
      if (missing()) {
        console.log(emptyNote());
        return;
      }
      let eggs = basket.all();
      if (tier === "ready") eggs = eggs.filter(isReady);
      else if (tier) eggs = eggs.filter((e) => e.tier === tier);
      if (values.kind) eggs = eggs.filter((e) => e.kind === values.kind);
      console.log(formatList(eggs, terminalOptions(), histories(eggs)));
      const [only] = eggs;
      if (only && eggs.length === 1) diagram(only);
      return;
    }
    case "render":
      prepare();
      basket.render();
      save("render");
      console.log(`wrote ${basket.preferencesPath}`);
      return;
    case "migrate": {
      const result = migrate(legacy, basketRoot, join(repoRoot, "templates"));
      result.messages.forEach((m) => console.log(m));
      if (existsSync(basketRoot) && !migrateHistory().length) console.log("history: every item already keeps its history in <tier>/<id>.history.md");
      if (result.relinks.length && values.relink) {
        relink(result.relinks);
        for (const r of result.relinks) console.log(`relinked ${r.link} -> ${r.to}`);
      } else if (result.relinks.length) {
        console.log("these harness skill links still point into the old basket; repoint them with deveggs migrate --relink, or:");
        for (const r of result.relinks) console.log(`  ${lnCommand(r)}`);
      }
      for (const file of result.staleMentions) console.log(`${file} still mentions ${legacy}; point it at ${basketRoot}`);
      return;
    }
    case "where":
      console.log(basketRoot);
      return;
    case "push": {
      prepare();
      console.log(`🧺 basket saved to ${pushBasket(basketRoot, values.repo)}`);
      return;
    }
    case "share": {
      share(values);
      return;
    }
    case "browse":
      browse(positionals[0], values);
      return;
    case "import":
      borrow(positionals[0], values.repo);
      return;
    case "autopush": {
      const mode = positionals[0];
      if (mode === "on" || mode === "off") setAutopush(basketRoot, mode === "on");
      else if (mode !== "status") throw new BasketError("usage: deveggs autopush on|off|status");
      const remote = originUrl(basketRoot);
      const on = autopushEnabled(basketRoot);
      const where = remote ? `${on ? "pushes" : "remote"}: ${webUrl(remote)}` : "no remote yet; save the basket with: deveggs push";
      console.log(`autopush ${on ? "on" : "off"} (${where})`);
      return;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(USAGE);
      return;
    default:
      throw new BasketError(`unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  if (err instanceof BasketError || (err instanceof Error && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"))) {
    console.error(`deveggs: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
