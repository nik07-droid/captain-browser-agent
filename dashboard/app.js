const $ = (selector) => document.querySelector(selector);
const metric = (name, value, detail) =>
  `<label>${name}<meter value="${Math.max(0, Math.min(100, Number(value) || 0))}" max="100"></meter><b>${value == null ? "not measured" : `${value}%`}</b><small>${detail}</small></label>`;
const safe = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function update() {
  try {
    const optionalJson = (url) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    const [health, report, acceptance, handoff, amazonLatency] = await Promise.all([
      fetch("/health", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/benchmark", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error("Run npm run benchmark first");
        return r.json();
      }),
      optionalJson("/api/acceptance"),
      optionalJson("/api/handoff"),
      optionalJson("/api/amazon-latency"),
    ]);
    $("#health").textContent = `● LOCAL AGENT ONLINE · ${health.planner}`;
    $("#health").style.color = "#34d399";
    const s = report.summary || {},
      visual = s.visual || {},
      pii = s.pii || {},
      redaction = s.redaction || {},
      task = s.taskCompletion || {},
      latency = s.latency || {},
      resources = s.resources || {},
      vlm = s.vlm || {};
    $("#screens").textContent = `${s.passed ?? 0}/${s.total ?? 0}`;
    $("#screen-detail").textContent = `${s.failed ?? 0} failed labeled screens`;
    $("#completion").textContent =
      task.ratePercent == null ? "—" : `${task.ratePercent}%`;
    $("#latency").textContent =
      latency.p95ObservationMs == null ? "—" : `${latency.p95ObservationMs}ms`;
    $("#generated").textContent =
      `${report.passed ? "PASS" : "NEEDS WORK"} · ${new Date(report.generatedAt).toLocaleString()}`;
    $("#generated").className = report.passed ? "pass" : "fail";
    $("#version").textContent = report.benchmarkVersion || "—";
    $("#score-bars").innerHTML = [
      metric(
        "Visual context F1",
        visual.f1Percent,
        `${visual.truePositives ?? 0} TP · ${visual.falsePositives ?? 0} FP · ${visual.falseNegatives ?? 0} FN`,
      ),
      metric(
        "PII detection F1",
        pii.f1Percent,
        `${pii.truePositives ?? 0} TP · ${pii.falsePositives ?? 0} FP · ${pii.falseNegatives ?? 0} FN`,
      ),
      metric(
        "Redaction precision",
        redaction.precisionPercent,
        `${redaction.recallPercent ?? "—"}% recall`,
      ),
      metric(
        "Task completion",
        task.ratePercent,
        `${task.passed ?? 0}/${task.total ?? 0} tested workflow`,
      ),
      metric(
        "Idle efficiency",
        resources.idleAggregateCpuThreeSecondSampleAfterCooldown
          ? Math.max(
              0,
              100 -
                resources.idleAggregateCpuThreeSecondSampleAfterCooldown
                  .aggregatePercentOfOneCore,
            ).toFixed(2)
          : null,
        resources.idleAggregateCpuThreeSecondSampleAfterCooldown
          ? `${resources.idleAggregateCpuThreeSecondSampleAfterCooldown.aggregatePercentOfOneCore}% aggregate Chrome CPU (lower is better)`
          : "not measured",
      ),
    ].join("");
    $("#cases").innerHTML = (report.cases || [])
      .map(
        (c) =>
          `<tr><td>${safe(c.id)}</td><td>${c.detectedElements}/${c.expectedElements}</td><td>${c.detectedPrivateRegions}/${c.expectedPrivateRegions}</td><td>${c.leaked ? '<span class="fail">YES</span>' : "No"}</td><td><span class="${c.passed ? "pass" : "fail"}">${c.passed ? "PASS" : "FAIL"}</span></td></tr>`,
      )
      .join("");
    $("#resources").innerHTML =
      `<div><b>${resources.modelAndLoadedRuntimeFootprintMiB ?? "—"} MiB</b><span>client model + loaded runtime</span></div><div><b>${resources.idleAggregateCpuThreeSecondSampleAfterCooldown?.aggregatePercentOfOneCore ?? "—"}%</b><span>idle aggregate CPU, one-core basis</span></div><div><b>${resources.aggregateChromeWorkingSetMiBUpperBound ?? "—"} MiB</b><span>dedicated Chrome working-set upper bound</span></div><div><b>${latency.shoppingEndToEndMs ?? "—"} ms</b><span>shopping task end-to-end</span></div><div><b>${vlm.passed ? "PASS" : "—"}</b><span>${safe(vlm.model || "VLM not audited")} · ${vlm.latencyMs ?? "—"} ms · sanitized image</span></div><p>${safe(resources.note || "No resource note recorded.")}</p>`;
    renderAcceptance(acceptance);
    renderHandoff(handoff);
    renderAmazonLatency(amazonLatency);
  } catch (error) {
    $("#health").textContent = `● EVIDENCE UNAVAILABLE · ${error.message}`;
    $("#health").style.color = "#fb7185";
  }
}
function renderAmazonLatency(report) {
  if (!report) {
    $("#amazon-latency").innerHTML = "<p>Run npm run benchmark:amazon-latency to create real-site evidence.</p>";
    return;
  }
  const { benchmark, baseline, optimized } = report;
  const total = benchmark.total?.medianMs || 1;
  const captain = benchmark.captainOnly?.medianMs || 0;
  const external = benchmark.externalNavigation?.medianMs || 0;
  const width = value => `${Math.max(1, (value / total) * 100).toFixed(1)}%`;
  const improvement = baseline.totalMs ? Math.round((1 - optimized.totalMs / baseline.totalMs) * 1000) / 10 : null;
  $("#amazon-latency-state").textContent = `${benchmark.successfulRuns}/${benchmark.requestedRuns} PASS · ${benchmark.privacyLeaks} leaks`;
  $("#amazon-latency-state").className = benchmark.successfulRuns === benchmark.requestedRuns && benchmark.privacyLeaks === 0 ? "pass" : "fail";
  $("#amazon-latency").innerHTML = `<div class="latency-summary"><div><b>${benchmark.total.medianMs} ms</b><span>median end-to-end</span></div><div><b>${benchmark.total.p95Ms} ms</b><span>P95 end-to-end</span></div><div><b>${captain} ms</b><span>median CAPTAIN-only</span></div><div><b>${external} ms</b><span>median external navigation</span></div></div><div class="waterfall"><div><span>CAPTAIN</span><i class="captain" style="width:${width(captain)}"></i><b>${captain} ms</b></div><div><span>External</span><i class="external" style="width:${width(external)}"></i><b>${external} ms</b></div></div><p class="caveat">Comparable instrumented run: ${baseline.totalMs} ms before → ${optimized.totalMs} ms after (${improvement}% faster). Five-run totals include live Amazon/network variance; planner median is ${Math.round(benchmark.results.reduce((sum, row) => sum + row.plannerMs, 0) / benchmark.results.length)} ms and VLM time is 0 ms because this grounded workflow uses the deterministic planner.</p>`;
}
let acceptanceReport = null;
function outcome(row) {
  return row.completed ? "verified" : row.status === "PARTIAL" ? "partial" : row.blocked ? "blocked" : "failed";
}
function renderAcceptance(report) {
  acceptanceReport = report;
  if (!report) {
    $("#acceptance").innerHTML =
      '<tr><td colspan="6">Run npm run test:acceptance to create evidence.</td></tr>';
    return;
  }
  const categories = [
    ...new Set((report.results || []).map((x) => x.category)),
  ].sort();
  const existing = [...$("#site-category").options]
    .slice(1)
    .map((x) => x.value);
  if (existing.join("|") !== categories.join("|"))
    $("#site-category").innerHTML =
      '<option value="">All categories</option>' +
      categories
        .map((x) => `<option value="${safe(x)}">${safe(x)}</option>`)
        .join("");
  const category = $("#site-category").value,
    status = $("#site-status").value;
  const rows = (report.results || []).filter(
    (x) =>
      (!category || x.category === category) &&
      (!status || outcome(x) === status),
  );
  $("#acceptance-summary").textContent =
    `${report.completed}/${report.total} verified · ${report.partial || 0} partial · ${report.blocked} blocked · ${report.failed} failed · ${(report.results || []).reduce((sum, row) => sum + (row.recoveryCount || 0), 0)} recoveries · generated ${new Date(report.generatedAt).toLocaleString()}`;
  $("#acceptance").innerHTML = rows.length
    ? rows
        .map((row) => {
          const state = outcome(row);
          return `<tr><td>${safe(row.website)}</td><td>${safe(row.category)}</td><td>${row.steps ?? "—"} · ${row.recoveryCount || 0} recoveries</td><td>${row.latency == null ? "—" : `${row.latency} ms`}</td><td>${safe(row.privacy?.status || "unknown")} · raw sent: ${row.privacy?.rawScreenshotTransmitted ? '<span class="fail">yes</span>' : "no"}</td><td><span class="${state === "verified" ? "pass" : state === "blocked" || state === "partial" ? "partial" : "fail"}">${state.toUpperCase()}</span><small>${safe(row.reason)}</small></td></tr>`;
        })
        .join("")
    : '<tr><td colspan="6">No outcomes match these filters.</td></tr>';
}
function renderHandoff(report) {
  if (!report) {
    $("#handoff").innerHTML =
      "<p>Run npm run test:handoff to create evidence.</p>";
    return;
  }
  $("#handoff-state").textContent = report.passed ? "PASS" : "NEEDS WORK";
  $("#handoff-state").className = report.passed ? "pass" : "fail";
  $("#handoff").innerHTML =
    `<div><b>${report.refusedWhilePresent ? "YES" : "NO"}</b><span>refused while challenge present</span></div><div><b>${report.resumed ? "YES" : "NO"}</b><span>resumed after human action</span></div><div><b>${report.taskCompletedAfterHandoff ? "YES" : "NO"}</b><span>task completed after handoff</span></div><div><b>${report.handoffDuration ?? "—"} ms</b><span>measured fixture handoff transition</span></div>`;
}
$("#refresh").addEventListener("click", update);
$("#site-category").addEventListener("change", () =>
  renderAcceptance(acceptanceReport),
);
$("#site-status").addEventListener("change", () =>
  renderAcceptance(acceptanceReport),
);
update();
setInterval(update, 10000);
