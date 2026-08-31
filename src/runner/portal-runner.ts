import "dotenv/config";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Run = {
  id: string;
  pilotId: string;
  project: string;
  title: string;
  status: "running" | "passed" | "failed";
  startedAt: string;
  completedAt?: string;
  azureRunId?: number;
  azureUrl?: string;
  journal?: string;
  video?: string;
  output: string;
  totals?: { points: number; executed: number; passed: number; failed: number; blocked: number };
};
type AutomationTarget = { project: string; planId: number; planName: string; manifest: string; playwrightProject: string };
const workspace = process.cwd(),
  port = Number(process.env.QA_RUNNER_PORT || 3101),
  storePath = path.join(workspace, "generated", "portal-runs.json");
let runs: Run[] = [];
function playwrightProjectFor(project: string) {
  const configured = JSON.parse(process.env.QA_PLAYWRIGHT_PROJECTS_JSON || "{}") as Record<string, string>;
  return configured[project] ?? `${project.replace(/^SG_/i, "").split(/[_\s-]/)[0].toLowerCase()}-chrome`;
}
async function resolveTarget(project: string, planId: number): Promise<AutomationTarget> {
  const directory = path.join(workspace, "generated", "automation");
  for (const name of await readdir(directory)) {
    if (!name.endsWith(".json")) continue;
    const relative = path.join("generated", "automation", name);
    try {
      const manifest = JSON.parse(await readFile(path.join(workspace, relative), "utf8"));
      if (manifest.project === project && Number(manifest.planId) === planId) {
        return { project, planId, planName: String(manifest.planName || `Test Plan ${planId}`), manifest: relative, playwrightProject: playwrightProjectFor(project) };
      }
    } catch {}
  }
  throw new Error(`No existe un manifiesto de automatización para ${project}/Plan ${planId}.`);
}
async function load() {
  try {
    runs = JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    runs = [];
  }
}
async function save() {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(runs, null, 2) + "\n", "utf8");
}
function json(res: http.ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(value));
}
async function body(req: http.IncomingMessage) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}
async function newestVideo(since: number) {
  const root = path.join(workspace, "test-results"),
    found: string[] = [];
  async function walk(dir: string) {
    try {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (
          entry.name.endsWith(".webm") &&
          (await stat(full)).mtimeMs >= since
        )
          found.push(full);
      }
    } catch {}
  }
  await walk(root);
  return found.sort((a, b) => a.localeCompare(b)).at(-1);
}
function execute(run: Run, target: AutomationTarget, suiteId: number) {
  const started = Date.now(),
    child = spawn(
      process.execPath,
      [
        path.join(workspace, "node_modules", "tsx", "dist", "cli.mjs"),
        "src/cli/run-test-plan.ts",
        "--manifest",
        target.manifest,
        "--project",
        target.playwrightProject,
        "--suite",
        String(suiteId),
        "--apply",
      ],
      {
        cwd: workspace,
        env: { ...process.env, DOTENV_CONFIG_QUIET: "true" },
        windowsHide: true,
      },
    );
  let output = "";
  child.stdout.on("data", (x) => (output += x));
  child.stderr.on("data", (x) => (output += x));
  child.on("close", async (code) => {
    run.output = output.slice(-12000);
    run.completedAt = new Date().toISOString();
    run.status = code === 0 ? "passed" : "failed";
    const runIds = [...output.matchAll(/Azure Test Run:\s*(\d+)/g)];
    const urls = [...output.matchAll(/URL:\s*(https?:\/\/\S+)/g)];
    run.azureRunId = Number(runIds.at(-1)?.[1]) || undefined;
    run.azureUrl = urls.at(-1)?.[1];
    run.journal = output.match(/Journal:\s*(.+)/)?.[1]?.trim();
    const totals = output.match(/Total Test Points:\s*(\d+)[\s\S]*?Ejecutados:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)\s*\|\s*Blocked:\s*(\d+)/);
    if (totals) run.totals = {
      points: Number(totals[1]), executed: Number(totals[2]), passed: Number(totals[3]),
      failed: Number(totals[4]), blocked: Number(totals[5]),
    };
    run.video = await newestVideo(started);
    await save();
  });
}
async function main() {
  await load();
  const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      return res.end();
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/health")
      return json(res, 200, {
        ok: true,
        running: runs.filter((x) => x.status === "running").length,
      });
    if (req.method === "GET" && url.pathname === "/runs")
      return json(res, 200, { runs: runs.slice().reverse() });
    if (req.method === "POST" && url.pathname === "/runs") {
      const input = await body(req),
        project = String(input.project ?? "").trim(),
        planId = Number(input.planId),
        suiteId = Number(input.suiteId);
      if (!project || !Number.isInteger(planId) || planId <= 0 || !Number.isInteger(suiteId) || suiteId <= 0)
        return json(res, 400, { error: "Proyecto, Test Plan o Test Suite inválido." });
      const target = await resolveTarget(project, planId);
      if (runs.some((x) => x.status === "running"))
        return json(res, 409, { error: "Ya existe una ejecución en curso." });
      const run: Run = {
        id: randomUUID(),
        pilotId: `${target.project}:${target.planId}`,
        project: target.project,
        title: `${target.planName} · Suite ${suiteId}`,
        status: "running",
        startedAt: new Date().toISOString(),
        output: "",
      };
      runs.push(run);
      await save();
      execute(run, target, suiteId);
      return json(res, 202, { run });
    }
    const videoMatch = url.pathname.match(/^\/runs\/([^/]+)\/video$/);
    if (req.method === "GET" && videoMatch) {
      const run = runs.find((x) => x.id === videoMatch[1]);
      if (!run?.video) return json(res, 404, { error: "Video no disponible." });
      res.writeHead(200, {
        "Content-Type": "video/webm",
        "Content-Disposition": `inline; filename="${path.basename(run.video)}"`,
        "Access-Control-Allow-Origin": "http://localhost:3000",
      });
      return createReadStream(run.video).pipe(res);
    }
    return json(res, 404, { error: "Ruta no encontrada." });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : "Error del runner.",
    });
  }
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`QA runner listo en http://127.0.0.1:${port}`),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
