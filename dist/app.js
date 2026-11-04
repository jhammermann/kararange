'use strict';
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const get = id => document.getElementById(id);
const low = get('low'), high = get('high');
let sortMode = 'popularity';

function pitch(note) {
  const match = /^([A-G])([#b]{0,2})(\d)$/.exec(note);
  if (!match) return NaN;
  const offset = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
  return (+match[3] + 1) * 12 + offset[match[1]] + [...match[2]].reduce((sum, c) => sum + (c === '#' ? 1 : -1), 0);
}

function note(midi) {
  return names[midi % 12] + (Math.floor(midi / 12) - 1);
}

function normalize(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ø/g, 'o')
    .replace(/[&+]/g, ' and ').replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\bn\b/g, 'and');
}

// Damerau-Levenshtein: includes the adjacent letter swaps common in typing errors.
function distance(a, b) {
  const grid = Array.from({length: a.length + 1}, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) grid[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        grid[i][j] = Math.min(grid[i][j], grid[i - 2][j - 2] + 1);
      }
    }
  }
  return grid[a.length][b.length];
}

function indexSong(song) {
  const fields = [song.artist, song.title, song.sourceArtist || '', song.sourceTitle || ''].map(normalize);
  const options = (song.rangeOptions || (song.range ? [{range: song.range, source: song.source}] : [])).map(option => {
    const voices = option.range.split(';').map(voice => voice.trim().split('-').map(pitch));
    return {...option, bottom: Math.min(...voices.map(r => r[0])), top: Math.max(...voices.map(r => r[1]))};
  }).filter(option => Number.isFinite(option.bottom) && Number.isFinite(option.top));
  return {...song, fields, words: [...new Set(fields.flatMap(f => [...f.split(' '), f.replace(/ /g, '')]).filter(Boolean))],
    options, ...(options[0] || {bottom: null, top: null})};
}

function matchesQuery(song, query) {
  if (!query) return true;
  const compact = query.replace(/ /g, '');
  if (song.fields.some(field => field.replace(/ /g, '').includes(compact))) return true;
  const tokens = query.split(' ').filter(t => t && t !== 'by');
  if (!tokens.length) return true;
  return tokens.every(token => song.words.some(word => {
    if (word === token || word.startsWith(token)) return true;
    if (token.length < 4) return false;
    const tolerance = token.length < 6 ? 1 : 2;
    if (Math.abs(token.length - word.length) > tolerance) return false;
    return distance(token, word) <= tolerance;
  }));
}

function fitSong(song, bottom, top, octaves, energetic) {
  if (!song.options.length) return null;
  for (const octave of octaves) {
    for (const option of song.options) {
      const a = option.bottom + 12 * octave, b = option.top + 12 * octave;
      if (a >= bottom && b <= top && (octave === 0 || !energetic || top - b <= 3)) {
        return {...song, ...option, bottom: a, top: b, octave};
      }
    }
  }
  return null;
}

function popularity(a, b) {
  return (b.rank ?? -1) - (a.rank ?? -1) || a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist);
}

function comparePower(a, b) {
  return a.top - b.top || a.bottom - b.bottom;
}

function compareSongs(a, b) {
  if (sortMode === 'popularity-asc') {
    if (a.rank === null || b.rank === null) return (a.rank === null) - (b.rank === null) || popularity(a, b);
    return a.rank - b.rank || a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist);
  }
  if (sortMode === 'popularity') return popularity(a, b);
  if (a.top === null || b.top === null) return (a.top === null) - (b.top === null) || popularity(a, b);
  return (sortMode === 'range-asc' ? 1 : -1) * comparePower(a, b) || popularity(a, b);
}

function colorScale(t, stops) {
  t = Math.max(0, Math.min(1, t));
  const upper = stops.findIndex(([position]) => position >= t);
  if (upper === 0) return `rgb(${stops[0][1].join(', ')})`;
  const [a, start] = stops[upper - 1], [b, end] = stops[upper];
  return `rgb(${start.map((value, i) => Math.round(value + (end[i] - value) * (t - a) / (b - a))).join(', ')})`;
}

function powerColor(song, bottom, top) {
  // Encoding preserves highest-note priority even when lowest notes differ.
  const span = top - bottom;
  const t = span ? Math.max(0, Math.min(1,
    ((song.top - bottom) * 128 + song.bottom - bottom) / (span * 129))) : 1;
  return colorScale(t, [[0, [230, 40, 40]], [0.5, [245, 210, 40]], [1, [0, 255, 0]]]);
}

function popularityColor(rank) {
  return colorScale(rank / 1000000, [[0, [230, 40, 40]], [0.5, [245, 210, 40]], [1, [0, 255, 0]]]);
}

