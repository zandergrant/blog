// api/generate.js
// This is your serverless function that calls Gemini API

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper to clean JSON from Gemini responses
function parseGeminiJson(text) {
    try {
        let cleaned = text.trim();
        // Remove markdown code blocks if present
        if (cleaned.startsWith('```json')) {
            cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?$/g, '');
        } else if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/```\n?/g, '').replace(/```\n?$/g, '');
        }
        return JSON.parse(cleaned.trim());
    } catch (error) {
        console.error("Failed to parse JSON:", text);
        throw new Error("AI returned invalid JSON format");
    }
}

module.exports = async (req, res) => {
    // NOTE: CORS is now handled by vercel.json.
    // We only need to handle the actual POST request here.

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get the API key from environment variables
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            console.error('GEMINI_API_KEY not found in environment variables');
            return res.status(500).json({ error: 'API key not configured' });
        }

        // Initialize Gemini
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const { date } = req.body;
        console.log(`Generating content for date: ${date}`);

        // Generate both pieces of content in parallel
        const [research, concepts] = await Promise.all([
            generateResearch(model),
            generateConcepts(model)
        ]);

        // Return the generated content
        res.status(200).json({
            research,
            concepts,
            generatedAt: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error generating content:', error);
        res.status(500).json({ 
            error: 'Failed to generate content',
            details: error.message 
        });
    }
};

async function generateResearch(model) {
    const prompt = `Generate a 'Research Paper of the Day' summary about a key study or concept related to CBT, psychology, inner peace, meditation, or positive psychology that would be valuable for ambitious professionals seeking emotional regulation and mental wellness.

Structure the response as a JSON object with this exact format:
{
  "title": "Compelling paper title here",
  "introduction": "150-word introduction paragraph explaining the topic and its relevance",
  "keyFindings": "200-word section covering the main findings, evidence, and key takeaways",
  "conclusion": "100-word conclusion with practical applications and implications",
  "source": "Citation or reference (can be a real study or conceptual framework)"
}

Return ONLY the raw JSON object, no markdown formatting, no code blocks, no additional text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return parseGeminiJson(text);
}

async function generateConcepts(model) {
    const prompt = `Generate exactly 3 essential core concepts related to CBT, performance psychology, meditation, inner peace, or positive psychology. These should be fresh, insightful concepts that help with emotional regulation and mental wellness.

Structure the response as a JSON array with this exact format:
[
  {
    "term": "Concept Name",
    "definition": "Clear, concise definition in 2-3 sentences"
  },
  {
    "term": "Concept Name",
    "definition": "Clear, concise definition in 2-3 sentences"
  },
  {
    "term": "Concept Name",
    "definition": "Clear, concise definition in 2-3 sentences"
  }
]

Return ONLY the raw JSON array, no markdown formatting, no code blocks, no additional text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    return parseGeminiJson(text);
}
