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
    readStartupTiming()
      .then(setReport)
      .catch(() => setReport(null));
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
