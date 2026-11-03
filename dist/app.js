'use strict';
const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const get = id => document.getElementById(id);
const low = get('low'), high = get('high');
let sortMode = 'popularity';

function pitch(note) {
  const match = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!match) return NaN;
  const offset = {C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11};
  return (+match[3] + 1) * 12 + offset[match[1]] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
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
  const ranges = song.range.split(';').map(voice => voice.trim().split('-').map(pitch));
  return {...song, fields, words: [...new Set(fields.flatMap(f => [...f.split(' '), f.replace(/ /g, '')]).filter(Boolean))],
    bottom: Math.min(...ranges.map(r => r[0])), top: Math.max(...ranges.map(r => r[1]))};
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
  for (const octave of octaves) {
    const a = song.bottom + 12 * octave, b = song.top + 12 * octave;
    if (a >= bottom && b <= top && (octave === 0 || !energetic || top - b <= 3)) {
      return {...song, bottom: a, top: b, octave};
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
  if (sortMode === 'popularity') return popularity(a, b);
  return (sortMode === 'power-asc' ? 1 : -1) * comparePower(a, b) || popularity(a, b);
}

function powerColor(song, bottom, top) {
  // Encoding preserves highest-note priority even when lowest notes differ.
  const span = top - bottom;
  const t = span ? Math.max(0, Math.min(1,
    ((song.top - bottom) * 128 + song.bottom - bottom) / (span * 129))) : 1;
  return `rgb(${Math.round(230 * t)}, 0, ${Math.round(110 * (1 - t))})`;
}

function link(text, url) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = url;
  return a;
}

const catalogue = window.catalogue ? window.catalogue.songs.map(indexSong) : null;

function search(event) {
  if (event) event.preventDefault();
  const body = get('songs'), results = get('results'), status = get('status');
  body.replaceChildren();
  results.hidden = true;
  if (!catalogue) {
    status.textContent = 'Song data unavailable. Reload to try again.';
    return;
  }
  const bottom = pitch(low.value), top = pitch(high.value);
  if (!Number.isFinite(bottom) || !Number.isFinite(top) || bottom > top) {
    status.textContent = 'Lowest note must not exceed highest note.';
    return;
  }
  const octaves = [get('original').checked ? 0 : null, get('down1').checked ? -1 : null,
    get('down2').checked ? -2 : null].filter(o => o !== null);
  if (!octaves.length) {
    status.textContent = 'Choose at least one octave option.';
    return;
  }
  const query = normalize(get('query').value);
  const songs = catalogue.filter(song => (!get('singer').value || song.gender === get('singer').value) && matchesQuery(song, query))
    .map(song => fitSong(song, bottom, top, octaves, get('energetic').checked)).filter(Boolean).sort(compareSongs);
  status.textContent = songs.length ? `${songs.length} songs` : 'No matches. Try a wider range, another octave, or fewer search words.';
  const fragment = document.createDocumentFragment();
  for (const song of songs) {
    const row = document.createElement('tr');
    const range = `${note(song.bottom)}–${note(song.top)}`;
    const values = [link(song.title, song.source), song.artist, range,
      song.octave === 0 ? 'Original' : `↓${-song.octave}`,
      song.rank === null ? '—' : link(song.rank.toLocaleString(), song.deezer)];
    for (const [i, value] of values.entries()) {
      const cell = document.createElement('td');
      cell.append(value);
      if (i === 1) cell.title = {M: 'Male', F: 'Female', U: 'Unknown'}[song.gender];
      if (i === 2) {
        cell.title = `Published range: ${song.range}`;
        cell.className = 'notes';
      }
      if (i === 4) cell.className = 'number';
      row.append(cell);
    }
    const power = document.createElement('td');
    power.className = 'power';
    power.style.backgroundColor = powerColor(song, bottom, top);
    power.title = `Power: ${range}`;
    power.setAttribute('role', 'img');
    power.setAttribute('aria-label', `Power: highest ${note(song.top)}, lowest ${note(song.bottom)}`);
    row.append(power);
    fragment.append(row);
  }
  body.append(fragment);
  results.hidden = songs.length === 0;
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
get('finder').addEventListener('submit', search);
get('finder').addEventListener('change', search);
let searchTimer;
get('query').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 100);
});

function setSort(mode) {
  sortMode = mode;
  get('popularity-header').setAttribute('aria-sort', mode === 'popularity' ? 'descending' : 'none');
  get('power-header').setAttribute('aria-sort', mode === 'popularity' ? 'none' : mode === 'power-asc' ? 'ascending' : 'descending');
  get('sort-popularity').textContent = mode === 'popularity' ? 'Popularity ↓' : 'Popularity';
  get('sort-power').textContent = mode === 'power-asc' ? 'Power ↑' : mode === 'power-desc' ? 'Power ↓' : 'Power ↕';
  search();
}
get('sort-popularity').addEventListener('click', () => setSort('popularity'));
get('sort-power').addEventListener('click', () => setSort(sortMode === 'power-asc' ? 'power-desc' : 'power-asc'));
if (window.catalogue) get('updated').textContent = window.catalogue.updated || 'unknown';
search();
