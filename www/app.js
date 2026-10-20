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

	function $(id) {
		return document.getElementById(id);
	}

	var els = {
		root: document.documentElement,
		hero: $("hero"),
		gwa: $("gwa"),
		standing: $("standing"),
		statUnits: $("stat-units"),
		statSubjects: $("stat-subjects"),
		list: $("list"),
		empty: $("empty"),
		add: $("add-btn"),
		clear: $("clear-btn"),
		themeBtn: $("theme-btn"),
		themeColor: document.querySelector('meta[name="theme-color"]'),
		minibar: $("minibar"),
		miniGwa: $("mini-gwa"),
		miniStanding: $("mini-standing"),
		editor: $("editor"),
		editorTitle: $("editor-title"),
		editorClose: $("editor-close"),
		nameInput: $("name-input"),
		gradeGrid: $("grade-grid"),
		unitsGrid: $("units-grid"),
		editorPrimary: $("editor-primary"),
		editorPrimaryText: $("editor-primary-text"),
		editorPrimaryIcon: $("editor-primary-icon"),
		editorSecondary: $("editor-secondary"),
		toast: $("toast"),
		toastText: $("toast-text"),
		toastUndo: $("toast-undo")
	};

	var state = loadState();
	var editing = null; // { id, isNew }
	var toastTimer = null;
	var undoAction = null;
	var lastGwaText = null;
	var heroVisible = true;

	/* ---------- State ---------- */

	function newRow() {
		var id = state.rows.reduce(function (max, r) { return Math.max(max, r.id); }, -1) + 1;
		return { id: id, name: "", grades: 0, units: DEFAULT_UNITS };
	}

	function systemPrefersDark() {
		try {
			return !window.matchMedia("(prefers-color-scheme: light)").matches;
		} catch (e) {
			return true;
		}
	}

	function isBlank(row) {
		return row.grades === 0 && row.name.trim() === "";
	}

	function loadState() {
		try {
			var saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
			if (saved && Array.isArray(saved.rows)) {
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
					}).filter(function (r) { return !isBlank(r); })
				};
			}
		} catch (e) {
			/* storage unavailable or corrupted: start fresh */
		}
		return { isDark: systemPrefersDark(), rows: [] };
	}

	function saveState() {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (e) {
			/* storage unavailable: app still works, it just won't remember */
		}
	}

	function findRow(id) {
		for (var i = 0; i < state.rows.length; i++) {
			if (state.rows[i].id === id) return state.rows[i];
		}
		return null;
	}

	/* ---------- Computation (same formula as the original) ---------- */

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

	function defaultName(row) {
		return "Subject " + (state.rows.indexOf(row) + 1);
	}

	function rowLabel(row) {
		return row.name.trim() || defaultName(row);
	}

	/* ---------- Small helpers ---------- */

	function icon(name, className) {
		var ns = "http://www.w3.org/2000/svg";
		var svg = document.createElementNS(ns, "svg");
		svg.setAttribute("class", "icon" + (className ? " " + className : ""));
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

	// Short vibration on Android for taps that change data. No-op elsewhere.
	function haptic() {
		try {
			if (navigator.vibrate) navigator.vibrate(8);
		} catch (e) {
			/* ignore */
		}
	}

	/* ---------- Rendering ---------- */

	function buildRow(row) {
		var li = el("li", "subject");
		li.dataset.id = String(row.id);

		var btn = el("button", "subject-btn");
		btn.type = "button";
		var name = row.name.trim();
		var gradeText = row.grades === 0 ? "No grade" : row.grades.toFixed(2);
		btn.setAttribute("aria-label",
			rowLabel(row) + ", grade " + gradeText + ", " + plural(row.units, "unit") + ". Edit");

		var text = el("span", "subject-text");
		text.appendChild(el("span", "subject-name" + (name ? "" : " is-placeholder"), rowLabel(row)));
		text.appendChild(el("span", "subject-units", plural(row.units, "unit")));
		btn.appendChild(text);

		btn.appendChild(el("span", "grade-pill" + (row.grades === 0 ? " is-empty" : ""),
			row.grades === 0 ? "Set grade" : row.grades.toFixed(2)));
		btn.appendChild(icon("caret-right", "chevron"));

		btn.addEventListener("click", function () {
			openEditor(row.id, false);
		});

		li.appendChild(btn);
		return li;
	}

	function renderList() {
		els.list.textContent = "";
		state.rows.forEach(function (row) {
			els.list.appendChild(buildRow(row));
		});
		els.empty.hidden = state.rows.length > 0;
		els.clear.disabled = state.rows.length === 0;
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

		els.statUnits.textContent = String(out.totalUnits);
		els.statSubjects.textContent = String(out.counted);

		els.miniGwa.textContent = text;
		els.miniStanding.textContent = out.academic;
		els.miniStanding.hidden = out.academic === "";
		updateMinibar();
	}

	function render() {
		renderList();
		renderSummary();
	}

	function updateMinibar() {
		var show = !heroVisible && state.rows.length > 0;
		els.minibar.classList.toggle("is-visible", show);
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

	/* ---------- Editor sheet ---------- */

	function buildChoices(container, values, current, format, onPick) {
		container.textContent = "";
		values.forEach(function (v) {
			var b = el("button", "choice", format(v));
			b.type = "button";
			b.setAttribute("role", "radio");
			b.setAttribute("aria-checked", String(v === current));
			b.addEventListener("click", function () {
				Array.prototype.forEach.call(container.children, function (c) {
					c.setAttribute("aria-checked", String(c === b));
				});
				haptic();
				onPick(v);
			});
			container.appendChild(b);
		});
	}

	function fillEditor() {
		var row = findRow(editing.id);
		if (!row) return;

		els.editorTitle.textContent = editing.isNew ? "New subject" : "Edit subject";
		els.nameInput.value = row.name;
		els.nameInput.placeholder = defaultName(row);

		buildChoices(els.gradeGrid, GRADES.map(parseFloat), row.grades,
			function (g) { return g.toFixed(2); },
			function (g) {
				row.grades = g;
				saveState();
				render();
			});

		var units = [];
		for (var u = MIN_UNITS; u <= MAX_UNITS; u++) units.push(u);
		buildChoices(els.unitsGrid, units, row.units, String, function (u) {
			row.units = u;
			saveState();
			render();
		});

		if (editing.isNew) {
			els.editorSecondary.textContent = "Done";
			els.editorSecondary.className = "btn btn-secondary";
			els.editorPrimaryText.textContent = "Next subject";
			els.editorPrimaryIcon.style.display = "";
		} else {
			els.editorSecondary.textContent = "Delete";
			els.editorSecondary.className = "btn btn-danger";
			els.editorPrimaryText.textContent = "Done";
			els.editorPrimaryIcon.style.display = "none";
		}
	}

	function openEditor(id, isNew) {
		editing = { id: id, isNew: isNew };
		fillEditor();
		if (!els.editor.open) {
			if (typeof els.editor.showModal === "function") {
				els.editor.showModal();
			} else {
				els.editor.setAttribute("open", "");
			}
		}
		els.editor.querySelector(".sheet-body").scrollTop = 0;
	}

	function closeEditor() {
		if (typeof els.editor.close === "function") {
			els.editor.close();
		} else {
			els.editor.removeAttribute("open");
			onEditorClosed();
		}
	}

	// Drop a new subject the user opened but never filled in.
	function discardIfBlank(id) {
		var row = findRow(id);
		if (row && isBlank(row)) {
			state.rows = state.rows.filter(function (r) { return r.id !== id; });
			saveState();
			return true;
		}
		return false;
	}

	function onEditorClosed() {
		if (!editing) return;
		var wasNew = editing.isNew;
		var id = editing.id;
		editing = null;
		var dropped = wasNew && discardIfBlank(id);
		render();
		if (wasNew && !dropped) highlightRow(id);
	}

	function highlightRow(id) {
		var li = els.list.querySelector('[data-id="' + id + '"]');
		if (!li) return;
		li.classList.add("is-new");
		li.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	function startNewSubject() {
		var row = newRow();
		state.rows = state.rows.concat([row]);
		saveState();
		render();
		haptic();
		openEditor(row.id, true);
	}

	els.editor.addEventListener("close", onEditorClosed);
	els.editorClose.addEventListener("click", closeEditor);

	els.editor.addEventListener("click", function (e) {
		// Tap on the dimmed area outside the sheet closes it.
		if (e.target !== els.editor) return;
		var r = els.editor.getBoundingClientRect();
		var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
		if (!inside) closeEditor();
	});

	els.nameInput.addEventListener("input", function () {
		var row = editing && findRow(editing.id);
		if (!row) return;
		row.name = els.nameInput.value;
		saveState();
		renderList();
	});

	els.nameInput.addEventListener("keydown", function (e) {
		if (e.key === "Enter") {
			e.preventDefault();
			els.nameInput.blur();
		}
	});

	els.editorPrimary.addEventListener("click", function () {
		if (!editing) return;
		if (editing.isNew) {
			// Keep the sheet open and move straight to the next subject.
			var prevId = editing.id;
			discardIfBlank(prevId);
			var row = newRow();
			state.rows = state.rows.concat([row]);
			saveState();
			render();
			highlightRow(prevId);
			haptic();
			openEditor(row.id, true);
			els.nameInput.blur();
		} else {
			closeEditor();
		}
	});

	els.editorSecondary.addEventListener("click", function () {
		if (!editing) return;
		if (editing.isNew) {
			closeEditor();
		} else {
			var id = editing.id;
			editing = null; // handled here, not by the close handler
			closeEditor();
			removeRow(id);
		}
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

	function removeRow(id) {
		var index = -1;
		for (var i = 0; i < state.rows.length; i++) {
			if (state.rows[i].id === id) index = i;
		}
		if (index < 0) return;
		var removed = state.rows[index];
		var label = rowLabel(removed);
		state.rows = state.rows.filter(function (r) { return r.id !== id; });
		saveState();
		render();
		haptic();
		showToast("Removed " + label, function () {
			state.rows.splice(Math.min(index, state.rows.length), 0, removed);
			saveState();
			render();
		});
	}

	function clearAll() {
		if (state.rows.length === 0) return;
		var previous = state.rows;
		state.rows = [];
		saveState();
		render();
		haptic();
		showToast("Cleared all subjects", function () {
			state.rows = previous;
			saveState();
			render();
		});
	}

	els.add.addEventListener("click", startNewSubject);
	els.clear.addEventListener("click", clearAll);
	els.themeBtn.addEventListener("click", function () {
		state.isDark = !state.isDark;
		applyTheme();
		saveState();
	});

	// Show the compact GWA bar once the big card scrolls out of view.
	if ("IntersectionObserver" in window) {
		new IntersectionObserver(function (entries) {
			heroVisible = entries[0].isIntersecting;
			updateMinibar();
		}, { threshold: 0, rootMargin: "-40px 0px 0px 0px" }).observe(els.hero);
	}

	applyTheme();
	render();

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
