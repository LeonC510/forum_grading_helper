// MV3 forbids inline scripts, hence this file.
const manifest = chrome.runtime.getManifest();
document.getElementById('name').textContent = manifest.name;
document.getElementById('version').textContent = manifest.version;

// Settings live in chrome.storage.local; the content scripts mirror them onto
// the page (src/settings.js) and react immediately.
const DEFAULTS = { showProgress: true };
const showProgress = document.getElementById('showProgress');
chrome.storage.local.get(DEFAULTS, (values) => { showProgress.checked = !!values.showProgress; });
showProgress.addEventListener('change', () => chrome.storage.local.set({ showProgress: showProgress.checked }));
