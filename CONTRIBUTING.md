# Contributing

SecureMind is a personal project shared as is. Contributions are welcome, and there is no promised response time.

## Ways to help

- **Report a bug or ask a question:** open an [issue](https://github.com/OrieBound/securemind/issues) or start a [discussion](https://github.com/OrieBound/securemind/discussions). Say which edition you run (local Docker or your own AWS account), what you did and what you expected. Do not paste API keys, setup codes or private data.
- **Report a security problem:** follow [SECURITY.md](SECURITY.md). Do not use a public issue.
- **Propose a change:** fork the repository, make the change on a branch and open a pull request. For anything larger than a small fix, open an issue first so the direction can be agreed before you spend time on it.

## Before you open a pull request

```bash
npm ci
npm run typecheck
npm test
```

Both checks should pass. CI runs them on every pull request, and a maintainer must approve the run for outside contributors.

Please keep a change focused on one thing. New detection patterns need test cases in `src/lib/pii.test.ts`, including a false-positive case. A route that reads or writes user-owned data needs a cross-tenant test in `tests/authz.test.ts`. The rules the project follows are in [AGENTS.md](AGENTS.md).

By contributing, you agree that your work is released under the [Apache License 2.0](LICENSE).

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Contact

Email [hello@securemind.chat](mailto:hello@securemind.chat), or use the [Contact page](https://securemind.chat/contact/) or [LinkedIn](https://www.linkedin.com/in/orie-hulan).
