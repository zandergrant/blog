// /api/generate.js — auto-discovers a working Gemini model for your key (no more 404s)

// ---- tiny raw JSON body reader (framework-free)
async function readJsonBody(req) {
  return new Promise((resolve) => {
    try {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { resolve({ _raw: data }); }
      });
    } catch { resolve({}); }
  });
}

export default async function handler(req, res) {
  // CORS — keep wide while finishing setup; tighten later to your GH Pages origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Env var names we accept
  const apiKey =
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const keyName =
    (process.env.GOOGLE_API_KEY && 'GOOGLE_API_KEY') ||
    (process.env.GEMINI_API_KEY && 'GEMINI_API_KEY') ||
    (process.env.GOOGLE_GENAI_API_KEY && 'GOOGLE_GENAI_API_KEY') ||
    (process.env.GOOGLE_GENERATIVE_AI_API_KEY && 'GOOGLE_GENERATIVE_AI_API_KEY') ||
    null;

  // Quick GET diag
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      info: 'Use POST for generation.',
      hasKey: Boolean(apiKey),
      keyName,
      endpoint: 'v1',
      note: 'This endpoint will list models internally and pick a working one.'
    });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'error', error: 'Use POST' });
  }

  const body = await readJsonBody(req);
  const date = (body && body.date) || new Date().toISOString().slice(0, 10);
  const userId = (body && body.userId) || 'anon';

  // If no key → return mock so UI renders
  if (!apiKey || apiKey.length < 10) {
    return res.status(200).json({
      status: 'mock',
      research: {
        title: `Sample Brief for ${date}`,
        introduction: 'No Gemini API key found on server (mock content).',
        keyFindings: 'Set GOOGLE_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.',
        conclusion: 'Once set, this will auto-switch to live AI.',
        source: 'System (mock)'
      },
      concepts: [
        { term: 'Centeredness',   definition: 'Steadiness under changing conditions.' },
        { term: 'Interoception',  definition: 'Sensing internal body signals.' },
        { term: 'Cognitive Load', definition: 'How much working memory is being used.' }
      ],
      debug: { hasKey: false, keyName, userIdPreview: String(userId).slice(0, 16) }
    });
  }

  // ---------- Live AI path with model auto-discovery ----------
  const API_BASE = 'https://generativelanguage.googleapis.com';

  // 1) List all models visible to *your key*
  let modelsResp, modelsText;
  try {
    modelsResp = await fetch(`${API_BASE}/v1/models?key=${apiKey}`);
    modelsText = await modelsResp.text();
  } catch (e) {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `Model List Error — Fallback for ${date}`,
        introduction: 'Could not reach the models list endpoint.',
        keyFindings: String(e).slice(0, 600),
        conclusion: 'Check network or key and refresh.',
        source: 'System'
      },
      concepts: [],
      debug: { step: 'listModels-fetch', error: String(e) }
    });
  }

  if (!modelsResp.ok) {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `Model List Error (${modelsResp.status}) — Fallback for ${date}`,
        introduction: 'The models list request failed.',
        keyFindings: modelsText.slice(0, 800),
        conclusion: 'Fix and refresh.',
        source: 'System'
      },
      concepts: [],
      debug: { step: 'listModels-response', status: modelsResp.status }
    });
  }

  let listed;
  try {
    listed = JSON.parse(modelsText);
  } catch {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `Model List Parse Error — Fallback for ${date}`,
        introduction: 'Could not parse the models list.',
        keyFindings: modelsText.slice(0, 800),
        conclusion: 'Try again.',
        source: 'System'
      },
      concepts: [],
      debug: { step: 'listModels-parse' }
    });
  }

  const models = Array.isArray(listed?.models) ? listed.models : [];
  // Prefer 1.5 flash/pro; otherwise anything that supports generateContent
  const preferred = models.filter(m => {
    const name = m?.name || '';
    const methods = m?.supportedGenerationMethods || m?.supportedMethods || [];
    return (
      /gemini-1\.5-(flash|pro)/.test(name) &&
      Array.isArray(methods) &&
      methods.includes('generateContent')
    );
  });

  const general = models.filter(m => {
    const methods = m?.supportedGenerationMethods || m?.supportedMethods || [];
    return Array.isArray(methods) && methods.includes('generateContent');
  });

  const pickedModel = (preferred[0]?.name || general[0]?.name || '').replace(/^models\//, '');
  if (!pickedModel) {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `No Usable Model — Fallback for ${date}`,
        introduction: 'Your key lists no models that support generateContent.',
        keyFindings: 'Enable Gemini API for this key/project or create a new API key in AI Studio.',
        conclusion: 'Update the key, then refresh.',
        source: 'System'
      },
      concepts: [],
      debug: {
        step: 'pickModel',
        modelsCount: models.length,
        sampleNames: models.slice(0, 5).map(m => m.name)
      }
    });
  }

  // 2) Call the picked model on v1
  const prompt = `
Return ONLY valid JSON with this exact shape:
{
  "research": {
    "title": string,
    "introduction": string,
    "keyFindings": string,
    "conclusion": string,
    "source": string
  },
  "concepts": [
    { "term": string, "definition": string },
    { "term": string, "definition": string },
    { "term": string, "definition": string }
  ]
}
Guidelines:
- Audience: thoughtful professionals working on centeredness.
- Tie lightly to the date: ${date}.
- Keep it concise, practical, science-informed.
- "source" can be a general plausible citation (no URLs required).
`;

  let upstream, raw;
  try {
    upstream = await fetch(
      `${API_BASE}/v1/models/${pickedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        })
      }
    );
    raw = await upstream.text();
  } catch (e) {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `AI Call Error — Fallback for ${date}`,
        introduction: 'Network error while calling the model.',
        keyFindings: String(e).slice(0, 600),
        conclusion: 'Check connection and try again.',
        source: 'System'
      },
      concepts: [],
      debug: { step: 'generateContent-fetch', pickedModel, error: String(e) }
    });
  }

  if (!upstream.ok) {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `AI Error (${upstream.status}) — Fallback for ${date}`,
        introduction: 'The AI call did not succeed.',
        keyFindings: raw ? raw.slice(0, 900) : 'No response body.',
        conclusion: 'Check debug → fix → refresh.',
        source: 'System'
      },
      concepts: [],
      debug: { step: 'generateContent-response', pickedModel, status: upstream.status }
    });
  }

  // Parse AI JSON; clean code fences if necessary
  let ai;
  try {
    ai = JSON.parse(raw);
  } catch {
    const cleaned = raw.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '')
      .trim();
    ai = JSON.parse(cleaned);
  }

  // Coerce to your UI schema
  return res.status(200).json({
    status: 'ok',
    research: {
      title:        ai?.research?.title        ?? `Untitled — ${date}`,
      introduction: ai?.research?.introduction ?? '',
      keyFindings:  ai?.research?.keyFindings  ?? '',
      conclusion:   ai?.research?.conclusion   ?? '',
      source:       ai?.research?.source       ?? 'General literature'
    },
    concepts: Array.isArray(ai?.concepts)
      ? ai.concepts.slice(0, 3).map(c => ({
          term:       String(c?.term ?? '').slice(0, 160),
          definition: String(c?.definition ?? '').slice(0, 900)
        }))
      : [],
    debug: { hasKey: true, keyName, pickedModel }
  });
}
