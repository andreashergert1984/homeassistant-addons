'use strict';
// Languages of the add-on: dictionaries in app/i18n/<lang>.json (key -> text, placeholders {name}).
// The active language is process wide: the server sets it from the option "language"
// (auto follows Home Assistant), the command line helpers get it through HM_LANG.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'i18n');
const FALLBACK = 'en';
const DICTS = {};
for (const f of fs.readdirSync(DIR)) {
  if (f.endsWith('.json')) DICTS[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
}
const LANGS = Object.keys(DICTS).sort();

let current = FALLBACK;

// "de", "de-CH", "de_DE" -> "de"; unsupported or empty -> null.
function normalize(lang) {
  const base = String(lang || '').trim().toLowerCase().split(/[-_]/)[0];
  return DICTS[base] ? base : null;
}

// Option value (auto or a language) plus the language of Home Assistant -> active language.
function resolve(option, haLanguage) {
  const opt = String(option || 'auto').toLowerCase();
  if (opt !== 'auto') return normalize(opt) || FALLBACK;
  return normalize(haLanguage) || FALLBACK;
}

// Asks Home Assistant (GET /api/config, field "language") when the option is auto.
async function detect(option, getConfig) {
  if (String(option || 'auto').toLowerCase() !== 'auto') return resolve(option, null);
  try {
    const cfg = await getConfig();
    return resolve('auto', cfg && cfg.language);
  } catch {
    return FALLBACK;
  }
}

function setLanguage(lang) {
  current = normalize(lang) || FALLBACK;
  return current;
}

const language = () => current;
const locale = (lang = current) => (DICTS[lang] || DICTS[FALLBACK]).locale;
const dict = (lang = current) => DICTS[lang] || DICTS[FALLBACK];
const has = (key, lang = current) => Object.prototype.hasOwnProperty.call(dict(lang), key);

function format(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

// Text for a key in the active language; missing keys fall back to English, then to the key.
function t(key, vars, lang = current) {
  const d = dict(lang);
  const text = Object.prototype.hasOwnProperty.call(d, key) ? d[key] : DICTS[FALLBACK][key];
  return format(text === undefined ? key : text, vars);
}

// Dictionary for the board: everything except the prompts for Claude.
function boardDict(lang = current) {
  return Object.fromEntries(Object.entries(dict(lang)).filter(([k]) => !k.startsWith('prompt.')));
}

module.exports = { t, setLanguage, language, locale, dict, has, resolve, detect, normalize, boardDict, format, LANGS, FALLBACK, DIR };
