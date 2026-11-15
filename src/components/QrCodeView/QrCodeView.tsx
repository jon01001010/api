import React, {useMemo} from 'react';
import {View} from 'react-native';
import Svg, {Path, Rect} from 'react-native-svg';
import qrcode from 'qrcode-generator';

/** The dark squares of a QR for `text`, or null if it doesn't fit in one. */
export function qrModules(text: string): boolean[][] | null {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({length: n}, (_r, row) =>
      Array.from({length: n}, (_c, col) => qr.isDark(row, col)),
    );
  } catch {
    return null;
  }
}

interface Props {
  value: string;
  size: number;
  testID?: string;
}

/**
 * A QR code drawn with SVG. Always black on white with a quiet border, also
 * in dark themes, so every camera can read it.
 */
export const QrCodeView: React.FC<Props> = ({value, size, testID}) => {
  const modules = useMemo(() => qrModules(value), [value]);
  if (!modules) {
    return null;
  }
  const quiet = 4;
  const total = modules.length + quiet * 2;
  let d = '';
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) {
        d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
      }
    }),
  );
  return (
    <View testID={testID} style={{width: size, height: size}}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
        <Rect x={0} y={0} width={total} height={total} fill="#ffffff" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
};
