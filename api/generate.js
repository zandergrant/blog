// /api/generate.js — one-pager generator
// - Model auto-discovery (v1 /models)
// - Correct wrapper parsing (Gemini 1.5 / 2.5)
// - Strong prompt for a single-topic one-pager
// - Optional client-provided `topic`
// - Never 500s the browser; returns status + debug

// -------- tiny raw JSON reader (framework-free) --------
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

// -------- content validator + defaults --------
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
      definition: String(c?.definition ?? '').trim().slice(0,1000)
    })) : []
  };

  // Reasonable "one-pager" thresholds (not overly strict)
  const ok =
    out.research.title.length >= 20 &&
    out.research.introduction.length >= 80 &&
    out.research.keyFindings.length >= 90 &&
    out.research.conclusion.length >= 50 &&
    out.concepts.length >= 3 &&
    out.concepts.every(c => c.term && c.definition.length >= 60);

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
  return { out, ok };
}

function buildPrompt(date, topic) {
  return `
You are writing a concise, research-informed ONE-PAGER for thoughtful professionals.

Task:
1) Use THIS specific topic for the date ${date}: ${topic ? topic : 'choose a specific, practical topic yourself (e.g., "Implementation Intentions for Procrastination", "Box Breathing to Lower Arousal Before Presentations", "Interoceptive Labels to Reduce Rumination", "2-Minute Setup Routines to Lower Cognitive Load")'}.
2) Return JSON ONLY (no code fences) with exactly this shape:

{
  "research": {
    "title": string,                   // 6–80 words, must include the chosen topic
    "introduction": string,            // 90–140 words, plain text
    "keyFindings": string,             // 110–180 words, plain text; synthesize 3–5 key points as full sentences
    "conclusion": string,              // 60–120 words, one clear action + why it matters
    "source": string                   // general plausible citation (e.g., "Cognitive psychology literature, 2011–2023")
  },
  "concepts": [
    { "term": string, "definition": string },  // 30–70 words
    { "term": string, "definition": string },  // 30–70 words
    { "term": string, "definition": string }   // 30–70 words
  ]
}

Rules:
- Output ONLY that JSON object — no extra text, no markdown.
- Use practical, precise language; avoid hype.
- Do not use bullet characters; write full sentences.
- Ground concepts in behavior change / attention regulation.
`.trim();
}

// -------- main handler --------
export default async function handler(req, res) {
  // CORS — leave * while finishing; tighten to your GH origin when done
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

  // GET = quick diag
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      info: 'Use POST for generation.',
      hasKey: Boolean(apiKey),
      keyName,
      endpoint: 'v1',
      autoDiscover: true
    });
  }

  if (req.method !== 'POST') {
    return res.status(200).json({ status:'error', error:'Use POST' });
  }

  const body = await readJsonBody(req);
  const date  = (body && body.date)  || new Date().toISOString().slice(0,10);
  const topic = (body && body.topic) || null;
  const userId = (body && body.userId) || 'anon';

  // No key → mock so UI renders
  if (!apiKey || apiKey.length < 10) {
    const { out } = coerceOutput({}, date);
    return res.status(200).json({
      status:'mock',
      ...out,
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

    // prefer 2.5 / 1.5 flash/pro → then any generateContent-capable model
    const prefer = models.filter(m =>
      /gemini-((2(\.5)?)|1\.5)-(flash|pro)/.test(m?.name || '') && supports(m)
    );
    const general = models.filter(supports);

    pickedModel = (prefer[0]?.name || general[0]?.name || '').replace(/^models\//,'');
    if (!pickedModel) throw new Error('No model with generateContent available to this key.');
  } catch (e) {
    const { out } = coerceOutput({}, date);
    return res.status(200).json({
      status:'fallback', ...out,
      debug:{ step:'listModels', error:String(e), hasKey:true, keyName }
    });
  }

  // 2) call the picked model; parse wrapper → extract text → parse inner JSON
  try {
    const prompt = buildPrompt(date, topic);
    const resp = await fetch(
      `${API_BASE}/v1/models/${pickedModel}:generateContent?key=${apiKey}`,
      {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({
          contents:[{ role:'user', parts:[{ text: prompt }] }],
          generationConfig:{ temperature:0.6, maxOutputTokens:1400 }
        })
      }
    );

    const raw = await resp.text();
    if (!resp.ok) {
      const { out } = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'generateContent-response', pickedModel, status:resp.status, body: raw.slice(0,700) }
      });
    }

    // Parse WRAPPER first (Gemini returns candidates/content/parts)
    let wrapper;
    try { wrapper = JSON.parse(raw); }
    catch {
      const { out } = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'parse-wrapper', pickedModel, sample: raw.slice(0,400) }
      });
    }

    // Extract text from first part with .text
    let text = '';
    const parts = wrapper?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      if (typeof p?.text === 'string' && p.text.trim()) { text = p.text; break; }
    }
    if (!text) {
      const { out } = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'no-text', pickedModel, partsType: Array.isArray(parts) ? 'array' : typeof parts }
      });
    }

    // Clean code fences, then parse inner JSON
    const cleaned = text.trim()
      .replace(/^```json\s*/i,'')
      .replace(/^```\s*/i,'')
      .replace(/```$/,'')
      .trim();

    let ai;
    try { ai = JSON.parse(cleaned); }
    catch (e) {
      const { out } = coerceOutput({}, date);
      return res.status(200).json({
        status:'fallback', ...out,
        debug:{ step:'parse-inner', pickedModel, error:String(e), sample: cleaned.slice(0,400) }
      });
    }

    const { out, ok } = coerceOutput(ai, date);
    return res.status(200).json({
      status: ok ? 'ok' : 'fallback',
      ...out,
      debug:{ hasKey:true, keyName, pickedModel, validated: ok }
    });

  } catch (err) {
    const { out } = coerceOutput({}, date);
    return res.status(200).json({
      status:'fallback', ...out,
      debug:{ step:'exception', pickedModel, error:String(err) }
    });
  }
}
