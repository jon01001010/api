import {ExecutionBudget} from '../ExecutionBudget';

describe('ExecutionBudget', () => {
  it('stops after the permitted action count', () => {
    const b = new ExecutionBudget(2, 60000, 100);
    b.recordStart(100); b.recordStart(200);
    expect(b.snapshot(201).remaining).toBe(0);
    expect(() => b.recordStart(202)).toThrow('budget exceeded');
  });
  it('stops after the deadline', () => {
    const b = new ExecutionBudget(5, 1000, 100);
    expect(b.canStart(1099)).toBe(true);
    expect(b.canStart(1100)).toBe(false);
  });
  it('rejects invalid limits', () => {
    expect(() => new ExecutionBudget(0, 5000)).toThrow();
    expect(() => new ExecutionBudget(1, 0)).toThrow();
  });
});

describe('configured loop count enforcement', () => {
  it('allows exactly five actions and blocks the sixth', () => {
    const budget = new ExecutionBudget(5, 60000, 100);
    for (let i = 0; i < 5; i++) budget.recordStart(100 + i);
    expect(budget.snapshot(105).remaining).toBe(0);
    expect(() => budget.recordStart(105)).toThrow('budget exceeded');
  });
  it('does not count an action until it starts', () => {
    const budget = new ExecutionBudget(5, 60000, 100);
    expect(budget.snapshot(100).remaining).toBe(5);
    budget.recordStart(100);
    expect(budget.snapshot(100).remaining).toBe(4);
  });
});
