import { mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
const root = await mkdtemp("/private/tmp/qwen-studio-e2e-");
const appRoot = path.resolve("..");
const child = spawn(
  path.join(appRoot, ".venv/bin/python"),
  [
    path.join(appRoot, "backend/qa_app.py"),
    "--data-root",
    root,
    "--port",
    "8768",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, PYTHONPATH: path.join(appRoot, "backend") },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code || 0));
