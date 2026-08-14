## What and why

<!-- What changes, and what problem it solves. Link an issue if there is one. -->

## Verified on

<!-- e.g. macOS 15.3 arm64, Claude Code 2.1.0. If you added agent detection,
     say which agent and version you confirmed it against. -->

## Checklist

- [ ] `npm run verify` passes (typecheck + i18n guard + tests)
- [ ] New user-facing strings go through `t()` and exist in **both**
      `en.ts` and `zh-CN.ts`
- [ ] New pure logic has test cases
- [ ] No new runtime dependencies (or explained above why one is needed)
- [ ] Screenshots, if any, come from `docs/mock/` rather than a real session
