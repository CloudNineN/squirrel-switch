#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(rootDir, "release/mac");
const appPath = join(releaseDir, "Squirrel Switch.app");
const zipPath = join(releaseDir, "Squirrel Switch.app.zip");
const resourcesDir = join(appPath, "Contents/Resources");
const bundledAppDir = join(resourcesDir, "app");
const bundledAppsDir = join(bundledAppDir, "apps");
const electronApp = join(rootDir, "apps/desktop/node_modules/electron/dist/Electron.app");
const appIconIcns = join(rootDir, "apps/desktop/assets/app-icon.icns");
const appIconPng = join(rootDir, "apps/desktop/assets/app-icon.png");
const rootPackage = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const skipZip =
  process.argv.includes("--no-zip") ||
  process.env.SQUIRREL_SWITCH_SKIP_ZIP === "1";

run(process.execPath, [join(rootDir, "scripts/build.mjs")]);

await removeInsideProject(appPath);
await mkdir(releaseDir, { recursive: true });
await cp(electronApp, appPath, { recursive: true, verbatimSymlinks: true });
await normalizeFrameworkSymlinks(
  join(appPath, "Contents/Frameworks/Electron Framework.framework"),
  ["Electron Framework", "Helpers", "Libraries", "Resources"],
);
await normalizeFrameworkSymlinks(join(appPath, "Contents/Frameworks/Mantle.framework"), [
  "Mantle",
  "Resources",
]);
await normalizeFrameworkSymlinks(join(appPath, "Contents/Frameworks/ReactiveObjC.framework"), [
  "ReactiveObjC",
  "Resources",
]);
await normalizeFrameworkSymlinks(join(appPath, "Contents/Frameworks/Squirrel.framework"), [
  "Squirrel",
  "Resources",
]);

await mkdir(bundledAppsDir, { recursive: true });
await writeFile(
  join(bundledAppDir, "package.json"),
  JSON.stringify(
    {
      name: "squirrel-switch-app",
      version: rootPackage.version,
      type: "module",
      main: "apps/desktop/dist/main.js",
    },
    null,
    2,
  ),
);

await cp(join(rootDir, "apps/desktop/dist"), join(bundledAppsDir, "desktop/dist"), {
  recursive: true,
});
const serverBundleDir = join(bundledAppsDir, "server");
if (
  !tryRun("pnpm", [
    "--config.confirmModulesPurge=false",
    "--filter",
    "@squirrel-switch/server",
    "deploy",
    "--legacy",
    "--prod",
    serverBundleDir,
  ])
) {
  console.warn("警告：pnpm deploy 失败，改用本地 node_modules 复制方式打包服务端依赖。");
  await removeInsideProject(serverBundleDir);
  await copyServerBundle(serverBundleDir);
}
await removeDeployWorkspaceBacklinks(serverBundleDir);
await cp(join(rootDir, "apps/web/dist"), join(bundledAppsDir, "web/dist"), { recursive: true });
await cp(appIconIcns, join(resourcesDir, "app-icon.icns"));
await cp(appIconIcns, join(resourcesDir, "electron.icns"));
await cp(appIconPng, join(resourcesDir, "app-icon.png"));

await mkdir(join(resourcesDir, "bin"), { recursive: true });
await cp(process.execPath, join(resourcesDir, "bin/node"));
await chmod(join(resourcesDir, "bin/node"), 0o755);

patchPlist(join(appPath, "Contents/Info.plist"), rootPackage.version);
signApp(appPath);
removeExtendedAttributes(appPath);

console.log(`macOS 应用已生成：${appPath}`);
if (!skipZip) {
  createZip(appPath, zipPath);
  removeExtendedAttributes(zipPath);
  console.log(`macOS 压缩包已生成：${zipPath}`);
}

function run(command, args) {
  if (!tryRun(command, args)) {
    throw new Error(`${command} ${args.join(" ")} 执行失败`);
  }
}

function tryRun(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
}

async function removeInsideProject(target) {
  const resolved = resolve(target);
  if (!resolved.startsWith(`${rootDir}/release/`)) {
    throw new Error(`拒绝清理非 release 目录：${resolved}`);
  }
  if (existsSync(resolved)) {
    await rm(resolved, { recursive: true, force: true });
  }
}

async function normalizeFrameworkSymlinks(frameworkPath, frameworkEntries) {
  const versionsPath = join(frameworkPath, "Versions");
  const currentPath = join(versionsPath, "Current");

  await removeInsideProjectFramework(currentPath, frameworkPath);
  await symlink("A", currentPath);
  for (const entry of frameworkEntries) {
    const entryPath = join(frameworkPath, entry);
    await removeInsideProjectFramework(entryPath, frameworkPath);
    await symlink(join("Versions", "Current", entry), entryPath);
  }
}

async function removeInsideProjectFramework(target, frameworkPath) {
  const resolved = resolve(target);
  const frameworkRoot = resolve(frameworkPath);
  if (!resolved.startsWith(`${frameworkRoot}/`)) {
    throw new Error(`拒绝清理非 framework 子目录：${resolved}`);
  }
  if (existsSync(resolved)) {
    await rm(resolved, { recursive: true, force: true });
  }
}

function patchPlist(plistPath, version) {
  const pairs = [
    ["CFBundleDisplayName", "Squirrel Switch"],
    ["CFBundleIdentifier", "dev.squirrel-switch.app"],
    ["CFBundleName", "Squirrel Switch"],
    ["CFBundleIconFile", "app-icon"],
    ["CFBundleShortVersionString", version],
    ["CFBundleVersion", version],
  ];
  for (const [key, value] of pairs) {
    const result = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plistPath], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`写入 Info.plist 失败：${key}`);
    }
  }
}

function signApp(target) {
  const result = spawnSync("codesign", ["--force", "--deep", "--sign", "-", target], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.warn("警告：codesign 失败，应用仍已生成，但 macOS 可能阻止直接打开。");
  }
}

function removeExtendedAttributes(target) {
  const result = spawnSync("xattr", ["-cr", target], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`清理扩展属性失败：${target}`);
  }
}

function createZip(source, target) {
  const result = spawnSync(
    "ditto",
    ["-c", "-k", "--sequesterRsrc", "--keepParent", source, target],
    {
      stdio: "inherit",
    },
  );
  if (result.status !== 0) {
    throw new Error(`生成 zip 失败：${target}`);
  }
}

async function copyServerBundle(target) {
  await mkdir(target, { recursive: true });
  await cp(join(rootDir, "apps/server/dist"), join(target, "dist"), { recursive: true });
  await cp(join(rootDir, "apps/server/package.json"), join(target, "package.json"));
  await cp(join(rootDir, "apps/server/node_modules"), join(target, "node_modules"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await mkdir(join(bundledAppDir, "node_modules"), { recursive: true });
  await cp(join(rootDir, "node_modules/.pnpm"), join(bundledAppDir, "node_modules/.pnpm"), {
    recursive: true,
    verbatimSymlinks: true,
  });
  await mkdir(join(bundledAppDir, "packages/shared"), { recursive: true });
  await cp(join(rootDir, "packages/shared/dist"), join(bundledAppDir, "packages/shared/dist"), {
    recursive: true,
  });
  await cp(
    join(rootDir, "packages/shared/package.json"),
    join(bundledAppDir, "packages/shared/package.json"),
  );
}

async function removeDeployWorkspaceBacklinks(serverBundle) {
  const selfLink = join(serverBundle, "node_modules/.pnpm/node_modules/@squirrel-switch/server");
  if (existsSync(selfLink)) {
    await rm(selfLink, { force: true });
  }
}
