let currentLanguageData = {};
let currentLangCode = 'en'; // Default language

/**
 * Asynchronously loads language data from a JSON file.
 * @param {string} langCode - The language code (e.g., 'en', 'vn').
 * @returns {Promise<boolean>} - Promise resolving to true on success, false on failure.
 */
export async function loadLanguage(langCode) {
    try {
        const response = await fetch(`lang/${langCode}.json`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        currentLanguageData = await response.json();
        currentLangCode = langCode;
        console.log(`Language loaded: ${langCode}`);
        // Update document lang attribute
        document.documentElement.lang = langCode;
        return true;
    } catch (error) {
        console.error(`Failed to load language file for ${langCode}:`, error);
        // Optionally load fallback language (e.g., English)
        if (langCode !== 'en') {
            console.log("Attempting to load English fallback...");
            return await loadLanguage('en');
        }
        return false;
    }
}

/**
 * Retrieves a localized string based on a key.
 * Replaces placeholders like {paramName} with values from the params object.
 * @param {string} key - The key for the string (e.g., 'gameTitle', 'playerTurn').
 * @param {object} [params={}] - Optional parameters for placeholder replacement.
 * @returns {string} - The localized string, or the key itself if not found.
 */
export function getString(key, params = {}) {
    let str = currentLanguageData[key];

    if (str === undefined || str === null) {
        console.warn(`Missing translation for key: ${key} in language: ${currentLangCode}`);
        return key; // Return the key as a fallback
    }

    // Replace placeholders
    for (const paramKey in params) {
        const placeholder = `{${paramKey}}`;
        // Use a global regex replace to catch multiple occurrences
        str = str.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), params[paramKey]);
    }

    return str;
}

/**
 * Applies localization to all elements with data-translate attribute.
 */
export function applyLocalizationToPage() {
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        const text = getString(key);
        if (text !== key) { // Only update if translation exists
             // Handle specific elements like buttons or inputs if needed
             if (element.tagName === 'BUTTON' || element.tagName === 'OPTION' || element.tagName === 'LABEL' || element.tagName === 'H1' || element.tagName === 'H2' || element.tagName === 'SPAN') {
                 element.textContent = text;
             } else if (element.placeholder) {
                 element.placeholder = text;
             } else if (element.title) {
                 element.title = text;
             }
             // Add more cases if necessary (e.g., input values)
        }
    });
     // Special case: Update page title
     document.title = getString('gameTitle');
}

// Function to get the current language code
export function getCurrentLanguage() {
    return currentLangCode;
}