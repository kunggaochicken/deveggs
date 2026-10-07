import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Basket, BasketError, KINDS, type Egg, type Kind, WARM_THRESHOLD } from "./basket.ts";
import { apply, describe, harnesses, planInstall, planUninstall } from "./install.ts";

const USAGE = `deveggs: a basket of eggs for the agentic developer

usage:
  deveggs lay "<one-sentence fact>" [--kind preference|workflow|script|skill]
                                     [--tag t1,t2] [--harness name] [--explicit] [--note text]
  deveggs warm <id> [--harness name]   record another sighting
  deveggs hatch <id>                   confirm an egg (then re-renders)
  deveggs crack <id>                   reject an egg (kept so it is never re-laid)
  deveggs list [--status egg|hatched|cracked|warm] [--kind k]
  deveggs show <id>
  deveggs render                       rebuild basket/PREFERENCES.md
  deveggs install [--harness claude,codex] [--dry-run]
  deveggs uninstall [--harness claude,codex] [--dry-run]

env:
  DEVEGGS_HOME   repo root holding basket/ and skills/ (default: this checkout)`;

const repoRoot = resolve(process.env["DEVEGGS_HOME"] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
const basket = new Basket(join(repoRoot, "basket"));

function line(egg: Egg): string {
  const mark = egg.status === "hatched" ? "🐣" : egg.status === "cracked" ? "💥" : egg.sightings >= WARM_THRESHOLD ? "🔥" : "🥚";
  const tags = egg.tags.length ? ` [${egg.tags.join(", ")}]` : "";
  return `${mark} ${egg.id}  (${egg.kind}, ×${egg.sightings})${tags}\n     ${egg.summary}`;
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
      explicit: { type: "boolean", default: false },
      note: { type: "string" },
      status: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  switch (command) {
    case "lay": {
      const summary = positionals.join(" ").trim();
      if (!summary) throw new BasketError('usage: deveggs lay "<one-sentence fact>"');
      const kind = values.kind;
      if (kind !== undefined && !(KINDS as readonly string[]).includes(kind)) {
        throw new BasketError(`invalid kind ${JSON.stringify(kind)}; expected one of ${KINDS.join(", ")}`);
      }
      const egg = basket.lay({
        summary,
        source: values.explicit ? "explicit" : "inferred",
        tags: values.tag?.split(",").map((t) => t.trim()).filter(Boolean) ?? [],
        ...(kind !== undefined && { kind: kind as Kind }),
        ...(values.harness !== undefined && { harness: values.harness }),
        ...(values.note !== undefined && { body: values.note }),
      });
      if (egg.status === "hatched") basket.render();
      console.log(line(egg));
      return;
    }
    case "warm":
      console.log(line(basket.warm(requireId(positionals), values.harness)));
      return;
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
      console.log(`${line(egg)}\n     source: ${egg.source}  harnesses: ${egg.harnesses.join(", ") || "-"}  laid: ${egg.laid}`);
      if (egg.body) console.log(`\n${egg.body}`);
      return;
    }
    case "list": {
      let eggs = values.status === "warm" ? basket.warmEggs() : basket.all();
      if (values.status && values.status !== "warm") eggs = eggs.filter((e) => e.status === values.status);
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
      const targets = harnesses(homedir()).filter((h) =>
        wanted ? wanted.includes(h.name) : existsSync(h.home),
      );
      if (!targets.length) throw new BasketError("no supported harness found (looked for ~/.claude, ~/.codex)");
      if (command === "install" && !values["dry-run"]) basket.render();
      const actions = command === "install" ? planInstall(repoRoot, targets) : planUninstall(repoRoot, targets);
      if (!actions.length) {
        console.log("nothing to do");
        return;
      }
      for (const a of actions) console.log(describe(a));
      if (values["dry-run"]) console.log("\n(dry run: nothing changed)");
      else apply(actions);
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
