#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { connect as tlsConnect } from "node:tls";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(rootDir, "release/win");
const cacheDir = join(rootDir, "release/.cache/windows");
const buildDir = join(releaseDir, ".build");
const appDir = join(releaseDir, "Squirrel Switch-win32-x64");
const resourcesDir = join(appDir, "resources");
const bundledAppDir = join(resourcesDir, "app");
const bundledAppsDir = join(bundledAppDir, "apps");
const zipPath = join(releaseDir, "Squirrel Switch-win32-x64.zip");
const rootPackage = JSON.parse(await readFile(join(rootDir, "package.json"), "utf8"));
const desktopPackage = JSON.parse(await readFile(join(rootDir, "apps/desktop/package.json"), "utf8"));
const serverPackage = JSON.parse(await readFile(join(rootDir, "apps/server/package.json"), "utf8"));
const electronVersion = resolveInstalledPackageVersion(
  "apps/desktop/node_modules/electron/package.json",
  desktopPackage.devDependencies.electron,
);
const nodeVersion = process.version.slice(1);
const electronZip = join(cacheDir, `electron-v${electronVersion}-win32-x64.zip`);
const nodeZip = join(cacheDir, `node-v${nodeVersion}-win-x64.zip`);
const DOWNLOAD_CONNECT_TIMEOUT_MS = 30_000;
const DOWNLOAD_TOTAL_TIMEOUT_MS = 10 * 60_000;

run(process.execPath, [join(rootDir, "scripts/build.mjs")]);

await removeInsideRelease(releaseDir);
await mkdir(cacheDir, { recursive: true });
await mkdir(buildDir, { recursive: true });

await ensureDownload(
  `https://github.com/electron/electron/releases/download/v${electronVersion}/electron-v${electronVersion}-win32-x64.zip`,
  electronZip,
);
await ensureDownload(
  `https://nodejs.org/dist/v${nodeVersion}/node-v${nodeVersion}-win-x64.zip`,
  nodeZip,
);

extractZip(electronZip, appDir);
await rename(join(appDir, "electron.exe"), join(appDir, "Squirrel Switch.exe"));
await removeIfExists(join(appDir, "resources/default_app.asar"));

const nodeExtractDir = join(buildDir, "node");
extractZip(nodeZip, nodeExtractDir);
await mkdir(join(resourcesDir, "bin"), { recursive: true });
await cp(join(nodeExtractDir, `node-v${nodeVersion}-win-x64`, "node.exe"), join(resourcesDir, "bin/node.exe"));
await chmod(join(resourcesDir, "bin/node.exe"), 0o755);

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
await cp(join(rootDir, "apps/web/dist"), join(bundledAppsDir, "web/dist"), { recursive: true });
await cp(join(rootDir, "apps/desktop/assets/app-icon.png"), join(resourcesDir, "app-icon.png"));
await cp(join(rootDir, "apps/desktop/assets/app-icon.ico"), join(resourcesDir, "app-icon.ico"));
await copySharedPackage();
await copyServerPackage();
await prepareWindowsServerDependencies();
await removeIfExists(buildDir);

console.log(`Windows 应用目录已生成：${appDir}`);
createZip(appDir, zipPath);
console.log(`Windows 压缩包已生成：${zipPath}`);

function resolveInstalledPackageVersion(packagePath, declaredRange) {
  const fullPath = join(rootDir, packagePath);
  if (existsSync(fullPath)) {
    return JSON.parse(readFileSync(fullPath, "utf8")).version;
  }
  return declaredRange.replace(/^[^\d]*/, "");
}

function run(command, args, options = {}) {
  const result = spawnCommand(command, args, {
    cwd: options.cwd ?? rootDir,
    stdio: "inherit",
    env: options.env ?? process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 执行失败`);
  }
}

function runPnpm(args, options = {}) {
  const env = withProxyEnv(options.env ?? process.env);
  const pnpmCli = resolvePnpmCli();
  if (pnpmCli) {
    run(process.execPath, [pnpmCli, ...args], { cwd: options.cwd, env });
    return;
  }

  const pnpmResult = spawnCommand(commandName("pnpm"), args, {
    cwd: options.cwd ?? rootDir,
    stdio: "inherit",
    env,
  });
  if (pnpmResult.status === 0) {
    return;
  }
  run(commandName("corepack"), ["pnpm", ...args], { cwd: options.cwd, env });
}

async function removeInsideRelease(target) {
  const resolved = resolve(target);
  if (!isInsideRelease(resolved)) {
    throw new Error(`拒绝清理非 release 目录：${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}

async function removeIfExists(target) {
  const resolved = resolve(target);
  if (!isInsideRelease(resolved)) {
    throw new Error(`拒绝清理非 release 目录：${resolved}`);
  }
  if (existsSync(resolved)) {
    await rm(resolved, { recursive: true, force: true });
  }
}

async function ensureDownloadOnce(url, target) {
  if (existsSync(target) && (await stat(target)).size > 0) {
    return;
  }

  await mkdir(dirname(target), { recursive: true });
  const tempTarget = `${target}.download`;
  await removeIfExists(tempTarget);
  console.log(`下载：${url}`);
  await downloadFile(url, tempTarget, resolveDownloadProxy());
  await rename(tempTarget, target);
}

async function ensureDownload(url, target) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      console.log(`下载(${attempt}/5)：${url}`);
      await ensureDownloadOnce(url, target);
      return;
    } catch (error) {
      await removeIfExists(`${target}.download`);
      if (attempt === 5) {
        throw error;
      }
      await delay(1000 * attempt);
    }
  }
}

