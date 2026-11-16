import React from 'react';
import {StyleSheet, View} from 'react-native';

import {Text} from '../../components/ThemedText';

import {TalentUI} from './TalentUIRegistry';
import {ModelAnswerItem, TalentResult} from './types';

/**
 * Several models' answers (ask_models: side by side; ask_model_chain: the
 * "ran out" lines, then the answer), each labelled with its model and
 * where it ran. The app's own lines (where answers differ, which model ran
 * out) come first. Never rendered as anything but text.
 */
export const ModelAnswersCard: React.FC<{
  mode: 'and' | 'or';
  answers: ModelAnswerItem[];
  lines: string[];
}> = ({mode, answers, lines}) => (
  <View testID="model-answers" style={styles.card}>
    <Text style={styles.title}>
      {mode === 'and'
        ? `Answers from ${answers.length} models`
        : 'Answer from a chain of models'}
    </Text>
    {lines.map((line, i) => (
      <Text key={i} style={styles.line} testID="model-answers-line">
        {line}
      </Text>
    ))}
    <View style={mode === 'and' ? styles.row : undefined}>
      {answers.map((a, i) => (
        <View
          key={i}
          style={mode === 'and' ? styles.column : undefined}
          testID="model-answers-item">
          <Text style={styles.name}>{a.model}</Text>
          <Text style={styles.note}>
            {a.where}
            {a.problem ? ` · ${a.problem}` : ''}
          </Text>
          {!!a.answer && <Text selectable>{a.answer}</Text>}
        </View>
      ))}
    </View>
    <Text style={styles.note}>
      Other models’ answers: check them before you rely on them.
    </Text>
  </View>
);

export class ModelAnswersTalentUI implements TalentUI {
  constructor(readonly name: string) {}

  renderResult(result: TalentResult): React.ReactNode {
    if (result.type !== 'model_answers') {
      return null;
    }
    return (
      <ModelAnswersCard
        mode={result.mode}
        answers={result.answers}
        lines={result.lines}
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
  line: {fontSize: 13, fontStyle: 'italic'},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  column: {flexGrow: 1, flexBasis: 220, minWidth: 0, gap: 2},
  name: {fontWeight: 'bold', marginTop: 4},
  note: {fontSize: 12, opacity: 0.7},
});
