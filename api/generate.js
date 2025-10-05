// /api/generate.js — robust, single-file handler for Vercel "Other" projects
// - Uses Gemini v1 with a stable model id
// - Works even without a body parser
// - Always returns 200 with { research, concepts } so your page never breaks
// - Includes a tiny GET diagnostic

// --------- tiny raw JSON body reader (no framework needed) ----------
async function readJsonBody(req) {
  return new Promise((resolve) => {
    try {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { resolve({ _raw: data }); }
      });
    } catch {
      resolve({});
    }
  });
}

export default async function handler(req, res) {
  // CORS — wide-open while you finish setup; tighten to your origin later.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept multiple common env var names (use whichever you set in Vercel)
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

  // Simple GET diagnostic so you can sanity-check the deployment
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      info: 'Use POST for generation.',
      hasKey: Boolean(apiKey),
      keyName,
      keyLen: apiKey ? apiKey.length : 0,
      node: process.version,
      endpoint: 'v1',
      modelHint: 'gemini-1.5-flash-latest'
    });
  }

  if (req.method !== 'POST') {
    // Return 200 (not 405) so your frontend never throws
    return res.status(200).json({ ok: false, error: 'Use POST' });
  }

  // Read POST body safely
  const body = await readJsonBody(req);
  const date = (body && body.date) || new Date().toISOString().slice(0, 10);
  const userId = (body && body.userId) || 'anon';

  // If no key found, return a usable mock so your page renders
  if (!apiKey || apiKey.length < 10) {
    return res.status(200).json({
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

  // --------- live AI path (Gemini v1) ----------
  const API_BASE = 'https://generativelanguage.googleapis.com';
  // Use GA v1 model id; include a couple of safe fallbacks
  const MODELS = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash-002',
    'gemini-1.5-flash'
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
    // Try each candidate model on the v1 endpoint until one succeeds
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

      // For NOT_FOUND, continue to next model; for others, stop early
      try {
        const err = JSON.parse(raw);
        const status = err?.error?.status || '';
        if (status !== 'NOT_FOUND') break;
      } catch {
        break;
      }
    }

    if (!upstream || !upstream.ok) {
      // Return a graceful fallback (200) so your page still renders
      return res.status(200).json({
        research: {
          title: `AI Error (${upstream ? upstream.status : 'n/a'}) — Fallback for ${date}`,
          introduction: 'The AI call did not succeed.',
          keyFindings: raw ? raw.slice(0, 500) : 'No response body.',
          conclusion: 'Check the debug info, fix, and refresh.',
          source: 'System'
        },
        concepts: [],
        debug: { hasKey: true, keyName, triedModels: tried }
      });
    }

    // Parse AI JSON; if model returns code fences/markdown, clean and try again
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

    // Coerce into your UI schema
    const out = {
      research: {
        title:        ai?.research?.title        ?? `Untitled — ${date}`,
        introduction: ai?.research?.introduction ?? '',
        keyFindings:  ai?.research?.keyFindings  ?? '',
        conclusion:   ai?.research?.conclusion   ?? '',
        source:       ai?.research?.source       ?? 'General literature'
      },
      concepts: Array.isArray(ai?.concepts)
        ? ai.concepts.slice(0, 3).map(c => ({
            term:        String(c?.term ?? '').slice(0, 160),
            definition:  String(c?.definition ?? '').slice(0, 900)
          }))
        : [],
      debug: { hasKey: true, keyName, usedModel }
    };

    return res.status(200).json(out);
  } catch (err) {
    // Any unexpected exception → safe fallback so the UI never breaks
    return res.status(200).json({
      research: {
        title: `Server Exception — Fallback for ${date}`,
        introduction: 'An unexpected error occurred while generating content.',
        keyFindings: String(err).slice(0, 700),
        conclusion: 'See debug; check Vercel Function logs if needed.',
        source: 'System'
      },
      concepts: [],
      debug: { hasKey: true, keyName, usedModel, triedModels: tried }
    });
  }
}
