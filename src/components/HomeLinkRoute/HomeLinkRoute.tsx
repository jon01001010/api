import React, {useEffect, useState} from 'react';
import {Text} from 'react-native-paper';

import {pcStatus} from '../../services/homeLink/homeLink';

/**
 * A "Home PC" server: how this phone reaches the PC right now ("direct":
 * straight to the PC, e.g. Wi-Fi or a hotspot; "relay": through a relay
 * that can't read it) and the model the PC runs or would start on Load.
 */
export const HomeLinkRoute: React.FC<{pc: string}> = ({pc}) => {
  const [line, setLine] = useState('Home link: checking…');
  useEffect(() => {
    let alive = true;
    pcStatus(pc).then(s => {
      if (!alive) {
        return;
      }
      if (!s.ok) {
        setLine(`Home link: can't reach the PC (${s.error})`);
        return;
      }
      const model = s.running
        ? 'a model is running'
        : s.lastModel
          ? `no model running (Load starts ${s.lastModel})`
          : 'no model running';
      setLine(`Home link: ${s.route || 'connected'} · ${model}`);
    });
    return () => {
      alive = false;
    };
  }, [pc]);
  return (
    <Text variant="bodySmall" testID="home-link-route">
      {line}
    </Text>
  );
};
