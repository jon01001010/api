describe('Symbol.asyncIterator polyfill', () => {
  const real = Symbol.asyncIterator;

  it('defines the symbol when the engine lacks it (Hermes)', () => {
    const {ensureAsyncIterator} = require('../asyncIterator');
    // A stand-in for Hermes' Symbol, which has no asyncIterator.
    const hermesSymbol: any = {};
    ensureAsyncIterator(hermesSymbol);
    expect(typeof hermesSymbol.asyncIterator).toBe('symbol');
    expect(hermesSymbol.asyncIterator).toBe(Symbol.for('Symbol.asyncIterator'));
  });

  it('leaves a real one alone', () => {
    require('../asyncIterator');
    expect(Symbol.asyncIterator).toBe(real);
  });

  it('is the first thing the app loads', () => {
    const entry = require('fs').readFileSync(
      require('path').join(__dirname, '../../../index.js'),
      'utf8',
    );
    const firstImport = entry.match(/^import .*$/m)?.[0];
    expect(firstImport).toBe("import './src/polyfills/asyncIterator';");
  });
});
