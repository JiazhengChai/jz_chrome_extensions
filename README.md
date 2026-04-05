# Chrome Extensions

This workspace contains two unpacked Chrome extensions:

- `image-downloader`: collects image URLs from the current page and lets you either queue normal downloads or export the selection as one ZIP.
- `page-to-markdown`: extracts readable page text and saves it as a Markdown file.

Each extension now includes its own generated icon set in `icons/` for the toolbar and extension management page.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select either `image-downloader` or `page-to-markdown`.

## Permissions

Both extensions use Manifest V3.

- `activeTab` and `scripting`: read the current page when you click the extension.
- `downloads`: save files to disk.
- `host_permissions` on `image-downloader`: fetch image bytes from page asset URLs so selected files can be bundled into one ZIP.

## Notes

- The image downloader now looks at regular images, common lazy-load attributes, `srcset` candidates, video posters, and CSS background images. You can either queue normal per-file downloads or bundle the selected set into one ZIP archive.
- The Markdown exporter now scores likely article containers and converts more page structure into Markdown, including headings, paragraphs, lists, blockquotes, code blocks, tables, and image alt text.
- Downloads are grouped into extension-specific folders with page-identifiable names. The folder and Markdown filename now also include URL-derived hints when the page title is too generic, which helps keep app pages like chat conversations distinct.
- Some websites restrict asset downloads with cookies, expiring URLs, or CSP. In those cases, behavior depends on the site.
