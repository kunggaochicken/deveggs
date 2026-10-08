import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shared by the CLI tests: a throwaway HOME, deveggs checkout and basket, so no test
// ever touches the developer's real ~/.deveggs or my-basket/.

export const repoRoot = join(import.meta.dirname, "..");
const cliPath = join(repoRoot, "src", "cli.ts");
const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

export interface Sandbox {
  dir: string;
  home: string;
  /** A stand-in deveggs checkout ($DEVEGGS_HOME) holding templates/ and any legacy my-basket/. */
  checkout: string;
  basket: string;
  env: NodeJS.ProcessEnv;
}

/** A temp HOME and basket, and a git that ignores the developer's own config. */
export function sandbox(gitconfig = ""): Sandbox {
  const dir = mkdtempSync(join(tmpdir(), "deveggs-store-"));
  const home = join(dir, "home");
  mkdirSync(home);
  writeFileSync(join(dir, "gitconfig"), gitconfig);
  const checkout = join(dir, "deveggs");
  mkdirSync(join(checkout, "templates"), { recursive: true });
  copyFileSync(join(repoRoot, "templates", "basket-README.md"), join(checkout, "templates", "basket-README.md"));
  const basket = join(dir, "basket");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"],
    HOME: home,
    DEVEGGS_HOME: checkout,
    DEVEGGS_BASKET: basket,
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    ...(gitconfig === "" && {
      GIT_AUTHOR_NAME: "Tester",
      GIT_AUTHOR_EMAIL: "tester@example.com",
      GIT_COMMITTER_NAME: "Tester",
      GIT_COMMITTER_EMAIL: "tester@example.com",
    }),
  };
  return { dir, home, checkout, basket, env };
}

/** A PATH holding only a real git (unless left out) and the given fake scripts. */
export function fakePath(box: Sandbox, scripts: Record<string, string>, git = true): string {
  const bin = join(box.dir, "bin");
  mkdirSync(bin, { recursive: true });
  if (git) symlinkSync(realGit, join(bin, "git"));
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return bin;
}

export function cli(box: Sandbox, ...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cliPath, ...args], {
    env: box.env,
    cwd: box.dir,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export const git = (box: Sandbox, cwd: string, ...args: string[]): string =>
  execFileSync(realGit, args, { cwd, env: box.env, encoding: "utf8" }).trim();

export const subjects = (box: Sandbox, repo = box.basket): string[] => git(box, repo, "log", "--format=%s").split("\n");
