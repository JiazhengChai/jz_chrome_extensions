# Chrome Extensions

This workspace contains two unpacked Chrome extensions:

- `image-downloader`: collects image URLs from the current page and lets you either queue normal downloads or export the selection as one ZIP.
- `page-to-markdown`: extracts readable page text and saves it as Markdown or through a print-friendly PDF flow.

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
- `storage` on `page-to-markdown`: pass generated content into its print-friendly PDF preview tab.
- `host_permissions` on `image-downloader`: fetch image bytes from page asset URLs so selected files can be bundled into one ZIP.

## Notes

- The image downloader now looks at regular images, common lazy-load attributes, `srcset` candidates, video posters, and CSS background images. You can either queue normal per-file downloads or bundle the selected set into one ZIP archive.
- The Markdown exporter now scores likely article containers and converts more page structure into Markdown, including headings, paragraphs, lists, blockquotes, code blocks, tables, and image alt text.
- The page-to-markdown popup can also open a dedicated print layout and trigger the browser print dialog so you can save the extracted content as a PDF.
- Downloads are grouped into extension-specific folders with page-identifiable names. The Markdown filename now keeps a readable page slug and adds a short URL-based hash so similarly titled pages stay distinct, which helps keep app pages like chat conversations separate.
- Some websites restrict asset downloads with cookies, expiring URLs, or CSP. In those cases, behavior depends on the site.
