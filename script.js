// --- Modern (v9) Firebase Imports ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.7/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/9.6.7/firebase-firestore.js";

// --- Configuration ---
const GEMINI_API_KEY = ""; // This is handled by the environment
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDeT_BSciMftq2Rx7Gzk63oP-DgNNslXME",
  authDomain: "innerlabresearch.firebaseapp.com",
  projectId: "innerlabresearch",
  storageBucket: "innerlabresearch.appspot.com",
  messagingSenderId: "137996904547",
  appId: "1:137996904547:web:9a1b86dc9aa41237fcb056",
  measurementId: "G-VGVRLJSWPZ"
};
// ----------------------------------------------


// --- Global Variables ---
let db;
let currentDate;

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
    try {
        // Initialize Firebase using the new modular functions
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);

        const dateSelector = document.getElementById('date-selector');
        
        // Set today's date and load data
        const today = new Date();
        const todayString = today.toISOString().split('T')[0]; // YYYY-MM-DD format
        dateSelector.value = todayString;
        currentDate = todayString;
        loadDataForDate(currentDate);

        // Event Listeners
        dateSelector.addEventListener('change', () => {
            currentDate = dateSelector.value;
            loadDataForDate(currentDate);
        });

        document.getElementById('save-journal-btn').addEventListener('click', saveJournal);
    } catch (error) {
        console.error("Firebase initialization failed:", error);
        showErrorState("Firebase initialization failed. Check the console and your firebaseConfig object.");
    }
});

// --- Core Logic ---

async function loadDataForDate(dateString) {
    showLoadingState();
    // Use the new `doc` function to create a document reference
    const docRef = doc(db, 'dailyEntries', dateString);
    
    try {
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            displayResearch(data.research);
            displayConcepts(data.concepts);
            displayJournal(data.journal);
        } else {
            console.log(`No data for ${dateString}. Generating with AI...`);
            const [research, concepts] = await Promise.all([
                generateAiResearch(),
                generateAiCoreConcepts()
            ]);

            const newData = {
                research: research,
                concepts: concepts,
                journal: '' 
            };

            await setDoc(docRef, newData);
            console.log(`Data for ${dateString} saved to Firebase.`);

            displayResearch(newData.research);
            displayConcepts(newData.concepts);
            displayJournal(newData.journal);
        }
    } catch (error) {
        console.error("Error loading or generating data:", error);
        showErrorState(error.message); // Display the actual error message
    }
}

async function saveJournal() {
    const journalText = document.getElementById('journal-entry').value;
    const saveButton = document.getElementById('save-journal-btn');
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    const docRef = doc(db, 'dailyEntries', currentDate);

    try {
        await updateDoc(docRef, { journal: journalText });
        saveButton.textContent = 'Saved!';
        setTimeout(() => { 
            saveButton.textContent = 'Save Journal';
            saveButton.disabled = false;
        }, 2000);
    } catch (error) {
        console.error("Error saving journal:", error);
        saveButton.textContent = 'Error - Retry';
        saveButton.disabled = false;
    }
}

// --- AI Generation Functions ---

async function generateAiResearch() {
    const userPrompt = "Generate a 'Research of the Day' brief about a key study or concept related to emotional regulation. The topic must be relevant to ambitious professionals in high-pressure environments. Provide a compelling title, a concise brief (2-3 sentences), and a source (e.g., an academic paper or book).";
    const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "OBJECT", properties: { "title": { "type": "STRING" }, "brief": { "type": "STRING" }, "source": { "type": "STRING" } } } }
    };
    const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`API call failed with status: ${response.status}`);
    const result = await response.json();
    return JSON.parse(result.candidates[0].content.parts[0].text);
}

async function generateAiCoreConcepts() {
    const userPrompt = "Generate a list of exactly 5 essential core concepts related to CBT and performance psychology. For each concept, provide a 'term' and a concise 'definition' suitable for a flashcard.";
    const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { "term": { "type": "STRING" }, "definition": { "type": "STRING" } } } } }
    };
    const response = await fetch(GEMINI_API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`API call failed with status: ${response.status}`);
    const result = await response.json();
    return JSON.parse(result.candidates[0].content.parts[0].text);
}


// --- DOM Update Functions ---

function displayResearch(research) {
    document.getElementById('brief-title').textContent = research.title;
    document.getElementById('brief-body').textContent = research.brief;
    document.getElementById('brief-source').textContent = `Source: ${research.source}`;
}

function displayConcepts(concepts) {
    const grid = document.getElementById('flashcard-grid');
    grid.innerHTML = ""; // Clear previous concepts
    if (concepts && concepts.length > 0) {
        concepts.forEach(concept => {
            const card = createFlashcard(concept);
            grid.appendChild(card);
        });
    } else {
        grid.innerHTML = "<p>No concepts available.</p>";
    }
}

function displayJournal(journalText) {
    document.getElementById('journal-entry').value = journalText || '';
}

function createFlashcard(concept) {
    const card = document.createElement('div');
    card.className = 'flashcard';
    card.innerHTML = `<div class="card-inner"><div class="card-face card-front"><h3>${concept.term}</h3></div><div class="card-face card-back"><p>${concept.definition}</p></div></div>`;
    card.addEventListener('click', () => card.classList.toggle('is-flipped'));
    return card;
}

function showLoadingState() {
    document.getElementById('brief-title').textContent = "Loading...";
    document.getElementById('brief-body').textContent = "Fetching today's insights from our records or generating new ones with AI...";
    document.getElementById('brief-source').textContent = "";
    document.getElementById('flashcard-grid').innerHTML = "<p>Loading concepts...</p>";
    document.getElementById('journal-entry').value = "";
}

function showErrorState(message) {
    document.getElementById('brief-title').textContent = "An Error Occurred";
    document.getElementById('brief-body').textContent = message || "Could not load or generate content. Please check the console for errors and try refreshing the page.";
    document.getElementById('flashcard-grid').innerHTML = "<p>Could not load concepts.</p>";
}

