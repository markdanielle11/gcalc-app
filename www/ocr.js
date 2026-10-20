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

	/* Left and right ends of each horizontal line. */
	function addExtents(lines, eraseH, W) {
		lines.forEach(function (line) {
			var left = W, right = 0;
			for (var y = line[0]; y <= line[1]; y++) {
				for (var x = 0; x < W; x++) {
					if (eraseH[y * W + x]) {
						if (x < left) left = x;
						if (x > right) right = x;
					}
				}
			}
			line.extent = [left, right];
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

		return { canvas: canvas, clean: clean, W: W, H: H, grid: grid };
	}

	/* Copies one cell (text only) onto a small white canvas with a margin. */
	function cropCell(prep, x0, y0, x1, y1) {
		var W = prep.W, clean = prep.clean;
		var minX = x1, minY = y1, maxX = x0, maxY = y0, count = 0;
		for (var y = y0; y <= y1; y++) {
			for (var x = x0; x <= x1; x++) {
				if (clean[y * W + x]) {
					count++;
					if (x < minX) minX = x;
					if (x > maxX) maxX = x;
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
				}
			}
		}
		if (count < 25 || maxX - minX < 4 || maxY - minY < 8) return null; // empty cell

		var pad = 20;
		var w = maxX - minX + 1, h = maxY - minY + 1;
		var c = document.createElement("canvas");
		c.width = w + pad * 2;
		c.height = h + pad * 2;
		var ctx = c.getContext("2d");
		var img = ctx.createImageData(c.width, c.height);
		var d = img.data;
		for (var i = 0; i < d.length; i += 4) {
			d[i] = d[i + 1] = d[i + 2] = 255;
			d[i + 3] = 255;
		}
		for (var yy = 0; yy < h; yy++) {
			for (var xx = 0; xx < w; xx++) {
				if (clean[(minY + yy) * W + (minX + xx)]) {
					var o = ((yy + pad) * c.width + (xx + pad)) * 4;
					d[o] = d[o + 1] = d[o + 2] = 0;
				}
			}
		}
		ctx.putImageData(img, 0, 0);
		return c;
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

	async function recognizeCell(worker, canvas, psm) {
		await worker.setParameters({ tessedit_pageseg_mode: psm });
		var r = await worker.recognize(canvas);
		return (r.data.text || "").replace(/\s+/g, " ").trim();
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
					var t = await recognizeCell(worker, cell, "6");
					var m = matchCode(t);
					if (m) {
						name = m.name;
						nameCol = c;
						phase = "units";
					}
				} else if (phase === "units") {
					// A lone digit is easy to miss as a block; read it as a single word.
					var u = await recognizeCell(worker, cell, "8");
					if (!toUnits(u)) u = await recognizeCell(worker, cell, "10");
					if (toUnits(u)) {
						units = toUnits(u);
						phase = "grade";
					} else if (toGrade(u)) {
						grade = toGrade(u);
						break;
					} else {
						phase = "grade";
						c--; // this cell may be the grade column; look at it again
						continue;
					}
				} else {
					var gtext = await recognizeCell(worker, cell, "7");
					var words = /[A-Za-z]{3,}/.test(gtext.replace(/[OoSsIlBZ]/g, ""));
					grade = words ? 0 : gradeFromText(gtext);
					if (!grade && !words) {
						// No words in the cell, so it should be a number: read digits only.
						await worker.setParameters({ tessedit_char_whitelist: "0123456789.," });
						var dtext = await recognizeCell(worker, cell, "7");
						if (!gradeFromText(dtext)) dtext = await recognizeCell(worker, cell, "8");
						await worker.setParameters({ tessedit_char_whitelist: WHITELIST });
						grade = gradeFromText(dtext);
						if (window.GCALC_DEBUG) console.log("grade cell: " + JSON.stringify(gtext) + " digits: " + JSON.stringify(dtext));
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

	/**
	 * Reads a grades screenshot.
	 * onProgress(0..1, label) is called while it works.
	 * Resolves to { rows: [{ name, units, grades, unitsFound }], mode }.
	 */
	async function read(file, onProgress) {
		var report = typeof onProgress === "function" ? onProgress : function () {};
		var worker = null;
		report(0.02, "Opening image");
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

	window.GCalcOCR = { read: read, parse: parse, _prepare: prepare };
})();
