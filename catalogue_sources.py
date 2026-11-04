"""Conservative recording-credit matching and source-specific vocal-range notation."""
from collections import defaultdict
import re
import unicodedata
from urllib.parse import quote

ALIASES = {
    'pink': ['P!nk'], 'thechicks': ['Dixie Chicks'], 'fantasiabarrino': ['Fantasia'],
    'johnanderson': ['John David Anderson'], 'koolandthegang': ['Kool & The Gang'],
    'thebodyguard': ['Whitney Houston'], '8mile': ['Eminem'],
    'hannahmontanathemovie': ['Miley Cyrus'], 'jamesbond': ['Adele'],
    'victorious': ['Victoria Justice'], 'pitchperfect': ['Anna Kendrick'],
    'cars': ['Rascal Flatts'], 'footloose1984film': ['Kenny Loggins', 'Bonnie Tyler', 'John Mellencamp'],
    'kpopdemonhunters': ['HUNTR/X', 'Saja Boys'],
    'korn': ['KoЯn'], 'frozen2013film': ['Idina Menzel', 'Kristen Bell', 'Santino Fontana'],
    'obrotherwhereartthou': ['The Soggy Bottom Boys'],
    'thewizardofoz': ['Judy Garland'], 'greasefilm': ['John Travolta', 'Olivia Newton-John'],
    'scoobydoo': ['Simple Plan'],
    'astarisborn2018film': ['Lady Gaga', 'Bradley Cooper'],
    'aladdin1992film': ['Brad Kane', 'Lea Salonga', 'Peabo Bryson', 'Regina Belle'],
    'hocuspocusfilm': ['Bette Midler'], 'moana': ["Auli'i Cravalho", 'Dwayne Johnson'],
    'mulan': ['Donny Osmond'], 'tangled': ['Mandy Moore', 'Zachary Levi'],
    'thegreatestshowman': ['Loren Allred', 'Ziv Zaifman', 'Hugh Jackman', 'Zac Efron', 'Zendaya'],
    'thelionking1994film': ['Jason Weaver', 'Nathan Lane', 'Ernie Sabella', 'Elton John', 'Joseph Williams'],
    'thelittlemermaid1989film': ['Jodi Benson', 'Pat Carroll', 'Samuel E. Wright'],
    'thephantomoftheoperamusical': ['Michael Crawford', 'Sarah Brightman', 'Andrew Lloyd Webber'],
    'wickedmusical': ['Idina Menzel', 'Kristin Chenoweth'],
}


def normalize(value):
    value = unicodedata.normalize('NFKD', value.casefold().replace('&', ' and '))
    return ''.join(c for c in value if c.isalnum() and not unicodedata.combining(c))


def artist_names(name):
    return [name] + ALIASES.get(normalize(name), [])


def artist_key(name):
    name = re.sub(r'\([^)]*(?:film|musical|band|\?)[^)]*\)|\[\d{4}\]', '', name, flags=re.I)
    name = re.sub(r'\b(?:the|and)\b', '', name.replace('&', ' and '), flags=re.I)
    return normalize(name)


def artist_matches(a, b):
    years_a, years_b = set(re.findall(r'\b(?:19|20)\d{2}\b', a)), set(re.findall(r'\b(?:19|20)\d{2}\b', b))
    if years_a and years_b and years_a.isdisjoint(years_b):
        return False
    for x in artist_names(a):
        for y in artist_names(b):
            ka, kb = artist_key(x), artist_key(y)
            if ka and kb and (ka == kb or (min(len(ka), len(kb)) >= 6 and (ka.startswith(kb) or kb.startswith(ka)))):
                return True
    return False


def title_key(title, popularity=False):
    title = re.sub(r'f\*+k', 'fuck', title, flags=re.I)
    if popularity:
        title = re.sub(r'\([^)]*\)|\[[^]]*\]|\([^)]*$', '', title)
        title = re.split(r'\s+(?:feat\.?|featuring|ft\.?)\s+|\s+-\s+(?:.*remaster|.*version|.*mix|.*edit|live).*', title, flags=re.I)[0]
    else:
        title = re.sub(r'\((?:main|album|single) version\)|\(solo\)', '', title, flags=re.I)
        if title.count('(') > title.count(')'):
            title = title.split('(')[0]
    title = re.sub(r'^somewhere\s+over the rainbow$', 'Over the Rainbow', title.strip(), flags=re.I)
    return normalize(re.sub(r'^the\s+', '', title.strip(), flags=re.I))


def cache_key(row):
    return row.get('source_url') or 'catalogue:' + row['artist'] + ' / ' + row['title']


def pitch(note):
    match = re.fullmatch(r'([A-G])([#b]{0,2})(\d)', note.strip())
    if not match:
        raise ValueError('Invalid note: ' + note)
    return (int(match[3]) + 1) * 12 + dict(C=0, D=2, E=4, F=5, G=7, A=9, B=11)[match[1]] + match[2].count('#') - match[2].count('b')


