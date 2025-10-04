// --- Firebase Configuration ---
// PASTE YOUR FIREBASE CONFIGURATION OBJECT FROM YOUR FIREBASE PROJECT HERE
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project-id.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};

// --- Initialize Firebase ---
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- Main Function: Run when the page content is loaded ---
document.addEventListener('DOMContentLoaded', () => {
    fetchDailyResearch();
    fetchCoreConcepts();
});

// --- Module 1: Research of the Day ---
function fetchDailyResearch() {
    const briefTitle = document.getElementById('brief-title');
    const briefBody = document.getElementById('brief-body');
    const briefSource = document.getElementById('brief-source');

    // Get today's date at the start of the day for comparison
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    db.collection("dailyResearch")
      .where("date", ">=", today) // Fetch briefs for today or any future date
      .orderBy("date") // Ensure the earliest one is first
      .limit(1) // We only want one
      .get()
      .then((querySnapshot) => {
        if (querySnapshot.empty) {
            briefTitle.textContent = "No Brief for Today";
            briefBody.textContent = "Please check back later or add a new research item in the database.";
            return;
        }
        querySnapshot.forEach((doc) => {
            const research = doc.data();
            briefTitle.textContent = research.title;
            briefBody.textContent = research.brief;
            briefSource.textContent = `Source: ${research.source}`;
        });
      })
      .catch((error) => {
        console.error("Error getting daily research: ", error);
        briefTitle.textContent = "Error Loading Brief";
        briefBody.textContent = "Could not connect to the database. Check your Firebase config and Firestore rules.";
      });
}

// --- Module 2: Core Concepts (Flashcards) ---
function fetchCoreConcepts() {
    const grid = document.getElementById('flashcard-grid');
    
    db.collection("coreConcepts")
      .get()
      .then((querySnapshot) => {
        if (querySnapshot.empty) {
            grid.innerHTML = "<p>No core concepts found in the database.</p>";
            return;
        }
        // Clear any loading text before adding cards
        grid.innerHTML = ""; 
        querySnapshot.forEach((doc) => {
            const concept = doc.data();
            const card = createFlashcard(concept);
            grid.appendChild(card);
        });
      })
      .catch((error) => {
        console.error("Error getting core concepts: ", error);
        grid.innerHTML = "<p>Error loading concepts. Could not connect to the database.</p>";
      });
}

function createFlashcard(concept) {
    const card = document.createElement('div');
    card.className = 'flashcard';

    // Using innerHTML to easily structure the card faces
    card.innerHTML = `
        <div class="card-inner">
            <div class="card-face card-front">
                <h3>${concept.term}</h3>
            </div>
            <div class="card-face card-back">
                <p>${concept.definition}</p>
            </div>
        </div>
    `;

    // Add click event listener to flip the card
    card.addEventListener('click', () => {
        card.classList.toggle('is-flipped');
    });

    return card;
}
