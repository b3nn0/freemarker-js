// Getting started 7: JavaBean-style getter naming. A getFoo()/isFoo() member stands
// for the property foo, so templates stay the Java way while the model stays the JS way.
// Run: node examples/bean-readers.mjs

import { Configuration, Template } from '../src/index.js';

class Customer {
  constructor(id) { this.id = id; } // a plain data member
  getName() { return 'Ada Lovelace'; } // read as ${c.name}
  isVip() { return true; } // read as ${c.vip}
  getURL() { return 'https://example.org/ada'; } // read as ${c.URL} (never ${c.uRL})
  getNickname() { return undefined; } // a getter with nothing to read -> missing
  greet(greeting) { return `${greeting}, ${this.getName()}!`; } // 1 argument: no property
}

const source = `
Name:      \${c.name}  (from getName())
Vip:       \${c.vip?c}  (from isVip())
Web:       \${c.URL}  (getURL -> URL)
Presence:  \${c.name?? ?then('known', 'unknown')} / \${c.nickname!"(nobody)"}
Methods:   \${c.greet('Hello')} and \${c.getName?is_method?then('getName is callable', 'not callable')}
Nested:    <#list [c] as x>\${x.name}</#list>
Maps:      \${m.name!"no getter magic on Maps"}
`;

const t = new Template('readers.ftl', source, new Configuration());
console.log(t.processToStringSync({
  c: new Customer(7),
  m: new Map([['getName', () => 'a Map key called getName is just a key']]),
}));

// The property is a value, so it is not callable; the getter keeps its own name:
try {
  new Template('t', '${c.name()}', new Configuration()).processToStringSync({ c: new Customer(7) });
} catch (e) {
  console.log('${c.name()} fails:', e.constructor.name, '-', String(e.message).split('\n')[0]);
}
