// /api/generate.js  — TEMP DEBUG VERSION
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://zandergrant.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ ok: true, info: 'Use POST for generation.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const { date = new Date().toISOString().slice(0,10) } = req.body || {};

    // Debug breadcrumb (not leaking the key itself)
    const debug = {
      runtime: 'node',
      hasApiKey: Boolean(apiKey),
      apiKeyLen: apiKey ? apiKey.length : 0,
      method: req.method,
      dateReceived: date
    };

    if (!apiKey || apiKey.length < 10) {
      return res.status(500).json({
        error: 'Missing or invalid GOOGLE_API_KEY on Vercel',
        debug
      });
    }

    const prompt = `
Return ONLY valid JSON with:
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

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
        })
      }
    );

    const maybeText = await resp.text(); // read once for logging
    if (!resp.ok) {
      // Bubble up the exact Gemini error to your page
      return res.status(resp.status).json({
        error: 'Gemini error',
        status: resp.status,
        details: maybeText,
        debug
      });
    }

    // Parse the successful response we just read
    let body;
    try {
      body = JSON.parse(maybeText);
    } catch (e) {
      return res.status(500).json({
        error: 'Gemini returned non-JSON body',
        details: maybeText.slice(0, 4000),
        debug
      });
    }

    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '')
      .trim();

    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      return res.status(200).json({
        research: {
          title: 'Generation Error (Parse)',
          introduction: 'Could not parse AI JSON.',
          keyFindings: cleaned.slice(0, 400),
          conclusion: 'Check logs or try again.',
          source: 'System'
        },
        concepts: []
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: 'Server exception',
      details: String(err)
    });
  }
}
