// MV3 forbids inline scripts, hence this file.
const manifest = chrome.runtime.getManifest();
document.getElementById('name').textContent = manifest.name;
document.getElementById('version').textContent = manifest.version;

// Settings live in chrome.storage.local; the content scripts mirror them onto
// the page (src/settings.js) and react immediately. Each key has a checkbox
// with the same id.
const DEFAULTS = { shuffleByDefault: true, showProgress: true };
chrome.storage.local.get(DEFAULTS, (values) => {
  for (const key of Object.keys(DEFAULTS)) document.getElementById(key).checked = !!values[key];
});
for (const key of Object.keys(DEFAULTS)) {
  const box = document.getElementById(key);
  box.addEventListener('change', () => chrome.storage.local.set({ [key]: box.checked }));
}
