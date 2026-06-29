#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = join(rootDir, "node_modules/typescript/bin/tsc");
const vite = join(rootDir, "apps/web/node_modules/vite/bin/vite.js");

run(process.execPath, [tsc, "-p", "packages/shared/tsconfig.json"]);
run(process.execPath, [tsc, "-p", "apps/server/tsconfig.json"]);
run(process.execPath, [tsc, "-p", "apps/web/tsconfig.json"]);
run(process.execPath, [vite, "build"], { cwd: join(rootDir, "apps/web") });
run(process.execPath, [tsc, "-p", "apps/desktop/tsconfig.json"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? rootDir,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 执行失败`);
  }
}