function extractZip(source, target) {
  mkdirSync(target, { recursive: true });
  if (process.platform === "win32") {
    run("tar", ["-xf", source, "-C", target]);
    return;
  }
  run("unzip", ["-q", source, "-d", target]);
}

function createZip(source, target) {
  if (process.platform === "win32") {
    run("tar", ["-a", "-cf", target, "-C", dirname(source), basename(source)]);
    return;
  }
  run("ditto", ["-c", "-k", "--keepParent", source, target]);
}

async function copySharedPackage() {
  const target = join(bundledAppDir, "packages/shared");
  await mkdir(target, { recursive: true });
  await cp(join(rootDir, "packages/shared/dist"), join(target, "dist"), { recursive: true });
  await cp(join(rootDir, "packages/shared/package.json"), join(target, "package.json"));
}

async function copyServerPackage() {
  const target = join(bundledAppsDir, "server");
  await mkdir(target, { recursive: true });
  await cp(join(rootDir, "apps/server/dist"), join(target, "dist"), { recursive: true });
  const patchedPackage = {
    ...serverPackage,
    dependencies: {
      ...serverPackage.dependencies,
      "@squirrel-switch/shared": "file:../../packages/shared",
    },
  };
  await writeFile(join(target, "package.json"), JSON.stringify(patchedPackage, null, 2));
}

async function prepareWindowsServerDependencies() {
  const serverBundleDir = join(bundledAppsDir, "server");
  runPnpm(
    [
      "install",
      "--prod",
      "--ignore-workspace",
      "--ignore-scripts",
      "--lockfile=false",
      "--config.confirmModulesPurge=false",
      "--config.node-linker=hoisted",
    ],
    {
      cwd: serverBundleDir,
      env: {
        ...process.env,
        npm_config_platform: "win32",
        npm_config_arch: "x64",
        npm_config_target_platform: "win32",
        npm_config_target_arch: "x64",
      },
    },
  );

  const betterSqliteDir = join(serverBundleDir, "node_modules/better-sqlite3");
  const prebuildBin = join(serverBundleDir, "node_modules/prebuild-install/bin.js");
  run(process.execPath, [
    prebuildBin,
    "--runtime",
    "node",
    "--target",
    nodeVersion,
    "--platform",
    "win32",
    "--arch",
    "x64",
    "--force",
  ], { cwd: betterSqliteDir, env: withProxyEnv(process.env) });
  await removeIfExists(join(serverBundleDir, "node_modules/.bin"));
  await removeIfExists(join(betterSqliteDir, "node_modules/.bin"));
}

function isInsideRelease(target) {
  const releaseRoot = resolve(rootDir, "release");
  const relative = target.slice(releaseRoot.length);
  return target === releaseRoot || relative.startsWith("\\") || relative.startsWith("/");
}

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function resolvePnpmCli() {
  const match = /^pnpm@(.+)$/.exec(rootPackage.packageManager ?? "");
  const version = match?.[1];
  if (!version || process.platform !== "win32" || !process.env.LOCALAPPDATA) {
    return "";
  }

  const candidate = join(
    process.env.LOCALAPPDATA,
    "node",
    "corepack",
    "v1",
    "pnpm",
    version,
    "bin",
    "pnpm.cjs",
  );
  return existsSync(candidate) ? candidate : "";
}

function shouldUseShell(command) {
  return process.platform === "win32" && command.endsWith(".cmd");
}

function spawnCommand(command, args, options) {
  if (!shouldUseShell(command)) {
    return spawnSync(command, args, options);
  }

  const commandLine = ["call", command, ...args].map(quoteWindowsArg).join(" ");
  return spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", commandLine], options);
}