function link(text, url) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = url;
  return a;
}

const catalogue = window.catalogue ? window.catalogue.songs.map(indexSong).filter(song => song.options.length) : null;

function createSongRow(song, bottom, top) {
  const row = document.createElement('tr');
  const range = `${note(song.bottom)}–${note(song.top)}`;
  const videoSearch = 'https://www.youtube.com/@karafun/search?query=' + encodeURIComponent(`${song.artist} ${song.title}`);
  const songLink = link(song.title, videoSearch);
  songLink.target = '_blank';
  songLink.rel = 'noopener';
  songLink.title = 'Find this song on KaraFun’s YouTube channel';
  const values = [songLink, song.artist, range,
    song.octave === null ? '—' : song.octave === 0 ? 'Original' : `${song.octave > 0 ? '↑' : '↓'}${Math.abs(song.octave)}`];
  for (const [i, value] of values.entries()) {
    const cell = document.createElement('td');
    cell.append(value);
    if (i === 1) cell.title = {M: 'Male', F: 'Female', U: 'Unknown'}[song.gender];
    if (i === 2) {
      cell.title = song.top === null ? 'Range unknown; this is not a confirmed vocal-range fit.'
        : `Published range: ${song.publishedRange || song.range}${song.note ? ' · ' + song.note : ''}`;
      cell.className = 'notes';
    }
    row.append(cell);
  }
  for (const [name, known, color, label] of [
    ['popularity', song.rank !== null, song.rank === null ? null : popularityColor(song.rank),
      song.rank === null ? 'Popularity unavailable' : `Deezer popularity: ${song.rank.toLocaleString()}`],
    ['power', song.top !== null, song.top === null ? null : powerColor(song, bottom, top),
      song.top === null ? 'Power unknown: no verified vocal range' : `Power: highest ${note(song.top)}, lowest ${note(song.bottom)}`]
  ]) {
    const cell = document.createElement('td');
    cell.className = name;
    const swatch = document.createElement('span');
    swatch.className = `${name}-swatch${known ? '' : ' unknown-swatch'}`;
    if (known) swatch.style.backgroundColor = color;
    swatch.title = label;
    swatch.setAttribute('role', 'img');
    swatch.setAttribute('aria-label', label);
    cell.append(swatch);
    row.append(cell);
  }
  return row;
}

function search(event) {
  if (event) event.preventDefault();
  const body = get('songs'), results = get('results'), status = get('status');
  body.replaceChildren();
  results.hidden = true;
  get('excluded-results').hidden = true;
  get('excluded-songs').replaceChildren();
  if (!catalogue) {
    status.textContent = 'Song data unavailable. Reload to try again.';
    return;
  }
  const bottom = pitch(low.value), top = pitch(high.value);
  if (!Number.isFinite(bottom) || !Number.isFinite(top) || bottom > top) {
    status.textContent = 'Lowest note must not exceed highest note.';
    return;
  }
  const octaves = [get('original').checked ? 0 : null,
    ...(get('octave1').checked ? [-1, 1] : []), ...(get('octave2').checked ? [-2, 2] : [])].filter(o => o !== null);
  const query = normalize(get('query').value);
  const candidates = catalogue.filter(song => matchesQuery(song, query)).map(song => ({song,
    singerMatches: !get('singer').value || song.gender === get('singer').value,
    fit: fitSong(song, bottom, top, octaves, get('energetic').checked)}));
  const songs = candidates.filter(candidate => candidate.singerMatches && candidate.fit).map(candidate => candidate.fit).sort(compareSongs);
  status.textContent = !octaves.length ? 'Choose at least one octave option.'
    : songs.length ? `${songs.length} songs`
    : 'No matches. Try a wider range, another octave, or fewer search words.';
  const fragment = document.createDocumentFragment();
  for (const song of songs) fragment.append(createSongRow(song, bottom, top));
  body.append(fragment);
  results.hidden = songs.length === 0;
  const excluded = query ? candidates.filter(candidate => !candidate.singerMatches || !candidate.fit)
    .sort((a, b) => popularity(a.song, b.song))[0] : null;
  if (excluded) {
    const reasons = [];
    if (!excluded.singerMatches) reasons.push('singer');
    if (!excluded.fit) {
      const span = Math.min(...excluded.song.options.map(o => o.top - o.bottom));
      reasons.push(!octaves.length ? 'octave options' : excluded.song.top === null ? 'range unknown'
        : fitSong(excluded.song, bottom, top, octaves, false) ? 'energy'
        : span > top - bottom ? `song spans ${span} semitones; selection ${top - bottom}` : 'range / octave');
    }
    get('excluded-caption').textContent = `Filtered out · ${reasons.join(', ')}${excluded.fit || excluded.song.top === null ? '' : ' · published range'}`;
    get('excluded-songs').append(createSongRow(excluded.fit || {...excluded.song, octave: excluded.song.top === null ? null : 0}, bottom, top));
    get('excluded-results').hidden = false;
  }
}

