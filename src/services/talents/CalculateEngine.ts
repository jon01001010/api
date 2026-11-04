import {safeMath} from './safeMath';

import {TalentEngine, TalentResult, ToolDefinition} from './types';

export class CalculateEngine implements TalentEngine {
  readonly name = 'calculate';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const expression =
      typeof args.expression === 'string' ? args.expression : '';
    if (!expression) {
      return {
        type: 'error',
        summary: 'calculate: missing or empty "expression" argument',
        errorMessage:
          'expression argument is required and must be a non-empty string',
      };
    }

    try {
      const result = safeMath(expression);
      const precision =
        typeof args.precision === 'number' &&
        Number.isInteger(args.precision) &&
        args.precision >= 1 &&
        args.precision <= 15
          ? args.precision
          : 10;
      const formatted =
        typeof result === 'number'
          ? parseFloat(result.toPrecision(precision)).toString()
          : String(result);
      return {
        type: 'text',
        summary: `${expression} = ${formatted}`,
      };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      return {
        type: 'error',
        summary: `calculate: failed to evaluate "${expression}"`,
        errorMessage: errMsg,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'calculate',
        description:
          'Do exact math instead of guessing. Use it for any calculation with numbers. ' +
          'How: put one expression in `expression`. Use + - * / ^ ( ), and functions such as ' +
          'sqrt, abs, round, floor, ceil, min, max, pow, log, log10, exp, sin, cos, tan, and pi. ' +
          'Percent: write "15% of 240" as 240*15/100 (the % sign means remainder, not percent).',
        parameters: {
          type: 'object',
          properties: {
            expression: {
              type: 'string',
              description:
                'One math expression, e.g. "2^10", "sqrt(144)", "240*15/100", "(3+4)*2".',
            },
            precision: {
              type: 'number',
              description: 'Number of significant digits (default: 10).',
            },
          },
          required: ['expression'],
        },
      },
    };
  }
}
