# Contributing to Lancelot

Open an issue before a pull request and describe the problem, not the diff. A small, obvious fix
(a typo, a broken link, a failing test with a clear cause) can go straight to a pull request that
names the file and line.

## Setup

```bash
npm ci
npm run check
```

`npm run check` runs typecheck, lint, tests and the build. CI also runs `scripts/identity-gate.sh`
and `scripts/check-headers.mjs`.

## Rules the tree enforces

- Every source file opens with the two header lines in `scripts/check-headers.mjs`.
- Nothing writes to stdout while the server runs. Log through `LoggerService`; it writes to stderr.
- Nothing in `src` creates, changes or deletes data in the LanceDB database.
- No emoji. No new dependency without a reason in the pull request.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), and every commit signed off with
`git commit -s`. The sign-off certifies you may submit the code under Apache-2.0.

## License

Contributions are licensed under Apache-2.0.
