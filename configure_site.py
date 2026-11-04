#!/usr/bin/env python3
"""Set the public URL in the static site's canonical metadata and sitemap."""
import argparse
from html import escape
from pathlib import Path
import re
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', help='Public HTTPS base URL, including any subdirectory')
    args = parser.parse_args()
    parts = urlsplit(args.url)
    if (parts.scheme != 'https' or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.query or parts.fragment
            or any(character.isspace() for character in args.url)
            or any(character in args.url for character in '<>"\\')):
        parser.error('Use an HTTPS base URL without credentials, query parameters, or a fragment.')
    url = args.url.rstrip('/') + '/'
    dist = Path(__file__).resolve().parent / 'dist'
    page = dist / 'index.html'
    html = page.read_text(encoding='utf-8')
    metadata = (f'<!-- Public URL: start -->\n'
                f'<link rel="canonical" href="{escape(url, quote=True)}">\n'
                f'<meta property="og:url" content="{escape(url, quote=True)}">\n'
                f'<!-- Public URL: end -->')
    html, count = re.subn(r'<!-- Public URL: start -->.*?<!-- Public URL: end -->',
                          lambda _: metadata, html, flags=re.DOTALL)
    if count != 1:
        parser.error('Expected one public URL block in dist/index.html; no files changed.')
    page.write_text(html, encoding='utf-8')
    (dist / 'sitemap.xml').write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f'  <url><loc>{escape(url)}</loc></url>\n'
        '</urlset>\n', encoding='utf-8')
    (dist / 'robots.txt').write_text(
        f'User-agent: *\nAllow: /\n\nSitemap: {url}sitemap.xml\n', encoding='utf-8')
    print(f'Configured canonical URL and sitemap for {url}')


if __name__ == '__main__':
    main()
