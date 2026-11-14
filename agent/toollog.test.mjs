import assert from 'node:assert/strict';
import test from 'node:test';
import { toolLogLine } from './toollog.mjs';

const out = (value) => ({ output: JSON.stringify(value) });

test('a failed tool logs its short error code', () => {
  assert.equal(
    toolLogLine('look_at_camera', out({ ok: false, error: 'vision_failed', say: 'I could not look.' })),
    '[agent] tool look_at_camera ok=false error=vision_failed',
  );
});

test('an ok tool logs ok=true only', () => {
  assert.equal(toolLogLine('check_food', out({ ok: true, say: 'Banana is high in potassium.' })), '[agent] tool check_food ok=true');
});

test('error codes that are not short snake_case become other', () => {
  for (const error of ['USDA lookup failed (429)', 'Banana', 'a'.repeat(41), 42, {}, '']) {
    assert.equal(toolLogLine('check_food', out({ ok: false, error })), '[agent] tool check_food ok=false error=other', String(error));
  }
});

test('a failed result without an error code logs none', () => {
  assert.equal(toolLogLine('check_food', out({ ok: false })), '[agent] tool check_food ok=false error=none');
});

test('tool exceptions and bad outputs are distinguished', () => {
  assert.equal(toolLogLine('check_food', { isError: true, output: 'boom' }), '[agent] tool check_food ok=false error=tool_exception');
  assert.equal(toolLogLine('check_food', undefined), '[agent] tool check_food ok=false error=tool_exception');
  assert.equal(toolLogLine('check_food', { output: 'not json' }), '[agent] tool check_food ok=false error=bad_output');
});

test('an unusual tool name is replaced and the line never carries caller content', () => {
  assert.equal(toolLogLine('Check Food!', out({ ok: true })), '[agent] tool unknown_tool ok=true');
  const line = toolLogLine('check_food', out({ ok: false, error: 'check_failed', say: 'banana pudding', food: 'banana' }));
  assert.doesNotMatch(line, /banana|pudding/);
});

test('an unreadable label logs its code', () => {
  assert.equal(toolLogLine('look_at_camera', out({ ok: false, error: 'label_unreadable' })), '[agent] tool look_at_camera ok=false error=label_unreadable');
});
