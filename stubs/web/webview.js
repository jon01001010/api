/**
 * The HTML preview on the desktop (the phone uses a locked-down WebView;
 * SECURITY.md rule 3). The page the app built (policy first, guard script,
 * frame tags renamed) goes to the native side, which serves it from its own
 * address, `pa-preview`, with a policy that blocks all network use. It is
 * shown in a frame sandboxed to scripts only: no origin, no Tauri bridge, no
 * pop-ups, forms, downloads, storage or navigation out (the app window only
 * allows frames from `pa-preview`).
 *
 * Only `source.html` is shown; a page address (`source.uri`) never is.
 * Outside the .exe (a plain browser) there is no native side: the preview
 * reports an error and the app offers "View code".
 */
const React = require('react');
const {View} = require('react-native');
const {isTauri, invoke} = require('./tauri');
const {convertFileSrc} = require('@tauri-apps/api/core');

const SCHEME = 'pa-preview';
/** The sandbox: the page's own scripts run, nothing else is allowed. */
const SANDBOX = 'allow-scripts';

/** The frame address for a stored page id, checked to be the preview's. */
function previewUrl(id) {
  if (!/^[0-9a-f]{32}$/.test(String(id))) {
    return null;
  }
  const url = convertFileSrc(id, SCHEME);
  return url === `${SCHEME}://localhost/${id}` ||
    url === `http://${SCHEME}.localhost/${id}` ||
    url === `https://${SCHEME}.localhost/${id}`
    ? url
    : null;
}

function WebView(props) {
  const {source, style, testID, onLoadEnd, onError} = props;
  const html = source && typeof source.html === 'string' ? source.html : null;
  const [url, setUrl] = React.useState(null);
  const latest = React.useRef(props);
  latest.current = props;

  React.useEffect(() => {
    let live = true;
    setUrl(null);
    const fail = () => {
      if (live && typeof latest.current.onError === 'function') {
        latest.current.onError({nativeEvent: {description: 'preview'}});
      }
    };
    if (html == null || !isTauri()) {
      fail();
      return undefined;
    }
    invoke('preview_put', {page: html})
      .then(id => {
        const address = previewUrl(id);
        if (!address) {
          fail();
        } else if (live) {
          setUrl(address);
        }
      })
      .catch(fail);
    return () => {
      live = false;
    };
  }, [html]);

  return React.createElement(
    View,
    {style, testID},
    url
      ? React.createElement('iframe', {
          src: url,
          sandbox: SANDBOX,
          referrerPolicy: 'no-referrer',
          allow: '',
          title: 'Preview',
          'data-testid': testID ? `${testID}-frame` : undefined,
          style: {border: 0, width: '100%', height: '100%', display: 'block'},
          onLoad: () => {
            if (typeof onLoadEnd === 'function') {
              onLoadEnd({nativeEvent: {}});
            }
          },
          onError: () => {
            if (typeof onError === 'function') {
              onError({nativeEvent: {description: 'preview'}});
            }
          },
        })
      : null,
  );
}

module.exports = {
  WebView,
  default: WebView,
  __esModule: true,
  previewUrl,
  SANDBOX,
};