function quoteWindowsArg(value) {
  const text = String(value);
  if (!/[\\s"]/u.test(text)) {
    return text;
  }
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/u, "$&$&")}"`;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function withTimeout(promise, ms, message, onTimeout) {
  let timer;
  const timeout = new Promise((_, rejectTimeout) => {
    timer = setTimeout(() => {
      onTimeout?.();
      rejectTimeout(new Error(message));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function downloadFile(url, target, proxy, redirects = 5) {
  if (redirects < 0) {
    throw new Error(`Too many redirects while downloading: ${url}`);
  }

  const parsed = new URL(url);
  const response = proxy && parsed.protocol === "https:"
    ? await requestHttpsViaProxy(parsed, proxy)
    : await requestDirect(parsed);

  const statusCode = response.statusCode ?? 0;
  if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
    response.resume();
    const nextUrl = new URL(response.headers.location, url).toString();
    await downloadFile(nextUrl, target, proxy, redirects - 1);
    return;
  }

  if (statusCode < 200 || statusCode >= 300) {
    response.resume();
    throw new Error(`Download failed: ${url} (${statusCode})`);
  }

  response.setTimeout(DOWNLOAD_CONNECT_TIMEOUT_MS, () => {
    response.destroy(new Error(`Download stalled for ${DOWNLOAD_CONNECT_TIMEOUT_MS}ms: ${url}`));
  });
  await withTimeout(
    pipeline(response, createWriteStream(target)),
    DOWNLOAD_TOTAL_TIMEOUT_MS,
    `Download timed out after ${DOWNLOAD_TOTAL_TIMEOUT_MS}ms: ${url}`,
    () => response.destroy(),
  );
}

function requestDirect(url) {
  const request = url.protocol === "http:" ? httpRequest : httpsRequest;
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(url, { headers: downloadHeaders(url) }, resolveRequest);
    req.setTimeout(DOWNLOAD_CONNECT_TIMEOUT_MS, () => {
      req.destroy(new Error(`Download connection timed out after ${DOWNLOAD_CONNECT_TIMEOUT_MS}ms: ${url}`));
    });
    req.on("error", rejectRequest);
    req.end();
  });
}

function requestHttpsViaProxy(url, proxyValue) {
  const proxy = new URL(proxyValue);
  if (proxy.protocol !== "http:") {
    throw new Error(
      `Unsupported proxy protocol for HTTP_PROXY/HTTPS_PROXY: ${proxy.protocol}. Only http:// proxies are supported.`,
    );
  }
  const targetPort = url.port || "443";
  const connectHeaders = { Host: `${url.hostname}:${targetPort}` };
  if (proxy.username || proxy.password) {
    connectHeaders["Proxy-Authorization"] = `Basic ${Buffer.from(
      `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`,
    ).toString("base64")}`;
  }

  return new Promise((resolveRequest, rejectRequest) => {
    const connectReq = httpRequest({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: "CONNECT",
      path: `${url.hostname}:${targetPort}`,
      headers: connectHeaders,
    });

    connectReq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        rejectRequest(new Error(`Proxy CONNECT failed: ${res.statusCode ?? "unknown"}`));
        return;
      }

      const secureSocket = tlsConnect({ socket, servername: url.hostname });
      secureSocket.setTimeout(DOWNLOAD_CONNECT_TIMEOUT_MS, () => {
        secureSocket.destroy(
          new Error(`TLS handshake timed out after ${DOWNLOAD_CONNECT_TIMEOUT_MS}ms: ${url}`),
        );
      });
      secureSocket.on("secureConnect", () => {
        secureSocket.setTimeout(0);
        const req = httpsRequest(
          {
            hostname: url.hostname,
            port: targetPort,
            path: `${url.pathname}${url.search}`,
            method: "GET",
            headers: downloadHeaders(url),
            createConnection: () => secureSocket,
            agent: false,
          },
          resolveRequest,
        );
        req.setTimeout(DOWNLOAD_CONNECT_TIMEOUT_MS, () => {
          req.destroy(new Error(`Download connection timed out after ${DOWNLOAD_CONNECT_TIMEOUT_MS}ms: ${url}`));
        });
        req.on("error", rejectRequest);
        req.end();
      });
      secureSocket.on("error", rejectRequest);
    });
    connectReq.setTimeout(DOWNLOAD_CONNECT_TIMEOUT_MS, () => {
      connectReq.destroy(new Error(`Proxy CONNECT timed out after ${DOWNLOAD_CONNECT_TIMEOUT_MS}ms: ${url}`));
    });
    connectReq.on("error", rejectRequest);
    connectReq.end();
  });
}

function downloadHeaders(url) {
  return {
    Host: url.host,
    "User-Agent": `squirrel-switch-packager/${rootPackage.version}`,
    Accept: "*/*",
    Connection: "close",
  };
}

function resolveDownloadProxy() {
  return normalizeDownloadProxy(
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    "",
  );
}

function normalizeDownloadProxy(value) {
  const proxy = value?.trim();
  if (!proxy) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(proxy);
  } catch {
    throw new Error(`Invalid download proxy URL: ${proxy}`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error(
      `Unsupported download proxy protocol: ${parsed.protocol}. Only http:// proxies are supported.`,
    );
  }
  return parsed.toString();
}

function withProxyEnv(env) {
  const proxy = resolveDownloadProxy();
  if (!proxy) {
    return env;
  }
  return {
    ...env,
    HTTP_PROXY: env.HTTP_PROXY || env.http_proxy || proxy,
    HTTPS_PROXY: env.HTTPS_PROXY || env.https_proxy || proxy,
    http_proxy: env.http_proxy || env.HTTP_PROXY || proxy,
    https_proxy: env.https_proxy || env.HTTPS_PROXY || proxy,
  };
}
