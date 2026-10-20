const assert = require('node:assert/strict');
const {parseCompletion} = require(process.argv[2]);
const good = {model:'local', messages:[{role:'user', content:'hello'}]};
assert.equal(parseCompletion(JSON.stringify(good)).maxTokens, 256);
const bad = [null, [], {...good, model:'remote'}, {...good, stream:true}, {...good, tools:[]}, {...good,max_tokens:-1}, {...good,max_tokens:513}, {...good,max_tokens:1.5}, {...good,temperature:'1'}, {...good,temperature:3}, {...good,messages:[]}, {...good,messages:Array(33).fill(good.messages[0])}, {...good,messages:[{role:'tool',content:'x'}]}, {...good,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'file:///secret'}}]}]}, {...good,messages:[{role:'user',content:'a'.repeat(16001)}]}, {...good,messages:[{role:'user',content:'x',tool_calls:[]}]}, {...good,logit_bias:{}}];
for (const input of bad) assert.throws(() => parseCompletion(JSON.stringify(input)));
assert.throws(() => parseCompletion('{bad json'));
console.log(`${bad.length+2} protocol security checks passed`);
