# Kara Range

Find karaoke songs that fit your vocal range. A static HTML, CSS, and JavaScript
site with bundled song data, a keyboard-accessible range slider, and piano samples.

## Public hosting

GitHub Pages address: <https://jhammermann.github.io/kararange/>.
The workflow in `.github/workflows/pages.yml` publishes `dist/` after each push
to `main`, or when run manually from the Actions tab. Enable it in repository
**Settings → Pages → Build and deployment → Source → GitHub Actions**.
GitHub Free requires a public repository; private repositories need a plan that
supports Pages. The workflow sets SEO URLs from the actual Pages configuration,
including a custom domain if one is added later.

Publish **only `dist/`** as the site's document root. No build command, backend,
API key, package installation, or runtime network lookup is required. All assets
use relative paths, so hosting under a subdirectory also works.

Preview from this repository:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Open <http://localhost:8000>. Opening `dist/index.html` directly also works.

Once the public HTTPS URL is known, run this command with the real address:

```sh
python3 configure_site.py https://your-domain.example/
```

This sets the canonical URL and Open Graph URL, generates `dist/sitemap.xml`,
and adds its location to `dist/robots.txt`. Include any hosting subdirectory in
the URL. Rerun if the address changes, then publish the updated `dist/` files.
For subdirectory hosting, place the robots directives in the domain's root
`robots.txt` if you control it; search engines look for that file at the root.

The page includes a descriptive title, meta description, social sharing metadata,
WebApplication structured data, and introductory text available without JavaScript.
Interactive search requires JavaScript. After publishing, verify the site in
[Google Search Console](https://search.google.com/search-console/about) and submit
the sitemap. SEO improves discoverability but does not guarantee indexing or rank;
see [Google's SEO guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

The existing `.openai/hosting.json` records the Sites project and its `dist/`
publish directory. Other static hosts can use `dist/` directly.

## Data maintenance

The committed `dist/songs.js` is ready to serve. Rebuilding it is optional and
requires the original `catalogue_vocal_ranges.csv` and `vocal_range_cache.json`
in the parent directory, plus Python's `requests` package. These source inputs
are not part of this website repository. With those files available:

```sh
python3 build_catalogue.py --offline
```

Omit `--offline` to fetch missing Deezer popularity scores, or use `--refresh`
to refresh them. Keep the caches and audit files outside the published directory.

Ranges come from Singing Carrots and MyVocalRange; arrangements and source
accuracy vary. Missing ranges are omitted, alternative arrangements are checked
separately, and MyVocalRange male parts are converted to sounding pitch.
`range_audit.json` documents corrections. Popularity is Deezer's indicator,
not a play count. “Keep energetic” requires shifted versions to peak within
three semitones of the selected upper note; it does not measure chorus energy.

The Sky background and Trebuchet title font are fixed. No appearance preferences
are read or stored. Search and filtering run in the browser.

## Third-party credits

- noUiSlider 15.8.1: [MIT license](dist/vendor/nouislider.LICENSE.md).
- Salamander Grand Piano by Alexander Holm:
  [CC BY 3.0 attribution and sample details](dist/vendor/piano.LICENSE.md).

Keep these license files and the piano attribution with published copies.
