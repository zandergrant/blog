// /api/generate.js — autodiscovery + correct Gemini response parsing + safe fallbacks

// tiny raw JSON reader (no framework required)
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

function coerceOutput(ai, date) {
  const out = {
    research: {
      title:        (ai?.research?.title ?? '').trim(),
      introduction: (ai?.research?.introduction ?? '').trim(),
      keyFindings:  (ai?.research?.keyFindings ?? '').trim(),
      conclusion:   (ai?.research?.conclusion ?? '').trim(),
      source:       (ai?.research?.source ?? 'General literature').trim()
    },
    concepts: Array.isArray(ai?.concepts) ? ai.concepts.slice(0,3).map(c => ({
      term:       String(c?.term ?? '').trim().slice(0,160),
      definition: String(c?.definition ?? '').trim().slice(0,900)
    })) : []
  };
  // minimal content guard; if too thin, fill sensible defaults
  const ok =
    out.research.title.length >= 6 &&
    out.research.introduction.length >= 40 &&
    out.research.keyFindings.length >= 40 &&
    out.research.conclusion.length >= 20 &&
    out.concepts.length >= 3 &&
    out.concepts.every(c => c.term && c.definition.length >= 40);

  if (!ok) {
    if (!out.research.title) out.research.title = `Daily Brief — ${date}`;
    if (!out.research.introduction) out.research.introduction =
      'This brief summarizes a practical idea for improving attention and centeredness in daily work.';
    if (!out.research.keyFindings) out.research.keyFindings =
      '• Brief, regular practice compounds.\n• Labeling sensations reduces rumination.\n• Lowering cognitive load improves follow-through.';
    if (!out.research.conclusion) out.research.conclusion =
      'Pick one small action and do it today. Consistency beats intensity.';
    if (!out.concepts || out.concepts.length < 3) {
      out.concepts = [
        { term:'Centeredness',  definition:'A stable, steady attentional state under changing conditions, built through brief, regular practice.' },
        { term:'Interoception', definition:'Awareness of internal body signals (breath, heartbeat, tension) that helps regulate attention and emotion.' },
        { term:'Cognitive load',definition:'How much working memory is in use; lowering it improves clarity and follow-through.' }
      ];
    }
  }
  return out;
}

export default async function handler(req, res) {
  // CORS (loose while finishing; tighten to your GH origin later)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // env var names we accept
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

  // GET = quick diag
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true, info: 'Use POST for generation.',
      hasKey: Boolean(apiKey), keyName, endpoint: 'v1', autoDiscover: true
    });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ status:'error', error:'Use POST' });
  }

  const body = await readJsonBody(req);
  const date = (body && body.date) || new Date().toISOString().slice(0,10);
  const userId = (body && body.userId) || 'anon';

  // no key → mock so UI renders
  if (!apiKey || apiKey.length < 10) {
    const out = coerceOutput({}, date);
    return res.status(200).json({
      status:'mock', ...out,
      debug:{ hasKey:false, keyName, userIdPreview:String(userId).slice(0,16) }
    });
  }

  const API_BASE = 'https://generativelanguage.googleapis.com';

  // 1) list models visible to THIS key and pick one that supports generateContent
  let pickedModel = '';
  try {
    const listResp = await fetch(`${API_BASE}/v1/models?key=${apiKey}`);
    const listText = await listResp.text();
    if (!listResp.ok) throw new Error(`listModels ${listResp.status}: ${listText.slice(0,300)}`);
    const listed = JSON.parse(listText);
    const models = Array.isArray(listed?.models) ? listed.models : [];

    const supports = m => {
      const methods = m?.supportedGenerationMethods || m?.supportedMethods || [];
      return Array.isArray(methods) && methods.includes('generateContent');
    };
    const prefer = models.filter(m => /gemini-([12]\.5|2)\-(flash|pro)/.test(m?.name || '') && supports(m));
    const general = models.filter(supports);

    pickedModel = (prefer[0]?.name || general[0]?.name || '').replace(/^models\//,'');
    if (!pickedModel) throw new Error('No model with generateContent available to this key.');
  } catch (e) {
    const out = coerceOutput({}, date);
    return res.status(200).json({
      status:'fallback', ...out,
      debug:{ step:'listModels', error:String(e), hasKey:true, keyName }
    });
  }

  // 2) call the picked model; parse the wrapper → extract text → parse inner JSON
  try {
    const prompt = `
Return ONLY valid JSON (no code fences) with exactly this shape:
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
Constraints:
- Audience: thoughtful professionals building centeredness.
- Date context: ${date}.
- Keep it concise, practical, science-informed.
- "source" can be a general plausible citation (no URLs required).
Output ONLY the JSON object — nothing else.`;

    const resp = await fetch(
      `${API_BASE}/v1/models/${pickedModel}:generateContent?key=${apiKey}`,
      {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          contents:[{ role:'user', parts:[{ text: prompt }] }],
          generationConfig:{ temperature:0.7, maxOutputTokens:900 }
        })
      }
    );

    const raw = await resp.text();
    if (!resp.ok) {
      const out = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'generateContent-response', pickedModel, status:resp.status, body: raw.slice(0,700) }
      });
    }

    // IMPORTANT: parse the WRAPPER first
    let wrapper;
    try { wrapper = JSON.parse(raw); }
    catch {
      const out = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'parse-wrapper', pickedModel, sample: raw.slice(0,400) }
      });
    }

    // Extract the model's text output from the wrapper
    const text =
      wrapper?.candidates?.[0]?.content?.parts?.[0]?.text ??
      wrapper?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ??
      '';

    if (!text) {
      const out = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'no-text', pickedModel, wrapperKeys:Object.keys(wrapper || {}) }
      });
    }

    // Clean code fences, then parse the INNER JSON
    const cleaned = text.trim()
      .replace(/^```json\s*/i,'')
      .replace(/^```\s*/i,'')
      .replace(/```$/,'')
      .trim();

    let ai;
    try { ai = JSON.parse(cleaned); }
    catch (e) {
      const out = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'parse-inner', pickedModel, error:String(e), sample: cleaned.slice(0,400) }
      });
    }

    const out = coerceOutput(ai, date);
    return res.status(200).json({ status:'ok', ...out, debug:{ hasKey:true, keyName, pickedModel } });

  } catch (err) {
    const out = coerceOutput({}, date);
    return res.status(200).json({
      status:'fallback', ...out,
      debug:{ step:'exception', pickedModel, error:String(err) }
    });
  }
}
