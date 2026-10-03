import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const content = await readFile(new URL('../extension/content-script.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8');
const popup = await readFile(new URL('../extension/popup.js', import.meta.url), 'utf8');

test('challenge detection uses controls plus strong verification language and never tries to solve it', () => {
  assert.match(content, /function detectHumanChallenge/);
  assert.match(content, /recaptcha/);
  assert.match(content, /verify .*human/i);
  assert.doesNotMatch(content, /solveCaptcha|bypassCaptcha|captchaSolver/i);
});

test('service worker pauses before planning and resumes only after a clear local observation', () => {
  const detection = worker.indexOf('if (context.challenge?.detected)');
  const planner = worker.indexOf("fetch(`${config.serverUrl}/api/agent/step`");
  assert.ok(detection > 0 && detection < planner, 'Challenge gate must run before the planner request');
  assert.match(worker, /status: 'waiting_human'/);
  assert.match(worker, /type === 'RESUME_TASK'/);
  assert.match(worker, /if \(context\.challenge\?\.detected\) return \{ ok: false/);
  for (const state of ['WAITING_FOR_HUMAN', 'VERIFICATION_CLEARED', 'RESUMING']) assert.match(worker, new RegExp(state));
});

test('controller exposes an explicit Resume CAPTAIN action only for human handoff', async () => {
  assert.match(popup, /RESUME_TASK/);
  assert.match(popup, /waiting_human/);
  assert.match(await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8'), /Resume CAPTAIN/);
});
