/// <reference types="expo/types" />

// Expo generates `expo-env.d.ts` with this same reference and gitignores it,
// which means it exists on a developer's machine and never on CI. Without it
// `process.env` is untyped, so `process.env.EXPO_PUBLIC_*` is `any` — and a
// callback taking a parameter derived from it becomes an implicit any, which
// `strict` rejects. The result was a typecheck that passed locally and failed
// in CI on code nobody had changed there.
//
// This file is tracked, so both see the same types.
