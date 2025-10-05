import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the Google AI client with the API key from environment variables
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Ensure the request is a POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { date } = req.body;

    // --- AI Content Generation ---
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      For the date ${date}, generate content for "The Inner Lab Method," a daily learning module.
      The topic should be related to psychology, cognitive science, or philosophy for personal growth.
      
      Please provide your response as a single, minified JSON object with NO markdown formatting (like \`\`\`json).
      
      The JSON object must have this exact structure:
      {
        "research": {
          "title": "A relevant and engaging title",
          "introduction": "A concise 1-2 sentence introduction to the topic.",
          "keyFindings": "2-3 key findings or main points from the research area, written in a clear paragraph.",
          "conclusion": "A 1-2 sentence conclusion on how this can be applied.",
          "source": "Fictional Academic Source (e.g., 'Journal of Applied Psychology, Vol. 42')"
        },
        "concepts": [
          { "term": "Key Term 1", "definition": "A clear, simple definition." },
          { "term": "Key Term 2", "definition": "A clear, simple definition." }
        ]
      }
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // The AI might return the JSON string wrapped in markdown, so we clean it.
    const cleanedText = text.replace(/^```json\s*|```\s*$/g, '').trim();

    // Parse the JSON string into an object
    const data = JSON.parse(cleanedText);

    // Send the AI-generated data to the frontend
    res.status(200).json(data);

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      error: 'Failed to generate AI content.',
      details: error.message
    });
  }
}
