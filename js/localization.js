/**
 * Stores the currently loaded language data (parsed JSON).
 * @type {Object.<string, string>}
 */
let currentLanguageData = {};

/**
 * Loads language data from a JSON file asynchronously.
 * Fetches the file corresponding to the langCode, parses it,
 * and stores it in the currentLanguageData variable.
 *
 * @param {string} [langCode='en'] - The language code (e.g., 'en', 'es') corresponding to the JSON file name.
 * @returns {Promise<boolean>} - True if the language loaded successfully, false otherwise.
 */
export async function loadLanguage(langCode = 'en') {
    const filePath = `lang/${langCode}.json`;
    console.log(`Attempting to load language file: ${filePath}`); // Debug log

    try {
        const response = await fetch(filePath);

        if (!response.ok) {
            // Handles HTTP errors (like 404 Not Found)
            throw new Error(`HTTP error! status: ${response.status} for ${filePath}`);
        }

        const data = await response.json();
        currentLanguageData = data;
        console.log(`Successfully loaded language: ${langCode}`); // Debug log
        return true;

    } catch (error) {
        // Catches fetch errors (network issues) or JSON parsing errors
        console.error(`Failed to load language file '${filePath}':`, error);
        // Optionally fallback to English or keep previous language data?
        // For now, we just signal failure.
        return false;
    }
}

/**
 * Retrieves a localized string by its key, replacing placeholders.
 * Placeholders in the string should be like {paramName}.
 *
 * @param {string} key - The key corresponding to the string in the loaded language file.
 * @param {Object.<string, string|number>} [params={}] - An object containing key-value pairs for placeholders.
 * @returns {string} - The processed string with placeholders replaced, or a fallback message if the key is not found.
 */
export function getString(key, params = {}) {
    const template = currentLanguageData[key];

    if (template === undefined) {
        // Key not found in the current language data
        console.warn(`Localization key not found: "${key}"`);
        // Return the key itself or a more descriptive error string
        return `[Missing Key: ${key}]`;
    }

    // Replace placeholders like {paramName} with values from the params object
    let processedString = template;
    for (const paramName in params) {
        // Use a RegExp with the 'g' flag to replace all occurrences globally
        // Escape curly braces as they have special meaning in RegExp
        const placeholderRegex = new RegExp(`\\{${paramName}\\}`, 'g');
        processedString = processedString.replace(placeholderRegex, params[paramName]);
    }

    return processedString;
}

// No constants needed to be imported for this specific module's functionality.