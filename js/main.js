// js/main.js
import { initGame, setupUIListeners } from './game.js';
import { loadLanguage, getString } from './localization.js';

/**
 * Initializes the application after the DOM is loaded.
 * Loads language data and then starts the game.
 */
async function startApp() {
    console.log("DOM Loaded. Starting application...");

    // 1. Load Default Language (e.g., English)
    const defaultLang = 'en'; // Or determine from browser settings/local storage
    const langLoaded = await loadLanguage(defaultLang);

    if (!langLoaded) {
        // Handle critical error - maybe display a message without localization
        document.body.innerHTML = '<p style="color: red; font-weight: bold;">Error: Could not load essential language files. Application cannot start.</p>';
        return;
    }

    try {
        initGame(); // This function will now handle initial rendering using loaded language
        console.log("Game Initialized.");
    } catch (error) {
         console.error("Fatal Error: Could not initialize game.", error);
         // Display error to user
          const statusElement = document.getElementById('status');
          if (statusElement) {
              statusElement.textContent = "Critical Error: Game failed to start.";
              statusElement.style.color = 'red';
          } else {
               document.body.insertAdjacentHTML('beforeend', '<p style="color: red; font-weight: bold;">Critical Error: Game failed to start.</p>');
          }
         return; // Stop if game init fails
    }

    // 3. Setup UI Event Listeners (Now elements and worker should exist)
    try {
        setupUIListeners();
        console.log("UI Listeners set up.");
    } catch (error) {
         console.error("Fatal Error: Could not set up UI listeners.", error);
          document.body.innerHTML = '<p style="color: red; font-weight: bold;">Error: Failed to initialize UI controls.</p>';
         // If this fails, the game might be partially usable but controls won't work
    }
    // **************************
}

// --- Entry Point ---
// Wait for the DOM to be fully loaded before starting the application
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    // DOMContentLoaded has already fired
    startApp();
}