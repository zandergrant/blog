// /api/generate.js — TEMP DEBUG + HARDENED
export default async function handler(req, res) {
  // CORS — open during debug to rule it out
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, info: 'Use POST for generation.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    const { date = new Date().toISOString().slice(0,10), userId = 'anon' } = req.body || {};

    const debug = {
      hasApiKey: Boolean(apiKey),
      apiKeyLen: apiKey ? apiKey.length : 0,
      method: req.method,
      dateReceived: date
    };
    if (!apiKey || apiKey.length < 10) {
      return res.status(500).json({ error: 'Missing or invalid GOOGLE_API_KEY on Vercel', debug });
    }

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

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
          // ask Gemini to emit pure JSON (reduces codefences/markdown)
          responseMimeType: "application/json"
        })
      }
    );

    const raw = await resp.text(); // read body once, whether ok or not
    if (!resp.ok) {
      // Bubble exact upstream error so you can see it in the page/Network tab
      return res.status(resp.status).json({
        error: 'Gemini error',
        status: resp.status,
        details: raw,
        debug
      });
    }

    let ai;
    try { ai = JSON.parse(raw); }
    catch {
      // if responseMimeType got ignored and model returned text/markdown
      const cleaned = raw.trim()
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/, '')
        .trim();
      try { ai = JSON.parse(cleaned); }
      catch {
        return res.status(500).json({
          error: 'Gemini returned non-JSON',
          sample: raw.slice(0, 800),
          debug
        });
      }
    }

    // Validate minimally & coerce to your UI schema
    const data = {
      research: {
        title: ai?.research?.title ?? 'Untitled',
        introduction: ai?.research?.introduction ?? '',
        keyFindings: ai?.research?.keyFindings ?? '',
        conclusion: ai?.research?.conclusion ?? '',
        source: ai?.research?.source ?? 'General literature'
      },
      concepts: Array.isArray(ai?.concepts) ? ai.concepts.slice(0,3).map(c => ({
        term: String(c?.term ?? '').slice(0, 120),
        definition: String(c?.definition ?? '').slice(0, 600)
      })) : []
    };

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Server exception', details: String(err) });
  }
}
