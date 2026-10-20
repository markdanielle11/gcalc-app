/* Generates test screenshots of the CLSU CAIS "View Grades" page (replica in
   cais-template.html, fictional student and subjects) the way students take
   them: on phones, tablets and laptops, scrolled to the table, with the
   phone's status bar / browser bar on top, in light and forced-dark mode,
   and re-compressed the way Messenger does.

   Writes <outDir>/*.png|jpg and <outDir>/expected.json:
     [{ file, device, truth: [[code, units, grade]...], visible: [codes fully visible] }]

   Usage: node tests/ocr/generate.cjs <path-to-playwright-module> [outDir]
   Needs the "sharp" module next to playwright (global node_modules). */
const path = require("path");
const fs = require("fs");
const pw = process.argv[2] || "playwright";
const { chromium } = require(pw);
const sharp = require(path.join(path.dirname(require.resolve(pw)), "..", "sharp"));

const OUT = path.resolve(process.argv[3] || path.join(__dirname, "corpus"));
const TEMPLATE = fs.readFileSync(path.join(__dirname, "cais-template.html"), "utf8");

// [code, units, grade cell, remarks, status, expected grade (0 = none)]
const NYS = "NOT YET SUBMITTED";
const DATASETS = {
	pending: { sem: "1ST SEMESTER 2026-2027", rows: [
		["INTECH 3100", 3, NYS, NYS, NYS, 0], ["INTECH 3101", 3, NYS, NYS, NYS, 0], ["INTECH 3110", 3, NYS, NYS, NYS, 0],
		["INTECH 3112", 3, NYS, NYS, NYS, 0], ["STAT 3206", 3, NYS, NYS, NYS, 0], ["COMSCI 3100", 3, NYS, NYS, NYS, 0],
		["PHILI 1100", 3, "1.00", "PASSED", "NOT YET APPROVED", 1], ["ITRM 3100", 3, NYS, NYS, NYS, 0]] },
	final: { sem: "2ND SEMESTER 2025-2026", rows: [
		["PHILI 1100", 3, "1.25", "PASSED", "FINAL GRADE", 1.25], ["PSYCH 2130", 5, "1.00", "PASSED", "FINAL GRADE", 1],
		["PSYCH 4180", 3, "1.50", "PASSED", "FINAL GRADE", 1.5], ["CHEM 2390", 3, "1.75", "PASSED", "FINAL GRADE", 1.75],
		["PATHFIT 4", 2, "1.00", "PASSED", "FINAL GRADE", 1]] },
	mixed: { sem: "1ST SEMESTER 2025-2026", rows: [
		["GEC 104", 3, "2.75", "PASSED", "FINAL GRADE", 2.75], ["MATH 2104", 3, "2.25", "PASSED", "FINAL GRADE", 2.25],
		["NSTP 12", 3, "1.50", "PASSED", "FINAL GRADE", 1.5], ["IT 311", 3, "3.00", "PASSED", "FINAL GRADE", 3],
		["STAT 2105", 3, "4.00", "CONDITIONAL", "FINAL GRADE", 4], ["COMSCI 2100", 5, "5.00", "FAILED", "FINAL GRADE", 5],
		["ENGL 1010", 3, "INC", "INCOMPLETE", "FINAL GRADE", 0], ["BIO 1100", 4, "2.00", "PASSED", "FINAL GRADE", 2],
		["PE 2", 2, "1.75", "PASSED", "FINAL GRADE", 1.75]] },
	labs: { sem: "MIDYEAR 2025", rows: [
		["CHEM 2391L", 1, "1.25", "PASSED", "FINAL GRADE", 1.25], ["PHYS 2100", 4, "2.50", "PASSED", "FINAL GRADE", 2.5],
		["AGRI 1100", 2, "1.00", "PASSED", "FINAL GRADE", 1], ["ECON 2200", 3, "2.00", "PASSED", "FINAL GRADE", 2],
		["HIST 1100", 3, "1.75", "PASSED", "FINAL GRADE", 1.75], ["FIL 1100", 3, "2.25", "PASSED", "FINAL GRADE", 2.25],
		["DRAW 1010", 1, "3.00", "PASSED", "FINAL GRADE", 3]] },
	// Lecture and lab parts of the same course, as in the public subject schedule
	lablec: { sem: "1ST SEMESTER 2025-2026", rows: [
		["CRSCI 1100", 2, "1.50", "PASSED", "FINAL GRADE", 1.5], ["CRSCI 1100 LAB A", 1, "1.25", "PASSED", "FINAL GRADE", 1.25],
		["ANSCI 1100", 2, "2.00", "PASSED", "FINAL GRADE", 2], ["ANSCI 1100 LAB B", 1, "1.75", "PASSED", "FINAL GRADE", 1.75],
		["SOILS 2100", 3, "2.25", "PASSED", "FINAL GRADE", 2.25], ["ENGL 1100", 3, "1.00", "PASSED", "FINAL GRADE", 1]] }
};

