/**
 * Regenerates lib/keeper/__fixtures__/buildTable.sol.json: Deploy.s.sol's own buildTable, run by forge over
 * lib/machines.json at four price vectors (scripts/keeper/BuildTableFixture.s.sol). The keeper's TypeScript port is
 * unit tested against it (lib/keeper/table.test.ts). Run after changing machines.json or buildTable:
 *   pnpm keeper:fixture
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { REPO, run, snapshotContracts } from "./snapshot";

const snap = snapshotContracts({ "script/BuildTableFixture.s.sol": join(REPO, "scripts", "keeper", "BuildTableFixture.s.sol") });
try {
  run("forge", ["script", "script/BuildTableFixture.s.sol", "--tc", "BuildTableFixture"], { cwd: snap.contracts });
  const dir = join(REPO, "lib", "keeper", "__fixtures__");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(snap.lib, "buildTable.sol.json"), join(dir, "buildTable.sol.json"));
  process.stdout.write(`wrote ${join(dir, "buildTable.sol.json")}\n`);
} finally {
  snap.cleanup();
}
