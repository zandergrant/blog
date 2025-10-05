// /api/generate.js — daily one-pager generator (auto-model, robust parsing, retry)

// ---------- tiny raw JSON reader (framework-free) ----------
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

// ---------- validator + sensible defaults ----------
function coerceOutput(ai, date) {
  const out = {
    research: {
      title:        (ai?.research?.title ?? '').trim(),
      introduction: (ai?.research?.introduction ?? '').trim(),
      keyFindings:  (ai?.research?.keyFindings ?? '').trim(),
      conclusion:   (ai?.research?.conclusion ?? '').trim(),
      source:       (ai?.research?.source ?? 'Cognitive psychology literature').trim()
    },
    concepts: Array.isArray(ai?.concepts) ? ai.concepts.slice(0,4).map(c => ({
      term:       String(c?.term ?? '').trim().slice(0,160),
      definition: String(c?.definition ?? '').trim().slice(0,1000)
    })) : []
  };

  // Reasonable one-pager minimums (deliberately not too strict)
  const ok =
    out.research.title.length >= 10 &&
    out.research.introduction.length >= 60 &&
    out.research.keyFindings.length >= 100 &&
    out.research.conclusion.length >= 50 &&
    out.concepts.length >= 3 &&
    out.concepts.every(c => c.term && c.definition.length >= 60);

  // Fill readable defaults if underfilled so the UI never looks empty
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

// ---------- prompt builder (model picks a new topic daily) ----------
function buildPrompt(date, userId, strict = false) {
  const base = `
You are a research assistant that creates daily one-pagers on psychology, CBT, and philosophy of inner work.

Your task for ${date} (user ${userId}) is to generate a unique research summary — as if the user asked,
"Teach me something meaningful about inner work or mental clarity today."

Guidance:
- Choose a fresh, specific topic randomly related to psychology, CBT, inner peace, or philosophy (different each day and may vary by user).
- Be research-backed and practical; reference effects, mechanisms, or example studies when relevant.

Return ONLY valid JSON (no markdown/backticks) with EXACTLY this shape:

{
  "research": {
    "title": string,          // short, specific, descriptive (e.g., "Cognitive Defusion in Daily Stress Management")
    "introduction": string,   // 100–150 words explaining the topic and its relevance
    "keyFindings": string,    // 150–250 words summarizing key findings, mechanisms, or example experiments (full sentences)
    "conclusion": string,     // 80–120 words with one clear action + why it matters
    "source": string          // a plausible citation label (e.g., "Cognitive psychology literature, 2011–2024")
  },
  "concepts": [
    { "term": string, "definition": string },  // 1–2 sentences (30–70 words)
    { "term": string, "definition": string },
    { "term": string, "definition": string },
    { "term": string, "definition": string }
  ]
}

Rules:
- Output ONLY that JSON object, nothing else.
- Avoid bullet characters; write full sentences in the fields.
- Do NOT repeat the same text across fields.
`.trim();

  if (!strict) return base;

  // Stricter retry with explicit minimums
  return (base + `
Minimums that MUST be met:
- introduction ≥ 100 words; keyFindings ≥ 150 words; conclusion ≥ 80 words.
- 4 concepts present; each definition ≥ 30 words.
Output ONLY the JSON object. Ensure it parses with JSON.parse().
`).trim();
}

// ---------- core: call Gemini (v1), parse wrapper, parse inner JSON ----------
async function geminiGenerate({ apiKey, model, date, userId, strict = false }) {
  const API_BASE = 'https://generativelanguage.googleapis.com';
  const prompt = buildPrompt(date, userId, strict);

  const resp = await fetch(
    `${API_BASE}/v1/models/${model}:generateContent?key=${apiKey}`,
    {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        contents: [{ role:'user', parts:[{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 1800 }
      })
    }
  );

  const raw = await resp.text();
  if (!resp.ok) {
    const err = new Error(`generateContent ${resp.status}`);
    err._status = resp.status;
    err._body = raw.slice(0, 1200);
    throw err;
  }

  // Parse wrapper (candidates/content/parts)
  let wrapper;
  try { wrapper = JSON.parse(raw); }
  catch (e) {
    const err = new Error('parse-wrapper');
    err._sample = raw.slice(0, 600);
    throw err;
  }

  // Extract text from first part that has .text
  let text = '';
  const parts = wrapper?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (typeof p?.text === 'string' && p.text.trim()) { text = p.text; break; }
  }
  if (!text) {
    const err = new Error('no-text');
    err._partsType = Array.isArray(parts) ? 'array' : typeof parts;
    throw err;
  }

  // Clean code fences → parse inner JSON
  const cleaned = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/, '')
    .trim();

  let ai;
  try { ai = JSON.parse(cleaned); }
  catch (e) {
    const err = new Error('parse-inner');
    err._sample = cleaned.slice(0, 600);
    throw err;
  }

  return ai;
}

// ---------- main handler ----------
export default async function handler(req, res) {
  // CORS — keep wide until everything’s stable, then tighten to your GH origin
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

  const body   = await readJsonBody(req);
  const date   = (body && body.date)   || new Date().toISOString().slice(0,10);
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

  // 1) List models visible to THIS key and pick one that supports generateContent
  const API_BASE = 'https://generativelanguage.googleapis.com';
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

    // Prefer 2.5 / 1.5 flash/pro; otherwise any generateContent model
    const prefer = models.filter(m =>
      /gemini-((2(\.5)?)|1\.5)-(flash|pro)/.test(m?.name || '') && supports(m)
    );
    const general = models.filter(supports);

    pickedModel = (prefer[0]?.name || general[0]?.name || '').replace(/^models\//, '');
    if (!pickedModel) throw new Error('No model with generateContent available to this key.');
  } catch (e) {
    const { out } = coerceOutput({}, date);
    return res.status(200).json({
      status:'fallback', ...out,
      debug:{ step:'listModels', error:String(e), hasKey:true, keyName }
    });
  }

  // 2) Generate → validate; if thin, retry once with stricter prompt
  try {
    let ai = await geminiGenerate({ apiKey, model: pickedModel, date, userId, strict: false });
    let { out, ok } = coerceOutput(ai, date);

    if (!ok) {
      // one retry with stricter minimums
      ai = await geminiGenerate({ apiKey, model: pickedModel, date, userId, strict: true });
      ({ out, ok } = coerceOutput(ai, date));
    }

    return res.status(200).json({
      status: ok ? 'ok' : 'fallback',
      ...out,
      debug: { hasKey:true, keyName, pickedModel, validated: ok }
    });
  } catch (err) {
    const { out } = coerceOutput({}, date);
    return res.status(200).json({
      status:'fallback',
      ...out,
      debug:{
        step:'generate',
        pickedModel,
        error: String(err),
        status: err?._status || null,
        bodySample: err?._body || err?._sample || null
      }
    });
  }
}
