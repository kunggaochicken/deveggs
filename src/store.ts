import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { BasketError } from "./basket.ts";

/**
 * The basket is data, kept apart from the deveggs code (like ~/.claude or ~/.codex):
 * its own git repo at ~/.deveggs, or wherever $DEVEGGS_BASKET points.
 */
export function basketPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env["DEVEGGS_BASKET"];
  return override ? resolve(override) : join(homedir(), ".deveggs");
}

/** Folders every basket has. Each gets a .gitkeep so the layout survives a clone. */
export const SCAFFOLD = ["eggs", "chickens", "cracked", "scripts", join("skills", "eggs"), join("skills", "chickens")];

interface Run {
  /** The program isn't installed (not on PATH). */
  missing: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
}

export function run(cmd: string, args: string[], cwd?: string): Run {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const missing = (r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  return { missing, status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const firstLine = (text: string): string => text.trim().split("\n").find(Boolean)?.trim() ?? "";

export interface Ensured {
  /** The basket folder didn't exist before this call. */
  created: boolean;
  warnings: string[];
}

/**
 * Make sure the basket exists before a write: scaffold its folders, seed README.md
 * from templates/basket-README.md, and `git init` it. Never sets a git identity.
 */
export function ensureBasket(root: string, templates: string): Ensured {
  const created = !existsSync(root);
  const warnings: string[] = [];
  for (const dir of SCAFFOLD) {
    const path = join(root, dir);
    if (existsSync(path)) continue;
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, ".gitkeep"), "");
  }
  const readme = join(root, "README.md");
  const template = join(templates, "basket-README.md");
  if (!existsSync(readme) && existsSync(template)) writeFileSync(readme, readFileSync(template, "utf8"));
  if (!existsSync(join(root, ".git"))) {
    const init = run("git", ["init", "-q", "-b", "main"], root);
    if (init.missing) warnings.push("git not found; your basket isn't version-controlled (install git to back it up)");
    else if (init.status !== 0) warnings.push(`git init failed: ${firstLine(init.stderr)}`);
    else {
      const warning = commitBasket(root, "basket: create");
      if (warning) warnings.push(warning);
    }
  }
  return { created, warnings };
}

/**
 * Commit everything in the basket repo. Returns a one-line warning instead of
 * throwing: a failed commit must never fail the developer's command.
 */
export function commitBasket(root: string, message: string): string | undefined {
  if (!existsSync(join(root, ".git"))) return undefined;
  const add = run("git", ["add", "-A"], root);
  if (add.missing) return "git not found; basket change saved but not committed";
  if (add.status !== 0) return `git add failed, change not committed: ${firstLine(add.stderr)}`;
  if (run("git", ["diff", "--cached", "--quiet"], root).status === 0) return undefined;
  const commit = run("git", ["commit", "-q", "-m", message], root);
  if (commit.status === 0) return undefined;
  const why = `${commit.stderr}\n${commit.stdout}`;
  if (/tell me who you are|user\.email|user\.name|auto-detect|empty ident/i.test(why)) {
    return 'basket change not committed: git has no identity. Set one with git config --global user.name "…" and user.email "…"';
  }
  return `basket change not committed: ${firstLine(why) || "git commit failed"}`;
}

/** https://github.com/o/n for git@github.com:o/n.git, https://…/n.git, ssh://…; anything else unchanged. */
export function webUrl(remote: string): string {
  const scp = /^[\w.-]+@([^:/]+):(.+?)(?:\.git)?\/?$/.exec(remote);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = /^ssh:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/.exec(remote);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return remote.replace(/\.git\/?$/, "");
}

export const DEFAULT_REPO = "my-basket";

/**
 * Save the basket to GitHub. The first time (no `origin`) it creates a private repo
 * with `gh`; after that it's a plain `git push`. Returns the repo's URL.
 */
export function pushBasket(root: string, repo?: string): string {
  const pending = commitBasket(root, "basket: save");
  if (pending) throw new BasketError(pending);
  const origin = run("git", ["remote", "get-url", "origin"], root);
  if (origin.missing) throw new BasketError("git not found; install git to save your basket");
  if (origin.status === 0) {
    const url = origin.stdout.trim();
    if (repo !== undefined) throw new BasketError(`the basket already pushes to ${webUrl(url)}; --repo only names a new repo`);
    const push = run("git", ["push", "-q", "-u", "origin", "HEAD"], root);
    if (push.status !== 0) throw new BasketError(`git push failed: ${firstLine(push.stderr) || "unknown error"}`);
    return webUrl(url);
  }
  const name = repo ?? DEFAULT_REPO;
  if (!/^([\w.-]+\/)?[\w.-]+$/.test(name)) throw new BasketError(`invalid --repo ${JSON.stringify(name)}; expected owner/name or name`);
  const manual = `or add a remote yourself: git -C ${root} remote add origin <url> && deveggs push`;
  const version = run("gh", ["--version"]);
  if (version.missing) throw new BasketError(`saving to GitHub needs the gh CLI (https://cli.github.com), ${manual}`);
  if (run("gh", ["auth", "status"]).status !== 0) throw new BasketError(`gh isn't logged in; run gh auth login, ${manual}`);
  const create = run("gh", ["repo", "create", name, "--private", "--source", root, "--remote", "origin", "--push"], root);
  if (create.status !== 0) throw new BasketError(`gh repo create failed: ${firstLine(create.stderr) || firstLine(create.stdout)}`);
  const made = run("git", ["remote", "get-url", "origin"], root);
  if (made.status === 0) return webUrl(made.stdout.trim());
  return firstLine(create.stdout);
}
