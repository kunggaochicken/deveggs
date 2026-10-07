import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Basket, BasketError, type Egg, isKind, isReady, KINDS, READY_AFTER, TIERS } from "./basket.ts";
import { apply, describe, harnesses, managedBlock, planInstall, planUninstall } from "./install.ts";

const USAGE = `deveggs: a basket of eggs for the agentic developer

  🥚 egg      on trial: a new preference/workflow/script/skill you're playing with
  🐔 chicken  hatched: you liked it, so it's permanent
  💥 cracked  rejected: kept so it's never laid again

usage:
  deveggs lay "<one-sentence fact>" [--kind ${KINDS.join("|")}]
                                     [--tag t1,t2] [--harness name] [--note text] [--chicken]
                                     [--quote "<developer's words>"] [--repo name] [--session id]
  deveggs feedback <id> --good|--bad [--note text] [--harness name]   record a trial
  deveggs hatch <id>                   egg -> chicken (permanent)
  deveggs crack <id>                   reject an egg, or retire a chicken
  deveggs list [--tier egg|chicken|cracked|ready] [--kind k]
  deveggs show <id>
  deveggs render                       rebuild my-basket/PREFERENCES.md
  deveggs install [--harness claude,codex] [--dry-run]
  deveggs uninstall [--harness claude,codex] [--dry-run]
  deveggs prompt                       print the deveggs prompt for a harness's global instructions

An egg is "ready" to propose hatching after ${READY_AFTER} good trials and no bad ones.
Every change re-renders PREFERENCES.md.

env:
  DEVEGGS_HOME   repo root holding my-basket/ and skills/ (default: this checkout)`;

const OTHER_HARNESS = `install wires these harnesses when they exist: ${harnesses(homedir()).map((h) => h.name).join(", ")}.
Running in a different harness? Add this deveggs prompt to that harness's global
instructions file (the one it reads every session). If it has no such file, give the prompt
to the developer to paste into its settings, e.g. Cursor's User Rules:`;

const repoRoot = resolve(process.env["DEVEGGS_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const basket = new Basket(join(repoRoot, "my-basket"));

function line(egg: Egg): string {
  const mark = egg.tier === "chicken" ? "🐔" : egg.tier === "cracked" ? "💥" : isReady(egg) ? "🐣" : "🥚";
  const tags = egg.tags.length ? ` [${egg.tags.join(", ")}]` : "";
  const trials = egg.tier === "egg" ? `, ✓${egg.good} ✗${egg.bad}` : "";
  return `${mark} ${egg.id}  (${egg.kind}${trials})${tags}\n     ${egg.summary}`;
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
      tag: { type: "string" },
      harness: { type: "string" },
      note: { type: "string" },
      quote: { type: "string" },
      repo: { type: "string" },
      session: { type: "string" },
      chicken: { type: "boolean", default: false },
      good: { type: "boolean", default: false },
      bad: { type: "boolean", default: false },
      tier: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
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
      const egg = basket.lay({
        summary,
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
      console.log(line(egg));
      if (egg.kind === "skill") console.log(`     write it: ${join(basket.skillDir(egg.tier, egg.id), "SKILL.md")}`);
      return;
    }
    case "feedback": {
      if (values.good === values.bad) throw new BasketError("pass exactly one of --good or --bad");
      const egg = basket.feedback(requireId(positionals), { good: values.good, ...harness, ...note });
      basket.render();
      console.log(line(egg));
      if (isReady(egg)) console.log(`     🐣 ready to hatch: deveggs hatch ${egg.id}`);
      return;
    }
    case "hatch":
      console.log(line(basket.hatch(requireId(positionals))));
      basket.render();
      return;
    case "crack":
      console.log(line(basket.crack(requireId(positionals))));
      basket.render();
      return;
    case "show": {
      const egg = basket.get(requireId(positionals));
      console.log(`${line(egg)}\n     harnesses: ${egg.harnesses.join(", ") || "-"}  laid: ${egg.laid}  updated: ${egg.updated}`);
      if (egg.body) console.log(`\n${egg.body}`);
      return;
    }
    case "list": {
      const tier = values.tier;
      if (tier !== undefined && tier !== "ready" && !(TIERS as readonly string[]).includes(tier)) {
        throw new BasketError(`invalid tier ${JSON.stringify(tier)}; expected one of ${TIERS.join(", ")}, ready`);
      }
      let eggs = basket.all();
      if (tier === "ready") eggs = eggs.filter(isReady);
      else if (tier) eggs = eggs.filter((e) => e.tier === tier);
      if (values.kind) eggs = eggs.filter((e) => e.kind === values.kind);
      console.log(eggs.length ? eggs.map(line).join("\n") : "basket is empty");
      return;
    }
    case "render":
      basket.render();
      console.log(`wrote ${basket.preferencesPath}`);
      return;
    case "install":
    case "uninstall": {
      const wanted = values.harness?.split(",").map((s) => s.trim());
      const targets = harnesses(homedir()).filter((h) => (wanted ? wanted.includes(h.name) : existsSync(h.home)));
      if (command === "install" && !values["dry-run"]) basket.render();
      const actions = command === "install" ? planInstall(repoRoot, targets) : planUninstall(repoRoot, targets);
      for (const a of actions) console.log(describe(a));
      if (!actions.length) console.log(targets.length ? "nothing to do" : "no known harness found (looked for ~/.claude, ~/.codex)");
      if (values["dry-run"]) console.log("\n(dry run: nothing changed)");
      else apply(actions);
      if (command === "install") console.log(`\n${OTHER_HARNESS}\n\n${managedBlock(repoRoot)}`);
      return;
    }
    case "prompt":
      console.log(managedBlock(repoRoot));
      return;
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
