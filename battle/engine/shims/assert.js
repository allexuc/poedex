// node の assert の代わり（Showdown 内部の整合性チェック用）
function assert(v, m) { if (!v) throw new Error(m || 'Assertion failed'); }
assert.ok = assert;
assert.equal = (a, b, m) => assert(a == b, m);
assert.strictEqual = (a, b, m) => assert(a === b, m);
assert.deepEqual = assert.deepStrictEqual = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), m);
assert.notEqual = (a, b, m) => assert(a != b, m);
assert.throws = (fn, m) => { try { fn(); } catch (e) { return; } throw new Error(m || 'Missing expected exception'); };
export default assert;