const rangeSlider = get('range-slider');
const presets = [
  ['Bass', 'E2', 'E4', '#cadaff', 'above'],
  ['Baritone', 'A2', 'A4', '#c8eddd', 'below'],
  ['Tenor', 'C3', 'C5', '#fff0b3', 'above'],
  ['Alto', 'F3', 'F5', '#ffd7a8', 'below'],
  ['Mezzo', 'A3', 'A5', '#e8ceff', 'above'],
  ['Soprano', 'C4', 'C6', '#ffc7d1', 'below']
];
const sliderMin = pitch('C2'), sliderMax = pitch('C7');
noUiSlider.create(rangeSlider, {
  start: [pitch(low.value), pitch(high.value)],
  range: {min: sliderMin, max: sliderMax},
  step: 1,
  margin: 1,
  animate: false,
  connect: true,
  behaviour: 'tap-drag',
  keyboardSupport: true,
  keyboardPageMultiplier: 12,
  handleAttributes: [{'aria-label': 'Lowest note'}, {'aria-label': 'Highest note'}],
  ariaFormat: {to: value => note(Math.round(value)), from: pitch},
  pips: {mode: 'values', values: [36, 48, 60, 72, 84, 96], density: 20,
    filter: value => value % 12 === 0 ? 1 : -1,
    format: {to: value => note(Math.round(value)), from: pitch}}
});
for (const [name, a, b, color, side] of presets) {
  const lane = document.createElement('div');
  lane.className = 'preset-lane';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'preset-range';
  button.textContent = `${name} ${a}–${b}`;
  button.dataset.range = `${a}-${b}`;
  button.style.left = `${(pitch(a) - sliderMin) / (sliderMax - sliderMin) * 100}%`;
  button.style.width = `${(pitch(b) - pitch(a)) / (sliderMax - sliderMin) * 100}%`;
  button.style.backgroundColor = color;
  button.addEventListener('click', () => rangeSlider.noUiSlider.set([pitch(a), pitch(b)]));
  lane.append(button);
  get(`presets-${side}`).append(lane);
}
rangeSlider.noUiSlider.on('update', (values, handle, raw) => {
  low.value = note(Math.round(raw[0]));
  high.value = note(Math.round(raw[1]));
  get('range-value').textContent = `${low.value}–${high.value}`;
  for (const button of document.querySelectorAll('.preset-range')) {
    button.setAttribute('aria-pressed', String(button.dataset.range === `${low.value}-${high.value}`));
  }
  search();
});
const lastPlayed = [pitch(low.value), pitch(high.value)];
rangeSlider.noUiSlider.on('start.piano', (values, handle, raw) => {
  lastPlayed[handle] = Math.round(raw[handle]);
  piano.play([lastPlayed[handle]]);
});
rangeSlider.noUiSlider.on('slide.piano', (values, handle, raw) => {
  const midi = Math.round(raw[handle]);
  if (midi !== lastPlayed[handle]) {
    lastPlayed[handle] = midi;
    piano.play([midi]);
  }
});
rangeSlider.noUiSlider.on('set.piano', (values, handle, raw) => {
  lastPlayed[handle] = Math.round(raw[handle]);
});
get('finder').addEventListener('submit', search);
get('finder').addEventListener('change', search);
let searchTimer;
get('query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 100);
});

function setSort(mode) {
  sortMode = mode;
  const byPopularity = mode === 'popularity' || mode === 'popularity-asc';
  get('popularity-header').setAttribute('aria-sort', mode === 'popularity' ? 'descending' : mode === 'popularity-asc' ? 'ascending' : 'none');
  get('range-header').setAttribute('aria-sort', byPopularity ? 'none' : mode === 'range-asc' ? 'ascending' : 'descending');
  get('sort-popularity').textContent = mode === 'popularity' ? 'Popular ↓' : mode === 'popularity-asc' ? 'Popular ↑' : 'Popular';
  get('sort-range').textContent = mode === 'range-asc' ? 'Range ↑' : mode === 'range-desc' ? 'Range ↓' : 'Range ↕';
  search();
}
get('sort-popularity').addEventListener('click', () => setSort(sortMode === 'popularity' ? 'popularity-asc' : 'popularity'));
get('sort-range').addEventListener('click', () => setSort(sortMode === 'range-asc' ? 'range-desc' : 'range-asc'));
if (window.catalogue) get('updated').textContent = window.catalogue.updated || 'unknown';
search();