// chrome: phone UI drawn over the page ("android" status bar, "ios" Safari bottom bar)
// scroll: where the table header sits in the screenshot (fraction of the viewport height)
const DEVICES = [
	{ id: "iphone-se", width: 375, height: 667, dpr: 2, mobile: true, chrome: "ios", scroll: 0.12 },
	{ id: "iphone-13", width: 390, height: 844, dpr: 3, mobile: true, chrome: "ios", scroll: 0.25 },
	{ id: "pixel-7", width: 412, height: 915, dpr: 2.625, mobile: true, chrome: "android", scroll: 0.2 },
	{ id: "galaxy-a", width: 360, height: 780, dpr: 3, mobile: true, chrome: "android", scroll: 0.15 },
	{ id: "ipad", width: 820, height: 1180, dpr: 2, mobile: true, chrome: null, scroll: 0.1 },
	{ id: "laptop", width: 1366, height: 768, dpr: 1, mobile: false, chrome: null, scroll: 0.05 },
	{ id: "macbook", width: 1440, height: 900, dpr: 2, mobile: false, chrome: null, scroll: 0.05 },
	{ id: "desktop", width: 1920, height: 1080, dpr: 1, mobile: false, chrome: null, scroll: 0.05 },
	// "Desktop site" turned on in a phone browser: the page is laid out 980px wide and shrunk
	{ id: "android-desktop-site", width: 980, height: 2178, dpr: 1.102, mobile: false, chrome: "android", scroll: null },
	{ id: "ios-desktop-site", width: 980, height: 2120, dpr: 1.194, mobile: false, chrome: "ios", scroll: null },
	// Android "scroll capture" (long screenshot of the whole page)
	{ id: "android-long", width: 412, height: 915, dpr: 2.625, mobile: true, chrome: null, scroll: null, fullPage: true }
];

const cell = (text, left) => `<td style="border: 1px solid #000000; border-collapse: collapse; font-size: 18px;${left ? "" : " text-align: center;"} font-family: roboto;">${text}</td>`;

function pageHtml(ds) {
	const rows = ds.rows.map((r, i) => `<tr data-code="${r[0]}" style="border: 1px solid #000000; border-collapse: collapse;">${cell(i + 1)}${cell(r[0], true)}${cell(r[1])}${cell(r[2])}${cell(r[3])}${cell(r[4])}</tr>`);
	for (let i = ds.rows.length; i < 14; i++) rows.push(`<tr style="border: 1px solid #000000; border-collapse: collapse;">${cell(i + 1)}${cell("", true)}${cell("")}${cell("")}${cell("")}${cell("")}</tr>`);
	return TEMPLATE
		.replace("{{ROWS}}", rows.join(""))
		.replace("{{TOTAL}}", String(ds.rows.reduce((a, r) => a + r[1], 0)))
		.replace("{{SEM}}", ds.sem)
		.replace("{{DATE}}", "October 20, 2026 03:18:12 PM.")
		.replaceAll("{{NAME}}", "JUAN DELA CRUZ")
		.replace("{{EMAIL}}", "delacruz.juan@clsu2.edu.ph");
}

