import base from '@pulseops/config/eslint';

export default [
  ...base,
  {
    // Nest dependency injection needs constructor parameter types as runtime values,
    // so the type-import rule must know decorator metadata is emitted.
    languageOptions: {
      parserOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
    },
  },
];
