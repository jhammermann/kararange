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
import threading
from catalogue_sources import artist_names, artist_key, artist_matches, cache_key, enrich_ranges, title_key

import requests

HERE = Path(__file__).resolve().parent
CACHE = HERE / 'popularity_cache.json'
REQUEST_LOCK = threading.Lock()


def lookup(row):
    title = row['title']
    short = re.sub(r'\([^)]*\)|\([^)]*$', '', title).strip()
    aliases = artist_names(row['artist'])[1:]
    queries = list(dict.fromkeys([row['artist'] + ' ' + title] + [name + ' ' + short for name in aliases] + [short]))
    pool = {}
    failure = None
    best_record = None
    for query in queries:
        data = None
        for attempt in range(3):
            try:
                with REQUEST_LOCK:
                    time.sleep(0.12)
                response = requests.get('https://api.deezer.com/search', params={'q': query, 'limit': 50}, timeout=20)
                response.raise_for_status()
                data = response.json()
                if 'error' in data:
                    raise ValueError(str(data['error']))
                break
            except (requests.RequestException, ValueError) as exc:
                failure = str(exc)
                data = None
                time.sleep(1 + attempt)
        if data is None:
            continue
        for track in data.get('data', []):
            if title_key(track.get('title_short', track['title']), True) != title_key(title, True):
                continue
            if re.search(r'karaoke|tribute|instrumental', track['artist']['name'] + ' ' + track.get('title_version', ''), re.I):
                continue
            if isinstance(track.get('rank'), int):
                pool[track['id']] = track
        # Film headings require credited original performers, not arbitrary soundtrack covers.
        def credited(track):
            names = [track['artist']['name']] + [a['name'] for a in track.get('contributors', [])]
            featured = re.search(r'(?:feat\.?|featuring|ft\.?)\s+([^\)\]]+)', track['title'], re.I)
            if featured:
                names.append(featured[1])
            if any(artist_matches(row['artist'], name) for name in names):
                return True
            return False
        matches = [t for t in pool.values() if credited(t)]
        if matches:
            # Album evidence can establish the performer for a differently credited release.
            performers = {artist_key(t['artist']['name']) for t in matches}
            matches.extend(t for t in pool.values() if artist_key(t['artist']['name']) in performers)
            best = max(matches, key=lambda t: t['rank'])
            if best_record and best_record['rank'] > best['rank']:
                continue
            best_record = dict(rank=best['rank'], url=best['link'], artist=best['artist']['name'], title=best['title'],
                        album=best['album']['title'], checked_at=datetime.now(timezone.utc).isoformat())
            if not aliases:
                return best_record
    if best_record:
        return best_record
    # Some real recordings are absent from general search but present in artist tops.
    try:
        response = requests.get('https://api.deezer.com/search/artist', params={'q': row['artist'], 'limit': 5}, timeout=20)
        response.raise_for_status()
        for artist in response.json().get('data', []):
            if not artist_matches(row['artist'], artist['name']) or re.search(r'karaoke|tribute', artist['name'], re.I):
                continue
            response = requests.get(f"https://api.deezer.com/artist/{artist['id']}/top", params={'limit': 100}, timeout=20)
            response.raise_for_status()
            matches = [t for t in response.json().get('data', [])
                       if title_key(t.get('title_short', t['title']), True) == title_key(title, True)
                       and isinstance(t.get('rank'), int)]
            if matches:
                best = max(matches, key=lambda t: t['rank'])
                return dict(rank=best['rank'], url=best['link'], artist=best['artist']['name'], title=best['title'],
                            album=best['album']['title'], lookup_method='artist_top', checked_at=datetime.now(timezone.utc).isoformat())
    except (requests.RequestException, ValueError) as exc:
        failure = str(exc)
    if not pool and failure:
        return {'error': failure}
    return dict(rank=None, url=None, checked_at=datetime.now(timezone.utc).isoformat())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true', help='Refresh cached popularity scores')
    parser.add_argument('--offline', action='store_true', help='Use cached scores only')
    args = parser.parse_args()
    rows = list(csv.DictReader((HERE.parent / 'catalogue_vocal_ranges.csv').open()))
    root_cache = json.loads((HERE.parent / 'vocal_range_cache.json').read_text())
    extra_path = HERE / 'range_sources.json'
    extra_sources = json.loads(extra_path.read_text()) if extra_path.exists() else {}
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    pending = [r for r in rows if args.refresh or cache.get(cache_key(r), {}).get('rank') is None]
    if not args.offline:
        with ThreadPoolExecutor(max_workers=4) as pool:
            for count, (row, result) in enumerate(zip(pending, pool.map(lookup, pending)), 1):
                if 'error' not in result:
                    cache[cache_key(row)] = result
                else:
                    print(f"Lookup failed: {row['artist']} / {row['title']}: {result['error']}", flush=True)
                if count % 25 == 0 or count == len(pending):
                    temporary = CACHE.with_suffix('.tmp')
                    temporary.write_text(json.dumps(cache, ensure_ascii=False, indent=2) + '\n')
                    temporary.replace(CACHE)
                    print(f'Popularity: {count}/{len(pending)}', flush=True)
    for row in rows:
        row['recordingArtist'] = cache.get(cache_key(row), {}).get('artist', '')
    manual = json.loads((HERE / 'range_review.json').read_text())
    manual_ranges = {(entry['artist'], entry['title']): entry for entry in manual}
    audit = enrich_ranges(rows, root_cache, extra_sources, manual_ranges)
    songs = []
    for row in rows:
        popularity = cache.get(cache_key(row), {})
        options = row['rangeOptions']
        primary = options[0] if options else {}
        songs.append(dict(title=row['title'], artist=row['artist'],
                          sourceArtist=primary.get('sourceArtist', row['source_artist']),
                          sourceTitle=primary.get('sourceTitle', row['source_title']), gender=row['gender'], leadSinger=row.get('leadSinger'),
                          range=primary.get('range'), source=primary.get('source'), rangeOptions=options,
                          rank=popularity.get('rank'), deezer=popularity.get('url')))
    songs.sort(key=lambda s: (-(s['rank'] if s['rank'] is not None else -1),
                              s['title'].casefold(), s['artist'].casefold()))
    dates = [v['checked_at'] for v in cache.values() if 'checked_at' in v]
    shown = [song for song in songs if song['rangeOptions']]
    payload = dict(updated=max(dates)[:10] if dates else None, songs=shown,
                   coverage=dict(total=len(rows), ranged=sum(bool(r['rangeOptions']) for r in rows),
                                 corrected=len(audit['corrections']), restored=len(audit['restored'])))
    audit['popularity_missing'] = [dict(artist=s['artist'], title=s['title']) for s in songs if s['rank'] is None]
    audit['source_conventions'] = dict(singing_carrots_note_index='C1=1, MIDI=index+23; song range invariant under user-range parameters',
        myvocalrange_male_notation='Published male notes are sounding pitch +12 semitones',
        calibration_probe='Iris: user ranges 17..41 and 41..65 both returned D3-A4 and song indices 27..46')
    (HERE / 'range_audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    (HERE / 'dist').mkdir(exist_ok=True)
    (HERE / 'dist' / 'songs.js').write_text(
        'window.catalogue = ' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(f"Built {len(shown)} songs with ranges; {sum(s['rank'] is not None for s in shown)} ranked; {len(songs) - len(shown)} missing-range songs omitted.")


if __name__ == '__main__':
    main()
