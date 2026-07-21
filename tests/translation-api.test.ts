import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTranslationBackend,
  getTranslationProvider,
  TranslationError,
  TRANSLATION_BACKENDS,
} from '../backend/src/translation-api.ts';

test('isTranslationBackend accepts all known backends', () => {
  for (const backend of TRANSLATION_BACKENDS) {
    assert.equal(isTranslationBackend(backend), true);
  }
});

test('isTranslationBackend rejects unknown / invalid values', () => {
  assert.equal(isTranslationBackend(''), false);
  assert.equal(isTranslationBackend('nope'), false);
  assert.equal(isTranslationBackend(undefined), false);
  assert.equal(isTranslationBackend(null), false);
  assert.equal(isTranslationBackend(42), false);
  assert.equal(isTranslationBackend('__proto__'), false);
});

test('getTranslationProvider returns a provider with a translate method', () => {
  for (const backend of TRANSLATION_BACKENDS) {
    const provider = getTranslationProvider(backend);
    assert.equal(typeof provider.translate, 'function');
  }
});

test('key-based providers throw a 400 TranslationError when the API key is missing', async () => {
  for (const backend of ['google-translate', 'bing-translate', 'deepl-translate'] as const) {
    await assert.rejects(
      () =>
        getTranslationProvider(backend).translate({
          text: 'hello',
          sourceLanguage: 'en',
          targetLanguage: 'de',
          backend,
        }),
      (err: unknown) => {
        assert.ok(err instanceof TranslationError);
        assert.equal(err.status, 400);
        assert.match(err.message, /TRANSLATION_API_KEY/);
        return true;
      },
    );
  }
});

test('providers throw a 400 when required languages are missing', async () => {
  await assert.rejects(
    () =>
      getTranslationProvider('free-google-translate').translate({
        text: 'hello',
        sourceLanguage: '',
        targetLanguage: '',
        backend: 'free-google-translate',
      }),
    (err: unknown) => {
      assert.ok(err instanceof TranslationError);
      assert.equal(err.status, 400);
      return true;
    },
  );
});
