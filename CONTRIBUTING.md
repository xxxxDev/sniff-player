# Contributing

Thanks for helping. Sniff Player is a small project, so a short, focused change is the easiest to review.

## Before you start

- For a bug, open an issue with what you did, what you expected and what happened, plus the version shown in `chrome://extensions`.
- For a larger change or a new feature, open an issue first so we can agree on the approach.
- For a security problem, follow [SECURITY.md](SECURITY.md) instead.

Please don't report problems with a specific site's content, and don't name sites that host content without permission. A test stream that reproduces the problem is what helps.

## Development

There's no build step. Load the `extension` folder with **Load unpacked** in `chrome://extensions`, and press its reload button after a change.

```sh
npm run package   # packs extension/ into dist/
npm run icons     # makes the icon sizes from assets/icon-original.png (macOS)
```

The project's test suite is maintained separately and is not part of this repository. In your pull request, describe how you checked the change: what you ran, on which browser, and what you saw.

## Guidelines

- Match the style of the code around your change.
- Explain any behaviour you change, especially anything about permissions, cookies, or what's sent to a site, so it can be checked.
- Text shown to people goes in `extension/_locales`, in English and Traditional Chinese.
- Code comments are in English and say why, not what.
- Downloading and getting around DRM are out of scope for this project.
