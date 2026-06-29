#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(rootDir, "node_modules/typescript/bin/tsc");

run(process.execPath, [tsc, "-p", "packages/shared/tsconfig.json", "--noEmit"]);
run(process.execPath, [tsc, "-p", "apps/server/tsconfig.json", "--noEmit"]);
run(process.execPath, [tsc, "-p", "apps/web/tsconfig.json", "--noEmit"]);
run(process.execPath, [tsc, "-p", "apps/desktop/tsconfig.json", "--noEmit"]);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 执行失败`);
  }
}
