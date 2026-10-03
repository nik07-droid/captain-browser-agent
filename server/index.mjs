import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { payloadLeaks } from "./privacy.mjs";
import { planStep } from "./planner.mjs";
import { expectedServerRuntime } from "../scripts/server-runtime.mjs";
import {
  allowedOrigin,
  createRateLimiter,
  isJsonRequest,
  responseOrigin,
} from "./security.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const runtime = expectedServerRuntime(root);
let activeRequests = 0;
try {
  for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match && process.env[match[1].trim()] === undefined)
      process.env[match[1].trim()] = match[2].trim();
  }
} catch {}
const port = Number(process.env.CAPTAIN_PORT || 4317);
const host = process.env.CAPTAIN_HOST || "127.0.0.1";
const samples = [];
let lastVisualAudit = null;
const checkAgentRate = createRateLimiter({ limit: 60, windowMs: 60_000 });
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 4_500_000) {
      const error = new Error("Request too large");
      error.status = 413;
      throw error;
    }
  }
  return JSON.parse(raw || "{}");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  res.setHeader("access-control-allow-origin", responseOrigin(origin));
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("vary", "Origin");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  if (!allowedOrigin(origin))
    return json(res, 403, { error: "Origin is not permitted" });
  if (req.method === "OPTIONS") return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/health")
      return json(res, 200, {
        ok: true,
        service: "captain",
        ...runtime,
        activeRequests,
        planner: process.env.CAPTAIN_OLLAMA_MODEL
          ? "ollama"
          : process.env.CAPTAIN_VLM_API_KEY
            ? "vlm"
            : "local-fallback",
        model: process.env.CAPTAIN_OLLAMA_MODEL || null,
      });
    if (url.pathname === "/api/metrics" && req.method === "GET") {
      const average = (key) =>
        samples.length
          ? Math.round(
              samples.reduce((sum, x) => sum + Number(x[key] || 0), 0) /
                samples.length,
            )
          : 0;
      return json(res, 200, {
        runs: samples.length,
        latencyMs: average("latencyMs"),
        piiDetected: samples.reduce(
          (n, x) => n + Number(x.piiDetected || 0),
          0,
        ),
        last: samples.at(-1) || null,
        lastVisualAudit,
      });
    }
    if (url.pathname === "/api/metrics" && req.method === "POST") {
      if (!isJsonRequest(req.headers))
        return json(res, 415, { error: "application/json is required" });
      samples.push(await body(req));
      samples.splice(0, Math.max(0, samples.length - 100));
      return json(res, 202, { ok: true });
    }
    if (url.pathname === "/api/benchmark" && req.method === "GET") {
      const report = JSON.parse(
        await readFile(join(root, "runtime", "benchmark-results.json"), "utf8"),
      );
      return json(res, 200, report);
    }
    if (url.pathname === "/api/amazon-latency" && req.method === "GET") {
      const [benchmark, baseline, optimized] = await Promise.all([
        readFile(join(root, "runtime", "amazon-latency-benchmark.json"), "utf8").then(JSON.parse),
        readFile(join(root, "runtime", "amazon-latency-baseline.json"), "utf8").then(JSON.parse),
        readFile(join(root, "runtime", "amazon-latency-optimized.json"), "utf8").then(JSON.parse),
      ]);
      return json(res, 200, { benchmark, baseline, optimized });
    }
    if (url.pathname === "/api/acceptance" && req.method === "GET") {
      const report = JSON.parse(
        await readFile(
          join(root, "runtime", "acceptance-summary.json"),
          "utf8",
        ),
      );
      return json(res, 200, report);
    }
    if (url.pathname === "/api/handoff" && req.method === "GET") {
      const report = JSON.parse(
        await readFile(join(root, "runtime", "handoff-audit.json"), "utf8"),
      );
      return json(res, 200, report);
    }
    if (
      url.pathname === "/api/benchmark/sanitized-image" &&
      req.method === "GET"
    ) {
      const file = await readFile(
        join(root, "runtime", "sanitized-privacy-audit.jpg"),
      );
      res.writeHead(200, {
        "content-type": "image/jpeg",
        "cache-control": "no-store",
      });
      return res.end(file);
    }
    if (url.pathname === "/api/agent/step" && req.method === "POST") {
      if (!isJsonRequest(req.headers))
        return json(res, 415, { error: "application/json is required" });
      const rate = checkAgentRate(
        `${req.socket.remoteAddress || "local"}:${origin || "no-origin"}`,
      );
      res.setHeader("x-ratelimit-remaining", String(rate.remaining));
      if (!rate.allowed) {
        res.setHeader(
          "retry-after",
          String(Math.ceil(rate.retryAfterMs / 1000)),
        );
        return json(res, 429, { error: "Too many agent requests" });
      }
      const started = performance.now();
      const input = await body(req);
      const bodyParsed = performance.now();
      if (!input.task || !input.context)
        return json(res, 400, { error: "task and context are required" });
      const leaks = payloadLeaks(input);
      const privacyChecked = performance.now();
      if (leaks.length)
        return json(res, 422, {
          error: "Privacy boundary rejected unsanitized PII",
          categories: [...new Set(leaks.map((x) => x.kind))],
        });
      lastVisualAudit = input.context.screenshot
        ? {
            receivedAt: new Date().toISOString(),
            ...input.context.visualPrivacy,
            screenshotField: "sanitized-jpeg",
            rawScreenshotReceived: false,
          }
        : {
            receivedAt: new Date().toISOString(),
            screenshotField: "none",
            rawScreenshotReceived: false,
          };
      activeRequests++;
      try {
        const plannerStarted = performance.now();
        const plan = await planStep(
          input.task,
          input.context,
          input.history || [],
        );
        return json(res, 200, {
          ...plan,
          serverLatencyMs: Math.round(performance.now() - started),
          serverTiming: { bodyParseMs: Math.round(bodyParsed - started), privacyBoundaryMs: Math.round(privacyChecked - bodyParsed), plannerMs: Math.round(performance.now() - plannerStarted) },
        });
      } finally {
        activeRequests--;
      }
    }
    const dashboardRoutes = new Map([
      ["/", "dashboard/index.html"],
      ["/demo.html", "dashboard/demo.html"],
      ["/privacy-fixture.html", "dashboard/privacy-fixture.html"],
      ["/challenge-fixture.html", "dashboard/challenge-fixture.html"],
      ["/benchmark.html", "dashboard/benchmark.html"],
      ["/ultraface-test.jpg", "dashboard/ultraface-test.jpg"],
    ]);
    const relative =
      dashboardRoutes.get(url.pathname) || url.pathname.replace(/^\//, "");
    if (relative.includes(".."))
      return json(res, 400, { error: "Invalid path" });
    if (
      ![
        "dashboard/index.html",
        "dashboard/demo.html",
        "dashboard/privacy-fixture.html",
        "dashboard/challenge-fixture.html",
        "dashboard/benchmark.html",
        "dashboard/ultraface-test.jpg",
        "dashboard/style.css",
        "dashboard/app.js",
      ].includes(relative)
    )
      return json(res, 404, { error: "Not found" });
    const file = await readFile(join(root, relative));
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'",
    );
    res.writeHead(200, {
      "content-type": types[extname(relative)] || "application/octet-stream",
    });
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, Number(error.status) || 500, {
      error:
        Number(error.status) && error.status < 500
          ? error.message
          : "Request could not be processed",
    });
  }
});

server.listen(port, host, () =>
  console.log(`CAPTAIN control plane: http://${host}:${port}`),
);
