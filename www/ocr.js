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

	/* The space between consecutive lines. */
	function bandsBetween(lines, minSize) {
		var bands = [];
		for (var i = 0; i + 1 < lines.length; i++) {
			var a = lines[i][1] + 3, b = lines[i + 1][0] - 3;
			if (b - a >= minSize) {
				var band = [a, b];
				band.extent = lines[i].extent; // left/right ends of the line above
				bands.push(band);
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
	function prepare(img) {
		var scale = Math.min(3, TARGET_WIDTH / img.width);
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
				rows: bandsBetween(rowLines, 18),
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
		if (count < 25 || maxX - minX < 4 || maxY - minY < 8) return null; // empty cell

		minX = Math.max(x0, minX - 2);
		minY = Math.max(y0, minY - 2);
		maxX = Math.min(x1, maxX + 2);
		maxY = Math.min(y1, maxY + 2);
		var w = maxX - minX + 1, h = maxY - minY + 1;

		// Roughly one line of text is rowsWithInk tall (two for a wrapped code).
		var lineHeight = rowsWithInk > 60 && rowsWithInk > h * 0.6 ? rowsWithInk / 2 : rowsWithInk;
		var scale = Math.max(1, Math.min(4, 40 / Math.max(1, lineHeight)));
		var cache = {};

		function make(kind) {
			if (cache[kind]) return cache[kind];
			var src = document.createElement("canvas");
			src.width = w;
			src.height = h;
			var sctx = src.getContext("2d");
			var img = sctx.createImageData(w, h);
			var d = img.data;
			for (var yy = 0; yy < h; yy++) {
				for (var xx = 0; xx < w; xx++) {
					var i = (minY + yy) * W + (minX + xx);
					var v = kind === "gray" ? gray[i] : (clean[i] ? 0 : 255);
					var o = (yy * w + xx) * 4;
					d[o] = d[o + 1] = d[o + 2] = v;
					d[o + 3] = 255;
				}
			}
			sctx.putImageData(img, 0, 0);
			var pad = 24;
			var c = document.createElement("canvas");
			c.width = Math.round(w * scale) + pad * 2;
			c.height = Math.round(h * scale) + pad * 2;
			var ctx = c.getContext("2d");
			ctx.fillStyle = "#fff";
			ctx.fillRect(0, 0, c.width, c.height);
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = "high";
			ctx.drawImage(src, pad, pad, Math.round(w * scale), Math.round(h * scale));
			cache[kind] = c;
			return c;
		}

		return { make: make, small: lineHeight < 30 };
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
		return { name: m[1] + " " + m[2].toUpperCase(), index: m.index, length: m[0].length };
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
	   read both as black-and-white and as grayscale, and the more confident of
	   the accepted readings wins. */
	async function bestRead(worker, cell, psms, accept, whitelist) {
		var kinds = cell.small ? ["binary", "gray"] : ["binary"];
		var best = null, raw = [];
		for (var k = 0; k < kinds.length; k++) {
			var canvas = cell.make(kinds[k]);
			for (var p = 0; p < psms.length; p++) {
				var r = await readText(worker, canvas, psms[p], whitelist);
				raw.push(r.text);
				var value = accept(r.text);
				if (value) {
					if (!best || r.conf > best.conf) best = { value: value, conf: r.conf, text: r.text };
					break;
				}
			}
		}
		if (window.GCALC_DEBUG) console.log("cell " + JSON.stringify(raw) + " -> " + (best ? JSON.stringify(best.value) : "none"));
		return { best: best, raw: raw };
	}

	function hasWords(text) {
		return /[A-Za-z]{3,}/.test(text.replace(/[OoSsIlBZ]/g, ""));
	}

	/* Table mode: walk each row's cells left to right: [No.] Subject, Units, Grade, ... */
	async function readTable(worker, prep, report) {
		var grid = prep.grid;
		var rows = [];
		var seen = {};
		for (var r = 0; r < grid.rows.length; r++) {
			report(0.3 + 0.65 * (r / grid.rows.length), "Reading row " + (r + 1) + " of " + grid.rows.length);
			var band = grid.rows[r];
			var name = null, units = 0, grade = 0, nameCol = -1;
			var phase = "subject", tried = 0;

			for (var c = 0; c < grid.cols.length; c++) {
				var col = grid.cols[c];
				var cell = cropCell(prep, col[0], band[0], col[1], band[1]);
				if (!cell) continue;

				if (phase === "subject") {
					if (++tried > 3) break; // no code in the first cells: not a subject row
					var s1 = await bestRead(worker, cell, ["6"], matchCode);
					if (s1.best) {
						name = s1.best.value.name;
						nameCol = c;
						phase = "units";
					}
				} else if (phase === "units") {
					// A lone digit is easy to miss as a block; read it as a single word or character.
					var u1 = await bestRead(worker, cell, ["8", "10"], toUnits, "0123456789.");
					if (u1.best) {
						units = u1.best.value;
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
					if (g1.best) {
						grade = g1.best.value;
					} else if (!g1.raw.some(hasWords)) {
						// No words in the cell, so it should be a number: read digits only.
						var g2 = await bestRead(worker, cell, ["7", "8"], gradeFromText, "0123456789.,");
						if (g2.best) grade = g2.best.value;
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
					rows.push(row);
				}
			}
		}

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
		return rows.filter(function (r) {
			return Math.abs(r.extent[0] - midLeft) <= tolerance && Math.abs(r.extent[1] - midRight) <= tolerance;
		}).map(function (r) {
			delete r.col;
			delete r.extent;
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

	function readNative(file) {
		return new Promise(function (resolve, reject) {
			var fr = new FileReader();
			fr.onerror = function () { reject(new Error("Could not open the image.")); };
			fr.onload = function () {
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
				var base64 = String(fr.result).split(",")[1] || "";
				window.GCalcAndroid.recognizeText(id, base64);
			};
			fr.readAsDataURL(file);
		});
	}

	/**
	 * Reads a grades screenshot.
	 * onProgress(0..1, label) is called while it works.
	 * Resolves to { rows: [{ name, units, grades, unitsFound }], mode }.
	 */
	async function read(file, onProgress) {
		var report = typeof onProgress === "function" ? onProgress : function () {};
		var worker = null;
		report(0.02, "Opening image");

		// Android app: Google's on-device text recognition is the most accurate.
		if (hasNativeReader() && !window.GCALC_FORCE_TESSERACT) {
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

		try {
			var loaded = await Promise.all([loadLibrary(), loadImage(file)]);
			var T = loaded[0];
			var prep = prepare(loaded[1]);
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
			if (worker) worker.terminate();
		}
	}

	window.GCalcOCR = { read: read, parse: parse, parseLayout: parseLayout, _prepare: prepare };
})();