// Phone UI drawn on top of the page, like in real screenshots
const CHROME = {
	android: `<div style="position:fixed;left:0;right:0;top:0;height:30px;background:#fff;z-index:99;font:500 14px Roboto;color:#333;display:flex;align-items:center;justify-content:space-between;padding:0 14px">
		<span>3:18 PM</span><span>Vo LTE 4G ▂▄▆ 66</span></div>`,
	ios: `<div style="position:fixed;left:0;right:0;top:0;height:44px;background:#4caf50;z-index:99;font:600 16px -apple-system,Roboto;color:#111;display:flex;align-items:center;justify-content:space-between;padding:0 24px">
		<span>2:43</span><span>▂▄▆ ᯤ 34</span></div>
		<div style="position:fixed;left:50%;transform:translateX(-50%);bottom:14px;width:62%;height:44px;border-radius:22px;background:#1c1c1e;color:#fff;z-index:99;font:15px -apple-system,Roboto;display:flex;align-items:center;justify-content:center">admissions.clsu.edu.ph</div>`
};

(async () => {
	fs.mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch();
	const expected = [];
	const renderFile = path.join(__dirname, ".render.html");
	const only = process.env.GCALC_DEVICES ? new RegExp(process.env.GCALC_DEVICES) : null;
	for (const dev of DEVICES.filter((d) => !only || only.test(d.id))) {
		for (const [name, ds] of Object.entries(DATASETS)) {
			for (const dark of [false, true]) {
				const html = pageHtml(ds).replace("</body>", (dev.chrome ? CHROME[dev.chrome] : "") + "</body>");
				fs.writeFileSync(renderFile, html);
				// Phone browsers zoom out when the table is wider than the screen (as in
				// real iPhone screenshots of this page): lay out wider, keep the pixel size.
				let view = { width: dev.width, height: dev.height, dpr: dev.dpr };
				let ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dpr, isMobile: dev.mobile, hasTouch: dev.mobile });
				let page = await ctx.newPage();
				await page.goto("file://" + renderFile);
				await page.evaluate(() => document.fonts.ready);
				const contentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
				if (dev.mobile && contentWidth > dev.width + 2) {
					const k = contentWidth / dev.width;
					view = { width: contentWidth, height: Math.round(dev.height * k), dpr: dev.dpr / k };
					await ctx.close();
					ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.dpr, isMobile: true, hasTouch: true });
					page = await ctx.newPage();
					await page.goto("file://" + renderFile);
					await page.evaluate(() => document.fonts.ready);
				}
				if (dark) {
					// Approximates Chrome's automatic dark mode for websites
					await page.addStyleTag({ content: "html{filter:invert(1) hue-rotate(180deg);background:#fff}" });
				}
				const info = await page.evaluate(([scroll, full]) => {
					const table = document.querySelector("#grade_list table");
					if (scroll !== null) {
						const top = table.getBoundingClientRect().top + window.scrollY;
						window.scrollTo(0, Math.max(0, top - innerHeight * scroll));
					}
					// Rows fully on screen and not under the phone's own bars
					const blockers = full ? [] : [...document.querySelectorAll("body > div[style*='position:fixed']")].map((b) => b.getBoundingClientRect());
					const visible = [...document.querySelectorAll("tr[data-code]")].filter((tr) => {
						const r = tr.getBoundingClientRect();
						if (!full && (r.top < 0 || r.bottom > innerHeight)) return false;
						if (r.right > innerWidth + 1) return false;
						return !blockers.some((b) => !(r.bottom <= b.top || r.top >= b.bottom));
					}).map((tr) => tr.dataset.code);
					return { visible };
				}, [dev.scroll, !!dev.fullPage]);
				const file = `${dev.id}-${name}${dark ? "-dark" : ""}.png`;
				await page.screenshot({ path: path.join(OUT, file), fullPage: !!dev.fullPage });
				const truth = ds.rows.map((r) => [r[0], r[1], r[5]]);
				expected.push({ file, device: dev.id, truth, visible: info.visible });
				if (!dark) {
					// Sent through Messenger: smaller and JPEG-compressed
					const msgr = file.replace(".png", "-msgr.jpg");
					const meta = await sharp(path.join(OUT, file)).metadata();
					await sharp(path.join(OUT, file)).resize(Math.round(meta.width * 0.6)).jpeg({ quality: 55 }).toFile(path.join(OUT, msgr));
					expected.push({ file: msgr, device: dev.id, truth, visible: info.visible });
				}
				await ctx.close();
			}
		}
	}
	fs.rmSync(path.join(__dirname, ".render.html"), { force: true });
	fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 1));
	console.log("wrote", expected.length, "images to", OUT);
	await browser.close();
})();
