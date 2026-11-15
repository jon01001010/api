import React from 'react';
import {StyleSheet, View} from 'react-native';

import {Text} from '../../components/ThemedText';

import {TalentUI} from './TalentUIRegistry';
import {TalentResult} from './types';

/**
 * Another model's answer (ask_other_model), shown in the chat as plain
 * text labelled with the model's name and where it ran. Never rendered as
 * anything but text.
 */
export const ModelAnswerCard: React.FC<{
  model: string;
  where: string;
  answer: string;
}> = ({model, where, answer}) => (
  <View testID="model-answer" style={styles.card}>
    <Text style={styles.title}>Answer from {model}</Text>
    <Text style={styles.note}>
      {where}. Another model’s answer: check it before you rely on it.
    </Text>
    <Text selectable testID="model-answer-text">
      {answer}
    </Text>
  </View>
);

export class ModelAnswerTalentUI implements TalentUI {
  readonly name = 'ask_other_model';

  renderResult(result: TalentResult): React.ReactNode {
    if (result.type !== 'model_answer') {
      return null;
    }
    return (
      <ModelAnswerCard
        model={result.model}
        where={result.where}
        answer={result.answer}
      />
    );
  }
}

const styles = StyleSheet.create({
  card: {
    gap: 4,
    marginVertical: 6,
    padding: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#888',
  },
  title: {fontWeight: 'bold'},
  note: {fontSize: 12, opacity: 0.7},
});
