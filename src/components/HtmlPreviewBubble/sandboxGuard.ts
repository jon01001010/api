/**
 * Extra lock for the HTML preview: no browser enforces a CSP rule for WebRTC,
 * so `connect-src 'none'` alone would still let a page send data out over a
 * WebRTC connection, also from a blank inner frame (which has its own copy).
 * Checked in Chromium against 24 ways in (see TODO "HTML preview lock").
 *
 * 1. `neutralizeFrameTags` renames frame tags in the page text before it is
 *    built, so the HTML parser never creates a frame.
 * 2. `PREVIEW_GUARD_SCRIPT` runs first in the page: removes WebRTC for good
 *    (non-configurable), blocks pop-ups, and removes any frame a script adds
 *    before the script can reach it. It also gives the page a storage that
 *    lives only while it is open (the real one throws in the no-origin
 *    preview and stopped pages' scripts; nothing is saved or shared).
 */
const FRAME_TAG =
  /<(\/?)(iframe|frameset|frame|object|embed|portal|fencedframe)(?=[\s/>]|$)/gi;

/** `<iframe …>` → `<blocked-iframe …>`, an inert unknown element. */
export function neutralizeFrameTags(html: string): string {
  return html.replace(FRAME_TAG, '<$1blocked-$2');
}

export const PREVIEW_GUARD_SCRIPT = `(function () {
  var RTC = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection',
    'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate', 'RTCIceTransport',
    'RTCDtlsTransport', 'RTCSctpTransport', 'RTCRtpSender', 'RTCRtpReceiver',
    'RTCRtpTransceiver', 'RTCCertificate', 'RTCDTMFSender', 'RTCEncodedAudioFrame',
    'RTCEncodedVideoFrame', 'RTCRtpScriptTransform', 'RTCPeerConnectionIceEvent',
    'RTCDataChannelEvent', 'RTCTrackEvent', 'RTCError', 'RTCErrorEvent',
    'RTCStatsReport', 'RTCIceCandidatePair'];
  function lockRealm(w) {
    for (var i = 0; i < RTC.length; i++) {
      try {
        Object.defineProperty(w, RTC[i], {value: undefined, writable: false, configurable: false});
      } catch (e) {}
    }
  }
  lockRealm(window);
  // No pop-ups: a new window would be a fresh copy of everything above.
  try { Object.defineProperty(window, 'open', {value: function () { return null; }, writable: false, configurable: false}); } catch (e) {}
  // Pages often keep a score or a setting (localStorage). The preview has no
  // origin (by design), so the browser's storage throws and the page's own
  // script stops (a game's START button did nothing, 2026-11-09). Give it a
  // storage that lives only while the page is open: nothing is saved, and
  // nothing is shared with the app or other previews.
  function memoryStorage() {
    var data = {};
    var has = function (k) { return Object.prototype.hasOwnProperty.call(data, k); };
    var s = {
      getItem: function (k) { k = String(k); return has(k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; },
      key: function (i) { var ks = Object.keys(data); return i >= 0 && i < ks.length ? ks[i] : null; }
    };
    Object.defineProperty(s, 'length', {get: function () { return Object.keys(data).length; }});
    return s;
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var works = false;
    try { works = !!window[name]; } catch (e) {}
    if (!works) {
      try { Object.defineProperty(window, name, {value: memoryStorage(), writable: false, configurable: false}); } catch (e) {}
    }
  });
  try { void document.cookie; } catch (e) {
    var jar = '';
    try { Object.defineProperty(document, 'cookie', {get: function () { return jar; }, set: function () {}, configurable: false}); } catch (e2) {}
  }
  var FRAMES = 'iframe,frame,object,embed,portal,fencedframe';
  function sweep() {
    var found = document.querySelectorAll(FRAMES);
    for (var i = 0; i < found.length; i++) { found[i].remove(); }
    // Frames inside shadow roots are not reached by querySelectorAll.
    if (window.length > 0) {
      var all = document.querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var sr = all[j].shadowRoot;
        if (sr) { var inner = sr.querySelectorAll(FRAMES); for (var k = 0; k < inner.length; k++) { inner[k].remove(); } }
      }
    }
  }
  function wrap(proto, name) {
    if (!proto) { return; }
    var d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d) { return; }
    if (typeof d.value === 'function') {
      var f = d.value;
      Object.defineProperty(proto, name, {configurable: false, writable: false, enumerable: d.enumerable,
        value: function () { try { return f.apply(this, arguments); } finally { sweep(); } }});
    } else if (d.set) {
      var s = d.set;
      Object.defineProperty(proto, name, {configurable: false, enumerable: d.enumerable, get: d.get,
        set: function (v) { try { s.call(this, v); } finally { sweep(); } }});
    }
  }
  [[Node.prototype, ['appendChild', 'insertBefore', 'replaceChild']],
   [Element.prototype, ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren',
     'insertAdjacentElement', 'insertAdjacentHTML', 'innerHTML', 'outerHTML', 'setHTMLUnsafe',
     'setHTML', 'moveBefore', 'attachShadow']],
   [CharacterData.prototype, ['before', 'after', 'replaceWith']],
   [DocumentType.prototype, ['before', 'after', 'replaceWith']],
   [Document.prototype, ['append', 'prepend', 'replaceChildren', 'write', 'writeln', 'execCommand', 'open', 'moveBefore']],
   [DocumentFragment.prototype, ['append', 'prepend', 'replaceChildren', 'moveBefore']],
   [typeof ShadowRoot !== 'undefined' && ShadowRoot.prototype, ['innerHTML', 'setHTMLUnsafe', 'setHTML']],
   [Range.prototype, ['insertNode', 'surroundContents']]
  ].forEach(function (p) { p[1].forEach(function (n) { wrap(p[0], n); }); });
  // Getters return nothing, so a frame can never be reached through them.
  [typeof HTMLIFrameElement !== 'undefined' && HTMLIFrameElement.prototype,
   typeof HTMLFrameElement !== 'undefined' && HTMLFrameElement.prototype,
   typeof HTMLObjectElement !== 'undefined' && HTMLObjectElement.prototype,
   typeof HTMLEmbedElement !== 'undefined' && HTMLEmbedElement.prototype].forEach(function (proto) {
    if (!proto) { return; }
    ['contentWindow', 'contentDocument'].forEach(function (n) {
      if (Object.getOwnPropertyDescriptor(proto, n)) {
        Object.defineProperty(proto, n, {configurable: false, get: function () { return null; }});
      }
    });
    if (proto.getSVGDocument) {
      Object.defineProperty(proto, 'getSVGDocument', {configurable: false, writable: false, value: function () { return null; }});
    }
  });
  // Frames the HTML parser creates: removed at the microtask checkpoint the
  // parser runs before the page's next script.
  new MutationObserver(sweep).observe(document, {childList: true, subtree: true});
})();`;
