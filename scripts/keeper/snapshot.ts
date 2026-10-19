/**
 * A throwaway copy of contracts/ (src, script, foundry.toml) plus lib/machines.json in a temp folder, so the keeper's
 * fixture and e2e runs compile and broadcast without touching the real contracts/out, contracts/cache or
 * lib/deployments (Deploy.s.sol writes ../lib/deployments/arc-testnet.json on broadcast). Libraries are remapped to
 * the repo's contracts/lib by absolute path, nothing is copied from there.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const REPO = resolve(import.meta.dirname, "..", "..");
const posix = (p: string) => p.replace(/\\/g, "/");

export type Snapshot = { root: string; contracts: string; lib: string; cleanup: () => void };

/**
 * `from`: "head" (default) takes contracts/src, contracts/script and lib/machines.json as committed, so a run is not
 * broken by contract work in progress and matches the committed lib/abi; "worktree" takes the files as they are now
 * (use it once the new contracts and their ABI land: pnpm keeper:e2e --worktree).
 */
export function snapshotContracts(extra: Record<string, string> = {}, from: "head" | "worktree" = "head"): Snapshot {
  const root = mkdtempSync(join(tmpdir(), "arclaw-keeper-"));
  const contracts = join(root, "contracts");
  const lib = join(root, "lib");
  mkdirSync(join(lib, "deployments"), { recursive: true });
  if (from === "head") {
    const tar = join(root, "head.tar");
    run("git", ["-C", REPO, "archive", "--format=tar", "-o", tar, "HEAD", "contracts/src", "contracts/script", "lib/machines.json"]);
    run("tar", ["-xf", "head.tar"], { cwd: root }); // relative: GNU tar reads "C:" as a remote host
    rmSync(tar);
  } else {
    cpSync(join(REPO, "contracts", "src"), join(contracts, "src"), { recursive: true });
    cpSync(join(REPO, "contracts", "script"), join(contracts, "script"), { recursive: true });
    cpSync(join(REPO, "lib", "machines.json"), join(lib, "machines.json"));
  }
  for (const [name, from] of Object.entries(extra)) cpSync(from, join(contracts, name));

  const deps = posix(join(REPO, "contracts", "lib"));
  writeFileSync(join(contracts, "remappings.txt"), [`@openzeppelin/contracts/=${deps}/openzeppelin-contracts/contracts/`, `forge-std/=${deps}/forge-std/src/`].join("\n") + "\n");
  const toml = readFileSync(join(REPO, "contracts", "foundry.toml"), "utf8")
    .replace(/^libs = .*$/m, "libs = []")
    .replace(/^\[profile\.default\]$/m, `[profile.default]\nallow_paths = ["${deps}"]`);
  writeFileSync(join(contracts, "foundry.toml"), toml);
  return { root, contracts, lib, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Runs a command, streams nothing, returns stdout; throws with the tail of the output on failure. */
export function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}): string {
  const r = spawnSync(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.status !== 0) throw new Error(`${cmd} ${args.filter((a) => !/^0x[0-9a-f]{64}$/i.test(a)).join(" ")} failed (${r.status ?? r.error?.message}):\n${out.slice(-4000)}`);
  return r.stdout ?? "";
}
