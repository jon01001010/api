/**
 * Copy and paste on the desktop: the browser clipboard. If the web view
 * refuses navigator.clipboard, copying falls back to a hidden text box.
 */
function copyWithTextBox(text) {
  if (typeof document === 'undefined') {
    return;
  }
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  try {
    document.execCommand('copy');
  } catch (e) {}
  document.body.removeChild(box);
}

function setString(value) {
  const text = value == null ? '' : String(value);
  const clip = typeof navigator !== 'undefined' && navigator.clipboard;
  if (clip && clip.writeText) {
    clip.writeText(text).catch(() => copyWithTextBox(text));
  } else {
    copyWithTextBox(text);
  }
}

async function getString() {
  try {
    return (await navigator.clipboard.readText()) || '';
  } catch (e) {
    return '';
  }
}

async function hasString() {
  return (await getString()).length > 0;
}

const Clipboard = {setString, getString, hasString};
module.exports = {
  ...Clipboard,
  Clipboard,
  default: Clipboard,
  __esModule: true,
};
