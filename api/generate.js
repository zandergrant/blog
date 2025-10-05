// /api/generate.js — diag-aware + multi-name env support

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
  // CORS: keep wide while debugging; tighten later
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Look for the key under several common names
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

  // GET = health/diagnostics
  if (req.method === 'GET') {
    const diag = {
      ok: true,
      info: 'Use POST for generation.',
      hasKey: Boolean(apiKey),
      keyName,
      keyLen: apiKey ? apiKey.length : 0,
      node: process.version,
      envHints: [
        'Set one of: GOOGLE_API_KEY, GEMINI_API_KEY, GOOGLE_GENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY',
        'Add in Vercel → Project → Settings → Environment Variables',
        'Target: Production (and Preview if you use it)',
        'Redeploy after adding or changing env vars'
      ]
    };
    return res.status(200).json(diag);
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ ok: false, error: 'Use POST' });
  }

  const body = await readJsonBody(req);
  const date = (body && body.date) || new Date().toISOString().slice(0,10);

  // If we still don’t see a key, return a mock + debug (no 500s)
  if (!apiKey || apiKey.length < 10) {
    return res.status(200).json({
      research: {
        title: `Sample Brief for ${date}`,
        introduction: 'No Gemini API key found on the server (mock content).',
        keyFindings: 'Set your key in Vercel and redeploy.',
        conclusion: 'Once set, this will auto-switch to live AI.',
        source: 'System (mock)'
      },
      concepts: [
        { term: 'Centeredness', definition: 'Steadiness under changing conditions.' },
        { term: 'Interoception', definition: 'Sensing internal body signals.' },
        { term: 'Cognitive Load', definition: 'Amount of working memory being used.' },
      ],
      debug: { hasKey: false, keyName, keyLen: 0 }
    });
  }

  // Live AI call (unchanged, trimmed)
  try {
    const prompt = `
Return ONLY valid JSON:
{
  "research": { "title": string, "introduction": string, "keyFindings": string, "conclusion": string, "source": string },
  "concepts": [
    { "term": string, "definition": string },
    { "term": string, "definition": string },
    { "term": string, "definition": string }
  ]
}
Date: ${date}. Keep it concise and science-informed.
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
        })
      }
    );

    const raw = await upstream.text();
    if (!upstream.ok) {
      return res.status(200).json({
        research: {
          title: `AI Error (${upstream.status}) — Fallback for ${date}`,
          introduction: 'The AI call did not succeed.',
          keyFindings: raw.slice(0, 500),
          conclusion: 'Fix the issue and refresh.',
          source: 'System'
        },
        concepts: [],
        debug: { hasKey: true, keyName, keyLen: apiKey.length, upstreamStatus: upstream.status }
      });
    }

    let ai;
    try { ai = JSON.parse(raw); }
    catch {
      const cleaned = raw.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/, '')
        .trim();
      ai = JSON.parse(cleaned);
    }

    return res.status(200).json({
      research: {
        title: ai?.research?.title ?? `Untitled — ${date}`,
        introduction: ai?.research?.introduction ?? '',
        keyFindings: ai?.research?.keyFindings ?? '',
        conclusion: ai?.research?.conclusion ?? '',
        source: ai?.research?.source ?? 'General literature',
      },
      concepts: Array.isArray(ai?.concepts) ? ai.concepts.slice(0,3) : [],
      debug: { hasKey: true, keyName, keyLen: apiKey.length }
    });
  } catch (err) {
    return res.status(200).json({
      research: {
        title: `Server Exception — Fallback for ${date}`,
        introduction: 'Unexpected error while generating content.',
        keyFindings: String(err).slice(0, 500),
        conclusion: 'See debug, then check Vercel logs.',
        source: 'System'
      },
      concepts: [],
      debug: { hasKey: true, keyName, keyLen: apiKey.length, error: String(err) }
    });
  }
}
