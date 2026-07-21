import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LineBuffer,
  parseOpenAILine,
  GeminiStreamParser,
} from '../shared/stream-parser.ts';
import { detectStyle } from '../backend/src/completion-api.ts';

test('detectStyle picks gemini for gemini models, openai otherwise', () => {
  assert.equal(detectStyle('gemini-1.5-flash-latest'), 'gemini');
  assert.equal(detectStyle('gpt-4o-mini'), 'openai');
  assert.equal(detectStyle('claude-3'), 'openai');
});

test('LineBuffer yields complete lines and buffers the remainder', () => {
  const buf = new LineBuffer();
  assert.deepEqual(buf.push('hel'), []);
  assert.deepEqual(buf.push('lo\nwor'), ['hello']);
  assert.deepEqual(buf.push('ld\n'), ['world']);
  assert.deepEqual(buf.flush(), []);
});

test('LineBuffer flush returns the trailing partial line', () => {
  const buf = new LineBuffer();
  assert.deepEqual(buf.push('a\nb'), ['a']);
  assert.deepEqual(buf.flush(), ['b']);
});

test('parseOpenAILine extracts content deltas', () => {
  const line = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] });
  assert.equal(parseOpenAILine(line), 'Hi');
});

test('parseOpenAILine ignores [DONE], blanks and malformed JSON', () => {
  assert.equal(parseOpenAILine('data: [DONE]'), null);
  assert.equal(parseOpenAILine(''), null);
  assert.equal(parseOpenAILine('   '), null);
  assert.equal(parseOpenAILine('data: {not json'), null);
  assert.equal(parseOpenAILine('data: ' + JSON.stringify({ choices: [{ delta: {} }] })), null);
});

test('GeminiStreamParser decodes tokens across a JSON-array stream', () => {
  const parser = new GeminiStreamParser();
  const tokens: string[] = [];
  const obj1 = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello' }] } }] });
  const obj2 = JSON.stringify({ candidates: [{ content: { parts: [{ text: ' world' }] } }] });
  // Simulate Gemini's pretty-printed array stream.
  for (const line of `[${obj1},${obj2}]`.split('\n')) {
    tokens.push(...parser.push(line));
  }
  assert.deepEqual(tokens, ['Hello', ' world']);
});

test('GeminiStreamParser buffers across partial chunks', () => {
  const parser = new GeminiStreamParser();
  const full = JSON.stringify([{ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] }]);
  const mid = Math.floor(full.length / 2);
  const tokens: string[] = [];
  tokens.push(...parser.push(full.slice(0, mid)));
  tokens.push(...parser.push(full.slice(mid)));
  assert.deepEqual(tokens, ['Hi']);
});
