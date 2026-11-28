import { invoke, on, closeCurrentWindow } from './tauri-ipc.js';

const $ = (id) => document.getElementById(id);

let currentLocale = 'en';
let dict = {};
let aboutInfo = {};

function resolveUiTheme(uiTheme, backgroundMode, theme) {
    if (uiTheme === 'light' || uiTheme === 'dark') return uiTheme;
    const src = backgroundMode || theme || 'dark';
    return src === 'light' || src === 'lightGradient' ? 'light' : 'dark';
}

function applyUiTheme(uiTheme, backgroundMode, theme) {
    document.documentElement.setAttribute(
        'data-theme',
        resolveUiTheme(uiTheme, backgroundMode, theme)
    );
}

function openExternal(url) {
    if (!url) return;
    invoke('open_external', { url }).catch((err) => console.warn('Open URL failed:', err));
}

async function loadLocale(locale) {
    const tag = locale === 'en' ? 'en' : 'ru';
    try {
        const res = await fetch(`./translations/${tag}.json`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        dict = await res.json();
        currentLocale = tag;
        return true;
    } catch (e) {
        console.warn('i18n load failed:', e.message);
        if (tag !== 'en') {
            try {
                const res = await fetch('./translations/en.json');
                dict = await res.json();
                currentLocale = 'en';
                return true;
            } catch (_) {}
        }
        dict = {};
        return false;
    }
}

function t(key) {
    return (dict && dict[key] != null) ? dict[key] : key;
}

function applyI18n() {
    document.documentElement.lang = currentLocale;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    const appName = aboutInfo.name || $('appName')?.textContent || '';
    document.title = appName ? `${t('about')} ${appName}` : t('about');
    if (aboutInfo.version) {
        $('version').textContent = `${t('about_version')} v.${aboutInfo.version}`;
    }
}

try {
    aboutInfo = await invoke('get_about_info');
    applyUiTheme(aboutInfo.ui_theme, aboutInfo.backgroundMode, aboutInfo.theme);
    if (aboutInfo.name) $('appName').textContent = aboutInfo.name;
    if (aboutInfo.author) $('author').textContent = aboutInfo.author;
    if (aboutInfo.license) $('license').textContent = aboutInfo.license;
    if (aboutInfo.website) {
        $('website').textContent = aboutInfo.website;
        $('website').addEventListener('click', () => openExternal(aboutInfo.website));
    }
    if (aboutInfo.source) {
        $('source').textContent = aboutInfo.source;
        $('source').addEventListener('click', () => openExternal(aboutInfo.source));
    }
} catch (err) {
    console.warn('Failed to load About info:', err);
}

await loadLocale(aboutInfo.locale || 'en');
applyI18n();

on('ribbons-i18n-changed', async (locale) => {
    await loadLocale(locale);
    applyI18n();
});

on('ribbons-theme-changed', (payload) => {
    applyUiTheme(
        payload && payload.ui_theme,
        payload && payload.backgroundMode,
        payload && payload.theme
    );
});

$('close').addEventListener('click', () => closeCurrentWindow());
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeCurrentWindow();
});
