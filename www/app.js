/* GCalc: GWA calculator for CLSU students.
   Port of github.com/AaronJay30/gwa-calculator (React) to plain JavaScript
   so it can run offline inside the Android app and as an installable web app. */
(function () {
	"use strict";

	var GRADES = ["1.00", "1.25", "1.50", "1.75", "2.00", "2.25", "2.50", "2.75", "3.00", "4.00", "5.00"];
	var MAX_UNITS = 10;
	var STORAGE_KEY = "gcalc-state-v1";

	// Font Awesome 5 "trash-alt" (regular), the same icon the original used via react-icons.
	// Font Awesome Free, CC BY 4.0, https://fontawesome.com/license/free
	var TRASH_ICON =
		'<svg viewBox="0 0 448 512" aria-hidden="true" focusable="false"><path d="M268 416h24a12 12 0 0 0 12-12V188a12 12 0 0 0-12-12h-24a12 12 0 0 0-12 12v216a12 12 0 0 0 12 12zM432 80h-82.41l-34-56.7A48 48 0 0 0 274.41 0H173.59a48 48 0 0 0-41.16 23.3L98.41 80H16A16 16 0 0 0 0 96v16a16 16 0 0 0 16 16h16v336a48 48 0 0 0 48 48h288a48 48 0 0 0 48-48V128h16a16 16 0 0 0 16-16V96a16 16 0 0 0-16-16zM171.84 50.91A6 6 0 0 1 177 48h94a6 6 0 0 1 5.15 2.91L293.61 80H154.39zM368 464H80V128h288zm-212-48h24a12 12 0 0 0 12-12V188a12 12 0 0 0-12-12h-24a12 12 0 0 0-12 12v216a12 12 0 0 0 12 12z"/></svg>';

	var state = loadState();

	var els = {
		result: document.getElementById("result"),
		academic: document.getElementById("academic"),
		rows: document.getElementById("rows"),
		add: document.getElementById("add-btn"),
		toggle: document.getElementById("theme-toggle"),
		themeColor: document.querySelector('meta[name="theme-color"]')
	};

	/* ---------- State ---------- */

	function defaultState() {
		return { isDark: true, rows: [{ id: 0, grades: 0, units: 0 }] };
	}

	function loadState() {
		try {
			var saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
			if (saved && Array.isArray(saved.rows) && saved.rows.length > 0) {
				return {
					isDark: saved.isDark !== false,
					rows: saved.rows.map(function (r, i) {
						var g = GRADES.indexOf(Number(r.grades).toFixed(2)) >= 0 ? Number(r.grades) : 0;
						var u = Number(r.units) >= 1 && Number(r.units) <= MAX_UNITS ? Math.floor(Number(r.units)) : 0;
						return { id: typeof r.id === "number" ? r.id : i, grades: g, units: u };
					})
				};
			}
		} catch (e) {
			/* storage unavailable or corrupted: start fresh */
		}
		return defaultState();
	}

	function saveState() {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (e) {
			/* storage unavailable: app still works, it just won't remember */
		}
	}

	/* ---------- Computation (same formula and honors as the original) ---------- */

	function compute(rows) {
		var totalGrades = 0;
		var totalUnits = 0;
		rows.forEach(function (row) {
			// Only rows with both a grade and units count toward the GWA.
			if (row.grades > 0 && row.units > 0) {
				totalGrades += row.grades * row.units;
				totalUnits += row.units;
			}
		});
		var result = totalUnits !== 0 ? parseFloat((totalGrades / totalUnits).toFixed(4)) : 0.0;
		return { result: result, totalUnits: totalUnits, academic: academicStanding(result, totalUnits) };
	}

	function academicStanding(result, totalUnits) {
		if (result <= 1.5 && totalUnits > 10) return "University Scholar";
		if (result >= 1.51 && result <= 1.75 && totalUnits > 10) return "College Scholar";
		if (result >= 1.76 && result <= 2.0 && totalUnits > 10) return "Dean's Lister";
		return "";
	}

	/* ---------- Rendering ---------- */

	function option(value, label, selected, disabled) {
		var o = document.createElement("option");
		o.value = value;
		o.textContent = label;
		if (selected) o.selected = true;
		if (disabled) o.disabled = true;
		return o;
	}

	function buildRow(row, index) {
		var wrap = document.createElement("div");
		wrap.className = "row";
		wrap.dataset.id = String(row.id);

		var grade = document.createElement("select");
		grade.name = "grades";
		grade.className = "select select-grade";
		grade.setAttribute("aria-label", "Grade, subject " + (index + 1));
		grade.appendChild(option("0", "Select your grade", row.grades === 0, true));
		GRADES.forEach(function (g) {
			grade.appendChild(option(g, g, row.grades === parseFloat(g), false));
		});
		grade.classList.toggle("is-empty", row.grades === 0);
		grade.addEventListener("change", function () {
			updateRow(row.id, { grades: parseFloat(grade.value) });
			grade.classList.remove("is-empty");
		});

		var units = document.createElement("select");
		units.name = "units";
		units.className = "select select-units";
		units.setAttribute("aria-label", "Units, subject " + (index + 1));
		units.appendChild(option("0", "Units", row.units === 0, true));
		for (var u = 1; u <= MAX_UNITS; u++) {
			units.appendChild(option(String(u), String(u), row.units === u, false));
		}
		units.classList.toggle("is-empty", row.units === 0);
		units.addEventListener("change", function () {
			updateRow(row.id, { units: parseInt(units.value, 10) });
			units.classList.remove("is-empty");
		});

		wrap.appendChild(grade);
		wrap.appendChild(units);

		if (state.rows.length > 1) {
			var del = document.createElement("button");
			del.type = "button";
			del.className = "delete-btn";
			del.setAttribute("aria-label", "Remove subject " + (index + 1));
			del.innerHTML = TRASH_ICON;
			del.addEventListener("click", function () {
				removeRow(row.id);
			});
			wrap.appendChild(del);
		}

		return wrap;
	}

	function renderRows() {
		els.rows.textContent = "";
		state.rows.forEach(function (row, i) {
			els.rows.appendChild(buildRow(row, i));
		});
	}

	function renderResult() {
		var out = compute(state.rows);
		els.result.textContent = String(out.result);
		els.academic.textContent = out.academic;
	}

	function applyTheme() {
		var dark = state.isDark;
		document.body.classList.toggle("theme-dark", dark);
		document.body.classList.toggle("theme-light", !dark);
		// Checked = light, same as the original switch (moon when dark, sun when light)
		els.toggle.checked = !dark;
		els.toggle.setAttribute("aria-checked", String(!dark));
		var bg = dark ? "#1E2B4D" : "#D9E2FC";
		if (els.themeColor) els.themeColor.setAttribute("content", bg);
		// Lets the Android app color its status and navigation bars to match.
		if (window.GCalcAndroid && typeof window.GCalcAndroid.setTheme === "function") {
			try {
				window.GCalcAndroid.setTheme(dark);
			} catch (e) {
				/* ignore */
			}
		}
	}

	/* ---------- Actions ---------- */

	function updateRow(id, patch) {
		state.rows = state.rows.map(function (r) {
			if (r.id !== id) return r;
			return {
				id: r.id,
				grades: patch.grades !== undefined ? patch.grades : r.grades,
				units: patch.units !== undefined ? patch.units : r.units
			};
		});
		renderResult();
		saveState();
	}

	function addRow() {
		var last = state.rows[state.rows.length - 1];
		var nextId = state.rows.length > 0 ? last.id + 1 : 0;
		state.rows = state.rows.concat([{ id: nextId, grades: 0, units: 0 }]);
		renderRows();
		renderResult();
		saveState();
		var newRow = els.rows.lastElementChild;
		if (newRow) {
			newRow.classList.add("row-new");
			if (newRow.scrollIntoView) newRow.scrollIntoView({ block: "nearest" });
		}
	}

	function removeRow(id) {
		state.rows = state.rows.filter(function (r) {
			return r.id !== id;
		});
		if (state.rows.length === 0) state.rows = defaultState().rows;
		renderRows();
		renderResult();
		saveState();
	}

	els.add.addEventListener("click", addRow);
	els.toggle.addEventListener("change", function () {
		state.isDark = !els.toggle.checked;
		applyTheme();
		saveState();
	});

	applyTheme();
	renderRows();
	renderResult();

	// Offline support when served over http(s) (GitHub Pages / installed web app).
	// Inside the Android app the files are already on the phone, so this is skipped.
	if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
		window.addEventListener("load", function () {
			navigator.serviceWorker.register("sw.js").catch(function () {});
		});
	}

	// Exposed for automated tests only.
	window.__gcalc = { compute: compute, academicStanding: academicStanding };
})();
