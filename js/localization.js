// js/localization.js

let currentLanguageData = {};
const supportedLanguages = ['en', 'vn']; // Add more as needed
let currentLangCode = 'en'; // Default

/**
 * Asynchronously fetches and loads language data from a JSON file.
 * @param {string} langCode - e.g., 'en', 'vn'
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
export async function loadLanguage(langCode) {
    if (!supportedLanguages.includes(langCode)) {
        console.warn(`Unsupported language code: ${langCode}. Falling back to 'en'.`);
        langCode = 'en';
    }

    try {
        const response = await fetch(`lang/${langCode}.json`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        currentLanguageData = await response.json();
        currentLangCode = langCode;
        document.documentElement.lang = langCode; // Set HTML lang attribute
        console.log(`Language '${langCode}' loaded successfully.`);
        return true;
    } catch (error) {
        console.error(`Failed to load language file for '${langCode}':`, error);
        // Optionally load fallback English data if primary load fails
        if (langCode !== 'en') {
            console.warn("Attempting to load English fallback...");
            return await loadLanguage('en');
        }
        currentLanguageData = {}; // Clear data on failure
        return false;
    }
}

/**
 * Retrieves a localized string based on a key.
 * Replaces placeholders like {paramName} with values from the params object.
 * @param {string} key - The key for the string (e.g., "gameTitle", "playerTurn").
 * @param {object} [params={}] - Optional object with placeholder values.
 * @returns {string} The localized string or a fallback message.
 */
export function getString(key, params = {}) {
    let str = currentLanguageData[key];

    if (str === undefined || str === null) {
        console.warn(`Localization key not found: ${key} (Lang: ${currentLangCode})`);
        return `[${key}]`; // Return the key as a fallback indicator
    }

    // Replace placeholders
    for (const paramName in params) {
        const placeholder = `{${paramName}}`;
        // Use a global regex replace
        str = str.replace(new RegExp(`\\${placeholder.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'g'), params[paramName]);
    }

    return str;
}

/**
 * Gets the currently loaded language code.
 * @returns {string}
 */
export function getCurrentLanguage() {
    return currentLangCode;
}


/**
 * Toggles the language between the supported languages (currently 'en' and 'vn').
 * Loads the new language file.
 * @returns {Promise<boolean>} True if the new language was loaded successfully.
 */
export async function toggleLanguage() {
    const currentLang = getCurrentLanguage();
    const nextLang = currentLang === 'en' ? 'vn' : 'en';
    console.log(`Toggling language from ${currentLang} to ${nextLang}`);
    return await loadLanguage(nextLang);
}