export default async function handler(req, res) {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', 'https://zandergrant.github.io'); // use your GH Pages origin
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  try {
    const { date = '2025-10-05', userId = 'demo' } = req.body || {};
    // Return data in the shape your UI expects
    return res.status(200).json({
      research: {
        title: `Sample Brief for ${date}`,
        introduction: 'This is a mock intro.',
        keyFindings: 'Key point A, B, C.',
        conclusion: 'Short summary + takeaway.',
        source: 'Mock Source'
      },
      concepts: [
        { term: 'Centeredness', definition: 'Steadiness under changing conditions.' },
        { term: 'Interoception', definition: 'Sensing internal body signals.' }
      ]
    });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', details: String(e) });
  }
}
