# Contributing to Tu

Thanks for your interest. Tu is in pre-alpha and the contribution process is still light. This file documents the conventions the existing commit history follows so a new PR fits in.

## Getting set up

```bash
pnpm install
pnpm build
pnpm test
```

Node 20+ and `pnpm` are required (see `package.json` for exact versions). The repo is a `turbo` + `pnpm-workspace` monorepo.

## How a change lands

The repo is organized around **milestones** (see the M-prefixed entries in commit titles and `docs/DEFERRED.md`). Each milestone is a self-contained vertical slice — a parser feature, a runtime feature, an LSP capability — that:

1. Lands in a single PR (or a tight series of PRs sharing a milestone prefix).
2. Updates all three sides at once: source / tests / docs. A new parser feature without a test or a docs entry is incomplete.
3. Logs every "left for later" decision in `docs/DEFERRED.md` in the SAME commit, with the milestone that introduced the gap and the target milestone for resolution. Those rows are removed in the commit that fills them — the diff itself shows the loop closing.
4. Avoids syntactic conflicts with active TC39 stage-2/3 proposals. Tu's stance is "强化 + 收敛 JS" — never invent sugar that collides. (Historical example: `match` was removed in M1.11 because TC39 Pattern Matching took the keyword.)

## Commit message shape

```
feat(M5.8): postfix member access (obj.x)

Closes the V1 typed-data gap: M5.6 shipped object literals but reading
fields out had no syntax (the `.` token was reserved by ClassRef). …
```

Conventional-commit prefix (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`) plus the milestone in parens. Body explains the *why* and notes any trade-offs / deferred follow-ups.

## Tests

- Compiler: `packages/compiler/tests/{lexer,parser,codegen,integration,ts-emit,diagnostics,imports}.test.ts`. Add a test in the most specific file. Integration tests compile + execute via dynamic ESM import.
- Runtime: `packages/runtime/tests/`. Use jsdom for DOM-touching tests.
- LSP: `packages/lsp/tests/`. Build a shadow graph + `ts.LanguageService` for cross-`.tu` cases.
- CLI: `packages/cli/tests/`. Integration tests run `runCheck` against a temp directory.

`pnpm test` runs the whole suite via `turbo`. Keep it green.

## Style

- TypeScript strict mode everywhere.
- No emoji in code or commit messages.
- Default to no comments; only add when the WHY is non-obvious.
- Don't pre-emptively abstract. Three similar lines beats a premature helper.
- Don't add error handling / fallback / validation for cases that can't happen. Trust internal invariants; validate at system boundaries.

## Filing an issue

Please include:
- Tu source that reproduces the problem
- The actual vs expected JS / TS / DOM output (or LSP behavior)
- The Tu commit hash / version

Tu is small enough today that a minimal repro almost always points at the offending compiler pass directly.
