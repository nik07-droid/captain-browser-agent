const started = performance.now();
const response = await fetch('http://127.0.0.1:4317/api/agent/step', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ task: 'Choose the dark appearance option', context: { url: 'https://example.com/settings', pageText: 'Appearance: Light / Dark', elements: [{ ref: 'c1', tag: 'button', name: 'Light' }, { ref: 'c2', tag: 'button', name: 'Dark' }] }, history: [] })
});
const plan = await response.json();
if (!response.ok || plan.planner !== 'ollama' || plan.action?.type !== 'click' || plan.action?.target?.ref !== 'c2') throw new Error(`Local inference failed: ${JSON.stringify(plan)}`);
console.log(JSON.stringify({ success: true, model: plan.model, action: plan.action, inferenceMs: Math.round(performance.now() - started) }));