def note(midi):
    return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12] + str(midi // 12 - 1)


def shifted_range(value, shift):
    return '; '.join('-'.join(note(pitch(n) + shift) for n in part.strip().split('-')) for part in value.split(';'))


def source_records(root_cache, extra_sources):
    carrots, vocal = {}, {}
    for url, response in root_cache.items():
        if isinstance(response['data'], list):
            for item in response['data']:
                song = item.get('song', {})
                if song.get('id') and song.get('voices') and song.get('artist') and song.get('title'):
                    value = dict(artist=song['artist'], title=song['title'], ranges='; '.join(song['voices']),
                                 key=song.get('key', ''), gender=song.get('gender', 'U'),
                                 source_url='https://singingcarrots.com/song?song=' + quote(song['id']),
                                 source='Singing Carrots', updated=song.get('lastUpdated', ''))
                    old = carrots.get(song['id'])
                    if not old or old['updated'] < value['updated']:
                        carrots[song['id']] = value
    for response in extra_sources.values():
        for song in response.get('songs', []):
            vocal[(song['artist'], song['title'], song['ranges'])] = song
    return list(carrots.values()), list(vocal.values())


def enrich_ranges(rows, root_cache, extra_sources, manual_ranges=None):
    carrots, vocal = source_records(root_cache, extra_sources)
    genders = defaultdict(set)
    for song in carrots:
        if song['gender'] in ('M', 'F'):
            genders[artist_key(song['artist'])].add(song['gender'])
    by_title, vocal_title = defaultdict(list), defaultdict(list)
    for song in carrots:
        by_title[title_key(song['title'])].append(song)
    for song in vocal:
        vocal_title[title_key(song['title'])].append(song)
    audit = dict(total=len(rows), corrections=[], uncertain=[], unknown=[], restored=[], multiple_ranges=[])
    manual_ranges = manual_ranges or {}
    for row in rows:
        names = [row['artist']] + ([row['recordingArtist']] if row.get('recordingArtist') else [])
        candidates = [s for s in by_title[title_key(row['title'])] if any(artist_matches(name, s['artist']) for name in names)]
        my_matches = [s for s in vocal_title[title_key(row['title'])] if any(artist_matches(name, s['artist']) for name in names)]
        labels = {s['gender'] for s in candidates if s['gender'] in ('M', 'F')}
        if not labels:
            for display in names:
                for name in artist_names(display):
                    labels.update(genders[artist_key(name)])
        gender = next(iter(labels)) if len(labels) == 1 else 'U'
        options = []
        # MyVocalRange explicitly defines its male notation as sounding pitch +12.
        for source in candidates:
            value = source['ranges']
            try:
                shifted_range(value, 0)
            except ValueError:
                continue
            correction, evidence = 0, None
            for other in my_matches:
                if (row['artist'], row['title']) not in {('Coldplay', 'Viva La Vida'), ('Johnny Cash', 'Ring of Fire')}:
                    continue
                if gender not in ('M', 'F') or not source['key'] or not other['key'] or normalize(source['key']) != normalize(other['key']):
                    continue
                sounding = shifted_range(other['ranges'], -12 if gender == 'M' else 0)
                for shift in (-12, 12):
                    if shifted_range(value, shift) == sounding:
                        correction, evidence = shift, other['source_url']
                        break
                if evidence:
                    break
            adjusted = shifted_range(value, correction) if correction else value
            option = dict(range=adjusted, publishedRange=value, source=source['source_url'],
                          sourceArtist=source['artist'], sourceTitle=source['title'], key=source['key'])
            if correction:
                option['note'] = 'Octave corrected against MyVocalRange notation; source arrangements may differ.'
                audit['corrections'].append(dict(artist=row['artist'], title=row['title'],
                    published=value, range=adjusted, semitones=correction,
                    source=source['source_url'], evidence=evidence, key=source['key']))
            options.append(option)
        # Restore additional published ranges with a known source notation.
        if not options and gender in ('M', 'F'):
            for source in my_matches:
                value = shifted_range(source['ranges'], -12 if gender == 'M' else 0)
                options.append(dict(range=value, publishedRange=source['ranges'], source=source['source_url'],
                    sourceArtist=source['artist'], sourceTitle=source['title'],
                    note='MyVocalRange: male notation converted down one octave.' if gender == 'M' else 'MyVocalRange published female range.'))
        # The two previously matched MyVocalRange songs have explicit female source metadata.
        if not options and row['source'] == 'MyVocalRange':
            options.append(dict(range=row['vocal_ranges'], publishedRange=row['vocal_ranges'],
                source=row['source_url'], sourceArtist=row['source_artist'], sourceTitle=row['source_title'],
                note='Published range; source convention should be checked.'))
        unique = {o['range']: o for o in options}
        options = list(unique.values())
        if len(options) > 1:
            audit['multiple_ranges'].append(dict(artist=row['artist'], title=row['title'], ranges=[o['range'] for o in options]))
            for option in options:
                option['note'] = 'Alternative published arrangement; range varies between sources.'
        manual = manual_ranges.get((row['artist'], row['title']))
        if manual and options:
            if manual.get('range'):
                previous = options[0]['range']
                options = [dict(options[0], range=manual['range'], note=manual['reason'], evidence=manual.get('evidence'))]
                audit['corrections'].append(dict(artist=row['artist'], title=row['title'], published=previous, range=manual['range'], evidence=manual.get('evidence'), reason=manual['reason']))
            elif manual.get('guess'):
                for option in options:
                    option['uncertain'] = True
                    option['guessedRange'] = manual['guess']
                    option['note'] = manual['reason']
                    if manual.get('evidence'):
                        option['evidence'] = manual['evidence']
                audit['uncertain'].append(dict(artist=row['artist'], title=row['title'], ranges=[o['range'] for o in options], guess=manual['guess'], reason=manual['reason'], evidence=manual.get('evidence')))
            gender = manual.get('gender', gender)
            row['leadSinger'] = manual.get('leadSinger')
        row.update(gender=gender if gender in ('M', 'F') else 'B', rangeOptions=options)
        if options and row['status'] != 'matched':
            audit['restored'].append(dict(artist=row['artist'], title=row['title']))
        if not options:
            audit['unknown'].append(dict(artist=row['artist'], title=row['title']))
    return audit
