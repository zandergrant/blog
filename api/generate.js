// /api/generate.js — robust, never-500, with fallbacks + debug

// Minimal raw-body JSON parser for Vercel "Other" functions
async function readJsonBody(req) {
  return new Promise((resolve) => {
    try {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data }); }
      });
    } catch {
      resolve({});
    }
  });
}

export default async function handler(req, res) {
  // CORS — keep * while debugging; tighten later to your GH origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Handy GET ping
  if (req.method === 'GET') {
    return res
      .status(200)
      .json({ ok: true, info: 'Use POST for generation. Add ?diag=1 for env check.' });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: false, error: 'Use POST', note: 'Method not allowed' });
  }

  // Read body safely (works even without Next.js/Express body parser)
  const body = await readJsonBody(req);
  const date = (body && body.date) || new Date().toISOString().slice(0, 10);
  const userId = (body && body.userId) || 'anon';

  const apiKey = process.env.GOOGLE_API_KEY;
  const baseDebug = {
    hasApiKey: Boolean(apiKey),
    apiKeyLen: apiKey ? apiKey.length : 0,
    node: process.version,
    method: req.method,
    dateReceived: date,
    userIdPreview: String(userId).slice(0, 16),
    rawBodyType: typeof body,
    rawBodyHasUnderscoreRaw: Boolean(body && body._raw),
  };

  // If no key, return a usable mock so the UI renders (and show debug)
  if (!apiKey || apiKey.length < 10) {
    return res.status(200).json({
      research: {
        title: `Sample Brief for ${date}`,
        introduction: 'No GOOGLE_API_KEY found on server. Showing mock content.',
        keyFindings: 'Add GOOGLE_API_KEY in Vercel → Settings → Environment Variables, then redeploy.',
        conclusion: 'Once set, this will switch to live AI output automatically.',
        source: 'System (mock)',
      },
      concepts: [
        { term: 'Centeredness', definition: 'Steadiness under changing conditions.' },
        { term: 'Interoception', definition: 'Sensing internal body signals.' },
        { term: 'Cognitive Load', definition: 'Amount of working memory being used.' },
      ],
      debug: baseDebug,
    });
  }

  // With a key, try Gemini — but never throw; always return 200 + fallback on errors
  try {
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
Keep it concise, science-informed. Date: ${date}.
`;

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
          responseMimeType: 'application/json',
        }),
      }
    );

    const raw = await upstream.text();
    if (!upstream.ok) {
      // Upstream error (invalid key, quota, etc.) — return safe fallback + debug
      return res.status(200).json({
        research: {
          title: `AI Error (status ${upstream.status}) — Fallback for ${date}`,
          introduction: 'The AI call did not succeed.',
          keyFindings: 'Check the debug field for reason (API key, quota, permissions).',
          conclusion: 'Fix and refresh.',
          source: 'System',
        },
        concepts: [],
        debug: { ...baseDebug, upstreamStatus: upstream.status, upstreamBody: raw.slice(0, 900) },
      });
    }

    // Parse AI JSON (with a second-chance cleanup)
    let ai;
    try {
      ai = JSON.parse(raw);
    } catch {
      const cleaned = raw.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/, '')
        .trim();
      ai = JSON.parse(cleaned); // will throw to catch if still invalid
    }

    // Coerce to UI schema
    const data = {
      research: {
        title: ai?.research?.title ?? `Untitled — ${date}`,
        introduction: ai?.research?.introduction ?? '',
        keyFindings: ai?.research?.keyFindings ?? '',
        conclusion: ai?.research?.conclusion ?? '',
        source: ai?.research?.source ?? 'General literature',
      },
      concepts: Array.isArray(ai?.concepts)
        ? ai.concepts.slice(0, 3).map((c) => ({
            term: String(c?.term ?? '').slice(0, 120),
            definition: String(c?.definition ?? '').slice(0, 800),
          }))
        : [],
      debug: baseDebug,
    };

    return res.status(200).json(data);
  } catch (err) {
    // Any unexpected exception → safe fallback + debug
    return res.status(200).json({
      research: {
        title: `Server Exception — Fallback for ${date}`,
        introduction: 'An unexpected error occurred while generating content.',
        keyFindings: String(err).slice(0, 700),
        conclusion: 'See debug field; check Vercel Function logs.',
        source: 'System',
      },
      concepts: [],
      debug: baseDebug,
    });
  }
}
