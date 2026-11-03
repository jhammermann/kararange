#!/usr/bin/env python3
"""Build static song data from the existing CSV and public Deezer popularity scores."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time
import unicodedata

import requests

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'popularity_cache.json'


def normalize(value):
    value = unicodedata.normalize('NFKD', value.casefold().replace('&', 'and'))
    return ''.join(c for c in value if c.isalnum() and not unicodedata.combining(c))


def recording_title(value):
    # Accept remasters, but retain arrangement labels such as live or acoustic.
    return re.sub(r'\s*[(-]\s*(?:(?:\d{4}\s+)?(?:re)?master(?:ed)?(?:\s+(?:version|edition|\d{4}))?)\s*\)?$',
                  '', value, flags=re.I).strip()


def lookup(row):
    query = row['source_artist'] + ' ' + row['source_title']
    for attempt in range(3):
        try:
            response = requests.get('https://api.deezer.com/search',
                                    params={'q': query, 'limit': 25}, timeout=20)
            response.raise_for_status()
            data = response.json()
            if 'error' in data:
                raise ValueError(str(data['error']))
            matches = [t for t in data['data']
                       if normalize(t['artist']['name']) == normalize(row['source_artist'])
                       and normalize(recording_title(t['title'])) == normalize(row['source_title'])
                       and isinstance(t.get('rank'), int)]
            best = max(matches, key=lambda t: t['rank']) if matches else None
            return dict(rank=best['rank'] if best else None,
                        url=best['link'] if best else None,
                        checked_at=datetime.now(timezone.utc).isoformat())
        except (requests.RequestException, ValueError, KeyError) as exc:
            if attempt == 2:
                return {'error': str(exc)}
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Refresh cached popularity scores')
    parser.add_argument('--offline', action='store_true', help='Use cached scores only')
    args = parser.parse_args()
    rows = [r for r in csv.DictReader((HERE.parent / 'catalogue_vocal_ranges.csv').open())
            if r['status'] == 'matched' and r['source'] == 'Singing Carrots']
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    pending = [r for r in rows if args.refresh or r['source_url'] not in cache]
    if not args.offline:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for count, (row, result) in enumerate(zip(pending, pool.map(lookup, pending)), 1):
                if 'error' not in result:
                    cache[row['source_url']] = result
                else:
                    print(f"Lookup failed: {row['artist']} / {row['title']}: {result['error']}", flush=True)
                if count % 25 == 0 or count == len(pending):
                    temporary = CACHE.with_suffix('.tmp')
                    temporary.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + '\n')
                    temporary.replace(CACHE)
                    print(f'Popularity: {count}/{len(pending)}', flush=True)
    songs = []
    for row in rows:
        popularity = cache.get(row['source_url'], {})
        songs.append(dict(title=row['title'], artist=row['artist'],
                          range=row['vocal_ranges'], source=row['source_url'],
                          rank=popularity.get('rank'), deezer=popularity.get('url')))
    songs.sort(key=lambda s: (-(s['rank'] if s['rank'] is not None else -1),
                              s['title'].casefold(), s['artist'].casefold()))
    dates = [v['checked_at'] for v in cache.values() if 'checked_at' in v]
    payload = dict(updated=max(dates)[:10] if dates else None, songs=songs)
    (HERE / 'dist').mkdir(exist_ok=True)
    (HERE / 'dist' / 'songs.js').write_text(
        'window.catalogue = ' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f"Built {len(songs)} songs; {sum(s['rank'] is not None for s in songs)} ranked.")


if __name__ == '__main__':
    main()
