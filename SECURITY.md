# Security

## What Sniff Player can see and do

Sniff Player has no server and no analytics, and it sends nothing to its authors. Its permissions are broad because it has to see what any page loads, so here is what each one is for:

- **Access to all sites, and `webRequest`.** To see the responses of your tabs and recognise videos. It reads the URL and the response headers, not the content of the pages you visit. This access also gives it each tab's URL and title: it uses the URL to match requests from a page's service worker, and the title to name the player tab.
- **`webNavigation`.** To empty a tab's list when the tab goes to a new page.
- **`storage`.** To keep the list. It uses session storage only: the list isn't written to disk, and it's gone when you close the browser.
- **`declarativeNetRequestWithHostAccess`.** To set request headers for the player tab, as described below.
- **A script in every page.** It shows the buttons on the video under the pointer and handles <kbd>F2</kbd>, <kbd>F3</kbd> and <kbd>Esc</kbd>. It reads the page's video elements and nothing else, keeps nothing and sends nothing. Its buttons are in a closed shadow root, and only real presses count.
- **`scripting`.** For **Play in the page**, an experimental setting that is off unless you turn it on, and for the Sniff Player button on a video. When a video is found in a frame, or you press the button, the extension puts a script into that frame. The script finds the video that loaded it, reads the page's title and the heading near the video to name it, pauses the site's player and builds Sniff Player in its place. The setting itself is kept in the browser's local storage.

## What it sends to the sites you visit

- **An extra read of each playlist.** When a page loads a playlist, the extension reads that URL once more, to learn its qualities and length. A site can tell this read happened, and so can guess that the extension is installed. It carries no cookies, follows no redirects and doesn't name the extension. If the host refuses it with 401 or 403, it's sent once more with the origin of the page that loaded the playlist.
- **The player's requests.** When you press Play, the player requests the video and carries your cookies to the video's host and its subdomains only. Cookies are removed from requests to any other host a playlist names, and those hosts can't set cookies on you. HTTP sign-ins and client certificates you have already given the browser aren't covered by this.
- **The page's origin, when a host refuses.** If a host answers the player with 401 or 403, or a video file fails to load, the player sends that host and its subdomains the origin of the page where the video was found, once per host. This applies to that player tab's own requests only, not to other tabs or to other sites you open later in that tab.

## Play in the page

- **The player in a page is part of that page.** It's built in a closed shadow root, which the page's scripts can't reach, but its requests are the page's own: the same cookies, origin and referrer the site's player would send. So it can't reach anything the page couldn't. None of the player tab's header rules apply.
- **Sites can tell.** A page can see that a player was swapped in, and so that the extension is installed and the setting is on.
- **Filling the window from a frame needs a real press.** A frame inside a page can't use it to cover the page around it on its own.
- **Only real key presses count.** Keys a page sends from script are ignored.
- **The Sniff Player button plays what that page loaded.** Not a video an earlier page in the same frame loaded.

## Keep in mind

- Web pages can't open the player or read the extension's files.
- A video plays with your cookies for its own host, like opening its link in a tab. A malicious page can add a row for another site to the list, so press Play only on rows you recognise. The same goes for pasted URLs.
- After you press Play, a playlist decides which addresses the player requests, including ones on your local network. Those requests carry no cookies.
- URLs you play appear in the player tab's address, so they can stay in your browser history, with any tokens in them.
- The extension isn't available in Incognito windows.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Email [support@v-ax.com](mailto:support@v-ax.com) instead. You can also use GitHub's **Report a vulnerability** button on this repository.

Include Sniff Player, the version shown in `chrome://extensions`, your browser and its version, minimal steps to reproduce, and the expected and observed results. Use a test stream and fictional data where possible, and redact sensitive information from errors or screenshots.

Do not send passwords, tokens, cookies, private keys, account data, raw private logs, or video URLs that carry sign-in tokens. Include only the information needed to reproduce the problem.

For ordinary usage questions and non-sensitive bugs, use this repository's issue tracker.
