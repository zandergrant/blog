// /api/generate.js  — Live Gemini version (no terminal needed)

export default async function handler(req, res) {
  // --- CORS (allow your GitHub Pages site) ---
  res.setHeader('Access-Control-Allow-Origin', 'https://zandergrant.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Optional: quiet down random GET pings
  if (req.method === 'GET') return res.status(200).json({ ok: true, info: 'Use POST for generation.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing GOOGLE_API_KEY on Vercel' });

  try {
    const { date = new Date().toISOString().slice(0,10), userId = 'anon' } = req.body || {};

    const prompt = `
Return ONLY valid JSON (no code fences) with this shape:
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
- Audience: thoughtful professionals building centeredness.
- Tie to the date: ${date}.
- Keep it concise, practical, science-informed.
- "source" should be a general, plausible citation (no URLs needed).
`;

    // Call Gemini via REST from the server (safe)
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

    if (!resp.ok) {
      const details = await resp.text();
      return res.status(resp.status).json({ error: 'Gemini error', details });
    }

    const body = await resp.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Clean common code-fence formatting then parse JSON
    const cleaned = text.trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '')
      .trim();

    let data;
    try {
      data = JSON.parse(cleaned);
    } catch (e) {
      // Fallback if the model slips formatting
      data = {
        research: {
          title: 'Generation Error (Fallback)',
          introduction: 'We had trouble parsing the AI response.',
          keyFindings: 'Please try again.',
          conclusion: 'Check function logs if it persists.',
          source: 'System'
        },
        concepts: []
      };
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', details: String(err) });
  }
}
