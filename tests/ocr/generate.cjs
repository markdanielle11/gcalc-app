/* Generates synthetic grade screenshots (fictional student and subjects) that
   look like the CLSU portal "View Grades" page, across devices, layouts,
   themes and compression, plus expected.json with the correct readings.

   Usage: node tests/ocr/generate.cjs <path-to-playwright> [outDir]
   Needs: sharp (for JPEG re-compression), Chromium from Playwright. */
const path = require("path");
const fs = require("fs");
const { chromium } = require(process.argv[2] || "playwright");
const sharp = require(path.join(path.dirname(require.resolve(process.argv[2] || "playwright")), "..", "sharp"));

const OUT = process.argv[3] || path.join(__dirname, "corpus");

// [code, units, grade text, remarks, status, expected grade]
const DATASETS = {
	pending: {
		sem: "1ST SEMESTER 2026-2027",
		rows: [
			["INTECH 3100", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0],
			["INTECH 3101", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0],
			["INTECH 3110", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0],
			["INTECH 3112", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0],
			["STAT 3206", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0],
			["COMSCI 3100", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0],
			["PHILI 1100", 3, "1.00", "PASSED", "NOT YET APPROVED", 1],
			["ITRM 3100", 3, "NOT YET SUBMITTED", "NOT YET SUBMITTED", "NOT YET SUBMITTED", 0]
		]
	},
	final: {
		sem: "2ND SEMESTER 2025-2026",
		rows: [
			["PHILI 1100", 3, "1.25", "PASSED", "FINAL GRADE", 1.25],
			["PSYCH 2130", 5, "1.00", "PASSED", "FINAL GRADE", 1],
			["PSYCH 4180", 3, "1.50", "PASSED", "FINAL GRADE", 1.5],
			["CHEM 2390", 3, "1.75", "PASSED", "FINAL GRADE", 1.75],
			["PATHFIT 4", 2, "1.00", "PASSED", "FINAL GRADE", 1]
		]
	},
	mixed: {
		sem: "1ST SEMESTER 2025-2026",
		rows: [
			["GEC 104", 3, "2.75", "PASSED", "FINAL GRADE", 2.75],
			["MATH 2104", 3, "2.25", "PASSED", "FINAL GRADE", 2.25],
			["NSTP 12", 3, "1.50", "PASSED", "FINAL GRADE", 1.5],
			["IT 311", 3, "3.00", "PASSED", "FINAL GRADE", 3],
			["STAT 2105", 3, "4.00", "CONDITIONAL", "FINAL GRADE", 4],
			["COMSCI 2100", 5, "5.00", "FAILED", "FINAL GRADE", 5],
			["ENGL 1010", 3, "INC", "INCOMPLETE", "FINAL GRADE", 0],
			["BIO 1100", 4, "2.00", "PASSED", "FINAL GRADE", 2],
			["PE 2", 2, "1.75", "PASSED", "FINAL GRADE", 1.75]
		]
	},
	labs: {
		sem: "SUMMER 2025",
		rows: [
			["CHEM 2391L", 1, "1.25", "PASSED", "APPROVED", 1.25],
			["PHYS 2100", 4, "2.50", "PASSED", "APPROVED", 2.5],
			["AGRI 1100", 2, "1.00", "PASSED", "APPROVED", 1],
			["ECON 2200", 3, "2.00", "PASSED", "APPROVED", 2],
			["HIST 1100", 3, "1.75", "PASSED", "APPROVED", 1.75],
			["FIL 1100", 3, "2.25", "PASSED", "APPROVED", 2.25],
			["DRAW 1010", 1, "3.00", "PASSED", "APPROVED", 3]
		]
	}
};

// layout: "mobile" = the portal's narrow layout (codes wrap), "desktop" = full page
const DEVICES = [
	{ id: "iphone-se", width: 375, height: 667, dpr: 2, layout: "mobile" },
	{ id: "iphone-13", width: 390, height: 844, dpr: 3, layout: "mobile" },
	{ id: "pixel-7", width: 412, height: 915, dpr: 2.625, layout: "mobile" },
	{ id: "galaxy-a", width: 360, height: 800, dpr: 3, layout: "mobile" },
	{ id: "ipad", width: 820, height: 1180, dpr: 2, layout: "desktop" },
	{ id: "laptop", width: 1366, height: 768, dpr: 1, layout: "desktop" },
	{ id: "desktop", width: 1920, height: 1080, dpr: 1, layout: "desktop" },
	// "Desktop site" on a phone: a 980px-wide page squeezed into a 1080px screenshot
	{ id: "phone-desktop-site", width: 980, height: 2100, dpr: 1.102, layout: "desktop" }
];

