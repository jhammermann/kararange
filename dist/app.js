'use strict';
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const get = id => document.getElementById(id);
const low = get('low'), high = get('high');
let sortMode = 'popularity';
let rangeSearchTimer;
let rangeDragging = false;

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
    const guessed = option.guessedRange ? option.guessedRange.split('-').map(pitch) : null;
    return {...option, bottom: Math.min(...voices.map(r => r[0])), top: Math.max(...voices.map(r => r[1])), guessed};
  }).filter(option => Number.isFinite(option.bottom) && Number.isFinite(option.top));
  return {...song, fields, words: [...new Set(fields.flatMap(f => [...f.split(' '), f.replace(/ /g, '')]).filter(Boolean))],
    options, ...(options[0] || {bottom: null, top: null})};
}

function selectRange(song, useGuess) {
  const options = song.options.map(option => useGuess && option.guessed
    ? {...option, bottom: option.guessed[0], top: option.guessed[1], usingGuess: true}
    : {...option, usingGuess: false});
  return {...song, options, ...(options[0] || {bottom: null, top: null})};
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

function powerScore(song) {
  // Encoding preserves highest-note priority even when lowest notes differ.
  return song.top * 128 + song.bottom;
}

function powerColor(song, minPower, maxPower) {
  const span = maxPower - minPower;
  const t = span ? (powerScore(song) - minPower) / span : 1;
  return colorScale(t, [[0, [210, 35, 35]], [0.5, [165, 115, 0]], [1, [0, 155, 45]]]);
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

function createSongRow(song, minPower, maxPower) {
  const row = document.createElement('tr');
  const range = `${note(song.bottom)}–${note(song.top)}${song.uncertain ? ' ?' : ''}`;
  const videoSearch = 'https://www.youtube.com/@karafun/search?query=' + encodeURIComponent(`${song.artist} ${song.title}`);
  const songLink = link(song.title, videoSearch);
  songLink.target = '_blank';
  songLink.rel = 'noopener';
  songLink.title = 'Find this song on KaraFun’s YouTube channel';
  const songCell = document.createElement('td');
  const artist = document.createElement('em');
  artist.className = 'artist';
  artist.textContent = song.artist;
  artist.title = [{M: 'Male', F: 'Female', B: 'Both'}[song.gender], song.leadSinger && `Lead: ${song.leadSinger}`].filter(Boolean).join(' · ');
  songCell.append(songLink, artist);
  row.append(songCell);
  const rangeCell = document.createElement('td');
  rangeCell.className = 'notes';
  rangeCell.title = song.top === null ? 'Range unknown; this is not a confirmed vocal-range fit.'
    : `${song.usingGuess ? 'Estimated range' : 'Source range'}: ${song.usingGuess ? song.guessedRange : song.range}${song.note ? ' · ' + song.note : ''}${song.uncertain ? ' · ? means uncertain' : ''}`;
  const octave = document.createElement('strong');
  octave.className = 'octave-marker';
  octave.textContent = song.octave === null ? '—' : song.octave === 0 ? '●' : `${song.octave > 0 ? '↑' : '↓'}${Math.abs(song.octave)}`;
  octave.title = song.octave === null ? 'Octave unknown' : song.octave === 0 ? 'Original octave' : `${Math.abs(song.octave)} octave(s) ${song.octave > 0 ? 'up' : 'down'}`;
  octave.setAttribute('aria-label', octave.title);
  const rangeText = document.createElement('span');
  rangeText.textContent = range;
  if (song.top !== null) rangeText.style.color = powerColor(song, minPower, maxPower);
  rangeCell.append(octave, rangeText);
  for (const [name, known, color, label] of [
    ['popularity', song.rank !== null, song.rank === null ? null : popularityColor(song.rank),
      song.rank === null ? 'Popularity unavailable' : `Deezer popularity: ${song.rank.toLocaleString()}`]
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
  row.append(rangeCell);
  return row;
}

function search(event) {
  if (event) event.preventDefault();
  clearTimeout(rangeSearchTimer);
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
  const fitted = catalogue.map(song => selectRange(song, get('guess-ranges').checked)).map(song => ({song,
    singerMatches: !get('singer').value || song.gender === get('singer').value,
    fit: fitSong(song, bottom, top, octaves, get('energetic').checked)}));
  // Calibrate after octave selection, across all fits regardless of search or singer.
  const powers = fitted.filter(candidate => candidate.fit).map(candidate => powerScore(candidate.fit));
  const minPower = powers.length ? Math.min(...powers) : 0;
  const maxPower = powers.length ? Math.max(...powers) : 0;
  const candidates = fitted.filter(candidate => matchesQuery(candidate.song, query));
  const songs = candidates.filter(candidate => candidate.singerMatches && candidate.fit).map(candidate => candidate.fit).sort(compareSongs);
  status.textContent = !octaves.length ? 'Choose at least one octave option.'
    : songs.length ? `${songs.length} songs`
    : 'No matches. Try a wider range, another octave, or fewer search words.';
  const fragment = document.createDocumentFragment();
  for (const song of songs) fragment.append(createSongRow(song, minPower, maxPower));
  body.append(fragment);
  results.hidden = songs.length === 0;
  const excluded = query ? candidates.filter(candidate => !candidate.singerMatches || !candidate.fit)
    .sort((a, b) => popularity(a.song, b.song))[0] : null;
  if (excluded) {
    get('excluded-songs').append(createSongRow(excluded.fit || {...excluded.song, octave: excluded.song.top === null ? null : 0}, minPower, maxPower));
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
  button.addEventListener('click', () => {
    const notes = [pitch(a), pitch(b)];
    rangeSlider.noUiSlider.set(notes);
    piano.play(notes);
  });
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
  clearTimeout(rangeSearchTimer);
  if (!rangeDragging) rangeSearchTimer = setTimeout(search, 120);
});
rangeSlider.noUiSlider.on('start.search', () => {
  rangeDragging = true;
  clearTimeout(rangeSearchTimer);
});
rangeSlider.noUiSlider.on('change.search', () => {
  rangeDragging = false;
  clearTimeout(rangeSearchTimer);
  rangeSearchTimer = setTimeout(search, 0);
});
const lastPlayed = [pitch(low.value), pitch(high.value)];
// Reset once per physical press; a touch's synthetic mouse event must not replay it.
rangeSlider.addEventListener('pointerdown', () => {
  lastPlayed.fill(null);
});
function playSliderNote(values, handle, raw) {
  const midi = Math.round(raw[handle]);
  if (midi !== lastPlayed[handle]) {
    lastPlayed[handle] = midi;
    piano.play([midi]);
  }
}
rangeSlider.noUiSlider.on('start.piano', playSliderNote);
rangeSlider.noUiSlider.on('slide.piano', playSliderNote);
rangeSlider.noUiSlider.on('set.piano', (values, handle, raw) => {
  lastPlayed[handle] = Math.round(raw[handle]);
});
get('finder').addEventListener('submit', search);
get('finder').addEventListener('change', search);
let searchTimer;
let rangeCollapsedForSearch = false;
get('query').addEventListener('input', () => {
  if (!rangeCollapsedForSearch && get('query').value.trim()) {
    get('range-selection').open = false;
    rangeCollapsedForSearch = true;
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 100);
});

function setSort(mode) {
  sortMode = mode;
  const byPopularity = mode === 'popularity' || mode === 'popularity-asc';
  get('popularity-header').setAttribute('aria-sort', mode === 'popularity' ? 'descending' : mode === 'popularity-asc' ? 'ascending' : 'none');
  get('range-header').setAttribute('aria-sort', byPopularity ? 'none' : mode === 'range-asc' ? 'ascending' : 'descending');
  get('popularity-arrow').textContent = mode === 'popularity' ? '↓' : mode === 'popularity-asc' ? '↑' : '↕';
  get('range-arrow').textContent = mode === 'range-asc' ? '↑' : mode === 'range-desc' ? '↓' : '↕';
  search();
}
get('sort-popularity').addEventListener('click', () => setSort(sortMode === 'popularity' ? 'popularity-asc' : 'popularity'));
get('sort-range').addEventListener('click', () => setSort(sortMode === 'range-asc' ? 'range-desc' : 'range-asc'));
get('reset-search').addEventListener('click', () => {
  clearTimeout(searchTimer);
  get('query').value = '';
  search();
  window.scrollTo(0, 0);
});
if (window.catalogue) get('updated').textContent = window.catalogue.updated || 'unknown';
search();
