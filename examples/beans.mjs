// Getting started 6: custom model objects. The port recognizes model kinds by
// capability contracts (method shapes), not by base classes -- the JS analogue
// of a Java bean implementing TemplateBooleanModel, TemplateNumberModel, etc.
// Run: node examples/beans.mjs

import { Configuration, Template } from '../src/index.js';

// Number + scalar: printing follows the scalar contract (JVM coercion order),
// arithmetic and comparisons use the number contract.
class Money {
  constructor(cents) { this.cents = cents; }
  getAsNumber() { return this.cents / 100; }
  getAsString() { return `$${(this.cents / 100).toFixed(2)}`; }
}

class Flag {                                 // TemplateBooleanModel
  constructor(ok) { this.ok = ok; }
  getAsBoolean() { return this.ok; }
}

class Day {                                  // TemplateDateModel
  getAsDate() { return new Date(2020, 0, 2, 3, 4, 5); }
}

class Countdown {                            // TemplateSequenceModel
  getByIndex(i) { return String(3 - i); }
  size() { return 3; }
}

class Row {                                  // TemplateHashModelEx
  get(k) { return { name: 'Ada', lang: 'JS' }[k] ?? null; }
  keys() { return ['name', 'lang']; }
  values() { return ['Ada', 'JS']; }
  size() { return 2; }
}

class Shout {                                // TemplateMethodModel
  // Port exec signature: exec(env, args); returns may be plain JS values.
  exec(env, args) { return String(args[0]).toUpperCase() + '!'; }
}

class Repeat {                               // TemplateTransformModel
  getWriter(out, args) {
    return { write(s) { out.write(s + s); }, close() {} };
  }
}

const model = {
  price: new Money(1234),
  flag: new Flag(true),
  day: new Day(),
  count: new Countdown(),
  row: new Row(),
  shout: new Shout(),
  repeat: new Repeat(),
};

const source = `
Print prefers scalar:        \${price}      math uses number: \${price * 2}
Boolean bean (never print,   <#if flag>on<#else>off</#if>, canonical form \${flag?c}
 instead test it):           \${flag?is_boolean?then('bool', '-')}
Date bean, default format:   \${day}
Sequence bean:               <#list count as n>[\${n}]</#list> size \${count?size}
Hash bean:                   \${row.name} keys: \${row?keys?join(', ')}
Method bean:                 \${shout('hi there')}
Transform bean:              <@repeat>ab</@repeat>
`;

const t = new Template('beans.ftl', source, new Configuration());
console.log(t.processToStringSync(model));

// Directly printing a boolean bean is an error unless a boolean_format is set:
const cfg2 = new Configuration();
try {
  new Template('t', '${flag}', cfg2).processToStringSync(model);
} catch (e) {
  console.log('printing a boolean bean without boolean_format:', e.constructor.name);
}
