/* GCalc screenshot import.
   Reads a photo or screenshot of a grades table on the device (Tesseract.js,
   fully offline) and turns it into subjects: code, units and grade. */
(function () {
	"use strict";

	var BASE = "vendor/tesseract/";
	var VALID_GRADES = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 4, 5];
	var TARGET_WIDTH = 2000;

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

	/* Black text on white, table borders removed. Borders confuse the reader
	   (a "|" next to "COMSCI" becomes "ICOMSCI"). */
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

		var erase = new Uint8Array(n);
		// Only runs much longer than any letter stroke count as table lines,
		// otherwise the stems of letters like I, L and T get erased too.
		var minH = Math.max(60, W * 0.08);
		var minV = Math.max(60, W * 0.06, H * 0.05);
		var x, y, run, k;
		for (y = 0; y < H; y++) {
			run = 0;
			for (x = 0; x <= W; x++) {
				if (x < W && ink[y * W + x]) run++;
				else {
					if (run >= minH) for (k = x - run; k < x; k++) erase[y * W + k] = 1;
					run = 0;
				}
			}
		}
		for (x = 0; x < W; x++) {
			run = 0;
			for (y = 0; y <= H; y++) {
				if (y < H && ink[y * W + x]) run++;
				else {
					if (run >= minV) for (k = y - run; k < y; k++) erase[k * W + x] = 1;
					run = 0;
				}
			}
		}
		for (var q = 0; q < n; q++) {
			var v = ink[q] && !erase[q] ? 0 : 255;
			px[q * 4] = px[q * 4 + 1] = px[q * 4 + 2] = v;
			px[q * 4 + 3] = 255;
		}
		ctx.putImageData(data, 0, 0);
		return canvas;
	}

	function toGrade(token) {
		// Grades are written with two decimals (1.00, 2.75). Units never are.
		if (!/^[1-5]\.\d{2}$/.test(token)) return 0;
		var g = parseFloat(token);
		return VALID_GRADES.indexOf(g) >= 0 ? g : 0;
	}

	function toUnits(token) {
		if (!/^\d{1,2}(\.0)?$/.test(token)) return 0;
		var u = Math.round(parseFloat(token));
		return u >= 1 && u <= 10 ? u : 0;
	}

	/* "7  PHILI 1100   3   1.00   PASSED" -> { name: "PHILI 1100", units: 3, grades: 1 } */
	function parse(text) {
		// Subject codes are written in capitals: INTECH 3100, GEC 104, PE 3, NSTP 12.
		var CODE = /\b([A-Z][A-Z&]{1,11})\s?-?\s?(\d{1,4}[A-Z]?)\b/;
		var seen = {};
		var rows = [];
		text.split(/\r?\n/).forEach(function (line) {
			var m = CODE.exec(line);
			if (!m) return;
			var prefix = m[1];
			if (/^(NO|SY|AY|SEM|YEAR|PAGE|ROOM|SECTION|TOTAL|GWA|UNITS|GRADE|GRADES|REMARKS|STATUS|SUBJECTS|PASSED|FAILED|SUBMITTED|APPROVED|YET|NOT)$/.test(prefix)) return;
			var name = prefix + " " + m[2].toUpperCase();
			var rest = line.slice(m.index + m[0].length);
			var tokens = rest.match(/\d+(?:\.\d+)?/g) || [];
			var units = 0, grade = 0;
			tokens.forEach(function (t) {
				if (!grade && toGrade(t)) grade = toGrade(t);
				else if (!units && toUnits(t)) units = toUnits(t);
			});
			var key = name.replace(/\s+/g, "");
			if (seen[key]) return;
			seen[key] = true;
			rows.push({ name: name.slice(0, 40), units: units || 3, grades: grade, unitsFound: units > 0 });
		});
		return rows;
	}

	/**
	 * Reads a grades screenshot.
	 * onProgress(0..1, label) is called while it works.
	 * Resolves to { rows: [{ name, units, grades, unitsFound }], text }.
	 */
	function read(file, onProgress) {
		var report = typeof onProgress === "function" ? onProgress : function () {};
		var worker = null;
		report(0.02, "Opening image");
		return Promise.all([loadLibrary(), loadImage(file)])
			.then(function (res) {
				var T = res[0];
				var canvas = prepare(res[1]);
				report(0.1, "Starting the reader");
				return T.createWorker("eng", 1, {
					workerPath: BASE + "worker.min.js",
					corePath: BASE + "core",
					langPath: BASE + "lang",
					gzip: false,
					cacheMethod: "none",
					workerBlobURL: false,
					logger: function (m) {
						if (m.status === "recognizing text") report(0.25 + 0.7 * (m.progress || 0), "Reading text");
						else if (m.status === "loading language traineddata") report(0.15 + 0.1 * (m.progress || 0), "Starting the reader");
					}
				}).then(function (w) {
					worker = w;
					return w.setParameters({
						tessedit_pageseg_mode: "6",
						preserve_interword_spaces: "1",
						tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-& "
					});
				}).then(function () {
					return worker.recognize(canvas);
				});
			})
			.then(function (result) {
				report(1, "Done");
				var text = result.data.text || "";
				return { rows: parse(text), text: text };
			})
			.finally(function () {
				if (worker) worker.terminate();
			});
	}

	window.GCalcOCR = { read: read, parse: parse };
})();
