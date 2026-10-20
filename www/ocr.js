/* GCalc screenshot import.
   Reads a photo or screenshot of a grades table on the device (Tesseract.js,
   fully offline) and turns it into subjects: code, units and grade.

   Two ways of reading:
   1. Table mode (preferred): when the image has a ruled table (like the CLSU
      portal), the grid lines are found and each cell is read on its own, so a
      code split over two lines ("INTECH" / "3100") and a lone "3" in the units
      column are still read correctly.
   2. Line mode (fallback): the whole image is read as text and each line that
      has a subject code is parsed. */
(function () {
	"use strict";

	var BASE = "vendor/tesseract/";
	var VALID_GRADES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 4, 5];
	var TARGET_WIDTH = 2000;
	var WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-& ";

	// Subject codes are written in capitals: INTECH 3100, GEC 104, PE 3, NSTP 12.
	// The code may be split over two lines inside a narrow cell.
	var CODE = /\b([A-Z][A-Z&]{1,11})\s*-?\s*(\d{1,4}[A-Z]?)\b/;
	var NOT_A_SUBJECT = /^(NO|SY|AY|ST|ND|RD|SEM|SEMESTER|YEAR|PAGE|ROOM|SECTION|TOTAL|GWA|UNITS|GRADE|GRADES|REMARKS|STATUS|SUBJECTS|SUBJECT|PASSED|FAILED|SUBMITTED|APPROVED|YET|NOT|PM|AM)$/;

	// Subject code prefixes at CLSU (from the portal's public subject schedule,
	// plus a few older ones). Used to fix a dropped or misread letter:
	// "COMSC" -> "COMSCI", "PATHEIT" -> "PATHFIT".
	var KNOWN_PREFIXES = {};
	("AA AB ABEN ACCT ACCTG AE AECON AENGR AG AGBIO AGBUS AGECON AGEXT AGMGT AGRIC AGRICULTURE AGRON AM ANSCI AP APPLIED AQ AQPH AQUA AREM ARTS AS BA BACC BAFIL BCAED BIO BIOL BLAW BOT BOTA BPED BSCI BTECH BTLED CAED CBMEC CE CENGR CHEM CHEMED CHEMISTRY CMENGR COMFUN COMM COMMUNICATIONS COMSCI CP CPE CPROT CRSCI CS DC EAPP EC ECED ECON ED EDUC EED EENGR ELECTIVE ELEM EM ENC ENG ENGL ENGLISH ENGR ENSCI ENTOM ENTREP ENVSC ENVSCI ENVST ESP EXED FILDIS FILI FILIPINO FILKOM FILLIT FILSOS FINMA FISH FL FLDS FTECH FTTFD FTTFM GEL GENMATH GENSCI GEO GU HE HEALTH HEED HISTO HM HO HORTI HOSPM HRDM HT HUMANITIES ICT INTECH IS ISFL ISGE ITAB ITCAP ITELEC ITPRAC ITRM LANG LCS LITERATURE LITT LL MA MAPEH MATH MATHED MATHEMATICS MEM MENGR METEOR MICRO MIL MKTG MNGT MS MUSIC NSTP OUTLINE PATHFIT PB PBREED PE PEH PERDEV PHILI PHILO PHILOSOPHY PHYS PHYSICS POLSCI PPATH PR PSYCH RD RES RESEARCH SCIED SCIENCE SED SEDELFIL SEDENG SEDFILI SEDMATH SEDSCI SEDSS SEDVED SFP SHP SO SOCIO SOCSCI SOCSI SOILS SPS STAT SW TAXN TFTEC TFTFD TFTFM THESIS TLEAFA TLEHE TLEIA TLSED TM TOURM TR VANA VCLIN VMED VMICR VPARA VPATH VPH VPHAR VPHYS VPM VSCI VSURG WA ZOOL ZOOT GEC GEE FIL HIST IT AGRI DRAW CRIM NURS").split(" ").forEach(function (p) { KNOWN_PREFIXES[p] = true; });

	function editDistanceAtMost1(a, b) {
		if (a === b) return true;
		var la = a.length, lb = b.length;
		if (Math.abs(la - lb) > 1) return false;
		var i = 0, j = 0, edits = 0;
		while (i < la && j < lb) {
			if (a[i] === b[j]) { i++; j++; continue; }
			if (++edits > 1) return false;
			if (la > lb) i++;
			else if (lb > la) j++;
			else { i++; j++; }
		}
		return edits + (la - i) + (lb - j) <= 1;
	}

	// When two known prefixes are equally close, the common general-education
	// ones win ("PHIL" -> "PHILI", not "PHILO").
	var COMMON_PREFIXES = ["PHILI", "PATHFIT", "NSTP", "GEC", "MATH", "ENGL", "STAT", "COMSCI", "INTECH", "ITRM", "PSYCH", "CHEM", "BIO", "PHYS", "FILI"];

	/* A known prefix as is, or the only (or most common) known prefix one letter away. */
	function fixPrefix(p) {
		if (KNOWN_PREFIXES[p] || p.length < 3) return p;
		var near = Object.keys(KNOWN_PREFIXES).filter(function (k) { return k.length >= 3 && editDistanceAtMost1(p, k); });
		if (near.length === 1) return near[0];
		var common = near.filter(function (k) { return COMMON_PREFIXES.indexOf(k) >= 0; });
		return common.length === 1 ? common[0] : p;
	}

	var libPromise = null;

	function loadLibrary() {
		if (window.Tesseract) return Promise.resolve(window.Tesseract);
		if (libPromise) return libPromise;
		libPromise = new Promise(function (resolve, reject) {
			var s = document.createElement("script");
			s.src = BASE + "tesseract.min.js";
			s.onload = function () { resolve(window.Tesseract); };
			s.onerror = function () {
				libPromise = null;
				reject(new Error("Could not load the text reader."));
			};
			document.head.appendChild(s);
		});
		return libPromise;
	}

	function loadImage(file) {
		return new Promise(function (resolve, reject) {
			var url = URL.createObjectURL(file);
			var img = new Image();
			img.onload = function () {
				URL.revokeObjectURL(url);
				resolve(img);
			};
			img.onerror = function () {
				URL.revokeObjectURL(url);
				reject(new Error("That file could not be opened as an image."));
			};
			img.src = url;
		});
	}

	/* Otsu's method: picks the gray level that best separates text from background. */
	function otsu(gray) {
		var hist = new Array(256).fill(0);
		for (var i = 0; i < gray.length; i++) hist[gray[i]]++;
		var total = gray.length, sum = 0;
		for (var t = 0; t < 256; t++) sum += t * hist[t];
		var sumB = 0, wB = 0, best = 0, threshold = 128;
		for (var k = 0; k < 256; k++) {
			wB += hist[k];
			if (!wB) continue;
			var wF = total - wB;
			if (!wF) break;
			sumB += k * hist[k];
			var mB = sumB / wB, mF = (sum - sumB) / wF;
			var between = wB * wF * (mB - mF) * (mB - mF);
			if (between > best) {
				best = between;
				threshold = k;
			}
		}
		return threshold;
	}

	/* Groups positions whose count is high into lines: [[start, end], ...]. */
	function findLines(counts, minCount) {
		var max = 0, i;
		for (i = 0; i < counts.length; i++) if (counts[i] > max) max = counts[i];
		if (max < minCount) return [];
		var thr = Math.max(minCount, max * 0.35);
		var lines = [];
		var start = -1, last = -10;
		for (i = 0; i < counts.length; i++) {
			if (counts[i] >= thr) {
				if (start < 0 || i - last > 4) {
					if (start >= 0) lines.push([start, last]);
					start = i;
				}
				last = i;
			}
		}
		if (start >= 0) lines.push([start, last]);
		return lines;
	}

	/* The space between consecutive lines. With limit (the image height) it also
	   adds one row-sized band above the first line and below the last one: in a
	   scrolled screenshot the first visible row's top border is often hidden
	   under the site's header bar. */
	function bandsBetween(lines, minSize, limit) {
		var bands = [];
		for (var i = 0; i + 1 < lines.length; i++) {
			var a = lines[i][1] + 3, b = lines[i + 1][0] - 3;
			if (b - a >= minSize) {
				var band = [a, b];
				band.extent = lines[i].extent; // left/right ends of the line above
				band.extentBelow = lines[i + 1].extent;
				bands.push(band);
			}
		}
		if (limit && bands.length >= 2) {
			var sizes = bands.map(function (x) { return x[1] - x[0]; }).sort(function (x, y) { return x - y; });
			var m = sizes[Math.floor(sizes.length / 2)];
			var first = lines[0], last = lines[lines.length - 1];
			if (first[0] - 3 >= m * 0.6) {
				var top = [Math.max(0, first[0] - 3 - m), first[0] - 3];
				top.extent = top.extentBelow = first.extent;
				top.edge = true;
				bands.unshift(top);
			}
			if (limit - 1 - (last[1] + 3) >= m * 0.6) {
				var bottom = [last[1] + 3, Math.min(limit - 1, last[1] + 3 + m)];
				bottom.extent = bottom.extentBelow = last.extent;
				bottom.edge = true;
				bands.push(bottom);
			}
		}
		return bands;
	}

	/* Left and right ends of each horizontal line: the longest unbroken stretch,
	   so a box border that happens to sit at the same height (a sidebar card,
	   say) is not counted as part of the table line. */
	function addExtents(lines, eraseH, W) {
		lines.forEach(function (line) {
			var present = new Uint8Array(W);
			for (var y = line[0]; y <= line[1]; y++) {
				for (var x = 0; x < W; x++) if (eraseH[y * W + x]) present[x] = 1;
			}
			var best = [0, 0], start = -1, gap = 0;
			for (var i = 0; i <= W; i++) {
				if (i < W && present[i]) {
					if (start < 0) start = i;
					gap = 0;
				} else if (start >= 0) {
					if (i < W && ++gap <= 6) continue; // tolerate tiny breaks
					var end = i - gap;
					if (end - start > best[1] - best[0]) best = [start, end];
					start = -1;
					gap = 0;
				}
			}
			line.extent = best;
		});
	}

	/* Black text on white with table borders removed (they confuse the reader:
	   a "|" next to "COMSCI" becomes "ICOMSCI"). Also finds the table grid. */
	function prepare(img, maxPixels) {
		// Enlarge small screenshots, shrink big ones; also cap the total size
		// (phone browsers refuse canvases much over ~16 million pixels).
		var scale = Math.min(3, TARGET_WIDTH / img.width, Math.sqrt((maxPixels || 12e6) / (img.width * img.height)));
		var W = Math.max(1, Math.round(img.width * scale));
		var H = Math.max(1, Math.round(img.height * scale));
		var canvas = document.createElement("canvas");
		canvas.width = W;
		canvas.height = H;
		var ctx = canvas.getContext("2d", { willReadFrequently: true });
		ctx.imageSmoothingQuality = "high";
		ctx.drawImage(img, 0, 0, W, H);

		var data = ctx.getImageData(0, 0, W, H);
		var px = data.data;
		var n = W * H;
		var gray = new Uint8ClampedArray(n);
		var sum = 0;
		for (var i = 0; i < n; i++) {
			var g = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
			gray[i] = g;
			sum += g;
		}
		var invert = sum / n < 128; // dark-mode screenshot: light text on dark
		if (invert) for (var j = 0; j < n; j++) gray[j] = 255 - gray[j];
		var threshold = otsu(gray);

		var ink = new Uint8Array(n);
		for (var p = 0; p < n; p++) ink[p] = gray[p] < threshold ? 1 : 0;

		// Only runs much longer than any letter stroke count as table lines,
		// otherwise the stems of letters like I, L and T get erased too.
		var minH = Math.max(60, W * 0.08);
		var minV = Math.max(60, W * 0.06, H * 0.05);
		var eraseH = new Uint8Array(n);
		var eraseV = new Uint8Array(n);
		var hCount = new Uint32Array(H);
		var vCount = new Uint32Array(W);
		var x, y, run, k;
		for (y = 0; y < H; y++) {
			run = 0;
			for (x = 0; x <= W; x++) {
				if (x < W && ink[y * W + x]) run++;
				else {
					if (run >= minH) {
						for (k = x - run; k < x; k++) eraseH[y * W + k] = 1;
						hCount[y] += run;
					}
					run = 0;
				}
			}
		}
		for (x = 0; x < W; x++) {
			run = 0;
			for (y = 0; y <= H; y++) {
				if (y < H && ink[y * W + x]) run++;
				else {
					if (run >= minV) {
						for (k = y - run; k < y; k++) eraseV[k * W + x] = 1;
						vCount[x] += run;
					}
					run = 0;
				}
			}
		}

		var clean = new Uint8Array(n); // 1 = text ink
		for (var q = 0; q < n; q++) {
			var isText = ink[q] && !eraseH[q] && !eraseV[q];
			clean[q] = isText ? 1 : 0;
			var v = isText ? 0 : 255;
			px[q * 4] = px[q * 4 + 1] = px[q * 4 + 2] = v;
			px[q * 4 + 3] = 255;
		}
		ctx.putImageData(data, 0, 0);

		var rowLines = findLines(hCount, W * 0.25);
		addExtents(rowLines, eraseH, W);
		var colLines = findLines(vCount, H * 0.08);
		var grid = null;
		if (rowLines.length >= 3 && colLines.length >= 4) {
			grid = {
				rows: bandsBetween(rowLines, 18, H),
				cols: bandsBetween(colLines, 18)
			};
			if (grid.rows.length < 2 || grid.cols.length < 3) grid = null;
		}

		// Grayscale copy with the table lines painted white, for reading cells:
		// smooth letter edges read better than hard black and white.
		for (var e = 0; e < n; e++) if (eraseH[e] || eraseV[e]) gray[e] = 255;

		return { canvas: canvas, clean: clean, gray: gray, W: W, H: H, grid: grid };
	}

	/* Finds the text inside one cell. Returns null for an empty cell, otherwise
	   an object that can draw the cell as "binary" (clean black on white) or
	   "gray" (smooth edges, better for small text), enlarged so letters are
	   about 40px tall, which is what the reader handles best. */
	function cropCell(prep, x0, y0, x1, y1) {
		var W = prep.W, clean = prep.clean, gray = prep.gray;
		var minX = x1, minY = y1, maxX = x0, maxY = y0, count = 0;
		var rowsWithInk = 0;
		for (var y = y0; y <= y1; y++) {
			var any = false;
			for (var x = x0; x <= x1; x++) {
				if (clean[y * W + x]) {
					count++;
					any = true;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
			if (any) rowsWithInk++;
		}
		// Empty cell? (A lone "1" can be just a couple of pixels wide, so only the
		// height and the amount of ink decide.)
		if (count < 12 || maxY - minY < 8) return null;
		var ink = [minX, minY, maxX, maxY];

		minX = Math.max(x0, minX - 2);
		minY = Math.max(y0, minY - 2);
		maxX = Math.min(x1, maxX + 2);
		maxY = Math.min(y1, maxY + 2);
		var w = maxX - minX + 1, h = maxY - minY + 1;

		// Roughly one line of text is rowsWithInk tall (two for a wrapped code).
		var lineHeight = rowsWithInk > 60 && rowsWithInk > h * 0.6 ? rowsWithInk / 2 : rowsWithInk;
		var scale = Math.max(1, Math.min(4, 40 / Math.max(1, lineHeight)));
		var cache = {};

		// Darkest and lightest gray in the cell, to stretch faint text to full contrast.
		var lo = 255, hi = 0;
		for (var gy = minY; gy <= maxY; gy++) {
			for (var gx = minX; gx <= maxX; gx++) {
				var gv = gray[gy * W + gx];
				if (gv < lo) lo = gv;
				if (gv > hi) hi = gv;
			}
		}
		var span = Math.max(1, hi - lo);

		function make(kind) {
			if (cache[kind]) return cache[kind];
			var isGray = kind === "gray" || kind === "gray2";
			var src = document.createElement("canvas");
			src.width = w;
			src.height = h;
			var sctx = src.getContext("2d");
			var img = sctx.createImageData(w, h);
			var d = img.data;
			for (var yy = 0; yy < h; yy++) {
				for (var xx = 0; xx < w; xx++) {
					var i = (minY + yy) * W + (minX + xx);
					var v = isGray ? Math.round((gray[i] - lo) * 255 / span) : (clean[i] ? 0 : 255);
					var o = (yy * w + xx) * 4;
					d[o] = d[o + 1] = d[o + 2] = v;
					d[o + 3] = 255;
				}
			}
			sctx.putImageData(img, 0, 0);
			var pad = 24;
			var k = kind === "gray2" ? scale * 1.6 : scale;
			// Keep each cell picture small enough for the reader's memory (Safari).
			k = Math.min(k, Math.sqrt(2.5e6 / Math.max(1, w * h)));
			var c = document.createElement("canvas");
			c.width = Math.round(w * k) + pad * 2;
			c.height = Math.round(h * k) + pad * 2;
			var ctx = c.getContext("2d");
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, c.width, c.height);
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(src, pad, pad, Math.round(w * k), Math.round(h * k));
			cache[kind] = c;
			return c;
		}

		return { make: make, small: lineHeight < 30, inkWidth: w - 4, inkHeight: rowsWithInk, ink: ink, prep: prep };
	}

	/* ---------- Shape check for numbers ----------
	   The portal prints units and grades in Roboto. Each possible value ("1".."10",
	   "1.00".."5.00") is drawn in Roboto at the size of the text in the cell and
	   compared with the cell's pixels; the closest one wins when it is clearly
	   closer than the rest. Fixes look-alike digits the reader confuses at small
	   sizes (2.50 / 2.00, 5 / 3). */

	var GLYPH_FONT = "GCalcDigits";
	var glyphFont = null;

	function loadGlyphFont() {
		if (!glyphFont) {
			glyphFont = (async function () {
				try {
					var face = new FontFace(GLYPH_FONT, "url(vendor/fonts/roboto-subset.ttf)");
					await face.load();
					document.fonts.add(face);
					return true;
				} catch (e) {
					return false;
				}
			})();
		}
		return glyphFont;
	}

	function normalize(arr) {
		var n = arr.length, mean = 0, i;
		for (i = 0; i < n; i++) mean += arr[i];
		mean /= n;
		var sd = 0;
		for (i = 0; i < n; i++) {
			arr[i] -= mean;
			sd += arr[i] * arr[i];
		}
		sd = Math.sqrt(sd) || 1;
		for (i = 0; i < n; i++) arr[i] /= sd;
		return arr;
	}

	var templateCache = {};

	/* Gray pixels of `text` drawn in Roboto so its ink is inkH tall, placed in a
	   w x h box (text centered on cx, top of ink at top). */
	function drawCandidate(text, w, h, inkH, cx, top) {
		var c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		var ctx = c.getContext("2d", { willReadFrequently: true });
		ctx.fillStyle = "#fff";
		ctx.fillRect(0, 0, w, h);
		var key = text;
		var m100 = templateCache[key];
		if (!m100) {
			ctx.font = "100px " + GLYPH_FONT;
			var mm = ctx.measureText(text);
			m100 = templateCache[key] = { asc: mm.actualBoundingBoxAscent, desc: mm.actualBoundingBoxDescent, left: mm.actualBoundingBoxLeft, right: mm.actualBoundingBoxRight };
		}
		var size = 100 * inkH / Math.max(1, m100.asc + m100.desc);
		ctx.font = size + "px " + GLYPH_FONT;
		ctx.fillStyle = "#000";
		ctx.textBaseline = "alphabetic";
		var k = size / 100;
		var inkW = (m100.left + m100.right) * k;
		ctx.fillText(text, cx - inkW / 2 + m100.left * k, top + m100.asc * k);
		var d = ctx.getImageData(0, 0, w, h).data;
		var out = new Float32Array(w * h);
		for (var i = 0; i < w * h; i++) out[i] = d[i * 4];
		out.inkW = inkW;
		return out;
	}

	/* Returns { value, score, margin } for the candidate that best matches the
	   cell, or null when the font isn't available or the cell is too small. */
	async function shapeRead(cell, candidates, box) {
		if (!cell || !cell.ink || !(await loadGlyphFont())) return null;
		var prep = cell.prep, W = prep.W, g = prep.gray;
		box = box || cell.ink;
		var x0 = box[0], y0 = box[1], x1 = box[2], y1 = box[3];
		var inkH = y1 - y0 + 1;
		if (inkH < 6 || inkH > 200) return null;
		var pad = Math.max(2, Math.round(inkH * 0.25));
		var bx0 = Math.max(0, x0 - pad), by0 = Math.max(0, y0 - pad);
		var bx1 = Math.min(W - 1, x1 + pad), by1 = Math.min(prep.H - 1, y1 + pad);
		var w = bx1 - bx0 + 1, h = by1 - by0 + 1;
		var patch = new Float32Array(w * h);
		for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) patch[yy * w + xx] = g[(by0 + yy) * W + bx0 + xx];
		normalize(patch);
		var cx = (x0 + x1) / 2 - bx0, top = y0 - by0;
		var boxW = x1 - x0 + 1;
		var scored = candidates.map(function (cand) {
			var t = drawCandidate(cand.text, w, h, inkH, cx, top);
			var widthOff = Math.abs(t.inkW - boxW) / boxW;
			t = normalize(t);
			var s = 0;
			for (var i = 0; i < t.length; i++) s += t[i] * patch[i];
			// A candidate much wider or narrower than the text can't be it.
			if (widthOff > 0.2) s -= 0.5;
			return { value: cand.value, text: cand.text, score: s };
		}).sort(function (a, b) { return b.score - a.score; });
		var best = scored[0], second = scored[1] || { score: 0 };
		if (window.GCALC_DEBUG) console.log("shape " + scored.slice(0, 3).map(function (x) { return x.text + "=" + x.score.toFixed(3); }).join(" "));
		return { value: best.value, score: best.score, margin: best.score - second.score, ranked: scored };
	}

	var UNIT_CANDIDATES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (u) { return { value: u, text: String(u) }; });
	var GRADE_CANDIDATES = ["1.00", "1.25", "1.50", "1.75", "2.00", "2.25", "2.50", "2.75", "3.00", "4.00", "5.00"].map(function (g) { return { value: parseFloat(g), text: g }; });

	/* Use the shape check when it is confident; otherwise keep the reader's value.
	   When the readings all agreed (strong), the shape must be very sure to win. */
	async function confirmNumber(cell, value, candidates, strong) {
		var s = await shapeRead(cell, candidates);
		if (!s || s.value === value) return value;
		if (strong ? s.score >= 0.85 && s.margin >= 0.1 : s.score >= 0.7 && s.margin >= 0.05) return s.value;
		return value;
	}

	/* All readings of the cell agreed (at least two of them). */
	function unanimous(res) {
		return !!(res && res.best && res.best.count >= 2 && res.best.count === res.accepted);
	}

	function toGrade(token) {
		// Grades are written with two decimals (1.00, 2.75). Units never are.
		if (!/^[1-5]\.\d{2}$/.test(token)) return 0;
		var g = parseFloat(token);
		return VALID_GRADES.indexOf(g) >= 0 ? g : 0;
	}

	// Digits the reader commonly mixes up with each other.
	var LOOKALIKE = { "1": "74", "7": "12", "5": "63", "6": "508", "0": "896", "8": "0369", "3": "85", "2": "7", "4": "1", "9": "08" };
	var GRADE_TEXT = ["1.00", "1.25", "1.50", "1.75", "2.00", "2.25", "2.50", "2.75", "3.00", "4.00", "5.00"];

	/* "2.15" is not a grade, but a 7 read as a 1 is a common mistake: -> 2.75.
	   Only fixes a single lookalike digit, and only when exactly one grade fits. */
	function fixGrade(token) {
		if (!/^\d\.\d{2}$/.test(token)) return 0;
		if (toGrade(token)) return toGrade(token);
		var fits = GRADE_TEXT.filter(function (g) {
			var diff = 0;
			for (var i = 0; i < 4; i++) {
				if (g[i] === token[i]) continue;
				if ((LOOKALIKE[token[i]] || "").indexOf(g[i]) < 0) return false;
				diff++;
			}
			return diff === 1;
		});
		return fits.length === 1 ? parseFloat(fits[0]) : 0;
	}

	/* Pulls a grade out of whatever the reader saw in a grade cell:
	   "2.75", "2,75", "2. 75", "275", "2.7S" all become 2.75. */
	function gradeFromText(text) {
		var t = text
			.replace(/[Oo]/g, "0").replace(/[Ss]/g, "5").replace(/[Il|]/g, "1").replace(/B/g, "8").replace(/Z/g, "2")
			.replace(/,/g, ".").replace(/\s+/g, "");
		var m = t.match(/[1-5]\.\d{2}/);
		if (m) return fixGrade(m[0]);
		m = t.match(/^[1-5]\d{2}$/); // decimal point missed
		if (m) return fixGrade(m[0][0] + "." + m[0].slice(1));
		return 0;
	}

	function toUnits(token) {
		if (!/^\d{1,2}(\.0)?$/.test(token)) return 0;
		var u = Math.round(parseFloat(token));
		return u >= 1 && u <= 10 ? u : 0;
	}

	function matchCode(text) {
		var m = CODE.exec(text);
		if (!m || NOT_A_SUBJECT.test(m[1])) return null;
		var name = m[1] + " " + m[2].toUpperCase();
		var length = m[0].length;
		// A laboratory part keeps its own row: "CRSCI 1100 LAB A" next to "CRSCI 1100".
		var lab = /^\s*-?\s*LAB\s*([A-Z])?(?![A-Za-z])/.exec(text.slice(m.index + length));
		if (lab) {
			name += " LAB" + (lab[1] ? " " + lab[1] : "");
			length += lab[0].length;
		}
		return { name: name, index: m.index, length: length };
	}

	function makeRow(name, units, grade) {
		return { name: name.slice(0, 40), units: units || 3, grades: grade || 0, unitsFound: units > 0 };
	}

	/* Line mode: "7  PHILI 1100   3   1.00   PASSED" -> { name: "PHILI 1100", units: 3, grades: 1 } */
	function parse(text) {
		var seen = {};
		var rows = [];
		text.split(/\r?\n/).forEach(function (line) {
			var m = matchCode(line);
			if (!m) return;
			var rest = line.slice(m.index + m.length);
			var tokens = rest.match(/\d+(?:\.\d+)?/g) || [];
			var units = 0, grade = 0;
			tokens.forEach(function (t) {
				if (!grade && toGrade(t)) grade = toGrade(t);
				else if (!units && toUnits(t)) units = toUnits(t);
			});
			var key = m.name.replace(/\s+/g, "");
			if (seen[key]) return;
			seen[key] = true;
			rows.push(makeRow(m.name, units, grade));
		});
		return rows;
	}

	async function readText(worker, canvas, psm, whitelist) {
		await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist || WHITELIST });
		var r = await worker.recognize(canvas);
		return { text: (r.data.text || "").replace(/\s+/g, " ").trim(), conf: r.data.confidence || 0 };
	}

	/* Reads a cell with each page mode until accept() takes the text. Small text is
	   read as black-and-white, as grayscale, and as larger grayscale; the value
	   most of the readings agree on wins (ties: the most confident reading). */
	async function bestRead(worker, cell, psms, accept, whitelist) {
		var kinds = cell.small ? ["binary", "gray", "gray2"] : ["binary", "gray"];
		var votes = {}, raw = [];
		var accepted = 0;
		for (var k = 0; k < kinds.length; k++) {
			var canvas = cell.make(kinds[k]);
			for (var p = 0; p < psms.length; p++) {
				var r = await readText(worker, canvas, psms[p], whitelist);
				raw.push(r.text);
				var value = accept(r.text);
				if (value) {
					var key = JSON.stringify(value.name || value);
					var v = votes[key] || (votes[key] = { value: value, count: 0, conf: 0, text: r.text });
					v.count++;
					v.conf = Math.max(v.conf, r.conf);
					accepted++;
					break;
				}
			}
			// Big clear text: stop as soon as one reading is accepted with high confidence.
			if (!cell.small && accepted && Object.keys(votes).length === 1 && votes[Object.keys(votes)[0]].conf >= 80) break;
		}
		var best = null;
		Object.keys(votes).forEach(function (key) {
			var v = votes[key];
			if (!best || v.count > best.count || (v.count === best.count && v.conf > best.conf)) best = v;
		});
		if (window.GCALC_DEBUG) console.log("cell " + JSON.stringify(raw) + " -> " + (best ? JSON.stringify(best.value) : "none"));
		return { best: best, raw: raw, accepted: accepted };
	}

	/* Reads a subject cell. Each reading votes separately for the letters and for
	   the number, so "FIL 1400", "FIL 1100" and "Fit. 1100" agree on FIL 1100. */
	async function readSubject(worker, cell, out) {
		var kinds = cell.small ? ["binary", "gray", "gray2"] : ["binary", "gray"];
		var letters = {}, numbers = {}, raw = [];
		var clean = 0;
		for (var k = 0; k < kinds.length; k++) {
			var r = await readText(worker, cell.make(kinds[k]), "6");
			raw.push(r.text);
			var m = matchCode(r.text);
			var weight = 1;
			if (!m) {
				// Second chance: capitals only, punctuation dropped ("Fit. 1100").
				m = matchCode(r.text.toUpperCase().replace(/[^A-Z0-9& ]/g, ""));
				weight = 0.5;
			}
			if (!m || m.index > 3) continue;
			var parts = m.name.split(" ");
			[[letters, parts[0]], [numbers, parts.slice(1).join(" ")]].forEach(function (pair) {
				var v = pair[0][pair[1]] || (pair[0][pair[1]] = { count: 0, conf: 0 });
				v.count += weight;
				v.conf = Math.max(v.conf, r.conf);
			});
			if (weight === 1) clean++;
			// Big clear text: one confident clean reading is enough.
			if (!cell.small && clean && r.conf >= 85) break;
		}
		function pick(votes) {
			var best = null, bestKey = null;
			Object.keys(votes).forEach(function (key) {
				var v = votes[key];
				if (!best || v.count > best.count || (v.count === best.count && v.conf > best.conf)) {
					best = v;
					bestKey = key;
				}
			});
			return bestKey;
		}
		// Readings that are a known prefix outvote ones that aren't.
		var known = {};
		Object.keys(letters).forEach(function (k) { if (KNOWN_PREFIXES[k]) known[k] = letters[k]; });
		var prefix = Object.keys(known).length ? pick(known) : Object.keys(letters).length ? fixPrefix(pick(letters)) : null;
		var name = prefix ? prefix + " " + pick(numbers) : null;
		if (window.GCALC_DEBUG) console.log("subject " + JSON.stringify(raw) + " -> " + name);
		if (out) out.raw = raw;
		return name;
	}

	/* Letters that are really digits in a number-only cell ("S" for 5, "l" for 1). */
	function lookalikeDigits(text) {
		return text.replace(/[Ss$]/g, "5").replace(/[Oo]/g, "0").replace(/[Il|!\]\[]/g, "1").replace(/Z/g, "2").replace(/B/g, "8").replace(/G/g, "6").replace(/[Tt]/g, "7");
	}

	function hasWords(text) {
		return /[A-Za-z]{3,}/.test(text.replace(/[OoSsIlBZ]/g, ""));
	}

	/* Table mode: walk each row's cells left to right: [No.] Subject, Units, Grade, ... */
	async function readTable(worker, prep, report) {
		var grid = prep.grid;
		var rows = [];
		var seen = {};
		var totalRow = null;
		for (var r = 0; r < grid.rows.length; r++) {
			report(0.3 + 0.65 * (r / grid.rows.length), "Reading row " + (r + 1) + " of " + grid.rows.length);
			var band = grid.rows[r];
			var name = null, units = 0, grade = 0, nameCol = -1, unitsCol = -1, unitsRank = null, rowNo = 0;
			var phase = "subject", tried = 0;

			for (var c = 0; c < grid.cols.length; c++) {
				var col = grid.cols[c];
				var cell = cropCell(prep, col[0], band[0], col[1], band[1]);
				if (!cell) continue;

				if (phase === "subject") {
					if (++tried > 3) break; // no code in the first cells: not a subject row
					var seenText = {};
					var subject = await readSubject(worker, cell, seenText);
					if (subject) {
						name = subject;
						nameCol = c;
						phase = "units";
					} else {
						var rawText = (seenText.raw || []).join(" ");
						if (/TOTAL/i.test(rawText)) {
							totalRow = { band: band };
							break;
						}
						var no = (seenText.raw || []).map(function (t) { return t.trim(); }).filter(function (t) { return /^\d{1,2}$/.test(t); });
						if (no.length) rowNo = parseInt(no[0], 10);
					}
				} else if (phase === "units") {
					// A lone digit is easy to miss as a block; read it as a single word or character.
					var u1 = await bestRead(worker, cell, ["8", "10"], toUnits, "0123456789.");
					if (!u1.best) {
						// A lone "1" is thin and easy to lose: read again allowing lookalikes,
						// and fall back to the glyph's shape (tall and narrow, one stroke).
						var u2 = await bestRead(worker, cell, ["10", "8"], function (t) { return hasWords(t) ? 0 : toUnits(lookalikeDigits(t.trim())); });
						if (u2.best) u1 = u2;
						else if (!u1.raw.some(function (t) { return /\d/.test(t); }) && cell.inkHeight > 6 && cell.inkWidth / cell.inkHeight < 0.45) {
							u1 = { best: { value: 1 }, raw: u1.raw };
						}
					}
					if (!u1.best && !u1.raw.some(hasWords)) {
						var su = await shapeRead(cell, UNIT_CANDIDATES);
						if (su && su.score >= 0.8 && su.margin >= 0.06) u1 = { best: { value: su.value }, raw: u1.raw };
					}
					if (u1.best) {
						var su2 = await shapeRead(cell, UNIT_CANDIDATES);
						unitsRank = su2 && su2.ranked;
						units = decideNumber(su2, u1.best.value, unanimous(u1));
						unitsCol = c;
						phase = "grade";
					} else {
						var asGrade = u1.raw.map(gradeFromText).filter(Boolean)[0];
						if (asGrade) {
							grade = asGrade;
							break;
						}
						phase = "grade";
						c--; // this cell may be the grade column; look at it again
					}
				} else {
					var g1 = await bestRead(worker, cell, ["7"], function (t) { return hasWords(t) ? 0 : gradeFromText(t); });
					var gStrong = unanimous(g1);
					if (g1.best) {
						grade = g1.best.value;
					} else if (!g1.raw.some(hasWords)) {
						// No words in the cell, so it should be a number: read digits only.
						var g2 = await bestRead(worker, cell, ["7", "8"], gradeFromText, "0123456789.,");
						if (g2.best) grade = g2.best.value;
						gStrong = unanimous(g2);
					}
					if (grade) grade = await confirmNumber(cell, grade, GRADE_CANDIDATES, gStrong);
					break; // first cell after units is the grade (or "NOT YET")
				}
			}

			if (name) {
				var key = name.replace(/\s+/g, "");
				if (!seen[key]) {
					seen[key] = true;
					var row = makeRow(name, units, grade);
					row.col = nameCol;
					row.extent = band.extent || [0, prep.W];
					row.extentBelow = band.extentBelow || row.extent;
					row.height = band[1] - band[0];
					row.rowNo = rowNo;
					row.unitsCol = unitsCol;
					row.unitsRank = unitsRank;
					rows.push(row);
				}
			}
		}

		// The TOTAL row's units, to double-check the units of every subject.
		var total = 0;
		if (totalRow) {
			var uc = modeOf(rows.map(function (x) { return x.unitsCol; }).filter(function (x) { return x >= 0; }));
			if (uc >= 0) {
				var tcell = cropCell(prep, grid.cols[uc][0], totalRow.band[0], grid.cols[uc][1], totalRow.band[1]);
				if (tcell) {
					var t1 = await bestRead(worker, tcell, ["8", "7"], function (t) { var v = t.trim(); return /^\d{1,3}$/.test(v) ? parseInt(v, 10) : 0; }, "0123456789");
					if (t1.best) total = t1.best.value;
				}
			}
		}
		return finalizeRows(rows, prep, total);
	}

	function modeOf(values) {
		var counts = {}, best = -1, bestN = 0;
		values.forEach(function (v) {
			counts[v] = (counts[v] || 0) + 1;
			if (counts[v] > bestN) { bestN = counts[v]; best = v; }
		});
		return best;
	}

	/* The shape check's choice when it is confident, otherwise the reader's. */
	function decideNumber(s, value, strong) {
		if (!s || s.value === value) return value;
		if (strong ? s.score >= 0.85 && s.margin >= 0.1 : s.score >= 0.7 && s.margin >= 0.05) return s.value;
		return value;
	}

	/* When the whole table is on the screenshot (row numbers 1..n) and the units
	   don't add up to the TOTAL row, change the one units value whose next-best
	   shape makes them add up. */
	function fixUnitsByTotal(rows, total) {
		if (!total || !rows.length) return;
		var sum = rows.reduce(function (a, r) { return a + r.units; }, 0);
		var diff = total - sum;
		if (!diff) return;
		var nos = rows.map(function (r) { return r.rowNo; }).sort(function (a, b) { return a - b; });
		for (var i = 0; i < nos.length; i++) if (nos[i] !== i + 1) return; // rows missing or unnumbered
		var best = null;
		rows.forEach(function (r) {
			if (!r.unitsRank || !r.unitsFound) return;
			var cur = r.unitsRank.filter(function (x) { return x.value === r.units; })[0];
			var curScore = cur ? cur.score : 0;
			r.unitsRank.slice(0, 4).forEach(function (alt) {
				if (alt.value - r.units !== diff || alt.score < 0.4) return;
				var cost = curScore - alt.score;
				if (!best || cost < best.cost) best = { row: r, value: alt.value, cost: cost };
			});
		});
		if (best) {
			if (window.GCALC_DEBUG) console.log("total " + total + ": " + best.row.name + " units " + best.row.units + " -> " + best.value);
			best.row.units = best.value;
		}
	}

	/* Keeps only rows that belong to the grades table. */
	function finalizeRows(rows, prep, total) {
		// Real subjects all sit in the same column. Anything found elsewhere
		// (a "1ST SEMESTER 2026-2027" box above the table, say) is dropped.
		var votes = {};
		rows.forEach(function (r) { votes[r.col] = (votes[r.col] || 0) + 1; });
		var best = -1, bestVotes = 0;
		Object.keys(votes).forEach(function (k) {
			if (votes[k] > bestVotes) {
				bestVotes = votes[k];
				best = Number(k);
			}
		});
		rows = rows.filter(function (r) { return r.col === best; });

		// Table rows are bounded by lines of the same length; a box above the
		// table is not. Keep rows whose line matches the typical (median) one.
		function median(values) {
			var v = values.slice().sort(function (a, b) { return a - b; });
			return v[Math.floor(v.length / 2)];
		}
		var midLeft = median(rows.map(function (r) { return r.extent[0]; }));
		var midRight = median(rows.map(function (r) { return r.extent[1]; }));
		var tolerance = prep.W * 0.04;
		function fits(ext) {
			return Math.abs(ext[0] - midLeft) <= tolerance && Math.abs(ext[1] - midRight) <= tolerance;
		}
		// The line above or the line below must belong to the table (the first
		// visible row may sit right under the site's full-width header bar).
		var heights = rows.filter(function (r) { return fits(r.extent); }).map(function (r) { return r.height; });
		var typical = heights.length ? median(heights) : Infinity;
		rows = rows.filter(function (r) {
			if (fits(r.extent)) return true;
			// Only the line below is the table's: accept a row-sized band only (not
			// the page header with the semester dropdown above the table).
			return fits(r.extentBelow) && r.height <= typical * 1.5;
		});
		fixUnitsByTotal(rows, total);
		return rows.map(function (r) {
			delete r.col;
			delete r.extent;
			delete r.extentBelow;
			delete r.height;
			delete r.rowNo;
			delete r.unitsCol;
			delete r.unitsRank;
			return r;
		});
	}

	/* ---------- Layout mode (on-device AI text recognition on Android) ----------
	   Input: lines of text with their positions, e.g. from Google ML Kit:
	   [{ text, box: [left, top, right, bottom], elements: [{ text, box }] }].
	   Rows are rebuilt from positions; the UNITS and GRADE headers, when found,
	   decide which number in a row is which. */

	function center(box) {
		return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
	}

	function headerX(elements, word) {
		// Finds a header word, also when glued to its neighbour ("SUBJECTSUNITS").
		for (var i = 0; i < elements.length; i++) {
			var e = elements[i], t = e.text.toUpperCase();
			var at = t.indexOf(word);
			if (at < 0) continue;
			var b = e.box, per = (b[2] - b[0]) / Math.max(1, t.length);
			var end = t.indexOf(" ", at) < 0 ? at + word.length + (t[at + word.length] === "S" ? 1 : 0) : t.indexOf(" ", at);
			return { x: b[0] + per * (at + end) / 2, y: center(b)[1], h: b[3] - b[1] };
		}
		return null;
	}

	function parseLayout(layout) {
		var lines = (layout && layout.lines) || [];
		var elements = [];
		lines.forEach(function (l) {
			(l.elements && l.elements.length ? l.elements : [l]).forEach(function (e) {
				if (e.text && e.box) elements.push({ text: e.text.trim(), box: e.box });
			});
		});
		if (!elements.length) return [];

		var unitsH = headerX(elements, "UNIT");
		var gradeH = headerX(elements, "GRADE");
		var headerY = unitsH ? unitsH.y : gradeH ? gradeH.y : -Infinity;

		// 1. Subject codes: "INTECH 3100" on one line, or "INTECH" above "3100".
		var used = {};
		var subjects = [];
		elements.forEach(function (e, i) {
			if (used[i] || center(e.box)[1] <= headerY) return;
			var word = e.text.replace(/[^A-Z&]/g, "");
			if (!/^[A-Z][A-Z&]{1,11}$/.test(e.text.replace(/[^A-Za-z&]/g, "")) || e.text !== e.text.toUpperCase()) return;
			if (NOT_A_SUBJECT.test(word)) return;
			var whole = matchCode(e.text);
			if (whole) { // code and number in one element ("PE3", "NSTP12")
				subjects.push({ name: whole.name, box: e.box.slice() });
				used[i] = true;
				return;
			}
			var h = e.box[3] - e.box[1];
			var best = -1, bestDist = Infinity;
			elements.forEach(function (f, j) {
				if (j === i || used[j] || !/^\d{1,4}[A-Z]?$/.test(f.text)) return;
				var sameLine = Math.abs(center(f.box)[1] - center(e.box)[1]) < h * 0.5 && f.box[0] > e.box[0] && f.box[0] - e.box[2] < h * 1.5;
				var below = f.box[1] > e.box[1] + h * 0.5 && f.box[1] - e.box[3] < h * 2.2 && Math.abs(f.box[0] - e.box[0]) < h * 1.5;
				if (!sameLine && !below) return;
				var dist = Math.abs(f.box[0] - e.box[2]) + Math.abs(f.box[1] - e.box[1]);
				if (dist < bestDist) {
					bestDist = dist;
					best = j;
				}
			});
			if (best < 0) return;
			var num = elements[best];
			used[i] = used[best] = true;
			subjects.push({
				name: word + " " + num.text,
				box: [Math.min(e.box[0], num.box[0]), Math.min(e.box[1], num.box[1]), Math.max(e.box[2], num.box[2]), Math.max(e.box[3], num.box[3])]
			});
		});
		if (!subjects.length) return [];

		// Real subjects line up in one column.
		var lefts = subjects.map(function (s) { return s.box[0]; }).sort(function (a, b) { return a - b; });
		var midLeft = lefts[Math.floor(lefts.length / 2)];
		var width = layout.width || Math.max.apply(null, elements.map(function (e) { return e.box[2]; }));
		subjects = subjects.filter(function (s) { return Math.abs(s.box[0] - midLeft) < width * 0.05; });

		// 2. Units and grade: numbers on the same row, right of the subject.
		var seen = {};
		var rows = [];
		subjects.sort(function (a, b) { return a.box[1] - b.box[1]; });
		subjects.forEach(function (s) {
			var top = s.box[1], bottom = s.box[3], h = bottom - top;
			var inRow = elements.filter(function (e) {
				var cy = center(e.box)[1];
				return e.box[0] > s.box[2] - 2 && cy > top - h * 0.35 && cy < bottom + h * 0.35;
			});
			function pick(test, near) {
				var cands = inRow.filter(function (e) { return test(e.text); });
				if (!cands.length) return null;
				cands.sort(function (a, b) {
					return near ? Math.abs(center(a.box)[0] - near.x) - Math.abs(center(b.box)[0] - near.x) : a.box[0] - b.box[0];
				});
				return cands[0];
			}
			var u = pick(function (t) { return toUnits(t); }, unitsH);
			var g = pick(function (t) { return !hasWords(t) && gradeFromText(t); }, gradeH);
			if (g && u && g === u) u = null;
			var key = s.name.replace(/\s+/g, "");
			if (seen[key]) return;
			seen[key] = true;
			rows.push(makeRow(s.name, u ? toUnits(u.text) : 0, g ? gradeFromText(g.text) : 0));
		});
		return rows;
	}

	/* Asks the Android app to read the image with Google ML Kit (on-device). */
	var nativeCalls = {};
	window.GCalcNativeText = function (id, layout, error) {
		var call = nativeCalls[id];
		if (!call) return;
		delete nativeCalls[id];
		if (layout) call.resolve(layout);
		else call.reject(new Error(error || "Text recognition failed."));
	};

	function hasNativeReader() {
		try {
			return !!(window.GCalcAndroid && window.GCalcAndroid.nativeTextAvailable && window.GCalcAndroid.nativeTextAvailable());
		} catch (e) {
			return false;
		}
	}

	function readNativeBase64(base64) {
		return new Promise(function (resolve, reject) {
			var id = "r" + Date.now() + Math.random().toString(36).slice(2);
			var timer = setTimeout(function () {
				if (nativeCalls[id]) {
					delete nativeCalls[id];
					reject(new Error("Text recognition timed out."));
				}
			}, 30000);
			nativeCalls[id] = {
				resolve: function (v) { clearTimeout(timer); resolve(v); },
				reject: function (e) { clearTimeout(timer); reject(e); }
			};
			window.GCalcAndroid.recognizeText(id, base64);
		});
	}

	function readNative(file) {
		return new Promise(function (resolve, reject) {
			var fr = new FileReader();
			fr.onerror = function () { reject(new Error("Could not open the image.")); };
			fr.onload = function () {
				readNativeBase64(String(fr.result).split(",")[1] || "").then(resolve, reject);
			};
			fr.readAsDataURL(file);
		});
	}

	/* The prepared screenshot in grayscale with the table lines removed: what the
	   AI reader sees in table mode (lines make it glue "|" onto codes, "ISTAT"). */
	function grayCanvas(prep) {
		var c = document.createElement("canvas");
		c.width = prep.W;
		c.height = prep.H;
		var ctx = c.getContext("2d");
		var img = ctx.createImageData(prep.W, prep.H);
		var d = img.data, g = prep.gray;
		for (var i = 0, n = prep.W * prep.H; i < n; i++) {
			d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g[i];
			d[i * 4 + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
		return c;
	}

	/* ---------- AI table mode: the AI reads the page, the grid says which cell
	   each word belongs to. Cells whose text doesn't make sense (a units cell
	   that isn't 1-10, a grade that isn't a real grade) are read again with
	   Tesseract. ---------- */

	function bandIndex(bands, v) {
		for (var i = 0; i < bands.length; i++) if (v >= bands[i][0] - 2 && v <= bands[i][1] + 2) return i;
		return -1;
	}

	/* Puts every word into its cell. A word that runs across a column line
	   ("31.25" for "3" and "1.25" side by side) is split at the line. */
	function wordsByCell(prep, layout) {
		var grid = prep.grid;
		var k = prep.W / (layout.width || prep.W);
		var cells = {};
		function add(r, c, text, box) {
			var key = r + "," + c;
			(cells[key] = cells[key] || []).push({ text: text, box: box });
		}
		(layout.lines || []).forEach(function (line) {
			(line.elements && line.elements.length ? line.elements : [line]).forEach(function (e) {
				if (!e.text || !e.box) return;
				var box = e.box.map(function (v) { return v * k; });
				var r = bandIndex(grid.rows, (box[1] + box[3]) / 2);
				if (r < 0) return;
				var text = e.text.trim();
				var per = (box[2] - box[0]) / Math.max(1, text.length);
				var parts = {};
				for (var i = 0; i < text.length; i++) {
					var c = bandIndex(grid.cols, box[0] + per * (i + 0.5));
					if (c < 0) continue;
					var part = parts[c] || (parts[c] = { text: "", x0: box[0] + per * i, x1: 0 });
					part.text += text[i];
					part.x1 = box[0] + per * (i + 1);
				}
				Object.keys(parts).forEach(function (c) {
					var part = parts[c];
					if (part.text.trim()) add(r, Number(c), part.text.trim(), [part.x0, box[1], part.x1, box[3]]);
				});
			});
		});
		return function cellText(r, c) {
			var words = (cells[r + "," + c] || []).slice().sort(function (a, b) { return a.box[1] - b.box[1]; });
			var lines = [];
			words.forEach(function (w) {
				var line = lines[lines.length - 1];
				var h = w.box[3] - w.box[1];
				if (line && Math.abs(w.box[1] - line.top) < h * 0.5) line.words.push(w);
				else lines.push({ top: w.box[1], words: [w] });
			});
			return lines.map(function (l) {
				return l.words.sort(function (a, b) { return a.box[0] - b.box[0]; }).map(function (w) { return w.text; }).join(" ");
			}).join(" ").trim();
		};
	}

	async function readTableAI(prep, layout, getTesseract, report) {
		var grid = prep.grid;
		var cellText = wordsByCell(prep, layout);
		var rows = [];
		var seen = {};
		var totalRow = -1;
		for (var r = 0; r < grid.rows.length; r++) {
			report(0.45 + 0.5 * (r / grid.rows.length), "Checking row " + (r + 1) + " of " + grid.rows.length);
			var band = grid.rows[r];
			var name = null, units = 0, grade = 0, nameCol = -1, unitsCol = -1, unitsRank = null, rowNo = 0;
			var phase = "subject", tried = 0;

			for (var c = 0; c < grid.cols.length; c++) {
				var col = grid.cols[c];
				var cell = cropCell(prep, col[0], band[0], col[1], band[1]);
				var text = cellText(r, c);
				if (!cell && !text) continue;

				if (phase === "subject") {
					if (++tried > 3) break; // no code in the first cells: not a subject row
					var m = matchCode(text) || matchCode(text.toUpperCase().replace(/[^A-Z0-9& ]/g, ""));
					if (m && m.index <= 3) {
						var mp = m.name.split(" ");
						name = fixPrefix(mp[0]) + " " + mp.slice(1).join(" ");
					} else if (cell && /[A-Za-z]{2}/.test(text) && /\d/.test(text)) {
						// Looks like a code the AI garbled: let Tesseract try this cell.
						name = await readSubject(await getTesseract(), cell);
					}
					if (name) {
						nameCol = c;
						phase = "units";
					} else if (/TOTAL/i.test(text)) {
						totalRow = r;
						break;
					} else if (/^\d{1,2}$/.test(text)) {
						rowNo = parseInt(text, 10);
					}
				} else if (phase === "units") {
					var u = hasWords(text) ? 0 : toUnits(lookalikeDigits(text.replace(/\s+/g, "")));
					if (!u && cell && !hasWords(text) && !gradeFromText(text)) {
						// Empty to the AI, or not 1-10: read the lone digit with Tesseract.
						var tw = await getTesseract();
						var u1 = await bestRead(tw, cell, ["8", "10"], toUnits, "0123456789.");
						if (!u1.best) u1 = await bestRead(tw, cell, ["10", "8"], function (t) { return hasWords(t) ? 0 : toUnits(lookalikeDigits(t.trim())); });
						if (u1.best) u = u1.best.value;
					}
					if (u) {
						var su = await shapeRead(cell, UNIT_CANDIDATES);
						unitsRank = su && su.ranked;
						units = decideNumber(su, u, true);
						unitsCol = c;
						phase = "grade";
					} else {
						if (gradeFromText(text) && !hasWords(text)) {
							grade = gradeFromText(text);
							break;
						}
						phase = "grade";
						c--; // this cell may be the grade column; look at it again
					}
				} else {
					if (!hasWords(text)) {
						grade = gradeFromText(text);
						if (!grade && cell) {
							var gw = await getTesseract();
							var g1 = await bestRead(gw, cell, ["7"], function (t) { return hasWords(t) ? 0 : gradeFromText(t); });
							if (!g1.best && !g1.raw.some(hasWords)) g1 = await bestRead(gw, cell, ["7", "8"], gradeFromText, "0123456789.,");
							if (g1.best) grade = g1.best.value;
						}
						if (grade) grade = await confirmNumber(cell, grade, GRADE_CANDIDATES, true);
					}
					break; // first cell after units is the grade (or "NOT YET")
				}
			}

			if (name) {
				var key = name.replace(/\s+/g, "");
				if (!seen[key]) {
					seen[key] = true;
					var row = makeRow(name, units, grade);
					row.col = nameCol;
					row.extent = band.extent || [0, prep.W];
					row.extentBelow = band.extentBelow || row.extent;
					row.height = band[1] - band[0];
					row.rowNo = rowNo;
					row.unitsCol = unitsCol;
					row.unitsRank = unitsRank;
					rows.push(row);
				}
			}
		}
		var total = 0;
		if (totalRow >= 0) {
			var uc = modeOf(rows.map(function (x) { return x.unitsCol; }).filter(function (x) { return x >= 0; }));
			var tt = uc >= 0 ? cellText(totalRow, uc).replace(/\s+/g, "") : "";
			if (/^\d{1,3}$/.test(tt)) total = parseInt(tt, 10);
		}
		return finalizeRows(rows, prep, total);
	}

	/**
	 * Reads a grades screenshot.
	 * onProgress(0..1, label) is called while it works.
	 * Resolves to { rows: [{ name, units, grades, unitsFound }], mode }.
	 */
	async function read(file, onProgress) {
		var report = typeof onProgress === "function" ? onProgress : function () {};
		report(0.02, "Opening image");

		// Android app: Google's on-device text recognition is the most accurate.
		if (hasNativeReader() && !window.GCALC_FORCE_TESSERACT) {
			var aiWorker = null;
			try {
				var aiImg = await loadImage(file);
				var aiPrep = prepare(aiImg);
				if (aiPrep.grid) {
					report(0.25, "Reading text");
					var gridLayout = await readNativeBase64(grayCanvas(aiPrep).toDataURL("image/png").split(",")[1]);
					var getTesseract = async function () {
						if (!aiWorker) {
							var T0 = await loadLibrary();
							aiWorker = await T0.createWorker("eng", 1, {
								workerPath: BASE + "worker.min.js", corePath: BASE + "core", langPath: BASE + "lang",
								gzip: false, cacheMethod: "none", workerBlobURL: false
							});
							await aiWorker.setParameters({ preserve_interword_spaces: "1", tessedit_char_whitelist: WHITELIST });
						}
						return aiWorker;
					};
					var tableRows = await readTableAI(aiPrep, gridLayout, getTesseract, report);
					if (tableRows.length) {
						report(1, "Done");
						return { rows: tableRows, mode: "ai", layout: window.GCALC_DEBUG ? gridLayout : undefined };
					}
				}
			} catch (e) {
				if (window.GCALC_DEBUG) console.log("AI table mode failed: " + e.message);
			} finally {
				if (aiWorker) aiWorker.terminate();
			}
			try {
				report(0.3, "Reading text");
				var layout = await readNative(file);
				var aiRows = parseLayout(layout);
				if (window.GCALC_DEBUG) console.log("native lines: " + JSON.stringify((layout.lines || []).map(function (l) { return l.text; })));
				if (aiRows.length) {
					report(1, "Done");
					return { rows: aiRows, mode: "ai", layout: window.GCALC_DEBUG ? layout : undefined };
				}
			} catch (e) {
				if (window.GCALC_DEBUG) console.log("native reader failed: " + e.message);
			}
			report(0.05, "Trying another way");
		}

		var loaded = await Promise.all([loadLibrary(), loadImage(file)]);
		try {
			return await readWithTesseract(loaded[0], loaded[1], report);
		} catch (err) {
			// Safari can run the reader out of memory on very tall screenshots:
			// start a fresh reader on a smaller copy and try once more.
			if (!/memory|bounds|abort|RuntimeError/i.test(String(err && (err.message || err)))) throw err;
			report(0.1, "Trying again");
			return await readWithTesseract(loaded[0], loaded[1], report, 5e6);
		}
	}

	async function readWithTesseract(T, img, report, maxPixels) {
		var worker = null;
		try {
			var prep = prepare(img, maxPixels);
			report(0.1, "Starting the reader");
			worker = await T.createWorker("eng", 1, {
				workerPath: BASE + "worker.min.js",
				corePath: BASE + "core",
				langPath: BASE + "lang",
				gzip: false,
				cacheMethod: "none",
				workerBlobURL: false
			});
			await worker.setParameters({
				preserve_interword_spaces: "1",
				tessedit_char_whitelist: WHITELIST
			});
			report(0.25, "Reading text");

			if (prep.grid) {
				var tableRows = await readTable(worker, prep, report);
				if (tableRows.length) {
					report(1, "Done");
					return { rows: tableRows, mode: "table" };
				}
			}

			report(0.5, "Reading text");
			await worker.setParameters({ tessedit_pageseg_mode: "6" });
			var result = await worker.recognize(prep.canvas);
			report(1, "Done");
			return { rows: parse(result.data.text || ""), mode: "lines" };
		} finally {
			if (worker) {
				try {
					await worker.terminate();
				} catch (e) {
					/* already gone */
				}
			}
		}
	}

	window.GCalcOCR = { read: read, parse: parse, parseLayout: parseLayout, _prepare: prepare, _cropCell: cropCell, _shapeRead: shapeRead, _drawCandidate: drawCandidate, _loadGlyphFont: loadGlyphFont };
})();
