const path = require("node:path");
const { spawn } = require("node:child_process");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForServer = async (baseUrl, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(baseUrl)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await wait(250);
  }
  throw new Error(`Vite did not start on ${baseUrl}`);
};

const startVite = ({ rootDir, port, host, logOutput = false }) => {
  const args = [path.join(rootDir, "node_modules", "vite", "bin", "vite.js")];
  if (host) args.push("--host", host);
  args.push("--port", String(port), "--strictPort");

  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: logOutput ? ["ignore", "pipe", "pipe"] : "ignore",
  });
  if (logOutput) {
    child.stdout.on("data", (data) => process.stdout.write(data));
    child.stderr.on("data", (data) => process.stderr.write(data));
  }
  return child;
};

const stopProcessTree = (processToStop) => new Promise((resolve) => {
  if (!processToStop || processToStop.killed) return resolve();
  if (process.platform !== "win32") {
    processToStop.kill();
    return resolve();
  }
  const killer = spawn("taskkill", ["/pid", String(processToStop.pid), "/T", "/F"], { stdio: "ignore" });
  killer.on("close", resolve);
  killer.on("error", resolve);
});

module.exports = { startVite, stopProcessTree, wait, waitForServer };
