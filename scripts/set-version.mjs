#!/usr/bin/env node
// 统一更新全仓库的版本号字面量。
// 真源约定：根 package.json 的 version。本脚本把目标版本同步到所有
// 被代码读取或对外展示的位置，避免发版时逐个文件手改。
//
// 用法：
//   node scripts/set-version.mjs 1.0.11   指定目标版本
//   node scripts/set-version.mjs          以根 package.json 现有 version 做一次全量同步
//
// 注意：VERSION_UPDATE_LOG 是更新说明内容，需手写，本脚本不改。
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const packageJsonFiles = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/shared/package.json",
];

// 代码/文档中的版本字面量：用正则定位唯一一处版本串并整体替换。
const literalTargets = [
  {
    file: "packages/shared/src/index.ts",
    pattern: /(export const APP_VERSION = ")[^"]+(";)/,
  },
  {
    file: "apps/server/src/lib/app-server.ts",
    pattern: /(const APP_VERSION = ")[^"]+(";)/,
  },
  {
    file: "apps/server/src/lib/login-sessions.ts",
    pattern: /(const LOGIN_CLIENT_VERSION = ")[^"]+(";)/,
  },
  {
    file: "README.md",
    pattern: /(Current version: `V)[^`]+(`)/,
  },
];

const VERSION_RE = /^\d+\.\d+\.\d+$/;

async function readRootVersion() {
  const pkg = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
  return pkg.version;
}

async function updatePackageJson(relPath, version) {
  const absPath = join(rootDir, relPath);
  const raw = await readFile(absPath, "utf8");
  const pkg = JSON.parse(raw);
  const changed = pkg.version !== version;
  pkg.version = version;
  const trailingNewline = raw.endsWith("\n") ? "\n" : "";
  await writeFile(absPath, `${JSON.stringify(pkg, null, 2)}${trailingNewline}`);
  return changed;
}

async function updateLiteral(target, version) {
  const absPath = join(rootDir, target.file);
  const raw = await readFile(absPath, "utf8");
  if (!target.pattern.test(raw)) {
    throw new Error(`未在 ${target.file} 中找到版本字面量，正则可能已失效：${target.pattern}`);
  }
  const next = raw.replace(target.pattern, `$1${version}$2`);
  const changed = next !== raw;
  await writeFile(absPath, next);
  return changed;
}

async function main() {
  const arg = process.argv[2];
  const version = arg ?? (await readRootVersion());
  if (!VERSION_RE.test(version)) {
    console.error(`版本号格式不合法（应为 x.y.z）：${version}`);
    process.exit(1);
  }

  const updated = [];
  const unchanged = [];

  for (const relPath of packageJsonFiles) {
    const changed = await updatePackageJson(relPath, version);
    (changed ? updated : unchanged).push(relPath);
  }
  for (const target of literalTargets) {
    const changed = await updateLiteral(target, version);
    (changed ? updated : unchanged).push(target.file);
  }

  console.log(`版本已统一为 ${version}`);
  if (updated.length > 0) {
    console.log("更新：");
    for (const file of updated) {
      console.log(`  - ${relative(rootDir, join(rootDir, file)) || file}`);
    }
  }
  if (unchanged.length > 0) {
    console.log(`已是目标版本（未改动）：${unchanged.length} 个文件`);
  }
  console.log("提醒：如为发版，请在 packages/shared/src/index.ts 的 VERSION_UPDATE_LOG 顶部手写一条更新说明。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
