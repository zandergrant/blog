// api/generate.js
// This is your serverless function that calls Gemini API

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Helper to clean JSON from Gemini responses
function parseGeminiJson(text) {
    try {
        let cleaned = text.trim();
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
    // CRITICAL FIX: Add CORS headers to allow requests from your GitHub Pages site
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', 'https://zandergrant.github.io');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY not found');
            return res.status(500).json({ error: 'API key not configured' });
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const { date, userId } = req.body;
        console.log(`Generating content for user: ${userId} on date: ${date}`);

        const [research, concepts] = await Promise.all([
            generateResearch(model),
            generateConcepts(model)
        ]);

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
    const prompt = `Generate a 'Research Paper of the Day' summary about a key study or concept related to CBT, psychology, inner peace, meditation, or positive psychology that would be valuable for ambitious professionals seeking emotional regulation and mental wellness... [Full prompt as before]`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return parseGeminiJson(response.text());
}

async function generateConcepts(model) {
    const prompt = `Generate exactly 3 essential core concepts related to CBT, performance psychology, meditation, inner peace, or positive psychology... [Full prompt as before]`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return parseGeminiJson(response.text());
}

