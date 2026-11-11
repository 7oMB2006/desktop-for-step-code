import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SpeechSegments, appendSpeechText, speechLevel } from '../src/speech-segments';

const tone = (seconds: number, value = 0.1) => new Float32Array(seconds * 16000).fill(value);

test('silence is bounded and never uploaded, including when the capture ends', () => {
  const segments = new SpeechSegments();
  assert.deepEqual(segments.push(tone(60, 0)), []);
  assert.equal(segments.finish(), undefined);
  assert.equal(speechLevel(tone(1, 0)), 0);
});
test('a short pause flushes a phrase before Finish, with bounded pre-roll and no duplicated samples', () => {
  const segments = new SpeechSegments();
  assert.deepEqual(segments.push(tone(2, 0)), []);
  assert.deepEqual(segments.push(tone(0.8)), []);
  const [first] = segments.push(tone(0.7, 0));
  assert.ok(first);
  assert.equal(first.length, 1.7 * 16000);
  assert.equal(first.filter(value => value > 0).length, 0.8 * 16000);
  assert.deepEqual(segments.push(tone(0.4, 0)), []);
  segments.push(tone(0.5, 0.2));
  const next = segments.finish()!;
  assert.equal(next.length, 0.7 * 16000);
  assert.equal(next.filter(value => value > 0).length, 0.5 * 16000);
  assert.equal(segments.finish(), undefined);
});
test('continuous speech is split every four seconds without rerecognizing prior audio', () => {
  const segments = new SpeechSegments();
  const source = new Float32Array(9.35 * 16000);
  source.forEach((_, index) => { source[index] = 0.1 + index / source.length * 0.4; });
  const phrases: Float32Array[] = [];
  for (let offset = 0; offset < source.length; offset += 127) phrases.push(...segments.push(source.subarray(offset, offset + 127)));
  phrases.push(segments.finish()!);
  assert.deepEqual(phrases.map(phrase => phrase.length), [64000, 64000, 21600]);
  const combined = new Float32Array(source.length);
  let offset = 0;
  for (const phrase of phrases) { combined.set(phrase, offset); offset += phrase.length; }
  assert.deepEqual(combined, source);
});
test('brief noise does not generate a request and a partial final audio block is retained', () => {
  const noise = new SpeechSegments();
  noise.push(tone(0.1));
  assert.equal(noise.finish(), undefined);
  const phrase = new SpeechSegments();
  phrase.push(tone(0.2375));
  assert.equal(phrase.finish()!.length, 3800);
});
test('recognized phrases append without replacing manual input or adding a line per segment', () => {
  assert.equal(appendSpeechText('已有草稿', '第一句。', false), '已有草稿\n第一句。');
  assert.equal(appendSpeechText('已有草稿\n第一句。', '第二句。', true), '已有草稿\n第一句。第二句。');
  assert.equal(appendSpeechText('Hello', 'world.', true), 'Hello world.');
  assert.equal(appendSpeechText('Hello', ', world.', true), 'Hello, world.');
  assert.equal(appendSpeechText('Edited by the user.', 'Next phrase', true), 'Edited by the user. Next phrase');
  assert.equal(appendSpeechText('', 'First', false), 'First');
});
test('the actual audio worklet captures continuous mono PCM, flushes its tail once and never plays the mic', () => {
  const messages: Array<{ type: string; samples?: Float32Array }> = [];
  let Processor: any;
  vm.runInNewContext(readFileSync(new URL('../public/speech-worklet.js', import.meta.url), 'utf8'), {
    Float32Array,
    AudioWorkletProcessor: class { port = { postMessage: (value: any) => messages.push(value), onmessage: null }; },
    registerProcessor: (name: string, value: any) => { assert.equal(name, 'desktop-speech-capture'); Processor = value; },
  });
  const processor = new Processor();
  const left = new Float32Array(128).fill(0.4), right = new Float32Array(128).fill(0.2);
  const output = new Float32Array(128);
  for (let index = 0; index < 20; index++) assert.equal(processor.process([[left, right]], [[output]]), true);
  processor.port.onmessage({ data: 'stop' });
  processor.port.onmessage({ data: 'stop' });
  assert.equal(processor.process([[left, right]]), false);
  assert.deepEqual(messages.map(message => message.type), ['samples', 'samples', 'stopped']);
  assert.equal(messages[0].samples!.length, 1600);
  assert.equal(messages[1].samples!.length, 960);
  assert.ok(messages[0].samples!.every(value => Math.abs(value - 0.3) < 1e-6));
  assert.ok(output.every(value => value === 0));
});
