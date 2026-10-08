import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Basket, BasketError, type Egg, isKind, isReady, KINDS, READY_AFTER, TIERS } from "./basket.ts";
import { hasContent, legacyBasket, lnCommand, migrate, relink } from "./migrate.ts";
import { autopushEnabled, basketPath, ensureBasket, originUrl, pushBasket, saveBasket, setAutopush, webUrl } from "./store.ts";
import { formatList, formatShow, mark, terminalOptions } from "./view.ts";

const USAGE = `deveggs: a basket of eggs for the agentic developer

  🥚 egg      on trial: a new preference/workflow/script/skill you're playing with
  🐔 chicken  hatched: you liked it, so it's permanent
  💥 cracked  rejected: kept so it's never laid again

usage:
  deveggs lay "<one-sentence fact>" [--id short-name] [--kind ${KINDS.join("|")}]
                                     [--tag t1,t2] [--harness name] [--note text] [--chicken]
                                     [--quote "<developer's words>"] [--repo name] [--session id]
  deveggs feedback <id> --good|--bad [--note text] [--harness name]   record a trial
  deveggs hatch <id>                   egg -> chicken (permanent)
  deveggs crack <id>                   reject an egg, or retire a chicken
  deveggs list [--tier egg|chicken|cracked|ready] [--kind k]
  deveggs show <id>
  deveggs render                       rebuild PREFERENCES.md in the basket
  deveggs where                        print the basket's path
  deveggs push [--repo owner/name]     save the basket to GitHub (first time: creates
                                     a private repo with gh, default name my-basket)
  deveggs autopush on|off|status       push the basket after every change (default off;
                                     needs deveggs push first)
  deveggs migrate [--relink]           move an old <deveggs>/my-basket/ to the basket;
                                     --relink repoints harness skill links to it

An egg is "ready" to propose hatching after ${READY_AFTER} good trials and no bad ones.
Every change re-renders PREFERENCES.md and is committed in the basket's own git repo
(pushed too only when deveggs autopush is on).

env:
  DEVEGGS_BASKET  your basket, a git repo of its own (default: ~/.deveggs)
  DEVEGGS_HOME    deveggs checkout holding skills/ and templates/ (default: this one)`;

const repoRoot = resolve(process.env["DEVEGGS_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const basketRoot = basketPath();
const basket = new Basket(basketRoot);

const warn = (message: string): void => console.error(`deveggs: warning: ${message}`);

/** Create the basket on first write and say where it went. */
function prepare(): void {
  const { created, warnings } = ensureBasket(basketRoot, join(repoRoot, "templates"));
  if (created) console.log(`🧺 started your basket at ${basketRoot} (its own git repo; save it to GitHub with: deveggs push)`);
  warnings.forEach(warn);
}

/** Commit a write in the basket repo, and push it when autopush is on. Warns, never fails. */
function save(message: string): void {
  const warning = saveBasket(basketRoot, message);
  if (warning) warn(warning);
}

const missing = (): boolean => !existsSync(basketRoot);
const emptyNote = (): string => `basket is empty; it will live at ${basketRoot} (created by your first deveggs lay)`;

function line(egg: Egg): string {
  const tags = egg.tags.length ? ` [${egg.tags.join(", ")}]` : "";
  const trials = egg.tier === "egg" ? `, ✓${egg.good} ✗${egg.bad}` : "";
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
    },
  });
  const legacy = legacyBasket(repoRoot);
  if (command !== "migrate" && hasContent(legacy) && !hasContent(basketRoot)) {
    console.error(`deveggs: your basket is still in ${legacy}; move it to ${basketRoot} with: deveggs migrate`);
  }
  const harness = values.harness !== undefined ? { harness: values.harness } : {};
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
        ...harness,
        ...note,
      });
      basket.render();
      save(`${egg.tier}: lay ${egg.id}`);
      console.log(line(egg));
      if (egg.kind === "skill") console.log(`     write it: ${join(basket.skillDir(egg.tier, egg.id), "SKILL.md")}`);
      return;
    }
    case "feedback": {
      if (values.good === values.bad) throw new BasketError("pass exactly one of --good or --bad");
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      prepare();
      const egg = basket.feedback(id, { good: values.good, ...harness, ...note });
      basket.render();
      save(`trial: ${values.good ? "good" : "bad"} ${egg.id}`);
      console.log(line(egg));
      if (isReady(egg)) console.log(`     🐣 ready to hatch: deveggs hatch ${egg.id}`);
      return;
    }
    case "hatch":
    case "crack": {
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      prepare();
      const egg = command === "hatch" ? basket.hatch(id) : basket.crack(id);
      basket.render();
      save(command === "hatch" ? `chicken: hatch ${egg.id}` : `crack: ${egg.id}`);
      console.log(line(egg));
      return;
    }
    case "show": {
      const id = requireId(positionals);
      if (missing()) throw new BasketError(`nothing in the basket named ${JSON.stringify(id)}; ${emptyNote()}`);
      console.log(formatShow(basket.get(id), terminalOptions()));
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
      console.log(formatList(eggs, terminalOptions()));
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
