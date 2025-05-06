// js/localization.js
import { PIECES } from './constants.js';

let currentLanguageData = {};
let currentLangCode = 'vn';

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

export function getString(key, params = {}) {
    let str = currentLanguageData[key];
    if (str === undefined || str === null) { console.warn(`Missing translation for key: ${key} in language: ${currentLangCode}`); return key; }
    for (const paramKey in params) { const placeholder = `{${paramKey}}`; str = str.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), params[paramKey]); }
    return str;
}

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

export function getCurrentLanguage() {
    return currentLangCode;
}

export function renderGameRules() {
    const rulesListElement = document.getElementById('rules-list');
    if (!rulesListElement) { console.error("Rules list element (#rules-list) not found!"); return; }

    rulesListElement.innerHTML = '';

    const ruleKeys = [ 'ruleMovement', 'ruleRank', 'ruleCapture', 'ruleRatElephant', 'ruleElephantRat', 'ruleTraps', 'ruleWater', 'ruleJump', 'ruleDens', 'ruleWinCondition' ];
    const rankOrder = ['elephant', 'lion', 'tiger', 'leopard', 'wolf', 'dog', 'cat', 'rat'];

    ruleKeys.forEach(key => {
        const li = document.createElement('li');
        let ruleText = getString(key);

        if (key === 'ruleRank') {
            let rankHtml = rankOrder.map((pieceType, index) => {
                const pieceName = getString(`animal_${pieceType}`) || PIECES[pieceType]?.name || pieceType;
                const imgSrc = `assets/images/head_no_background/${pieceType}.png`;
                // Use rule-piece-icon class for specific sizing
                let pieceHtml = `<span class="rank-piece"><img src="${imgSrc}" alt="${pieceName}" title="${pieceName}" class="rule-piece-icon"></span>`;
                if (index < rankOrder.length - 1) { pieceHtml += '<span class="rank-separator"> > </span>'; }
                return pieceHtml;
            }).join('');
            ruleText = ruleText.replace('{rankHierarchy}', rankHtml);
        }

        // ****** MODIFIED: Always use innerHTML to render rules ******
        // This allows the <span><img></span> tags for pieces to render correctly.
        li.innerHTML = ruleText;
        // ****** END MODIFIED ******

        rulesListElement.appendChild(li);
    });
}