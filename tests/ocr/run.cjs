/* Runs the app's screenshot import (www/ocr.js) on every test screenshot and
   scores it against expected.json.

   A screenshot passes when:
   - every fully visible subject is found, and
   - every subject the reader returns is real and has the right units and grade.

   Usage: node tests/ocr/run.cjs <path-to-playwright-module> <corpusDir> [chromium|webkit|firefox] [filter]
   Exits non-zero when any screenshot fails. */
const path = require("path");
const fs = require("fs");
const http = require("http");
const pw = require(process.argv[2] || "playwright");
const corpus = path.resolve(process.argv[3] || path.join(__dirname, "corpus"));
const engine = process.argv[4] || "chromium";
const filter = process.argv[5] ? new RegExp(process.argv[5]) : null;
const www = path.resolve(__dirname, "..", "..", "www");

const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

function serve() {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const url = decodeURIComponent(req.url.split("?")[0]);
			const file = url.startsWith("/corpus/") ? path.join(corpus, url.slice(8)) : path.join(www, url === "/" ? "index.html" : url);
			if (!file.startsWith(corpus) && !file.startsWith(www)) { res.writeHead(403); return res.end(); }
			fs.readFile(file, (err, data) => {
				if (err) { res.writeHead(404); return res.end(); }
				res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
				res.end(data);
			});
		});
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

function score(item, rows) {
	const truth = new Map(item.truth.map((t) => [t[0].replace(/\s+/g, ""), t]));
	const problems = [];
	const found = new Set();
	rows.forEach((r) => {
		const key = r.name.replace(/\s+/g, "");
		const t = truth.get(key);
		if (!t) { problems.push(`extra "${r.name}"`); return; }
		found.add(key);
		if (r.units !== t[1]) problems.push(`${t[0]} units ${r.units} (should be ${t[1]})`);
		if ((r.grades || 0) !== t[2]) problems.push(`${t[0]} grade ${r.grades || "-"} (should be ${t[2] || "-"})`);
	});
	item.visible.forEach((code) => {
		if (!found.has(code.replace(/\s+/g, ""))) problems.push(`missed ${code}`);
	});
	return problems;
}

(async () => {
	const expected = JSON.parse(fs.readFileSync(path.join(corpus, "expected.json"), "utf8")).filter((e) => !filter || filter.test(e.file));
	const server = await serve();
	const base = `http://127.0.0.1:${server.address().port}`;
	const browser = await pw[engine].launch();
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push(e.message));
	await page.goto(base + "/index.html");
	await page.waitForFunction(() => window.GCalcOCR);

	let pass = 0;
	const fails = [];
	const times = [];
	let count = 0;
	for (const item of expected) {
		// A student imports a few screenshots per visit; start a fresh page every
		// 25 so one long run doesn't pile up the browser's WebAssembly memory.
		if (++count % 25 === 0) {
			await page.reload();
			await page.waitForFunction(() => window.GCalcOCR);
		}
		const t0 = Date.now();
		let res;
		try {
			res = await page.evaluate(async (url) => {
				const blob = await (await fetch(url)).blob();
				const r = await window.GCalcOCR.read(blob);
				return { mode: r.mode, rows: r.rows.map((x) => ({ name: x.name, units: x.units, grades: x.grades })) };
			}, base + "/corpus/" + item.file);
		} catch (e) {
			res = { mode: "error", rows: [], error: e.message };
		}
		times.push(Date.now() - t0);
		const problems = res.error ? ["error: " + res.error] : score(item, res.rows);
		if (problems.length) fails.push({ file: item.file, mode: res.mode, problems });
		else pass++;
		process.stdout.write(problems.length ? "x" : ".");
	}
	process.stdout.write("\n");
	fails.forEach((f) => console.log(`FAIL ${f.file} [${f.mode}]: ${f.problems.join("; ")}`));
	// Read the first few failures again with the reader's debug log on.
	for (const f of fails.slice(0, 6)) {
		const lines = [];
		const onLog = (m) => { const t = m.text(); if (/^(cell|subject|shape) /.test(t)) lines.push(t.slice(0, 160)); };
		page.on("console", onLog);
		try {
			await page.evaluate(async (url) => {
				window.GCALC_DEBUG = true;
				try { await window.GCalcOCR.read(await (await fetch(url)).blob()); } finally { window.GCALC_DEBUG = false; }
			}, base + "/corpus/" + f.file);
		} catch (e) { lines.push("error " + e.message.slice(0, 120)); }
		page.off("console", onLog);
		console.log(`DEBUG ${f.file}:\n  ` + lines.join("\n  "));
	}
	const avg = Math.round(times.reduce((a, b) => a + b, 0) / Math.max(1, times.length));
	console.log(`${engine}: ${pass}/${expected.length} screenshots fully correct, avg ${avg}ms`);
	if (errors.length) console.log("page errors:", errors.slice(0, 5));
	await browser.close();
	server.close();
	process.exit(fails.length ? 1 : 0);
})();
