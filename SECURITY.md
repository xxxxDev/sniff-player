# Security

## What Sniff Player can see and do

Sniff Player has no server and no analytics, and it sends nothing to its authors. Its permissions are broad because it has to see what any page loads, so here is what each one is for:

- **Access to all sites, and `webRequest`.** To see the responses of your tabs and recognise videos. It reads the URL and the response headers, not the content of the pages you visit. This access also gives it each tab's URL and title: it uses the URL to match requests from a page's service worker, and the title to name the player tab.
- **`webNavigation`.** To empty a tab's list when the tab goes to a new page.
- **`storage`.** To keep the list. It uses session storage only: the list isn't written to disk, and it's gone when you close the browser.
- **`declarativeNetRequestWithHostAccess`.** To set request headers for the player, as described below.

## What it sends to the sites you visit

- **An extra read of each playlist.** When a page loads a playlist, the extension reads that URL once more, to learn its qualities and length. A site can tell this read happened, and so can guess that the extension is installed. It carries no cookies, follows no redirects and doesn't name the extension. If the host refuses it with 401 or 403, it's sent once more with the origin of the page that loaded the playlist.
- **The player's requests.** When you press Play, the player requests the video and carries your cookies to the video's host and its subdomains only. Cookies are removed from requests to any other host a playlist names, and those hosts can't set cookies on you. HTTP sign-ins and client certificates you have already given the browser aren't covered by this.
- **The page's origin, when a host refuses.** If a host answers the player with 401 or 403, or a video file fails to load, the player sends that host and its subdomains the origin of the page where the video was found, once per host. This applies to that player tab's own requests only, not to other tabs or to other sites you open later in that tab.

## Keep in mind

- Web pages can't open the player or read the extension's files.
- A video plays with your cookies for its own host, like opening its link in a tab. A malicious page can add a row for another site to the list, so press Play only on rows you recognise. The same goes for pasted URLs.
- After you press Play, a playlist decides which addresses the player requests, including ones on your local network. Those requests carry no cookies.
- URLs you play appear in the player tab's address, so they can stay in your browser history, with any tokens in them.
- The extension isn't available in Incognito windows.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Use GitHub's **Report a vulnerability** button on this repository, with steps to reproduce and the version you use.

We will acknowledge the report, work on a fix, and credit you in the release notes unless you prefer otherwise.
