'use strict';

const {createHash} = require('node:crypto');
const {parse} = require('@babel/parser');
const EXPECTED_SHA256 =
  '15b4de845b224f2b802a561ecff17d2ba439a58c00e662192fca47088ef41dc0';

// phonemize 1.1.0 emits 100,844 bindings for static pronunciation data.
// Babel's scope transforms are prohibitively expensive on that declaration.
// Keep the exact data and namespace, but represent them as JSON at runtime.
// Pin the input: a dependency upgrade must review this transformation again.
function compactPhonemize(src) {
  if (createHash('sha256').update(src).digest('hex') !== EXPECTED_SHA256) {
    throw new Error('phonemize dictionary changed; review the Metro compactor');
  }
  const body = parse(src).program.body;
  const bindings = new Map();
  function literal(node) {
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
      return node.quasis[0].value.cooked;
    }
    if (node.type === 'Identifier' && bindings.has(node.name)) {
      return bindings.get(node.name);
    }
    throw new Error('Unexpected dictionary value');
  }
  for (const d of body[2].declarations) {
    bindings.set(d.id.name, literal(d.init));
  }
  function object(properties, namespace = false) {
    const result = Object.create(null);
    for (const p of properties) {
      if (p.type !== 'ObjectProperty' || p.computed) {
        throw new Error('Unexpected dictionary property');
      }
      const key = p.key.name ?? p.key.value;
      if (namespace && key === '__proto__') {
        continue;
      }
      if (namespace && key === 'default') {
        result[key] = null;
        continue;
      }
      result[key] = literal(p.value);
    }
    return result;
  }
  const [dict, namespace] = body[3].declarations;
  const data = object(dict.init.properties);
  const names = object(namespace.init.arguments[0].properties, true);
  const jsonExpr = value =>
    `JSON.parse(${JSON.stringify(JSON.stringify(value))})`;
  const replacement = `var dict=${jsonExpr(data)},dictionary$1=Object.freeze(Object.assign(Object.create(null),${jsonExpr(names)},{default:dict}));`;
  return src.slice(0, body[2].start) + replacement + src.slice(body[3].end);
}

module.exports = {compactPhonemize};