function page(ds, layout, dark) {
	const rows = ds.rows.map((r, i) => `<tr><td>${i + 1}</td><td class="s">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join("");
	const empty = Array.from({ length: Math.max(0, 14 - ds.rows.length) }, (_, i) => `<tr><td>${ds.rows.length + i + 1}</td><td class="s"></td><td></td><td></td><td></td><td></td></tr>`).join("");
	const total = ds.rows.reduce((a, r) => a + r[1], 0);
	const c = dark
		? { bg: "#121212", card: "#1e1e1e", text: "#e0e0e0", muted: "#aaa", line: "#9aa4b5", green: "#2e7d32", gray: "#2a2a2a" }
		: { bg: "#e9e9e9", card: "#fff", text: "#333", muted: "#666", line: "#2c3e50", green: "#4caf50", gray: "#e9e9e9" };
	const mobile = layout === "mobile";
	return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box} body{margin:0;font-family:Roboto,"Helvetica Neue",Arial,"DejaVu Sans",sans-serif;background:${c.bg};color:${c.text}}
.top{background:${c.green};color:#fff;padding:${mobile ? "70px 16px 24px" : "18px 50px"};font-size:${mobile ? 17 : 16}px}
.wrap{display:flex;gap:28px;padding:${mobile ? "0" : "26px 14px"};align-items:flex-start}
.side{${mobile ? "display:none" : ""};width:124px;background:${c.card};box-shadow:0 1px 3px rgba(0,0,0,.2);padding:0 0 14px;text-align:center;font-size:12px}
.side .logo{height:150px;background:#1aa38a;display:flex;align-items:center;justify-content:center}
.side .logo span{width:110px;height:110px;border-radius:50%;background:#f3d34a;border:6px solid #2e7d32;display:block}
.side h4{margin:12px 6px 4px;font-size:20px} .side .b{display:block;margin:8px 12px;padding:8px 2px;color:#fff;font-size:12px}
.main{flex:1;background:${c.card};${mobile ? "padding:14px 0 30px;margin:0 14px" : "padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.2)"}}
.tabs{${mobile ? "display:none" : ""};color:${c.muted};font-size:16px;line-height:40px;border-bottom:1px solid ${c.gray};margin-bottom:16px}
.tabs b{color:${c.text};font-weight:400;border-bottom:2px solid #2196f3;padding-bottom:8px;margin:0 14px}
.tabs i{font-style:normal;margin:0 14px}
h2{color:${dark ? "#66bb6a" : "#1b8a1b"};text-align:center;font-size:32px;margin:${mobile ? "6px" : "22px"} 0 18px;${mobile ? "display:none" : ""}}
.sel{margin:0 auto 14px;width:${mobile ? "100%" : "460px"};border:1px solid ${dark ? "#555" : "#9ec5fe"};border-radius:4px;padding:8px 14px;font-size:${mobile ? 15 : 13}px}
p{text-align:center;font-size:${mobile ? 15 : 13}px;line-height:${mobile ? 32 : 24}px;margin:0 20px}
table{border-collapse:collapse;margin:16px auto 6px;font-size:${mobile ? 17 : 16}px;color:${c.text}}
th{font-size:${mobile ? 15 : 13}px;font-weight:700}
th,td{border:${mobile ? 2 : 2}px solid ${c.line};padding:${mobile ? "8px 2px" : "6px 4px"};text-align:center;line-height:${mobile ? 30 : 22}px;min-width:${mobile ? 36 : 60}px;height:${mobile ? 60 : 34}px}
td.s{text-align:left;${mobile ? "width:64px;max-width:64px" : "width:170px"}}
.st{text-align:center;font-size:12px;color:${c.muted}}
</style></head><body>
<div class="top">OFFICE OF ADMISSIONS</div>
<div class="wrap">
<div class="side"><div class="logo"><span></span></div><h4>JUAN DELA CRUZ</h4><div style="font-size:11px">delacruz.juan@clsu2.edu.ph</div><div style="margin:8px">STUDENT</div>
<span class="b" style="background:#2196f3">CHANGE PASSWORD</span><span class="b" style="background:#ff9800">UPDATE PROFILE</span><span class="b" style="background:#f44336">LOGOUT</span></div>
<div class="main">
<div class="tabs"><i>Home</i><i>Registration Form</i><b>View Grades</b><i>Preregistration</i><i>Enrollment</i></div>
<h2>GRADES</h2>
<div class="sel">${ds.sem}</div>
<p>Grade details as of <b>October 20, 2026 03:18:12 PM.</b></p>
<p>For verification, please contact the RECORDS-IN-CHARGE.</p>
<table><tr><th>No.</th><th>SUBJECTS</th><th>UNITS</th><th>GRADE</th><th>REMARKS</th><th>STATUS</th></tr>${rows}${empty}
<tr><th>TOTAL</th><td></td><th>${total}</th><td></td><th>GPA</th><td></td></tr></table>
<div class="st">Status: *** ---</div>
</div></div></body></html>`;
}

(async () => {
	fs.mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch();
	const expected = [];
	for (const dev of DEVICES) {
		const ctx = await browser.newContext({ viewport: { width: dev.width, height: dev.height }, deviceScaleFactor: dev.dpr, isMobile: dev.layout === "mobile" });
		const p = await ctx.newPage();
		for (const [name, ds] of Object.entries(DATASETS)) {
			for (const dark of [false, true]) {
				await p.setContent(page(ds, dev.layout, dark));
				const file = `${dev.id}-${name}${dark ? "-dark" : ""}.png`;
				await p.screenshot({ path: path.join(OUT, file), fullPage: true });
				const rows = ds.rows.map((r) => [r[0], r[1], r[5]]);
				expected.push({ file, device: dev.id, rows });
				// Messenger-style: smaller and JPEG-compressed (light theme only)
				if (!dark) {
					const small = file.replace(".png", "-msgr.jpg");
					const meta = await sharp(path.join(OUT, file)).metadata();
					await sharp(path.join(OUT, file)).resize(Math.round(meta.width * 0.6)).jpeg({ quality: 55 }).toFile(path.join(OUT, small));
					expected.push({ file: small, device: dev.id, rows });
				}
			}
		}
		await ctx.close();
	}
	fs.writeFileSync(path.join(OUT, "expected.json"), JSON.stringify(expected, null, 1));
	console.log("wrote", expected.length, "images to", OUT);
	await browser.close();
})();
