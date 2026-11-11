# Security

JARVIS can type, click, run apps and read your clipboard, so it is local-only by design:
it binds to `127.0.0.1`, rejects requests whose `Origin`/`Host` aren't localhost, never builds shell
commands from text, and limits file actions to your home folder. **Never expose it to the internet.**

## Reporting a vulnerability
Please **don't** open a public issue. Use GitHub's *Security → Report a vulnerability* on this repository,
or email the maintainer listed in `package.json`. You'll get a reply within a few days.

Particularly interested in: ways for a web page or another host to reach the WebSocket/API, command or
AppleScript injection, and path traversal outside the home folder.
