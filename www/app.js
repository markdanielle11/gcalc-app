/* GCalc: GWA calculator for CLSU students.
   Port of github.com/AaronJay30/gwa-calculator (React) to plain JavaScript
   so it runs offline inside the Android app and as an installable web app. */
(function () {
	"use strict";

	var GRADES = ["1.00", "1.25", "1.50", "1.75", "2.00", "2.25", "2.50", "2.75", "3.00", "4.00", "5.00"];
	var MIN_UNITS = 1;
	var MAX_UNITS = 10;
	var DEFAULT_UNITS = 3;
	var HONORS_MIN_UNITS = 10; // honors need MORE than this many units
	var STORAGE_KEY = "gcalc-state-v1";
	var TOAST_MS = 5000;

	var els = {
		root: document.documentElement,
		gwa: document.getElementById("gwa"),
		standing: document.getElementById("standing"),
		meta: document.getElementById("meta"),
		list: document.getElementById("list"),
		add: document.getElementById("add-btn"),
		clear: document.getElementById("clear-btn"),
		themeBtn: document.getElementById("theme-btn"),
		themeColor: document.querySelector('meta[name="theme-color"]'),
		sheet: document.getElementById("grade-sheet"),
		sheetTitle: document.getElementById("sheet-title"),
		sheetClose: document.getElementById("sheet-close"),
		gradeGrid: document.getElementById("grade-grid"),
		toast: document.getElementById("toast"),
		toastText: document.getElementById("toast-text"),
		toastUndo: document.getElementById("toast-undo")
	};

	var state = loadState();
	var sheetRowId = null;
	var toastTimer = null;
	var undoAction = null;
	var lastGwaText = null;

	/* ---------- State ---------- */

	function newRow(id) {
		return { id: id, name: "", grades: 0, units: DEFAULT_UNITS };
	}

	function nextId() {
		return state.rows.reduce(function (max, r) { return Math.max(max, r.id); }, -1) + 1;
	}

	function systemPrefersDark() {
		try {
			return !window.matchMedia("(prefers-color-scheme: light)").matches;
		} catch (e) {
			return true;
		}
	}

	function loadState() {
		try {
			var saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
			if (saved && Array.isArray(saved.rows) && saved.rows.length > 0) {
				return {
					isDark: typeof saved.isDark === "boolean" ? saved.isDark : systemPrefersDark(),
					rows: saved.rows.map(function (r, i) {
						var g = GRADES.indexOf(Number(r.grades).toFixed(2)) >= 0 ? Number(r.grades) : 0;
						var u = Math.floor(Number(r.units));
						return {
							id: typeof r.id === "number" ? r.id : i,
							name: typeof r.name === "string" ? r.name.slice(0, 40) : "",
							grades: g,
							units: u >= MIN_UNITS && u <= MAX_UNITS ? u : DEFAULT_UNITS
						};
					})
				};
			}
		} catch (e) {
			/* storage unavailable or corrupted: start fresh */
		}
		return { isDark: systemPrefersDark(), rows: [newRow(0)] };
	}

	function saveState() {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (e) {
			/* storage unavailable: app still works, it just won't remember */
		}
	}

	function isPristine() {
		return state.rows.length === 1 &&
			state.rows[0].grades === 0 &&
			state.rows[0].name === "" &&
			state.rows[0].units === DEFAULT_UNITS;
	}

	/* ---------- Computation (same formula and honors as the original) ---------- */

	function compute(rows) {
		var totalGrades = 0;
		var totalUnits = 0;
		var counted = 0;
		rows.forEach(function (row) {
			// Only rows with both a grade and units count toward the GWA.
			if (row.grades > 0 && row.units > 0) {
				totalGrades += row.grades * row.units;
				totalUnits += row.units;
				counted++;
			}
		});
		var result = totalUnits !== 0 ? parseFloat((totalGrades / totalUnits).toFixed(4)) : 0.0;
		return {
			result: result,
			totalUnits: totalUnits,
			counted: counted,
			academic: academicStanding(result, totalUnits)
		};
	}

	// Same cutoffs as the original (1.50 / 1.75 / 2.00, more than 10 units), without the
	// gaps it had between 1.50-1.51 and 1.75-1.76 where a GWA like 1.5050 got no standing.
	function academicStanding(result, totalUnits) {
		if (result <= 0 || totalUnits <= HONORS_MIN_UNITS) return "";
		if (result <= 1.5) return "University Scholar";
		if (result <= 1.75) return "College Scholar";
		if (result <= 2.0) return "Dean's Lister";
		return "";
	}

	/** 1.25 -> "1.25", 1.2045 -> "1.2045", 1 -> "1.00" */
	function formatGwa(n) {
		var s = n.toFixed(4).replace(/0+$/, "");
		var decimals = s.split(".")[1] || "";
		return decimals.length < 2 ? n.toFixed(2) : s;
	}

	function plural(n, word) {
		return n + " " + word + (n === 1 ? "" : "s");
	}

	function rowLabel(row) {
		var name = row.name.trim();
		if (name) return name;
		return "Subject " + (state.rows.indexOf(row) + 1);
	}

	/* ---------- Icons ---------- */

	function icon(name) {
		var ns = "http://www.w3.org/2000/svg";
		var svg = document.createElementNS(ns, "svg");
		svg.setAttribute("class", "icon");
		svg.setAttribute("aria-hidden", "true");
		var use = document.createElementNS(ns, "use");
		use.setAttribute("href", "#i-" + name);
		svg.appendChild(use);
		return svg;
	}

	function el(tag, className, text) {
		var e = document.createElement(tag);
		if (className) e.className = className;
		if (text !== undefined) e.textContent = text;
		return e;
	}

	/* ---------- Rendering ---------- */

	function buildRow(row, index) {
		var placeholder = "Subject " + (index + 1);
		var li = el("li", "subject");
		li.dataset.id = String(row.id);

		// Name + delete
		var top = el("div", "subject-top");
		var name = el("input", "subject-name");
		name.type = "text";
		name.value = row.name;
		name.placeholder = placeholder;
		name.maxLength = 40;
		name.autocomplete = "off";
		name.enterKeyHint = "done";
		name.setAttribute("aria-label", placeholder + " name (optional)");
		name.addEventListener("input", function () {
			row.name = name.value;
			saveState();
			renderClearButton();
		});
		name.addEventListener("keydown", function (e) {
			if (e.key === "Enter") name.blur();
		});
		top.appendChild(name);

		if (state.rows.length > 1) {
			var del = el("button", "icon-btn delete-btn");
			del.type = "button";
			del.setAttribute("aria-label", "Remove " + (row.name.trim() || placeholder));
			del.appendChild(icon("trash"));
			del.addEventListener("click", function () {
				removeRow(row.id);
			});
			top.appendChild(del);
		}
		li.appendChild(top);

		// Grade + units
		var fields = el("div", "subject-fields");

		var grade = el("button", "field grade-btn" + (row.grades === 0 ? " is-empty" : ""));
		grade.type = "button";
		grade.dataset.role = "grade";
		grade.setAttribute("aria-haspopup", "dialog");
		grade.appendChild(el("span", "field-label", "Grade"));
		grade.appendChild(el("span", "field-value", row.grades === 0 ? "Select" : row.grades.toFixed(2)));
		grade.appendChild(icon("caret-down"));
		grade.setAttribute("aria-label",
			"Grade for " + (row.name.trim() || placeholder) + ": " + (row.grades === 0 ? "not selected" : row.grades.toFixed(2)));
		grade.addEventListener("click", function () {
			openSheet(row.id);
		});
		fields.appendChild(grade);

		var stepper = el("div", "field stepper");
		stepper.setAttribute("role", "group");
		stepper.setAttribute("aria-label", "Units for " + (row.name.trim() || placeholder));

		var minus = el("button", "step-btn");
		minus.type = "button";
		minus.setAttribute("aria-label", "Fewer units");
		minus.appendChild(icon("minus"));
		minus.disabled = row.units <= MIN_UNITS;

		var value = el("div", "stepper-value");
		value.appendChild(el("span", "field-label", "Units"));
		var out = el("output", "field-value", String(row.units));
		out.setAttribute("aria-live", "polite");
		value.appendChild(out);

		var plus = el("button", "step-btn");
		plus.type = "button";
		plus.setAttribute("aria-label", "More units");
		plus.appendChild(icon("plus"));
		plus.disabled = row.units >= MAX_UNITS;

		function setUnits(u) {
			row.units = Math.min(MAX_UNITS, Math.max(MIN_UNITS, u));
			out.textContent = String(row.units);
			minus.disabled = row.units <= MIN_UNITS;
			plus.disabled = row.units >= MAX_UNITS;
			renderSummary();
			renderClearButton();
			saveState();
		}
		minus.addEventListener("click", function () { setUnits(row.units - 1); });
		plus.addEventListener("click", function () { setUnits(row.units + 1); });

		stepper.appendChild(minus);
		stepper.appendChild(value);
		stepper.appendChild(plus);
		fields.appendChild(stepper);

		li.appendChild(fields);
		return li;
	}

	function renderList() {
		els.list.textContent = "";
		state.rows.forEach(function (row, i) {
			els.list.appendChild(buildRow(row, i));
		});
		renderClearButton();
	}

	function renderClearButton() {
		els.clear.disabled = isPristine();
	}

	function renderSummary() {
		var out = compute(state.rows);
		var text = out.counted === 0 ? "0.00" : formatGwa(out.result);

		els.gwa.textContent = text;
		els.gwa.classList.toggle("is-empty", out.counted === 0);
		if (lastGwaText !== null && text !== lastGwaText) {
			els.gwa.classList.remove("bump");
			void els.gwa.offsetWidth; // restart the animation
			els.gwa.classList.add("bump");
		}
		lastGwaText = text;

		els.standing.textContent = out.academic;
		els.standing.hidden = out.academic === "";

		els.meta.textContent = out.counted === 0
			? plural(0, "unit")
			: plural(out.totalUnits, "unit") + " · " + plural(out.counted, "subject");

	}

	function applyTheme() {
		var dark = state.isDark;
		els.root.classList.toggle("theme-dark", dark);
		els.root.classList.toggle("theme-light", !dark);
		els.themeBtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
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

	/* ---------- Grade picker ---------- */

	function findRow(id) {
		for (var i = 0; i < state.rows.length; i++) {
			if (state.rows[i].id === id) return state.rows[i];
		}
		return null;
	}

	function openSheet(rowId) {
		var row = findRow(rowId);
		if (!row) return;
		sheetRowId = rowId;
		els.sheetTitle.textContent = "Grade for " + rowLabel(row);

		els.gradeGrid.textContent = "";
		var selected = null;
		GRADES.forEach(function (g) {
			var b = el("button", "grade-option", g);
			b.type = "button";
			b.setAttribute("role", "option");
			var isSel = row.grades === parseFloat(g);
			b.setAttribute("aria-selected", String(isSel));
			if (isSel) selected = b;
			b.addEventListener("click", function () {
				chooseGrade(parseFloat(g));
			});
			els.gradeGrid.appendChild(b);
		});

		if (typeof els.sheet.showModal === "function") {
			els.sheet.showModal();
		} else {
			els.sheet.setAttribute("open", "");
		}
		(selected || els.gradeGrid.firstChild).focus();
	}

	function closeSheet() {
		if (typeof els.sheet.close === "function") {
			els.sheet.close();
		} else {
			els.sheet.removeAttribute("open");
		}
	}

	function chooseGrade(value) {
		var row = findRow(sheetRowId);
		if (row) {
			row.grades = value;
			saveState();
		}
		closeSheet();
		renderList();
		renderSummary();
		focusRowControl(sheetRowId, "grade");
	}

	function focusRowControl(rowId, role) {
		var li = els.list.querySelector('[data-id="' + rowId + '"]');
		var target = li && li.querySelector('[data-role="' + role + '"]');
		if (target) target.focus({ preventScroll: true });
	}

	els.sheetClose.addEventListener("click", closeSheet);
	els.sheet.addEventListener("click", function (e) {
		// Tap on the dimmed area outside the sheet closes it.
		if (e.target !== els.sheet) return;
		var r = els.sheet.getBoundingClientRect();
		var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		if (!inside) closeSheet();
	});

	/* ---------- Toast with undo ---------- */

	function showToast(message, onUndo) {
		window.clearTimeout(toastTimer);
		undoAction = onUndo;
		els.toastText.textContent = message;
		els.toast.hidden = false;
		toastTimer = window.setTimeout(hideToast, TOAST_MS);
	}

	function hideToast() {
		window.clearTimeout(toastTimer);
		els.toast.hidden = true;
		undoAction = null;
	}

	els.toastUndo.addEventListener("click", function () {
		var fn = undoAction;
		hideToast();
		if (fn) fn();
	});

	/* ---------- Actions ---------- */

	function addRow() {
		var row = newRow(nextId());
		state.rows = state.rows.concat([row]);
		saveState();
		renderList();
		renderSummary();
		var li = els.list.lastElementChild;
		if (li) {
			li.classList.add("is-new");
			li.scrollIntoView({ block: "nearest", behavior: "smooth" });
		}
		openSheet(row.id);
	}

	function removeRow(id) {
		var index = -1;
		for (var i = 0; i < state.rows.length; i++) {
			if (state.rows[i].id === id) index = i;
		}
		if (index < 0) return;
		var removed = state.rows[index];
		var label = rowLabel(removed);
		state.rows = state.rows.filter(function (r) { return r.id !== id; });
		if (state.rows.length === 0) state.rows = [newRow(nextId())];
		saveState();
		renderList();
		renderSummary();
		showToast("Removed " + label, function () {
			state.rows.splice(Math.min(index, state.rows.length), 0, removed);
			saveState();
			renderList();
			renderSummary();
		});
	}

	function clearAll() {
		if (isPristine()) return;
		var previous = state.rows;
		state.rows = [newRow(nextId())];
		saveState();
		renderList();
		renderSummary();
		showToast("Cleared all subjects", function () {
			state.rows = previous;
			saveState();
			renderList();
			renderSummary();
		});
	}

	els.add.addEventListener("click", addRow);
	els.clear.addEventListener("click", clearAll);
	els.themeBtn.addEventListener("click", function () {
		state.isDark = !state.isDark;
		applyTheme();
		saveState();
	});

	applyTheme();
	renderList();
	renderSummary();

	// Offline support when served over http(s) (GitHub Pages / installed web app).
	// Inside the Android app the files are already on the phone, so this is skipped.
	if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
		window.addEventListener("load", function () {
			navigator.serviceWorker.register("sw.js").catch(function () {});
		});
	}

	// Exposed for automated tests only.
	window.__gcalc = { compute: compute, academicStanding: academicStanding, formatGwa: formatGwa };
})();
