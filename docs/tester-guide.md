# SecureMind tester guide

Thank you for helping. You are not expected to know anything technical to do Part 1. Part 2 is optional and only for people comfortable with Docker.

SecureMind is a privacy-aware AI workspace. Before a chat message is sent, it checks for sensitive values (card numbers, SSNs, secrets and similar) and offers to replace them. It also lets you upload documents and ask questions with citations. It reduces risk. It does not guarantee that every sensitive value is removed.

**Please use made-up data only. Do not type or upload anything real or private.**

## Part 1: try the sample site (about 20 minutes, no install)

Open https://sample.securemind.chat. It uses made-up data and needs no account.

Try these, in any order:

1. **Say hello.** Ask something casual. Does the reply feel natural?
2. **Ask about the workspace.** Ask a question that the sample documents could answer. Do you get an answer with sources you can click?
3. **Ask something unrelated.** Ask a general question (for example, how to boil an egg). It should answer without showing sources.
4. **Test detection.** Type a fake card number such as `4242 4242 4242 4242` or a fake SSN such as `123-45-6789` in a message and send it. A review dialog should appear before anything is sent. Is it clear what was found and what will happen?
5. **Look around.** Open the Insights panel, the settings and the memory page. Is anything confusing, unlabeled or broken?
6. **Try your phone or a second browser**, if you have one.

## Part 2 (optional): install it yourself (about 30 to 60 minutes)

You need Git, Docker with Compose v2, about 8 GB of free disk, 8 GB of RAM and port 3000 free.

```bash
git clone https://github.com/OrieBound/securemind.git
cd securemind
docker compose up --build
```

The first start downloads container images and two models, so it can take a while. Then:

1. Open http://localhost:3000.
2. Create the first owner. You will need the one-time setup code the install printed in the terminal, on the line that says `First-run setup code`. To show it again, open a second terminal in the same folder and run `docker compose logs init`.
3. Upload a document with made-up content and ask a question about it.
4. Repeat the detection test from Part 1.

Stop it with `docker compose down`. Use `docker compose down -v` to delete everything it stored.

Built and tested on Windows with Chrome. macOS, Linux, Apple Silicon and other browsers are untested, so those reports are especially useful.

## What to tell me

Anything is useful. Short notes are fine. The most helpful are:

- **Where you got stuck or confused**, even if it turned out to be your mistake.
- **Anything that broke**, with what you did just before.
- **The setup steps that did not work** as written.
- **Anything that sounded like a promise** of security or compliance. It should not.
- Your browser and operating system.

Screenshots help, but black out anything you do not want shared.

Send notes by email to hello@securemind.chat, in a GitHub [issue](https://github.com/OrieBound/securemind/issues), or directly to me. If you think you found a security problem, please follow [SECURITY.md](../SECURITY.md) and do not post details publicly.

There is no deadline and no obligation. Even "I opened it and could not tell what it was for" is a useful answer.
