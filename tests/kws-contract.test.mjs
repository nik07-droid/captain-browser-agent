import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

test('KWS contract is custom, int8-oriented and inside strict declared budgets', async () => {
  const config = JSON.parse(await read('kws/config.json'));
  assert.equal(config.keyword, 'hey captain');
  assert.deepEqual(config.labels, ['silence', 'unknown', 'hey_captain']);
  assert.equal(config.sampleRateHz, 16000);
  assert.ok(config.budgets.modelBytes <= 32768);
  assert.ok(config.budgets.totalRamBytes < 256 * 1024);
  assert.ok(config.budgets.idleCpuPercent < 10);
});

test('training explicitly exports full int8 without pretrained keyword weights', async () => {
  const source = await read('kws/train.py');
  assert.match(source, /TFLITE_BUILTINS_INT8/);
  assert.match(source, /inference_input_type = tf\.int8/);
  assert.match(source, /"pretrainedKeywordWeights": False/);
  assert.doesNotMatch(source, /requests\.get|urlretrieve|subprocess[^\n]+curl/i);
});

test('post-wake protocol uses binary PCM frames and a first-audio acknowledgement', async () => {
  const protocol = await read('kws/protocol.md');
  const server = await read('kws/asr_server.py');
  assert.match(protocol, /640 bytes/);
  assert.match(protocol, /first_audio_ack/);
  assert.match(server, /isinstance\(message, bytes\)/);
  assert.match(server, /compression=None/);
  assert.match(server, /register_browser/);
  const popup = await read('extension/popup.js');
  assert.match(popup, /source === 'edge-kws-asr'/);
  assert.match(popup, /handleVoicePhrase\(message\.text, true\)/);
});

test('budget verifier fails closed when physical evidence is absent or over budget', async () => {
  const source = await read('kws/verify_budget.py');
  assert.match(source, /missing measured evidence/);
  assert.match(source, /peakTotalRamBytes/);
  assert.match(source, /idleCpuPercent/);
  assert.match(source, /falseActivationsPerHour/);
  assert.match(source, /p95KeywordToFirstAudioMs/);
});
