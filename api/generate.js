// DEBUGGING VERSION of generate.js

export default async function handler(req, res) {
  // Set CORS headers for the response
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const apiKey = process.env.GOOGLE_API_KEY;

  // --- Start of Debugging Block ---
  console.log("--- VERCEL API KEY DEBUGGER ---");
  if (apiKey && apiKey.length > 10) {
    console.log("Status: API Key is PRESENT and seems validly formed.");
    console.log("Key Length:", apiKey.length);
    console.log("Starts with:", apiKey.substring(0, 4));
    console.log("Ends with:", apiKey.substring(apiKey.length - 4));
  } else if (apiKey) {
    console.log("Status: API Key is PRESENT but is TOO SHORT or malformed.");
    console.log("Received Value:", apiKey);
  } else {
    console.log("Status: API Key is MISSING or UNDEFINED.");
  }
  console.log("--- END OF DEBUGGER ---");
  // --- End of Debugging Block ---

  // We send back a specific error message for this test
  res.status(500).json({ 
    error: 'This is a debug response. Check your Vercel Function Logs.' 
  });
}
