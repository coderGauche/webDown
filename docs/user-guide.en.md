# SiteCapsule User Guide

> Applies to: version 0.1.0 engineering trial
> Status: restricted engineering use only; the MVP release gate has not been met.

SiteCapsule packages the final DOM and discovered resources of the current Chrome tab into a ZIP
for offline review, research, and backup. This version captures one current page; it does not crawl
or mirror an entire website.

## Create an archive

1. Open a public HTTP or HTTPS page that you are authorized to save and wait for its main content.
2. Select the SiteCapsule extension icon to open the side panel.
3. Select English or Chinese, then choose **Use current page** or **Refresh page**.
4. Approve the current-site request when Chrome prompts. SiteCapsule reads the title, final DOM,
   and resource discoveries.
5. Review the ZIP file name and capture options:
   - Render wait: 0-30,000 ms. Increase it for a page that renders late.
   - Concurrent downloads: 1-12; the default is 6.
   - Offline animations and interactions: off by default. When enabled, archived scripts run under
     a CSP sandbox that blocks external network access. This experimental mode can restore some
     animation but may break pages that require source-site routing or APIs.
   - Media files: off by default. Enabling video or audio can use substantial memory and time.
   - Archive-critical third-party resources: on by default. Critical CSS, image, font, script, and
     related hosts are preselected; choose **Grant selected** to let Chrome request only those exact
     hosts. Tracking, payment, iframe, and other runtime-only hosts remain excluded.
6. Choose **Create archive**. A running task can be paused, resumed, or cancelled; a failed task can
   be retried when the UI offers that action.
7. When **Archive ready** appears, choose **Download ZIP** before reloading or closing the extension.

A third-party host grant is not permission to crawl that host. SiteCapsule requests exact host
access only for archive-critical origins discovered for the current task. An ordinary task cannot
start while a critical host remains unapproved. You may explicitly turn off archive-critical
third-party resources and continue, but the UI warns that the archive may be incomplete.

When reading a page, SiteCapsule sanitizes only the cloned DOM used by the archive. It removes
resource nodes injected by other browser extensions, explicit tracking or payment runtime, and
ordinary iframes that cannot work independently offline; self-contained `srcdoc` iframes remain.
**Capture diagnostics** reports removal counts by reason. The source tab is not modified.

The experimental interactive mode executes scripts saved in the ZIP and inline page scripts. It rewrites
saved static imports, generated module dependency tables, static assets nested in `JSON.parse` data,
Workers, WASM/asset URLs, and literal `fetch` references to archive paths. The
archive CSP allows only same-origin local resources and blocks external scripts, remote connections,
form submission, and Service Worker registration. The default, with **Offline animations and
interactions** off, freezes executable scripts and preserves only the captured final DOM. Unsaved asset
references are removed or neutralized and remain explained in the failure manifest.

## View an archive offline

1. Extract the ZIP into a normal local directory.
2. For a simple static page, first try opening `index.html` directly.
3. ES modules, absolute paths, browser security policies, or `file://` restrictions may prevent
   direct opening. The more reliable option is a loopback-only HTTP server from the extracted root:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

4. Open `http://127.0.0.1:8000/` and press `Ctrl+C` in the terminal when finished.

Do not publish the extracted directory on a public server unless you have the right to redistribute
all included material and have reviewed its security. A ZIP may contain script files from the
source site; even though the offline entry disables their execution by default, archived content is
not automatically trusted code.

## Local tasks

- Task state and resource metadata are stored locally in the browser and can be reviewed or cleared
  under **Local tasks**.
- ZIP bytes exist only in the current extension runtime session. After a Service Worker restart,
  extension reload, or browser state change, history may show **metadata only**. Run the archive
  again to download another ZIP.
- **Clear history** removes terminal local job records while preserving active jobs.

## Troubleshooting

- **This page does not allow the content script**: switch to a normal HTTP/HTTPS page. `chrome://`,
  Chrome Web Store, extension pages, and some protected pages cannot be captured.
- **The page navigated during capture**: wait for a stable page, read it again, and create a new task.
- Missing third-party assets: enable archive-critical third-party resources, grant the preselected
  required hosts, and retry.
- A large page remains in downloading: disable media, reduce third-party resources, or lower
  concurrency and retry.
- The extracted page is blank or resolves an incorrect path: use the local HTTP server above and
  review the known limitations if the problem remains.

See [Known Limitations](./known-limitations.md) and the [Privacy Notice](./privacy.md).
