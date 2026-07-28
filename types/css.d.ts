// Next.js handles plain (non-module) CSS imports at build time; TypeScript 7
// needs an ambient declaration for the side-effect import to typecheck.
declare module '*.css';
