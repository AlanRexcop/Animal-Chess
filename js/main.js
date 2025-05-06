// js/main.js
import { initGame } from './game.js';
// ** Import renderGameRules from localization **
import { loadLanguage, applyLocalizationToPage, getString, renderGameRules } from './localization.js';
import { DEFAULT_LANGUAGE } from './constants.js'

/**
 * Asynchronously sets up and starts the application.
 */
async function startApp() {
    console.log("Starting application...");
    const initialLang = DEFAULT_LANGUAGE;

    const loaded = await loadLanguage(initialLang);

    if (!loaded) {
        console.error("Failed to load initial language. Application might not work correctly.");
        document.body.innerHTML = "Error loading language files. Please try refreshing.";
        return;
    }

    // Apply loaded language to static elements
    applyLocalizationToPage();

    // ** Render dynamic rules after localization **
    renderGameRules(); // <-- Call the function here

     const langSelect = document.getElementById('lang-select');
     if (langSelect) langSelect.value = initialLang;

    try {
        initGame();
    } catch (error) {
        console.error("Error initializing game:", error);
         document.body.innerHTML = `Critical error during game initialization: ${error.message}`;
    }
}

document.addEventListener('DOMContentLoaded', startApp);