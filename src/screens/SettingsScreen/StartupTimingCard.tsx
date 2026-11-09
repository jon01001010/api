import React, {useEffect, useState} from 'react';
import {Card, Text} from 'react-native-paper';

import {
  readStartupTiming,
  StartupReport,
} from '../../services/desktop/startupTiming';

/** Desktop app only: how long each start-up step took (shows nothing on the phone). */
export const StartupTimingCard: React.FC<{cardStyle?: object}> = ({
  cardStyle,
}) => {
  const [report, setReport] = useState<StartupReport | null>(null);
  useEffect(() => {
    // Settings stays open in the background, so read again every few
    // seconds until the Windows profile is in (ready a minute after start).
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () =>
      readStartupTiming()
        .then(r => {
          setReport(r);
          if (r?.waiting && tries++ < 60) {
            timer = setTimeout(read, 5000);
          }
        })
        .catch(() => setReport(null));
    read();
    return () => clearTimeout(timer);
  }, []);
  if (!report) {
    return null;
  }
  return (
    <Card elevation={0} style={cardStyle} testID="startup-timing-card">
      <Card.Title title="Start-up time" />
      <Card.Content>
        {report.rows.map(row => (
          <Text key={row.label} variant="bodySmall">
            {row.label}:{' '}
            {Number.isNaN(row.seconds) ? 'not measured' : `${row.seconds} s`}
          </Text>
        ))}
      </Card.Content>
    </Card>
  );
};
