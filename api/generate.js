// /api/generate.js — v1 + correct model, robust, with clear status/debug

// Tiny raw JSON body reader (works without a framework)
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
  // CORS — keep * while finishing setup; tighten to your origin after it works
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept several env var names
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

  // Simple GET diagnostic
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      info: 'Use POST for generation.',
      hasKey: Boolean(apiKey),
      keyName,
      endpoint: 'v1',
      modelHint: 'gemini-1.5-flash-latest'
    });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'error', error: 'Use POST' });
  }

  const body = await readJsonBody(req);
  const date = (body && body.date) || new Date().toISOString().slice(0, 10);
  const userId = (body && body.userId) || 'anon';

  // If no key, return a mock so the UI renders (no 500s)
  if (!apiKey || apiKey.length < 10) {
    return res.status(200).json({
      status: 'mock',
      research: {
        title: `Sample Brief for ${date}`,
        introduction: 'No Gemini API key found on the server (mock content).',
        keyFindings: 'Set GOOGLE_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy.',
        conclusion: 'Once set, this will auto-switch to live AI.',
        source: 'System (mock)'
      },
      concepts: [
        { term: 'Centeredness',   definition: 'Steadiness under changing conditions.' },
        { term: 'Interoception',  definition: 'Sensing internal body signals.' },
        { term: 'Cognitive Load', definition: 'How much working memory is being used.' }
      ],
      debug: { hasKey: false, keyName, userIdPreview: String(userId).slice(0,16) }
    });
  }

  // Live AI call — v1 endpoint, correct model ids only
  const API_BASE = 'https://generativelanguage.googleapis.com';
  const MODELS = [
    'gemini-1.5-flash-latest', // primary
    'gemini-1.5-pro-latest'    // safe fallback
  ];

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

  let usedModel = null;
  let upstream = null;
  let raw = '';
  const tried = [];

  try {
    for (const model of MODELS) {
      const url = `${API_BASE}/v1/models/${model}:generateContent?key=${apiKey}`;
      upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        })
      });
      raw = await upstream.text();
      tried.push({ model, status: upstream.status });
      if (upstream.ok) { usedModel = model; break; }
    }

    if (!upstream || !upstream.ok) {
      return res.status(200).json({
        status: 'fallback',
        research: {
          title: `AI Error (${upstream ? upstream.status : 'n/a'}) — Fallback for ${date}`,
          introduction: 'The AI call did not succeed.',
          keyFindings: raw ? raw.slice(0, 600) : 'No response body.',
          conclusion: 'Check debug → fix → refresh.',
          source: 'System'
        },
        concepts: [],
        debug: { hasKey: true, keyName, triedModels: tried }
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

    const out = {
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
      debug: { hasKey: true, keyName, usedModel }
    };

    return res.status(200).json(out);
  } catch (err) {
    return res.status(200).json({
      status: 'fallback',
      research: {
        title: `Server Exception — Fallback for ${date}`,
        introduction: 'An unexpected error occurred while generating content.',
        keyFindings: String(err).slice(0, 700),
        conclusion: 'See debug; check Vercel function logs if needed.',
        source: 'System'
      },
      concepts: [],
      debug: { hasKey: true, keyName, usedModel, triedModels: tried }
    });
  }
}
