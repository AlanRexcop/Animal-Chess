// js/main.js
import { initGame } from './game.js';
import { loadLanguage, applyLocalizationToPage, getString } from './localization.js';

/**
 * Asynchronously sets up and starts the application.
 */
async function startApp() {
    console.log("Starting application...");
    // Determine initial language (e.g., from browser, local storage, or default)
    const initialLang = navigator.language.startsWith('vn') ? 'vn' : 'en'; // Simple browser check

    // Load the initial language
    const loaded = await loadLanguage(initialLang);

    if (!loaded) {
        console.error("Failed to load initial language. Application might not work correctly.");
        // Display an error message to the user?
        document.body.innerHTML = "Error loading language files. Please try refreshing.";
        return;
    }

    // Apply loaded language to static elements
    applyLocalizationToPage();

     // Set the language dropdown to the loaded language
     const langSelect = document.getElementById('lang-select');
     if (langSelect) langSelect.value = initialLang;

    // Initialize the game logic
    try {
        initGame();
    } catch (error) {
        console.error("Error initializing game:", error);
        // Display critical error message
         document.body.innerHTML = `Critical error during game initialization: ${error.message}`;
    }
}

// Wait for the DOM to be fully loaded before starting
document.addEventListener('DOMContentLoaded', startApp);