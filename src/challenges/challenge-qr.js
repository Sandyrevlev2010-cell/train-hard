/* =============================================================
 * Train Hard Challenges — локальный QR-генератор
 *
 * Без внешних QR-API и без сторонних библиотек: генерация
 * полностью локальная (byte-mode, ECC уровень L, версии 1–13 —
 * до 428 байт данных, достаточно для self-contained ссылки).
 * QR содержит ту же ссылку ?challenge=<payload>, не «голый» ID.
 * ============================================================= */
(function () {
  'use strict';

  /* ---------- GF(256) ---------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* ---------- таблицы (уровень L, версии 1–13) ---------- */
  /* [кол-во блоков, всего кодвордов в блоке, данных в блоке] */
  var RS_BLOCKS = [
    [[1, 26, 19]], [[1, 44, 34]], [[1, 70, 55]], [[1, 100, 80]],
    [[1, 134, 108]], [[2, 86, 68]], [[2, 98, 78]], [[2, 121, 97]],
    [[2, 146, 116]], [[2, 86, 68], [2, 87, 69]], [[4, 101, 81]],
    [[2, 116, 92], [2, 117, 93]], [[4, 133, 107]]
  ];
  var ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38],
    [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62]];

  function dataCapacity(v) {
    var blocks = RS_BLOCKS[v - 1], total = 0;
    for (var i = 0; i < blocks.length; i++) total += blocks[i][0] * blocks[i][2];
    return total;
  }

  /* ---------- Reed–Solomon ---------- */
  function rsGenPoly(deg) {                    /* коэффициенты от старшей степени к младшей */
    var g = [1];
    for (var i = 0; i < deg; i++) {
      var ng = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];                         /* × x */
        ng[j + 1] ^= gmul(g[j], EXP[i]);       /* × α^i */
      }
      g = ng;
    }
    return g;
  }
  function rsEncode(data, ecLen) {
    var g = rsGenPoly(ecLen);
    var res = data.slice().concat(new Array(ecLen).fill(0));
    for (var pos = 0; pos < data.length; pos++) {
      var coef = res[pos];
      if (coef) {
        for (var j = 1; j < g.length; j++) res[pos + j] ^= gmul(g[j], coef);
      }
    }
    return res.slice(data.length);
  }

  /* ---------- битовый поток ---------- */
  function BitBuf() { this.buf = []; this.len = 0; }
  BitBuf.prototype.put = function (num, length) {
    for (var i = length - 1; i >= 0; i--) {
      this.buf.push((num >>> i) & 1);
      this.len++;
    }
  };
  BitBuf.prototype.putBytes = function (bytes) {
    for (var i = 0; i < bytes.length; i++) this.put(bytes[i], 8);
  };
  function toBytes(bits) {
    var out = [];
    for (var i = 0; i + 8 <= bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    return out;
  }

  function utf8Bytes(str) {
    var enc = null;
    try { enc = new TextEncoder().encode(str); } catch (e) { enc = null; }
    if (enc) return Array.prototype.slice.call(enc);
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ---------- выбор версии и сборка кодвордов ---------- */
  function buildCodewords(text) {
    var bytes = utf8Bytes(text);
    if (bytes.length > 428) return null;
    var version = 0, i;
    for (i = 1; i <= 13; i++) { if (dataCapacity(i) >= bytes.length + 2 + (i < 10 ? 1 : 2) + 4 / 8) { version = i; break; } }
    if (!version) {
      for (i = 1; i <= 13; i++) { if (dataCapacity(i) >= bytes.length) { version = i; break; } }
    }
    if (!version) return null;

    var bits = new BitBuf();
    bits.put(4, 4);                                       /* byte mode */
    bits.put(bytes.length, version < 10 ? 8 : 16);        /* длина */
    bits.putBytes(bytes);
    var capacity = dataCapacity(version) * 8;
    bits.put(0, Math.min(4, capacity - bits.len));        /* терминатор */
    while (bits.len % 8 !== 0) bits.put(0, 1);
    var padFlip = true;
    while (bits.len < capacity) bits.put(padFlip ? 0xec : 0x11, 8), padFlip = !padFlip;
    var data = toBytes(bits.buf);

    /* блоки + перемежение */
    var blocks = RS_BLOCKS[version - 1];
    var dataBlocks = [], ecBlocks = [], offset = 0;
    for (i = 0; i < blocks.length; i++) {
      for (var b = 0; b < blocks[i][0]; b++) {
        var dcnt = blocks[i][2], ecnt = blocks[i][1] - blocks[i][2];
        dataBlocks.push(data.slice(offset, offset + dcnt));
        ecBlocks.push(rsEncode(data.slice(offset, offset + dcnt), ecnt));
        offset += dcnt;
      }
    }
    var out = [], maxD = 0, maxE = 0, k;
    for (i = 0; i < dataBlocks.length; i++) maxD = Math.max(maxD, dataBlocks[i].length);
    for (i = 0; i < ecBlocks.length; i++) maxE = Math.max(maxE, ecBlocks[i].length);
    for (k = 0; k < maxD; k++) for (i = 0; i < dataBlocks.length; i++) if (k < dataBlocks[i].length) out.push(dataBlocks[i][k]);
    for (k = 0; k < maxE; k++) for (i = 0; i < ecBlocks.length; i++) if (k < ecBlocks[i].length) out.push(ecBlocks[i][k]);
    return { version: version, codewords: out };
  }

  /* ---------- матрица ---------- */
  function bchDigit(v) { var d = 0; while (v !== 0) { d++; v >>>= 1; } return d; }
  function formatInfo(mask) {                       /* уровень L = 01 */
    var data = (1 << 3) | mask;                     /* L<<3|mask */
    var d = data << 10;
    var g = 0x537;
    while (bchDigit(d) - bchDigit(g) >= 0) d ^= g << (bchDigit(d) - bchDigit(g));
    return ((data << 10) | d) ^ 0x5412;
  }
  function versionInfo(v) {
    var d = v << 12, g = 0x1f25;
    while (bchDigit(d) - bchDigit(g) >= 0) d ^= g << (bchDigit(d) - bchDigit(g));
    return (v << 12) | d;
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r * c) % 3 + (r + c) % 2) % 2 === 0; }
  ];

  function buildMatrix(version, codewords) {
    var size = 17 + version * 4;
    var mods = [], func = [];
    var r, c;
    for (r = 0; r < size; r++) { mods.push(new Array(size).fill(null)); func.push(new Array(size).fill(false)); }

    function setMod(row, col, dark) { mods[row][col] = dark; func[row][col] = true; }

    function placeFinder(row, col) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = row + dr, cc = col + dc;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          var dark = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
            (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setMod(rr, cc, dark);
        }
      }
    }
    placeFinder(0, 0); placeFinder(size - 7, 0); placeFinder(0, size - 7);

    for (var i = 8; i < size - 8; i++) {
      if (mods[6][i] === null) setMod(6, i, i % 2 === 0);
      if (mods[i][6] === null) setMod(i, 6, i % 2 === 0);
    }

    var centers = ALIGN[version - 1];
    for (var a = 0; a < centers.length; a++) {
      for (var b = 0; b < centers.length; b++) {
        var cr = centers[a], cc2 = centers[b];
        if ((cr === 6 && cc2 === 6) || (cr === 6 && cc2 === size - 7) || (cr === size - 7 && cc2 === 6)) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            setMod(cr + dr2, cc2 + dc2, Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1);
          }
        }
      }
    }

    /* резерв format-областей + тёмный модуль */
    for (i = 0; i <= 8; i++) { if (mods[8][i] === null) { mods[8][i] = false; func[8][i] = true; } if (mods[i][8] === null) { mods[i][8] = false; func[i][8] = true; } }
    for (i = 0; i <= 7; i++) { if (mods[8][size - 1 - i] === null) { mods[8][size - 1 - i] = false; func[8][size - 1 - i] = true; } if (mods[size - 1 - i][8] === null) { mods[size - 1 - i][8] = false; func[size - 1 - i][8] = true; } }
    mods[size - 8][8] = true; func[size - 8][8] = true;

    if (version >= 7) {
      var vbits = versionInfo(version);
      for (i = 0; i < 18; i++) {
        var bit = !!((vbits >> i) & 1);
        var vrow = size - 11 + (i % 3), vCol = Math.floor(i / 3);
        mods[vCol][size - 11 + (i % 3)] = bit; func[vCol][size - 11 + (i % 3)] = true;
        mods[vrow][vCol] = bit; func[vrow][vCol] = true;
      }
    }

    /* данные змейкой */
    var data = codewords, inc = -1, row = size - 1, bitIndex = 7, byteIndex = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var cc3 = 0; cc3 < 2; cc3++) {
          if (mods[row][col - cc3] === null) {
            var dark = false;
            if (byteIndex < data.length) dark = !!((data[byteIndex] >>> bitIndex) & 1);
            mods[row][col - cc3] = dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
    return { mods: mods, func: func, size: size };
  }

  /* ---------- выбор маски (штрафы) ---------- */
  function applyMaskAndScore(m, maskFn) {
    var size = m.size, mods = m.mods, func = m.func;
    var grid = [];
    for (var r = 0; r < size; r++) {
      grid.push(mods[r].slice());
      for (var c = 0; c < size; c++) {
        if (!func[r][c] && maskFn(r, c)) grid[r][c] = !grid[r][c];
      }
    }
    return grid;
  }
  function penalty(grid) {
    var size = grid.length, score = 0, r, c, i;
    /* N1: серии ≥5 */
    for (r = 0; r < size; r++) {
      var run = 1;
      for (c = 1; c < size; c++) {
        if (grid[r][c] === grid[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
        else run = 1;
      }
    }
    for (c = 0; c < size; c++) {
      var run2 = 1;
      for (r = 1; r < size; r++) {
        if (grid[r][c] === grid[r - 1][c]) { run2++; if (run2 === 5) score += 3; else if (run2 > 5) score += 1; }
        else run2 = 1;
      }
    }
    /* N2: блоки 2×2 */
    for (r = 0; r < size - 1; r++) for (c = 0; c < size - 1; c++) {
      if (grid[r][c] === grid[r][c + 1] && grid[r][c] === grid[r + 1][c] && grid[r][c] === grid[r + 1][c + 1]) score += 3;
    }
    /* N3: похоже на finder-паттерн */
    var P1 = [true, false, true, true, true, false, true, false, false, false, false];
    var P2 = P1.slice().reverse();
    function matchAt(get, len) {
      for (var st = 0; st + len <= size; st++) {
        var m1 = true, m2 = true;
        for (var k = 0; k < len; k++) {
          var v = get(st + k);
          if (v !== P1[k]) m1 = false;
          if (v !== P2[k]) m2 = false;
        }
        if (m1) score += 40;
        if (m2) score += 40;
      }
    }
    for (r = 0; r < size; r++) {
      matchAt(function (x) { return grid[r][x]; }, 11);
      matchAt(function (x) { return grid[x][r]; }, 11);
    }
    /* N4: доля тёмных */
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (grid[r][c]) dark++;
    score += 10 * Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5);
    return score;
  }
  function placeFormat(grid, size, mask) {
    var bits = formatInfo(mask), i;
    for (i = 0; i < 15; i++) {
      var mod = !!((bits >> i) & 1);
      if (i < 6) grid[i][8] = mod;
      else if (i < 8) grid[i + 1][8] = mod;
      else grid[size - 15 + i][8] = mod;
      if (i < 8) grid[8][size - i - 1] = mod;
      else if (i < 9) grid[8][15 - i] = mod;
      else grid[8][15 - i - 1] = mod;
    }
    grid[size - 8][8] = true;
  }

  /* ---------- публичный API ---------- */
  function generate(text) {
    var built = buildCodewords(text);
    if (!built) return null;
    var m = buildMatrix(built.version, built.codewords);
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var mi = 0; mi < 8; mi++) {
      var g = applyMaskAndScore(m, MASKS[mi]);
      var sc = penalty(g);
      if (sc < bestScore) { bestScore = sc; best = g; bestMask = mi; }
    }
    placeFormat(best, m.size, bestMask);
    return { size: m.size, modules: best };
  }

  window.__THQR = {
    generate: generate,
    /* отрисовка на canvas (реальные браузеры; в тестах canvas нет — используем modules) */
    draw: function (canvas, text, scale) {
      var qr = generate(text);
      if (!qr || !canvas || !canvas.getContext) return null;
      var ctx;
      try { ctx = canvas.getContext('2d'); } catch (e) { return null; }
      if (!ctx) return null;
      var s = scale || 4, quiet = 4, px = (qr.size + quiet * 2) * s;
      canvas.width = px; canvas.height = px;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#000000';
      for (var r = 0; r < qr.size; r++) {
        for (var c = 0; c < qr.size; c++) {
          if (qr.modules[r][c]) ctx.fillRect((c + quiet) * s, (r + quiet) * s, s, s);
        }
      }
      return qr;
    }
  };
})();
