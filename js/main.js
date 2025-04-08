// js/main.js

// Import the main game initialization function
import { initGame } from './game.js';
// Import the function to load language data
import { loadLanguage } from './localization.js';

/**
 * Asynchronous function to set up and start the application.
 * Ensures language resources are loaded before the game initializes.
 */
async function startApp() {
    console.log("Starting application...");

    // --- Language Loading ---
    const defaultLang = 'en'; // Set your desired default language here
    let languageLoaded = false;

    try {
        console.log(`Attempting to load default language: ${defaultLang}...`);
        languageLoaded = await loadLanguage(defaultLang);

        if (!languageLoaded) {
            // Attempt a fallback if the default fails? (Optional)
            // console.warn(`Default language '${defaultLang}' failed. Trying fallback 'en'...`);
            // languageLoaded = await loadLanguage('en'); // Example fallback
        }

    } catch (error) {
        // Catch any unexpected errors during language loading itself
        console.error("Unexpected error during language loading:", error);
        languageLoaded = false; // Ensure flag is false on unexpected error
    }

    // --- Game Initialization ---
    if (languageLoaded) {
        console.log("Language resources loaded successfully. Initializing game...");
        // Initialize the game only if the language data loaded successfully
        initGame();
    } else {
        // Handle the critical error where essential language data couldn't be loaded
        console.error(`CRITICAL ERROR: Could not load required language resources ('${defaultLang}' or fallback). Game cannot start.`);
        // Display a user-friendly error message on the page
        const errorTargetElement = document.getElementById('status') || document.getElementById('game-container') || document.body;
        errorTargetElement.innerHTML = `<p style="color: red; font-weight: bold;">
            Error: Failed to load essential game resources. The game cannot start. Please try refreshing the page.
            If the problem persists, please contact support or check your network connection.
            </p>`;
        // Optionally, hide the board or controls if they were rendered prematurely
        const boardElement = document.getElementById('board');
        if (boardElement) boardElement.style.display = 'none';
        const controlsElement = document.getElementById('controls');
        if (controlsElement) controlsElement.style.display = 'none';
    }
}

// --- Start the Application ---
// Call the async function to kick things off.
startApp();