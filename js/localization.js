// js/localization.js
import { PIECES } from './constants.js'; // ** Import PIECES **

let currentLanguageData = {};
let currentLangCode = 'en'; // Default language

/**
 * Asynchronously loads language data from a JSON file.
 */
export async function loadLanguage(langCode) {
    try {
        const response = await fetch(`lang/${langCode}.json`);
        if (!response.ok) { throw new Error(`HTTP error! status: ${response.status}`); }
        currentLanguageData = await response.json();
        currentLangCode = langCode;
        console.log(`Language loaded: ${langCode}`);
        document.documentElement.lang = langCode;
        return true;
    } catch (error) {
        console.error(`Failed to load language file for ${langCode}:`, error);
        if (langCode !== 'en') { console.log("Attempting to load English fallback..."); return await loadLanguage('en'); }
        return false;
    }
}

/**
 * Retrieves a localized string based on a key.
 */
export function getString(key, params = {}) {
    let str = currentLanguageData[key];
    if (str === undefined || str === null) {
        console.warn(`Missing translation for key: ${key} in language: ${currentLangCode}`);
        return key; // Return the key as a fallback
    }
    for (const paramKey in params) {
        const placeholder = `{${paramKey}}`;
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
        if (text !== key) {
             if (element.tagName === 'BUTTON' || element.tagName === 'OPTION' || element.tagName === 'LABEL' || element.tagName === 'H1' || element.tagName === 'H2' || element.tagName === 'SPAN') { element.textContent = text; }
             else if (element.placeholder) { element.placeholder = text; }
             else if (element.title) { element.title = text; }
        }
    });
     document.title = getString('gameTitle');
}

// Function to get the current language code
export function getCurrentLanguage() {
    return currentLangCode;
}

/** ---- NEW: Renders the game rules dynamically ---- */
export function renderGameRules() {
    const rulesListElement = document.getElementById('rules-list'); // Get element here
    if (!rulesListElement) {
        console.error("Rules list element (#rules-list) not found!");
        return;
    }

    rulesListElement.innerHTML = ''; // Clear existing rules

    const ruleKeys = [
        'ruleMovement',
        'ruleRank',
        'ruleCapture',
        'ruleRatElephant',
        'ruleElephantRat',
        'ruleTraps',
        'ruleWater',
        'ruleJump',
        'ruleDens',
        'ruleWinCondition'
    ];

    // Define rank order for visualization (strongest to weakest)
    const rankOrder = ['elephant', 'lion', 'tiger', 'leopard', 'wolf', 'dog', 'cat', 'rat'];

    ruleKeys.forEach(key => {
        const li = document.createElement('li');
        let ruleText = getString(key); // Get base translated text

        if (key === 'ruleRank') {
            // Build the rank hierarchy HTML using images
            let rankHtml = rankOrder.map((pieceType, index) => {
                const pieceName = getString(`animal_${pieceType}`) || PIECES[pieceType]?.name || pieceType; // Localized name or fallback
                const imgSrc = `assets/images/head_no_background/${pieceType}.png`; // Image path
                // Wrap image and separator for styling/spacing
                let pieceHtml = `<span class="rank-piece">
                                   <img src="${imgSrc}" alt="${pieceName}" title="${pieceName}" class="rank-piece-icon">
                                 </span>`;
                if (index < rankOrder.length - 1) {
                    pieceHtml += '<span class="rank-separator"> > </span>';
                }
                return pieceHtml;
            }).join(''); // Join all pieces/separators into one string

            // Replace placeholder in the translated string
            ruleText = ruleText.replace('{rankHierarchy}', rankHtml);
            li.innerHTML = ruleText; // Use innerHTML because we generated HTML
        } else {
             // For rules that might contain <b> or <i> tags from the JSON
             if (['ruleTraps', 'ruleWater', 'ruleJump', 'ruleDens', 'ruleWinCondition'].includes(key)) {
                 li.innerHTML = ruleText;
             } else {
                 li.textContent = ruleText; // Use textContent for safety otherwise
             }
        }
        rulesListElement.appendChild(li);
    });
}
/** ---- END NEW ---- */