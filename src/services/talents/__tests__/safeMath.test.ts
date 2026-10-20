import {safeMath} from '../safeMath';
it.each([
  '(0).constructor.constructor("return this")()',
  '__proto__',
  'a=1',
  '2;3',
  '[1,2]',
  'pow.constructor',
  'sin("0")',
])('rejects non-arithmetic %s', source => {
  expect(() => safeMath(source)).toThrow();
});
it('bounds source length, token count and recursion', () => {
  expect(() => safeMath('1'.repeat(1025))).toThrow();
  expect(() => safeMath('1+'.repeat(150) + '1')).toThrow();
  expect(() => safeMath('('.repeat(40) + '1' + ')'.repeat(40))).toThrow();
  expect(() => safeMath('-'.repeat(40) + '1')).toThrow();
});
it('preserves exponent associativity and unary precedence', () => {
  expect(safeMath('2^3^2')).toBe(512);
  expect(safeMath('-2^2')).toBe(-4);
  expect(safeMath('2^-2')).toBe(0.25);
});
