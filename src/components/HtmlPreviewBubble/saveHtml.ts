import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';

import {importWorkspace} from '../../services/talents/fileWorkspace';

/** "My Clock!" -> "My Clock.html"; empty/odd titles -> "preview.html". */
export function htmlFilename(title?: string): string {
  const stem = (title ?? '')
    .replace(/[^a-zA-Z0-9 _-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 60)
    .trim();
  return (stem || 'preview') + '.html';
}

/**
 * Save into the private workspace. Never overwrites: an existing name gets
 * a "-2", "-3"... suffix. Returns the name actually used.
 */
export function saveHtmlToWorkspace(
  html: string,
  title?: string,
): Promise<string> {
  return importWorkspace(htmlFilename(title), html);
}

/** Hand the page to the Android/iOS share sheet (save to phone, send...). */
export async function shareHtmlFile(html: string, title?: string) {
  const name = htmlFilename(title);
  const path = RNFS.CachesDirectoryPath + '/' + name;
  if (await RNFS.exists(path)) {
    await RNFS.unlink(path);
  }
  await RNFS.writeFile(path, html, 'utf8');
  await Share.open({
    url: 'file://' + path,
    filename: name,
    title: 'Save or share ' + name,
    type: 'text/html',
    failOnCancel: false,
  });
  return name;
}
