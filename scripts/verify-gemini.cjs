/**
 * Verify Gemini API key actually works.
 * Loads parent .env, checks the key, makes one minimal API call.
 *
 * Run: node scripts/verify-gemini.cjs
 */

require('./load-parent-env.cjs');

async function main() {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  console.log('─── Gemini API verification ──────────────────────────');
  console.log(`GEMINI_API_KEY loaded:  ${process.env.GEMINI_API_KEY ? 'yes' : 'no'}`);
  console.log(`GOOGLE_API_KEY loaded:  ${process.env.GOOGLE_API_KEY ? 'yes' : 'no'}`);
  console.log(`Effective key prefix:   ${key ? key.slice(0, 10) + '…' + key.slice(-4) : '(none)'}`);

  if (!key) {
    console.error('\n❌ No Gemini key found in env.');
    process.exit(1);
  }

  // Minimal text-only call to validate the key is alive.
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK.' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 5 },
  };

  console.log(`\nCalling ${model}…`);
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;

  if (!res.ok) {
    const errBody = await res.text();
    console.error(`❌ HTTP ${res.status} (${ms}ms):`);
    console.error(errBody.slice(0, 600));
    process.exit(2);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '(empty)';
  const promptTok = data?.usageMetadata?.promptTokenCount ?? 0;
  const respTok = data?.usageMetadata?.candidatesTokenCount ?? 0;

  console.log(`✅ HTTP 200 in ${ms}ms`);
  console.log(`   Model echo:  "${text.trim()}"`);
  console.log(`   Tokens:      ${promptTok} prompt + ${respTok} response`);
  console.log('\n🎉 Gemini key works. Vision tools (sim_cfd auto-verify, view_render) will now use Gemini when Anthropic is unset.');
}

main().catch(e => {
  console.error('❌ verification threw:', e.message);
  process.exit(3);
});
