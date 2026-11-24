'use strict';
// 0.8.2: built-in filters of ha-read (drafts have no jq, grep, head, tail or wc).
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../lib/cliopts');

const LIST = [
  { entity_id: 'light.kueche', state: 'on', attributes: { friendly_name: 'Küche', brightness: 200 } },
  { entity_id: 'light.flur', state: 'off', attributes: { friendly_name: 'Flur' } },
  { entity_id: 'sensor.temp', state: '21.5', attributes: { unit_of_measurement: '°C' } },
];

test('Optionen lesen: --count, --json, --fields, --pick, auch mit =', () => {
  assert.deepStrictEqual(cli.parseOpts(['states', 'light.', '--count']), { pos: ['states', 'light.'], count: true, json: false, fields: null, pick: null });
  const o = cli.parseOpts(['get', '/x', '--fields', 'entity_id, state', '--pick=data.0', '--json']);
  assert.deepStrictEqual([o.pos, o.fields, o.pick, o.json], [['get', '/x'], ['entity_id', 'state'], 'data.0', true]);
  assert.deepStrictEqual(cli.parseOpts(['get', '/x', '--pick']), { error: '--pick' });
  assert.deepStrictEqual(cli.parseOpts(['get', '/x', '--fields=']), { error: '--fields' });
  assert.deepStrictEqual(cli.parseOpts(['states', '--fields', ',']), { error: '--fields' });
});

test('states: bisherige Ausgabe ohne Optionen, sonst Anzahl, Felder, JSON', () => {
  const o = (...a) => cli.parseOpts(a);
  assert.strictEqual(cli.states(LIST, 'light.', o()), 'light.kueche\ton\tKüche\nlight.flur\toff\tFlur');
  assert.strictEqual(cli.states(LIST, 'light.', o('--count')), '2');
  assert.strictEqual(cli.states(LIST, 'nichts', o('--count')), '0');
  assert.strictEqual(cli.states(LIST, 'sensor.', o('--fields', 'entity_id,attributes.unit_of_measurement')), 'sensor.temp\t°C');
  assert.deepStrictEqual(JSON.parse(cli.states(LIST, 'light.', o('--json', '--fields', 'entity_id,state'))), [{ entity_id: 'light.kueche', state: 'on' }, { entity_id: 'light.flur', state: 'off' }]);
  assert.strictEqual(JSON.parse(cli.states(LIST, '', o('--json'))).length, 3);
  assert.strictEqual(cli.states(LIST, '', o('--pick', '*.entity_id')), 'light.kueche\nlight.flur\nsensor.temp');
});

test('--pick: Pfade mit Index, Stern und fehlenden Teilen', () => {
  const v = { data: [{ id: 'a', triggers: [{ trigger: 'state' }] }, { id: 'b' }], n: 3 };
  assert.strictEqual(cli.pick(v, 'data.1.id'), 'b');
  assert.strictEqual(cli.pick(v, 'data[0].triggers[0].trigger'), 'state');
  assert.deepStrictEqual(cli.pick(v, 'data.*.id'), ['a', 'b']);
  assert.strictEqual(cli.pick(v, 'data.5.id'), undefined);
  assert.strictEqual(cli.pick(v, 'n.x'), undefined);
  assert.strictEqual(cli.shape(v, cli.parseOpts(['--pick', 'data', '--count'])), '2');
  assert.strictEqual(cli.shape(v, cli.parseOpts(['--count'])), '2', 'Schlüssel eines Objekts');
  assert.strictEqual(cli.shape(v, cli.parseOpts(['--pick', 'fehlt', '--count'])), '0');
  assert.strictEqual(cli.shape(v, cli.parseOpts(['--pick', 'fehlt', '--json'])), 'null');
  assert.strictEqual(cli.shape(v, cli.parseOpts(['--pick', 'data.0', '--fields', 'id'])), 'a');
  assert.strictEqual(cli.shape(v, cli.parseOpts([])), JSON.stringify(v, null, 1), 'ohne Optionen wie bisher');
  assert.strictEqual(cli.shape('text', cli.parseOpts([])), 'text');
});
