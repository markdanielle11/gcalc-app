/* GCalc: GWA calculator for CLSU students.
   Port of github.com/AaronJay30/gwa-calculator (React) to plain JavaScript
   so it runs offline inside the Android app and as an installable web app.
   Subjects are kept per semester; each semester has its own GWA and the
   overall GWA covers every semester. */
(function () {
	"use strict";

	var GRADES = ["1.00", "1.25", "1.50", "1.75", "2.00", "2.25", "2.50", "2.75", "3.00", "4.00", "5.00"];
	var GRADE_VALUES = GRADES.map(parseFloat);
	var MIN_UNITS = 1;
	var MAX_UNITS = 10;
	var DEFAULT_UNITS = 3;
	var HONORS_MIN_UNITS = 10; // honors need MORE than this many units
	var STORAGE_KEY = "gcalc-state-v1";
	var TOAST_MS = 5000;
	var TERM_NAMES = ["1st Semester", "2nd Semester", "Midyear"];
	var STANDING_RANK = { "": 0, "Dean's Lister": 1, "College Scholar": 2, "University Scholar": 3 };
	var HONORS = [
		{ name: "Dean's Lister", max: 2.0 },
		{ name: "College Scholar", max: 1.75 },
		{ name: "University Scholar", max: 1.5 }
	];
	// NSTP (and its CWTS / ROTC / LTS components) is not part of the GWA.
	var NOT_COUNTED = /^\s*(NSTP|CWTS|ROTC|LTS)(\b|\d)/i;

	function $(id) {
		return document.getElementById(id);
	}

	var els = {
		root: document.documentElement,
		terms: $("terms"),
		hero: $("hero"),
		heroLabel: $("hero-label"),
		gwa: $("gwa"),
		standing: $("standing"),
		standingText: $("standing-text"),
		scaleRail: $("scale-rail"),
		subjectCount: $("subject-count"),
		statUnits: $("stat-units"),
		statSubjects: $("stat-subjects"),
		statOverallWrap: $("stat-overall-wrap"),
		statOverall: $("stat-overall"),
		list: $("list"),
		empty: $("empty"),
		add: $("add-btn"),
		clear: $("clear-btn"),
		settingsBtn: $("settings-btn"),
		shareBtn: $("share-btn"),
		goals: $("goals"),
		goalsText: $("goals-text"),
		goalsList: $("goals-list"),
		sortBtn: $("sort-btn"),
		settings: $("settings"),
		settingsClose: $("settings-close"),
		themeChoice: $("theme-choice"),
		backupSave: $("backup-save"),
		backupRestore: $("backup-restore"),
		backupInput: $("backup-input"),
		menu: $("menu"),
		menuTitle: $("menu-title"),
		menuClose: $("menu-close"),
		menuList: $("menu-list"),
		shareSheet: $("share-sheet"),
		shareClose: $("share-close"),
		shareCancel: $("share-cancel"),
		shareGo: $("share-go"),
		shareName: $("share-name"),
		sharePreview: $("share-preview"),
		importTarget: $("import-target"),
		importTargetChips: $("import-target-chips"),
		themeColor: document.querySelector('meta[name="theme-color"]'),
		minibar: $("minibar"),
		miniGwa: $("mini-gwa"),
		miniStanding: $("mini-standing"),
		editor: $("editor"),
		editorTitle: $("editor-title"),
		editorClose: $("editor-close"),
		editorGwa: $("editor-gwa"),
		nameInput: $("name-input"),
		gradeGrid: $("grade-grid"),
		unitsGrid: $("units-grid"),
		editorPrimary: $("editor-primary"),
		editorPrimaryText: $("editor-primary-text"),
		editorPrimaryIcon: $("editor-primary-icon"),
		editorSecondary: $("editor-secondary"),
		quick: $("quick"),
		quickTitle: $("quick-title"),
		quickClose: $("quick-close"),
		quickGrid: $("quick-grid"),
		quickGwa: $("quick-gwa"),
		quickMore: $("quick-more"),
		termSheet: $("term-sheet"),
		termTitle: $("term-title"),
		termClose: $("term-close"),
		termName: $("term-name"),
		termSuggest: $("term-suggest"),
		termDelete: $("term-delete"),
		termDone: $("term-done"),
		importBtn: $("import-btn"),
		importInput: $("import-input"),
		importer: $("importer"),
		importTitle: $("import-title"),
		importClose: $("import-close"),
		importProgress: $("import-progress"),
		importPreview: $("import-preview"),
		importBar: $("import-bar"),
		importFill: $("import-fill"),
		importStep: $("import-step"),
		importList: $("import-list"),
		importMessage: $("import-message"),
		importMessageText: $("import-message-text"),
		importPct: $("import-pct"),
		importPrimary: $("import-primary"),
		importSecondary: $("import-secondary"),
		toast: $("toast"),
		toastText: $("toast-text"),
		toastUndo: $("toast-undo")
	};

	var state = loadState();
	var editing = null;      // { id, isNew } in the subject editor
	var quickId = null;      // subject in the quick grade sheet
	var termEditing = null;  // { id, isNew } in the semester sheet
	var toastTimer = null;
	var undoAction = null;
	var lastGwaText = null;
	var lastRank = null;
	var shownGwa = 0;        // the number on screen while it counts to a new GWA
	var gwaFrame = 0;
	var heroVisible = true;
	var firstRender = true;

	/* ---------- State ---------- */

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

	function cleanRows(rows) {
		return (Array.isArray(rows) ? rows : []).map(function (r, i) {
			r = r || {};
			var g = GRADES.indexOf(Number(r.grades).toFixed(2)) >= 0 ? Number(r.grades) : 0;
			var u = Math.floor(Number(r.units));
			return {
				id: typeof r.id === "number" ? r.id : i,
				name: typeof r.name === "string" ? r.name.slice(0, 40) : "",
				grades: g,
				units: u >= MIN_UNITS && u <= MAX_UNITS ? u : DEFAULT_UNITS
			};
		}).filter(function (r) { return !isBlank(r); });
	}

	function loadState() {
		var saved = null;
		try {
			saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
		} catch (e) {
			/* storage unavailable or corrupted: start fresh */
		}
		return loadFrom(saved);
	}

	/* Turns saved data (or a backup file) into a clean state. */
	function loadFrom(saved) {
		var s = null;
		try {
			if (saved && typeof saved === "object") {
				var terms;
				if (Array.isArray(saved.terms) && saved.terms.length) {
					terms = saved.terms.map(function (t, i) {
						t = t || {};
						return {
							id: typeof t.id === "number" ? t.id : i,
							name: typeof t.name === "string" && t.name.trim() ? t.name.slice(0, 30) : "Semester " + (i + 1),
							rows: cleanRows(t.rows)
						};
					});
				} else {
					// Saved before semesters existed: everything becomes the first semester.
					terms = [{ id: 0, name: TERM_NAMES[0], rows: cleanRows(saved.rows) }];
				}
				var theme = saved.theme === "system" || saved.theme === "light" || saved.theme === "dark" ? saved.theme :
					typeof saved.isDark === "boolean" ? (saved.isDark ? "dark" : "light") : "system";
				s = {
					name: typeof saved.name === "string" ? saved.name.slice(0, 40) : "",
					theme: theme,
					isDark: false,
					terms: terms,
					active: typeof saved.active === "number" ? saved.active : terms[0].id
				};
			}
		} catch (e) {
			/* storage unavailable or corrupted: start fresh */
		}
		if (!s) s = { name: "", theme: "system", isDark: false, terms: [{ id: 0, name: TERM_NAMES[0], rows: [] }], active: 0 };
		// Subject ids are unique across all semesters.
		var seen = {}, next = 0;
		s.terms.forEach(function (t) { t.rows.forEach(function (r) { next = Math.max(next, r.id + 1); }); });
		s.terms.forEach(function (t) {
			t.rows.forEach(function (r) {
				if (seen[r.id]) r.id = next++;
				seen[r.id] = true;
			});
		});
		if (!s.terms.some(function (t) { return t.id === s.active; })) s.active = s.terms[0].id;
		return s;
	}

	function saveState() {
		try {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch (e) {
			/* storage unavailable: app still works, it just won't remember */
		}
	}

	/** The semester being shown. */
	function cur() {
		for (var i = 0; i < state.terms.length; i++) {
			if (state.terms[i].id === state.active) return state.terms[i];
		}
		return state.terms[0];
	}

	function findTerm(id) {
		for (var i = 0; i < state.terms.length; i++) {
			if (state.terms[i].id === id) return state.terms[i];
		}
		return null;
	}

	function allRows() {
		return state.terms.reduce(function (all, t) { return all.concat(t.rows); }, []);
	}

	function newRow() {
		var id = allRows().reduce(function (max, r) { return Math.max(max, r.id); }, -1) + 1;
		return { id: id, name: "", grades: 0, units: DEFAULT_UNITS };
	}

	function findRow(id) {
		var rows = cur().rows;
		for (var i = 0; i < rows.length; i++) {
			if (rows[i].id === id) return rows[i];
		}
		return null;
	}

	/* ---------- Computation (same formula as the original) ---------- */

	function compute(rows) {
		var totalGrades = 0;
		var totalUnits = 0;
		var counted = 0;
		rows.forEach(function (row) {
			// Only rows with both a grade and units count toward the GWA (NSTP never does).
			if (row.grades > 0 && row.units > 0 && isCounted(row)) {
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
		return "Subject " + (cur().rows.indexOf(row) + 1);
	}

	function rowLabel(row) {
		return row.name.trim() || defaultName(row);
	}

	function isCounted(row) {
		return !NOT_COUNTED.test(row.name);
	}

	/* Usual units for a subject code, so they don't have to be picked by hand. */
	function suggestUnits(name) {
		var n = name.toUpperCase().replace(/\s+/g, " ").trim();
		if (!/[A-Z]{2,}\s*\d/.test(n)) return 0;
		if (NOT_COUNTED.test(n)) return 3;
		if (/^(PATHFIT|PE)\s*\d/.test(n)) return 2;
		if (/\bLAB\b|\d+L$/.test(n)) return 1;
		return 3;
	}

	function unitsText(row) {
		return plural(row.units, "unit") + (isCounted(row) ? "" : " \u00b7 Not in GWA");
	}

	// Honors-level grades get the accent, failing grades red.
	function gradeTier(g) {
		if (g > 0 && g <= 1.75) return " is-top";
		if (g >= 5) return " is-fail";
		return "";
	}

	function reducedMotion() {
		try {
			return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		} catch (e) {
			return false;
		}
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
	function haptic(ms) {
		try {
			if (navigator.vibrate) navigator.vibrate(ms || 8);
		} catch (e) {
			/* ignore */
		}
	}

	function openSheet(dialog) {
		if (dialog.open) return;
		if (typeof dialog.showModal === "function") dialog.showModal();
		else dialog.setAttribute("open", "");
	}

	function closeSheet(dialog) {
		if (!dialog.open) return;
		if (typeof dialog.close === "function") dialog.close();
		else {
			dialog.removeAttribute("open");
			dialog.dispatchEvent(new Event("close"));
		}
	}

	// Tap on the dimmed area outside a sheet closes it.
	function closeOnBackdrop(dialog, onClose) {
		dialog.addEventListener("click", function (e) {
			if (e.target !== dialog) return;
			var r = dialog.getBoundingClientRect();
			var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
			if (!inside) (onClose || function () { closeSheet(dialog); })();
		});
	}

	/* ---------- Semesters ---------- */

	function renderTerms() {
		els.terms.textContent = "";
		var activeChip = null;
		state.terms.forEach(function (t) {
			var active = t.id === state.active;
			var b = el("button", "term-chip" + (active ? " is-active" : ""));
			b.type = "button";
			b.setAttribute("aria-pressed", String(active));
			b.appendChild(el("span", "term-name", t.name));
			if (active) {
				b.setAttribute("aria-label", t.name + ", edit semester");
				b.appendChild(icon("caret-down", "term-caret"));
				activeChip = b;
			}
			b.addEventListener("click", function () {
				if (t.id === state.active) openTermSheet(t.id, false);
				else switchTerm(t.id);
			});
			els.terms.appendChild(b);
		});
		var add = el("button", "term-chip is-add");
		add.type = "button";
		add.appendChild(icon("plus"));
		add.appendChild(el("span", "", "Semester"));
		add.setAttribute("aria-label", "Add semester");
		add.addEventListener("click", addTerm);
		els.terms.appendChild(add);
		if (activeChip && els.terms.scrollWidth > els.terms.clientWidth) {
			var left = activeChip.offsetLeft - 16;
			if (left < els.terms.scrollLeft || activeChip.offsetLeft + activeChip.offsetWidth > els.terms.scrollLeft + els.terms.clientWidth) {
				els.terms.scrollLeft = Math.max(0, left);
			}
		}
	}

	function switchTerm(id) {
		state.active = id;
		saveState();
		haptic();
		render({ quiet: true, entering: true });
	}

	function suggestTermName() {
		var used = state.terms.map(function (t) { return t.name; });
		for (var i = 0; i < TERM_NAMES.length; i++) {
			if (used.indexOf(TERM_NAMES[i]) < 0) return TERM_NAMES[i];
		}
		return "Semester " + (state.terms.length + 1);
	}

	function addTerm() {
		var id = state.terms.reduce(function (max, t) { return Math.max(max, t.id); }, -1) + 1;
		state.terms.push({ id: id, name: suggestTermName(), rows: [] });
		state.active = id;
		saveState();
		haptic();
		render({ quiet: true, entering: true });
		openTermSheet(id, true);
	}

	function openTermSheet(id, isNew) {
		var t = findTerm(id);
		if (!t) return;
		termEditing = { id: id, isNew: isNew };
		els.termTitle.textContent = isNew ? "New semester" : "Semester";
		els.termName.value = t.name;
		els.termDelete.hidden = state.terms.length < 2;
		els.termDelete.textContent = isNew ? "Cancel" : "Delete";
		els.termSheet.classList.toggle("is-single", state.terms.length < 2);
		els.termSuggest.textContent = "";
		TERM_NAMES.forEach(function (name) {
			var b = el("button", "suggest-chip", name);
			b.type = "button";
			b.addEventListener("click", function () {
				els.termName.value = name;
				setTermName(name);
				haptic();
			});
			els.termSuggest.appendChild(b);
		});
		openSheet(els.termSheet);
	}

	function setTermName(name) {
		var t = termEditing && findTerm(termEditing.id);
		if (!t) return;
		t.name = name.slice(0, 30);
		saveState();
		renderTerms();
		renderSummary({ quiet: true });
	}

	function removeTerm(id, silent) {
		var index = -1;
		for (var i = 0; i < state.terms.length; i++) if (state.terms[i].id === id) index = i;
		if (index < 0 || state.terms.length < 2) return;
		var removed = state.terms[index];
		var wasActive = state.active;
		state.terms.splice(index, 1);
		if (state.active === id) state.active = state.terms[Math.max(0, index - 1)].id;
		saveState();
		haptic();
		render({ quiet: true, entering: true });
		if (silent) return;
		showToast("Removed " + removed.name, function () {
			state.terms.splice(Math.min(index, state.terms.length), 0, removed);
			state.active = wasActive;
			saveState();
			render({ quiet: true });
		});
	}

	els.termName.addEventListener("input", function () {
		setTermName(els.termName.value);
	});
	els.termName.addEventListener("keydown", function (e) {
		if (e.key === "Enter") {
			e.preventDefault();
			closeSheet(els.termSheet);
		}
	});
	els.termDone.addEventListener("click", function () { closeSheet(els.termSheet); });
	els.termClose.addEventListener("click", function () { closeSheet(els.termSheet); });
	els.termDelete.addEventListener("click", function () {
		if (!termEditing) return;
		var id = termEditing.id, isNew = termEditing.isNew;
		termEditing = null;
		closeSheet(els.termSheet);
		removeTerm(id, isNew); // cancelling a new semester needs no undo
	});
	closeOnBackdrop(els.termSheet);
	els.termSheet.addEventListener("close", function () {
		var t = termEditing && findTerm(termEditing.id);
		termEditing = null;
		if (t && !t.name.trim()) {
			t.name = suggestTermName();
			saveState();
			render({ quiet: true });
		}
	});

	/* ---------- Rendering ---------- */

	function buildRow(row, index) {
		var li = el("li", "subject");
		li.dataset.id = String(row.id);
		li.style.setProperty("--i", String(index));

		var del = el("span", "subject-delete");
		del.setAttribute("aria-hidden", "true");
		del.appendChild(icon("trash"));
		li.appendChild(del);

		var swipe = el("div", "subject-row");

		var btn = el("button", "subject-btn");
		btn.type = "button";
		var name = row.name.trim();
		btn.setAttribute("aria-label", rowLabel(row) + ", " + unitsText(row) + ". Edit");
		var text = el("span", "subject-text");
		text.appendChild(el("span", "subject-name" + (name ? "" : " is-placeholder"), rowLabel(row)));
		text.appendChild(el("span", "subject-units", unitsText(row)));
		btn.appendChild(text);
		if (!isCounted(row)) li.classList.add("is-uncounted");
		btn.addEventListener("click", function () {
			if (li.dataset.swiped) return;
			openEditor(row.id, false);
		});

		var gradeBtn = el("button", "grade-pill" + (row.grades === 0 ? " is-empty" : isCounted(row) ? gradeTier(row.grades) : ""),
			row.grades === 0 ? "Set grade" : row.grades.toFixed(2));
		gradeBtn.type = "button";
		gradeBtn.setAttribute("aria-label", (row.grades === 0 ? "Set grade" : "Grade " + row.grades.toFixed(2) + ", change") + " for " + rowLabel(row));
		gradeBtn.addEventListener("click", function () {
			if (li.dataset.swiped) return;
			openQuick(row.id);
		});

		swipe.appendChild(btn);
		swipe.appendChild(gradeBtn);
		li.appendChild(swipe);
		attachSwipe(li, swipe, function () { removeRow(row.id); });
		return li;
	}

	/* Swipe a subject to the left to delete it (touch only; the editor has a Delete button too). */
	function attachSwipe(li, row, onDelete) {
		var startX = 0, startY = 0, dx = 0, pointer = null, mode = null;
		function reset(animate) {
			li.classList.remove("is-swiping", "will-delete");
			row.style.transition = animate ? "" : "none";
			row.style.transform = "";
		}
		row.addEventListener("pointerdown", function (e) {
			if (e.pointerType === "mouse" || pointer !== null) return;
			pointer = e.pointerId;
			startX = e.clientX;
			startY = e.clientY;
			dx = 0;
			mode = null;
		});
		row.addEventListener("pointermove", function (e) {
			if (e.pointerId !== pointer) return;
			var x = e.clientX - startX, y = e.clientY - startY;
			if (mode === null && (Math.abs(x) > 10 || Math.abs(y) > 10)) {
				mode = x < 0 && Math.abs(x) > Math.abs(y) * 1.3 ? "swipe" : "scroll";
				if (mode === "swipe") {
					try { row.setPointerCapture(pointer); } catch (err) { /* ignore */ }
					li.classList.add("is-swiping");
					row.style.transition = "none";
				}
			}
			if (mode !== "swipe") return;
			dx = Math.min(0, x);
			row.style.transform = "translateX(" + dx + "px)";
			var past = -dx > li.offsetWidth * 0.38;
			if (past !== li.classList.contains("will-delete")) {
				li.classList.toggle("will-delete", past);
				haptic(past ? 12 : 4);
			}
		});
		function end(e) {
			if (e.pointerId !== pointer) return;
			pointer = null;
			if (mode !== "swipe") return;
			// The tap that ends a swipe must not also open the editor.
			li.dataset.swiped = "1";
			window.setTimeout(function () { delete li.dataset.swiped; }, 350);
			if (-dx > li.offsetWidth * 0.38 && e.type === "pointerup") {
				row.style.transition = "";
				row.style.transform = "translateX(-110%)";
				li.classList.add("is-leaving");
				window.setTimeout(onDelete, reducedMotion() ? 0 : 200);
			} else {
				reset(true);
			}
		}
		row.addEventListener("pointerup", end);
		row.addEventListener("pointercancel", end);
	}

	function renderList(opts) {
		var rows = cur().rows;
		els.list.textContent = "";
		rows.forEach(function (row, i) {
			els.list.appendChild(buildRow(row, i));
		});
		els.list.classList.remove("is-entering");
		if (opts && opts.entering && !reducedMotion()) {
			void els.list.offsetWidth;
			els.list.classList.add("is-entering");
		}
		els.empty.hidden = rows.length > 0;
		els.clear.disabled = rows.length === 0;
		els.subjectCount.textContent = rows.length ? String(rows.length) : "";
	}

	function renderSummary(opts) {
		opts = opts || {};
		var out = compute(cur().rows);
		var text = out.counted === 0 ? "0.00" : formatGwa(out.result);

		var empty = out.counted === 0;
		if (text !== lastGwaText) showGwa(empty ? 0 : out.result, text, lastGwaText === null);
		els.gwa.classList.toggle("is-empty", empty);
		lastGwaText = text;

		// Marker on the 1.00 to 3.00 scale (past 3.00 it rests at the end).
		var pos = empty ? 0 : Math.max(0, Math.min(1, (out.result - 1) / 2));
		els.scaleRail.style.transform = "translateX(" + (pos * 100).toFixed(2) + "%)";
		els.hero.classList.toggle("has-gwa", !empty);
		els.hero.classList.toggle("is-honors", out.academic !== "");

		els.heroLabel.textContent = state.terms.length > 1 ? cur().name + " GWA" : "Your GWA";
		els.standingText.textContent = out.academic;
		els.standing.hidden = out.academic === "";

		els.statUnits.textContent = String(out.totalUnits);
		els.statSubjects.textContent = String(out.counted);

		var overall = compute(allRows());
		els.statOverallWrap.hidden = state.terms.length < 2;
		els.statOverall.textContent = overall.counted === 0 ? "0.00" : formatGwa(overall.result);

		renderGoals();

		els.miniGwa.textContent = text;
		els.miniStanding.textContent = out.academic;
		els.miniStanding.hidden = out.academic === "";
		els.editorGwa.textContent = text;
		els.quickGwa.textContent = text;
		updateMinibar();

		// Reaching honors (or a higher one) by an edit is worth a small celebration.
		var rank = STANDING_RANK[out.academic] || 0;
		if (lastRank !== null && rank > lastRank && !opts.quiet) {
			celebrate();
			haptic(30);
		}
		lastRank = rank;
	}

	/* For subjects still without a grade: the average grade they need for each honor. */
	function renderGoals() {
		var rows = cur().rows.filter(isCounted);
		var gradedUnits = 0, sum = 0, openUnits = 0, open = 0;
		rows.forEach(function (r) {
			if (r.grades > 0) {
				gradedUnits += r.units;
				sum += r.grades * r.units;
			} else {
				openUnits += r.units;
				open++;
			}
		});
		var total = gradedUnits + openUnits;
		var show = open > 0 && total > HONORS_MIN_UNITS;
		els.goals.hidden = !show;
		if (!show) return;
		els.goalsText.textContent = "Average grade needed in your " + plural(open, "subject") + " without a grade";
		els.goalsList.textContent = "";
		var passing = GRADE_VALUES.filter(function (g) { return g <= 3; });
		HONORS.slice().reverse().forEach(function (h) {
			var limit = (h.max * total - sum) / openUnits + 1e-9;
			var fit = passing.filter(function (g) { return g <= limit; });
			var li = el("li", "goal");
			li.appendChild(el("span", "goal-name", h.name));
			var need;
			if (!fit.length) need = el("span", "goal-need is-out", "Out of reach");
			else if (fit[fit.length - 1] >= 3) need = el("span", "goal-need is-easy", "Any passing grade");
			else need = el("span", "goal-need", fit[fit.length - 1].toFixed(2) + " or better");
			li.appendChild(need);
			els.goalsList.appendChild(li);
		});
	}

	// Counts the GWA up or down to its new value, so a change is easy to follow.
	function showGwa(value, text, instant) {
		window.cancelAnimationFrame(gwaFrame);
		var from = shownGwa;
		shownGwa = value;
		var decimals = (text.split(".")[1] || "").length;
		if (instant || reducedMotion() || !window.requestAnimationFrame || value === 0) {
			els.gwa.textContent = text;
			return;
		}
		var start = null;
		function step(now) {
			if (start === null) start = now;
			var k = Math.min(1, (now - start) / 480);
			var eased = 1 - Math.pow(1 - k, 3);
			els.gwa.textContent = k < 1 ? (from + (value - from) * eased).toFixed(decimals) : text;
			if (k < 1) gwaFrame = window.requestAnimationFrame(step);
		}
		gwaFrame = window.requestAnimationFrame(step);
	}

	function render(opts) {
		opts = opts || {};
		if (firstRender) {
			opts.entering = true;
			opts.quiet = true;
			firstRender = false;
		}
		renderTerms();
		renderList(opts);
		renderSummary(opts);
	}

	function updateMinibar() {
		var show = !heroVisible && cur().rows.length > 0;
		els.minibar.classList.toggle("is-visible", show);
	}

	function applyTheme() {
		var dark = state.theme === "system" ? systemPrefersDark() : state.theme === "dark";
		state.isDark = dark; // read before first paint (index.html)
		els.root.classList.toggle("theme-dark", dark);
		els.root.classList.toggle("theme-light", !dark);
		Array.prototype.forEach.call(els.themeChoice.children, function (b) {
			b.setAttribute("aria-checked", String(b.dataset.theme === state.theme));
		});
		var bg = dark ? "#131B31" : "#EEF2FB";
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

	/* ---------- Celebration ---------- */

	function celebrate() {
		if (reducedMotion() || !window.requestAnimationFrame) return;
		var canvas = el("canvas", "confetti");
		canvas.setAttribute("aria-hidden", "true");
		var dpr = Math.min(2, window.devicePixelRatio || 1);
		var w = window.innerWidth, h = window.innerHeight;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		document.body.appendChild(canvas);
		var ctx = canvas.getContext("2d");
		ctx.scale(dpr, dpr);
		var styles = window.getComputedStyle(els.root);
		var colors = [styles.getPropertyValue("--accent").trim(), styles.getPropertyValue("--accent-text").trim(), styles.getPropertyValue("--text").trim(), "#7FA2FF", "#F2D48A"];
		var r = els.hero.getBoundingClientRect();
		var ox = r.left + r.width / 2, oy = Math.max(40, r.top + r.height * 0.35);
		var parts = [];
		for (var i = 0; i < 110; i++) {
			var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
			var v = 7 + Math.random() * 9;
			parts.push({
				x: ox, y: oy,
				vx: Math.cos(a) * v, vy: Math.sin(a) * v,
				w: 5 + Math.random() * 5, h: 8 + Math.random() * 6,
				rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
				color: colors[i % colors.length]
			});
		}
		var start = null;
		function frame(now) {
			if (start === null) start = now;
			var t = (now - start) / 1000;
			ctx.clearRect(0, 0, w, h);
			parts.forEach(function (p) {
				p.vy += 0.32;
				p.vx *= 0.985;
				p.vy *= 0.985;
				p.x += p.vx;
				p.y += p.vy;
				p.rot += p.vr;
				ctx.save();
				ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1.1) / 0.6);
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rot);
				ctx.scale(1, Math.cos(p.rot * 2));
				ctx.fillStyle = p.color;
				ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
				ctx.restore();
			});
			if (t < 1.75) window.requestAnimationFrame(frame);
			else canvas.remove();
		}
		window.requestAnimationFrame(frame);
	}

	/* ---------- Editor sheet ---------- */

	function buildChoices(container, values, current, format, onPick, isGrade) {
		container.textContent = "";
		values.forEach(function (v) {
			var b = el("button", "choice" + (isGrade && v >= 5 ? " is-fail" : ""), format(v));
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

	function unitValues() {
		var units = [];
		for (var u = MIN_UNITS; u <= MAX_UNITS; u++) units.push(u);
		return units;
	}

	function fillEditor() {
		var row = findRow(editing.id);
		if (!row) return;

		els.editorTitle.textContent = editing.isNew ? "New subject" : "Edit subject";
		els.nameInput.value = row.name;
		els.nameInput.placeholder = defaultName(row);

		buildChoices(els.gradeGrid, GRADE_VALUES, row.grades,
			function (g) { return g.toFixed(2); },
			function (g) {
				row.grades = g;
				saveState();
				render();
			}, true);

		buildChoices(els.unitsGrid, unitValues(), row.units, String, function (u) {
			row.units = u;
			if (editing) editing.unitsPicked = true;
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
		openSheet(els.editor);
		els.editor.querySelector(".sheet-body").scrollTop = 0;
	}

	function closeEditor() {
		closeSheet(els.editor);
	}

	// Drop a new subject the user opened but never filled in.
	function discardIfBlank(id) {
		var row = findRow(id);
		if (row && isBlank(row)) {
			cur().rows = cur().rows.filter(function (r) { return r.id !== id; });
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
		li.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
	}

	function startNewSubject() {
		var row = newRow();
		cur().rows = cur().rows.concat([row]);
		saveState();
		render();
		haptic();
		openEditor(row.id, true);
	}

	els.editor.addEventListener("close", onEditorClosed);
	els.editorClose.addEventListener("click", closeEditor);
	closeOnBackdrop(els.editor, closeEditor);

	els.nameInput.addEventListener("input", function () {
		var row = editing && findRow(editing.id);
		if (!row) return;
		row.name = els.nameInput.value;
		// New subject: fill in the usual units for the code until units are picked by hand.
		if (editing.isNew && !editing.unitsPicked) {
			var u = suggestUnits(row.name);
			if (u && u !== row.units) {
				row.units = u;
				Array.prototype.forEach.call(els.unitsGrid.children, function (c) {
					c.setAttribute("aria-checked", String(Number(c.textContent) === u));
				});
			}
		}
		saveState();
		render({ quiet: true });
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
			cur().rows = cur().rows.concat([row]);
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

	/* ---------- Quick grade sheet ---------- */

	function openQuick(id) {
		var row = findRow(id);
		if (!row) return;
		quickId = id;
		els.quickTitle.textContent = rowLabel(row);
		buildChoices(els.quickGrid, GRADE_VALUES, row.grades, function (g) { return g.toFixed(2); }, function (g) {
			row.grades = g;
			saveState();
			render();
			// Let the choice show for a moment, then close.
			window.setTimeout(function () { closeSheet(els.quick); }, reducedMotion() ? 0 : 220);
		}, true);
		openSheet(els.quick);
	}

	els.quickClose.addEventListener("click", function () { closeSheet(els.quick); });
	els.quickMore.addEventListener("click", function () {
		var id = quickId;
		closeSheet(els.quick);
		if (id !== null) openEditor(id, false);
	});
	closeOnBackdrop(els.quick);
	els.quick.addEventListener("close", function () { quickId = null; });

	/* ---------- Toast with undo ---------- */

	function showToast(message, onUndo) {
		window.clearTimeout(toastTimer);
		undoAction = onUndo;
		els.toastText.textContent = message;
		els.toastUndo.hidden = !onUndo;
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

	/* ---------- Import from screenshot ---------- */

	var importRun = 0;       // ignores results from a cancelled read
	var importFound = [];    // rows read from the image
	var importPicked = [];   // true/false per row
	var importOpen = -1;     // row whose details are open for fixing
	var importTarget = null; // { id } of a semester, or { name } of a new one
	var importDetected = null;

	/* "1ST SEMESTER 2025-2026" on the screenshot -> "1st Semester 2025-2026". */
	function detectSemester(text) {
		var t = String(text || "").toUpperCase();
		var name = null;
		if (/\b(1ST|IST|LST|FIRST)\s*SEM/.test(t)) name = "1st Semester";
		else if (/\b(2ND|ZND|SECOND)\s*SEM/.test(t)) name = "2nd Semester";
		else if (/MID\s*-?\s*YEAR|SUMMER/.test(t)) name = "Midyear";
		if (!name) return null;
		var y = t.match(/(20\d\d)\s*-\s*(20\d\d)/);
		var year = y && Number(y[2]) === Number(y[1]) + 1 ? y[1] + "-" + y[2] : "";
		return { base: name, full: year ? name + " " + year : name };
	}

	function sameName(a, b) {
		return a.trim().toLowerCase() === b.trim().toLowerCase();
	}

	function pickImportTarget(found) {
		if (!found) return { id: state.active };
		var exact = state.terms.filter(function (t) { return sameName(t.name, found.full); })[0];
		if (exact) return { id: exact.id };
		// "1st Semester" without a year: the same semester, unless it already has subjects of its own.
		var base = state.terms.filter(function (t) { return sameName(t.name, found.base) && t.rows.length === 0; })[0];
		if (base) return { id: base.id };
		var active = cur();
		if (active.rows.length === 0 && /^Semester \d+$|^1st Semester$|^2nd Semester$|^Midyear$/.test(active.name) && sameName(active.name, found.base)) return { id: active.id };
		return { name: found.full };
	}

	function renderImportTarget() {
		var chips = els.importTargetChips;
		chips.textContent = "";
		var options = state.terms.map(function (t) { return { id: t.id, label: t.name }; });
		if (importDetected && !state.terms.some(function (t) { return sameName(t.name, importDetected.full); })) {
			options.push({ name: importDetected.full, label: importDetected.full, isNew: true });
		}
		els.importTarget.classList.toggle("is-only", options.length < 2);
		options.forEach(function (o) {
			var on = importTarget && (o.isNew ? !!importTarget.name : importTarget.id === o.id);
			var b = el("button", "term-chip" + (on ? " is-active" : "") + (o.isNew ? " is-new" : ""));
			b.type = "button";
			b.setAttribute("aria-pressed", String(!!on));
			if (o.isNew) b.appendChild(icon("plus"));
			b.appendChild(el("span", "", o.label));
			b.addEventListener("click", function () {
				importTarget = o.isNew ? { name: o.name } : { id: o.id };
				haptic();
				renderImportTarget();
			});
			chips.appendChild(b);
		});
	}
	var previewUrl = null;

	function normName(name) {
		return name.toUpperCase().replace(/[^A-Z0-9]/g, "");
	}

	function setImportView(view) {
		els.importProgress.hidden = view !== "working";
		els.importList.hidden = view !== "review";
		els.importTarget.hidden = view !== "review";
		els.importMessage.hidden = view !== "message";
		els.importProgress.classList.toggle("is-working", view === "working");
		els.importer.classList.toggle("is-busy", view === "working");
	}

	function setProgress(fraction, label) {
		var pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
		els.importFill.style.transform = "scaleX(" + pct / 100 + ")";
		els.importBar.setAttribute("aria-valuenow", String(pct));
		if (label) els.importStep.textContent = label;
		els.importPct.textContent = pct + "%";
	}

	function pickedCount() {
		return importPicked.filter(Boolean).length;
	}

	function updateImportButton() {
		var n = pickedCount();
		els.importPrimary.disabled = n === 0;
		els.importPrimary.textContent = n === 0 ? "Add subjects" : "Add " + plural(n, "subject");
	}

	function miniChoices(values, current, format, onPick) {
		var grid = el("div", "mini-grid");
		grid.setAttribute("role", "radiogroup");
		values.forEach(function (v) {
			var b = el("button", "mini-choice", format(v));
			b.type = "button";
			b.setAttribute("role", "radio");
			b.setAttribute("aria-checked", String(v === current));
			b.addEventListener("click", function () {
				Array.prototype.forEach.call(grid.children, function (c) {
					c.setAttribute("aria-checked", String(c === b));
				});
				haptic();
				onPick(v);
			});
			grid.appendChild(b);
		});
		return grid;
	}

	function buildImportRow(row, i) {
		var li = el("li", "import-row" + (importOpen === i ? " is-open" : ""));
		li.style.setProperty("--i", String(i));

		var item = el("div", "import-item");
		var check = el("button", "check-btn");
		check.type = "button";
		check.setAttribute("role", "checkbox");
		check.setAttribute("aria-checked", String(importPicked[i]));
		check.setAttribute("aria-label", "Add " + row.name);
		var box = el("span", "check");
		box.appendChild(icon("check"));
		check.appendChild(box);
		check.addEventListener("click", function () {
			importPicked[i] = !importPicked[i];
			check.setAttribute("aria-checked", String(importPicked[i]));
			li.classList.toggle("is-off", !importPicked[i]);
			haptic();
			updateImportButton();
		});
		item.appendChild(check);

		var main = el("button", "import-main");
		main.type = "button";
		main.setAttribute("aria-expanded", String(importOpen === i));
		main.setAttribute("aria-label", row.name + ", " + unitsText(row) + ", " +
			(row.grades ? "grade " + row.grades.toFixed(2) : "no grade yet") + ". Fix");
		var text = el("span", "subject-text");
		text.appendChild(el("span", "subject-name", row.name));
		text.appendChild(el("span", "subject-units", unitsText(row)));
		main.appendChild(text);
		main.appendChild(el("span", "grade-pill" + (row.grades ? gradeTier(row.grades) : " is-empty"),
			row.grades ? row.grades.toFixed(2) : "No grade yet"));
		main.appendChild(icon("caret-down", "import-caret"));
		main.addEventListener("click", function () {
			importOpen = importOpen === i ? -1 : i;
			haptic();
			renderImportList();
		});
		item.appendChild(main);
		li.appendChild(item);
		li.classList.toggle("is-off", !importPicked[i]);

		if (importOpen === i) {
			var edit = el("div", "import-edit");

			var nameLabel = el("label", "field-label", "Subject name");
			var nameInput = el("input", "text-input is-small");
			nameInput.type = "text";
			nameInput.maxLength = 40;
			nameInput.value = row.name;
			nameInput.autocomplete = "off";
			nameInput.setAttribute("autocapitalize", "characters");
			nameInput.id = "import-name-" + i;
			nameLabel.htmlFor = nameInput.id;
			nameInput.addEventListener("input", function () {
				row.name = nameInput.value.trim() ? nameInput.value.slice(0, 40) : row.name;
				main.querySelector(".subject-name").textContent = nameInput.value || row.name;
			});
			edit.appendChild(nameLabel);
			edit.appendChild(nameInput);

			edit.appendChild(el("p", "field-label", "Units"));
			edit.appendChild(miniChoices(unitValues(), row.units, String, function (u) {
				row.units = u;
				row.unitsFound = true;
				pickRow(i);
				main.querySelector(".subject-units").textContent = unitsText(row);
			}));

			edit.appendChild(el("p", "field-label", "Grade"));
			edit.appendChild(miniChoices([0].concat(GRADE_VALUES), row.grades || 0,
				function (g) { return g ? g.toFixed(2) : "None"; },
				function (g) {
					row.grades = g;
					pickRow(i);
					var pill = main.querySelector(".grade-pill");
					pill.className = "grade-pill" + (g ? gradeTier(g) : " is-empty");
					pill.textContent = g ? g.toFixed(2) : "No grade yet";
				}));
			li.appendChild(edit);
		}

		function pickRow(n) {
			if (!importPicked[n]) {
				importPicked[n] = true;
				check.setAttribute("aria-checked", "true");
				li.classList.remove("is-off");
				updateImportButton();
			}
		}
		return li;
	}

	function renderImportList() {
		els.importList.textContent = "";
		importFound.forEach(function (row, i) {
			els.importList.appendChild(buildImportRow(row, i));
		});
		updateImportButton();
		if (importOpen >= 0) {
			var open = els.importList.children[importOpen];
			if (open) open.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
		}
	}

	function showImportMessage(title, message) {
		els.importTitle.textContent = title;
		els.importMessageText.textContent = message;
		setImportView("message");
		els.importSecondary.textContent = "Close";
		els.importPrimary.disabled = false;
		els.importPrimary.textContent = "Try another image";
		els.importPrimary.dataset.action = "retry";
	}

	function startImport(file) {
		var run = ++importRun;
		importFound = [];
		importPicked = [];
		importOpen = -1;
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = URL.createObjectURL(file);
		els.importPreview.src = previewUrl;
		els.importPreview.alt = "Your screenshot";
		els.importTitle.textContent = "Reading screenshot";
		els.importSecondary.textContent = "Cancel";
		els.importPrimary.textContent = "Add subjects";
		els.importPrimary.disabled = true;
		els.importPrimary.dataset.action = "add";
		setProgress(0, "Opening image");
		setImportView("working");
		openSheet(els.importer);

		if (!window.GCalcOCR) {
			showImportMessage("Import unavailable", "The text reader did not load. Close the app and open it again.");
			return;
		}

		window.GCalcOCR.read(file, function (f, label) {
			if (run === importRun) setProgress(f, label);
		}).then(function (result) {
			if (run !== importRun) return;
			if (!result.rows.length) {
				showImportMessage("No subjects found", "Use a clear screenshot of your grades table, with the subject codes, units and grades visible.");
				return;
			}
			importFound = result.rows;
			importPicked = result.rows.map(function () { return true; });
			importDetected = detectSemester(result.headerText);
			importTarget = pickImportTarget(importDetected);
			renderImportTarget();
			els.importTitle.textContent = "Found " + plural(result.rows.length, "subject");
			setImportView("review");
			renderImportList();
			haptic(14);
		}).catch(function (err) {
			if (run !== importRun) return;
			showImportMessage("Could not read image", (err && err.message) || "Something went wrong while reading the image.");
		});
	}

	function applyImport() {
		var chosen = importFound.filter(function (r, i) { return importPicked[i]; });
		if (!chosen.length) return;
		var term = importTarget && importTarget.id !== undefined ? findTerm(importTarget.id) : null;
		var created = null;
		if (!term) {
			var tid = state.terms.reduce(function (max, t) { return Math.max(max, t.id); }, -1) + 1;
			created = term = { id: tid, name: (importTarget && importTarget.name) || suggestTermName(), rows: [] };
			state.terms.push(term);
		}
		var wasActive = state.active;
		state.active = term.id;
		var previous = term.rows.map(function (r) {
			return { id: r.id, name: r.name, grades: r.grades, units: r.units };
		});
		var added = 0, updated = 0;
		chosen.forEach(function (r) {
			var match = null;
			for (var i = 0; i < term.rows.length; i++) {
				if (normName(term.rows[i].name) === normName(r.name)) match = term.rows[i];
			}
			if (match) {
				// Same subject already in the list: refresh it (keep a grade you typed if the image has none).
				if (r.unitsFound) match.units = r.units;
				if (r.grades) match.grades = r.grades;
				updated++;
			} else {
				var row = newRow();
				row.name = r.name;
				row.units = r.units;
				row.grades = r.grades;
				term.rows.push(row);
				added++;
			}
		});
		saveState();
		closeSheet(els.importer);
		render({ entering: true });
		haptic();
		var parts = [];
		if (added) parts.push("Added " + plural(added, "subject"));
		if (updated) parts.push((added ? "updated " : "Updated ") + updated);
		if (created) parts[parts.length - 1] += " to " + created.name;
		showToast(parts.join(", "), function () {
			term.rows = previous;
			if (created) state.terms = state.terms.filter(function (t) { return t !== created; });
			state.active = wasActive;
			if (!findTerm(state.active)) state.active = state.terms[0].id;
			saveState();
			render({ quiet: true, entering: true });
		});
	}

	// Start the text reader while the person picks a screenshot.
	function warmUpReader() {
		try {
			if (window.GCalcOCR && window.GCalcOCR.warmUp) window.GCalcOCR.warmUp();
		} catch (e) {
			/* the scan starts its own reader */
		}
	}

	els.importBtn.addEventListener("click", function () {
		warmUpReader();
		els.importInput.value = "";
		els.importInput.click();
	});

	els.importInput.addEventListener("change", function () {
		var file = els.importInput.files && els.importInput.files[0];
		if (file) startImport(file);
	});

	els.importPrimary.addEventListener("click", function () {
		if (els.importPrimary.dataset.action === "retry") {
			warmUpReader();
			els.importInput.value = "";
			els.importInput.click();
		} else {
			applyImport();
		}
	});

	els.importSecondary.addEventListener("click", function () { closeSheet(els.importer); });
	els.importClose.addEventListener("click", function () { closeSheet(els.importer); });
	closeOnBackdrop(els.importer);
	els.importer.addEventListener("close", function () {
		importRun++; // drop any read still in progress
		setImportView("none");
	});

	/* ---------- Actions ---------- */

	function removeRow(id) {
		var term = cur();
		var index = -1;
		for (var i = 0; i < term.rows.length; i++) {
			if (term.rows[i].id === id) index = i;
		}
		if (index < 0) return;
		var removed = term.rows[index];
		var label = rowLabel(removed);
		term.rows = term.rows.filter(function (r) { return r.id !== id; });
		saveState();
		render({ quiet: true });
		haptic();
		showToast("Removed " + label, function () {
			term.rows.splice(Math.min(index, term.rows.length), 0, removed);
			saveState();
			render({ quiet: true });
		});
	}

	function clearAll() {
		var term = cur();
		if (term.rows.length === 0) return;
		var previous = term.rows;
		term.rows = [];
		saveState();
		render({ quiet: true });
		haptic();
		showToast("Cleared " + term.name, function () {
			term.rows = previous;
			saveState();
			render({ quiet: true, entering: true });
		});
	}

	els.add.addEventListener("click", startNewSubject);
	els.clear.addEventListener("click", clearAll);
	/* ---------- Settings: theme and backup ---------- */

	els.settingsBtn.addEventListener("click", function () { openSheet(els.settings); });
	els.settingsClose.addEventListener("click", function () { closeSheet(els.settings); });
	closeOnBackdrop(els.settings);

	Array.prototype.forEach.call(els.themeChoice.children, function (b) {
		b.addEventListener("click", function () {
			state.theme = b.dataset.theme;
			applyTheme();
			saveState();
			haptic();
		});
	});
	try {
		window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", function () {
			if (state.theme === "system") {
				applyTheme();
				saveState();
			}
		});
	} catch (e) {
		/* older browsers: picked up on next launch */
	}

	function today() {
		var d = new Date();
		return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
	}

	function touchDevice() {
		try {
			return window.matchMedia("(pointer: coarse)").matches;
		} catch (e) {
			return false;
		}
	}

	/* Saves a file: the Android app's save dialog, the share sheet on phones, a download elsewhere. */
	function saveFile(name, type, blob, base64, done) {
		if (window.GCalcAndroid && typeof window.GCalcAndroid.saveFile === "function") {
			window.GCalcSaved = function (ok) { done(ok); };
			window.GCalcAndroid.saveFile(name, type, base64);
			return;
		}
		var file = null;
		try {
			file = new File([blob], name, { type: type });
		} catch (e) { /* old browser */ }
		if (file && touchDevice() && navigator.canShare && navigator.canShare({ files: [file] })) {
			navigator.share({ files: [file] }).then(function () { done(true); }, function (err) {
				done(err && err.name === "AbortError" ? null : false);
			});
			return;
		}
		var url = URL.createObjectURL(blob);
		var a = el("a");
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
		done(true);
	}

	function toBase64(text) {
		return window.btoa(unescape(encodeURIComponent(text)));
	}

	els.backupSave.addEventListener("click", function () {
		var data = JSON.stringify({ app: "gcalc", version: 2, saved: new Date().toISOString(), terms: state.terms, active: state.active }, null, 1);
		saveFile("gcalc-backup-" + today() + ".json", "application/json", new Blob([data], { type: "application/json" }), toBase64(data), function (ok) {
			if (ok) showToast("Backup saved");
			else if (ok === false) showToast("Could not save the backup");
		});
	});

	els.backupRestore.addEventListener("click", function () {
		els.backupInput.value = "";
		els.backupInput.click();
	});

	els.backupInput.addEventListener("change", function () {
		var file = els.backupInput.files && els.backupInput.files[0];
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function () {
			var data = null;
			try {
				data = JSON.parse(String(reader.result));
			} catch (e) { /* not JSON */ }
			if (!data || data.app !== "gcalc" || !Array.isArray(data.terms) || !data.terms.length) {
				showToast("That file is not a GCalc backup");
				return;
			}
			var previous = JSON.stringify({ terms: state.terms, active: state.active });
			var restored = loadFrom(data);
			state.terms = restored.terms;
			state.active = restored.active;
			saveState();
			closeSheet(els.settings);
			render({ quiet: true, entering: true });
			haptic(14);
			showToast("Restored " + plural(state.terms.length, "semester"), function () {
				var back = JSON.parse(previous);
				state.terms = back.terms;
				state.active = back.active;
				saveState();
				render({ quiet: true, entering: true });
			});
		};
		reader.onerror = function () { showToast("Could not open that file"); };
		reader.readAsText(file);
	});

	/* ---------- Share your GWA as a picture ---------- */

	function loadIcon() {
		return new Promise(function (resolve) {
			var img = new Image();
			img.onload = function () { resolve(img); };
			img.onerror = function () { resolve(null); };
			img.src = "icons/icon-192.png";
		});
	}

	function shareCard(logo) {
		var out = compute(cur().rows);
		var W = 1080, H = 1350, X = 96;
		var c = el("canvas");
		c.width = W;
		c.height = H;
		var ctx = c.getContext("2d");
		var styles = window.getComputedStyle(els.root);
		function v(name) { return styles.getPropertyValue(name).trim(); }
		var dark = state.isDark;
		var g = ctx.createLinearGradient(0, 0, W, H);
		g.addColorStop(0, dark ? "#22305A" : "#FFFFFF");
		g.addColorStop(1, dark ? "#131B31" : "#E3E9F8");
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, W, H);
		if (out.academic) {
			var glow = ctx.createRadialGradient(W * 0.85, H * 0.2, 0, W * 0.85, H * 0.2, W * 0.75);
			glow.addColorStop(0, dark ? "rgba(210,167,63,0.26)" : "rgba(2,52,202,0.12)");
			glow.addColorStop(1, "rgba(0,0,0,0)");
			ctx.fillStyle = glow;
			ctx.fillRect(0, 0, W, H);
		}
		var text = v("--text"), muted = v("--muted"), accent = v("--accent"), accentText = v("--accent-text");
		var field = v("--field"), zone = v("--scale-zone");
		var font = "Outfit, system-ui, sans-serif";

		// Brand
		if (logo) {
			ctx.save();
			roundRect(ctx, X, 96, 88, 88, 22);
			ctx.clip();
			ctx.drawImage(logo, X, 96, 88, 88);
			ctx.restore();
		}
		ctx.fillStyle = text;
		ctx.font = "600 46px " + font;
		ctx.fillText("GCalc", X + (logo ? 116 : 0), 152);

		// Name (shrunk to fit), then which GWA this is
		var name = (state.name || "").trim();
		var label = state.terms.length > 1 ? cur().name + " GWA" : name ? "GWA" : "My GWA";
		if (name) {
			var size = 68;
			ctx.font = "700 " + size + "px " + font;
			while (size > 36 && ctx.measureText(name).width > W - 2 * X) {
				size -= 2;
				ctx.font = "700 " + size + "px " + font;
			}
			ctx.fillStyle = text;
			ctx.fillText(name, X, 320);
		}
		ctx.fillStyle = muted;
		ctx.font = "500 46px " + font;
		ctx.fillText(label, X, name ? 400 : 380);
		ctx.fillStyle = text;
		ctx.font = "700 290px " + font;
		ctx.fillText(out.counted ? formatGwa(out.result) : "0.00", X - 12, 660);

		if (out.academic) {
			ctx.font = "600 50px " + font;
			var tw = ctx.measureText(out.academic).width;
			ctx.fillStyle = dark ? "rgba(210,167,63,0.18)" : "rgba(2,52,202,0.10)";
			roundRect(ctx, X, 712, tw + 84, 92, 46);
			ctx.fill();
			ctx.fillStyle = accentText;
			ctx.fillText(out.academic, X + 42, 774);
		}

		// The 1.00 to 3.00 scale
		var top = 900, left = X, width = W - 2 * X;
		ctx.fillStyle = field;
		roundRect(ctx, left, top, width, 18, 9);
		ctx.fill();
		ctx.fillStyle = zone;
		roundRect(ctx, left, top, width / 2, 18, 9);
		ctx.fill();
		ctx.font = "500 32px " + font;
		[[0, "1.00"], [0.25, "1.50"], [0.375, "1.75"], [0.5, "2.00"], [1, "3.00"]].forEach(function (t, i, all) {
			var x = left + width * t[0];
			ctx.fillStyle = muted;
			var w = ctx.measureText(t[1]).width;
			ctx.fillText(t[1], i === 0 ? x : i === all.length - 1 ? x - w : x - w / 2, top + 80);
		});
		if (out.counted) {
			var pos = Math.max(0, Math.min(1, (out.result - 1) / 2));
			ctx.fillStyle = dark ? "#1B2541" : "#FFFFFF";
			ctx.beginPath();
			ctx.arc(left + width * pos, top + 9, 30, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = accent;
			ctx.beginPath();
			ctx.arc(left + width * pos, top + 9, 22, 0, Math.PI * 2);
			ctx.fill();
		}

		// Units and subjects
		[["Units", String(out.totalUnits)], ["Subjects", String(out.counted)]].forEach(function (s, i) {
			var x = X + i * 300;
			ctx.fillStyle = muted;
			ctx.font = "500 36px " + font;
			ctx.fillText(s[0], x, 1080);
			ctx.fillStyle = text;
			ctx.font = "600 72px " + font;
			ctx.fillText(s[1], x, 1160);
		});
		ctx.fillStyle = muted;
		ctx.font = "400 32px " + font;
		ctx.fillText("GWA Calculator for CLSU", X, H - 84);
		return c;
	}

	function roundRect(ctx, x, y, w, h, r) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	var shareLogo = null;
	var previewTimer = 0;

	function drawPreview() {
		var canvas = shareCard(shareLogo);
		els.sharePreview.src = canvas.toDataURL("image/png");
		return canvas;
	}

	els.shareBtn.addEventListener("click", function () {
		haptic();
		els.shareName.value = state.name || "";
		var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
		Promise.all([ready, loadIcon()]).then(function (got) {
			shareLogo = got[1];
			drawPreview();
			openSheet(els.shareSheet);
		});
	});

	els.shareName.addEventListener("input", function () {
		state.name = els.shareName.value.slice(0, 40);
		saveState();
		window.clearTimeout(previewTimer);
		previewTimer = window.setTimeout(drawPreview, 120);
	});
	els.shareName.addEventListener("keydown", function (e) {
		if (e.key === "Enter") {
			e.preventDefault();
			els.shareName.blur();
		}
	});

	els.shareGo.addEventListener("click", function () {
		var canvas = drawPreview();
		var dataUrl = canvas.toDataURL("image/png");
		closeSheet(els.shareSheet);
		if (window.GCalcAndroid && typeof window.GCalcAndroid.shareImage === "function") {
			window.GCalcAndroid.shareImage(dataUrl.split(",")[1]);
			return;
		}
		canvas.toBlob(function (blob) {
			saveFile("my-gwa.png", "image/png", blob, null, function (ok) {
				if (ok === false) showToast("Could not share the picture");
			});
		}, "image/png");
	});
	els.shareCancel.addEventListener("click", function () { closeSheet(els.shareSheet); });
	els.shareClose.addEventListener("click", function () { closeSheet(els.shareSheet); });
	closeOnBackdrop(els.shareSheet);

	/* ---------- Sort subjects ---------- */

	function openMenu(title, options) {
		els.menuTitle.textContent = title;
		els.menuList.textContent = "";
		options.forEach(function (o) {
			var li = el("li");
			var b = el("button", "menu-item", o.label);
			b.type = "button";
			b.addEventListener("click", function () {
				closeSheet(els.menu);
				o.run();
			});
			li.appendChild(b);
			els.menuList.appendChild(li);
		});
		openSheet(els.menu);
	}

	els.menuClose.addEventListener("click", function () { closeSheet(els.menu); });
	closeOnBackdrop(els.menu);

	function sortRows(label, compare) {
		var term = cur();
		var previous = term.rows.slice();
		term.rows = term.rows.slice().sort(compare);
		saveState();
		render({ quiet: true, entering: true });
		haptic();
		showToast("Sorted by " + label, function () {
			term.rows = previous;
			saveState();
			render({ quiet: true, entering: true });
		});
	}

	function byName(a, b) {
		return rowLabel(a).localeCompare(rowLabel(b), undefined, { numeric: true });
	}

	els.sortBtn.addEventListener("click", function () {
		openMenu("Sort subjects", [
			{ label: "Subject name", run: function () { sortRows("name", byName); } },
			{ label: "Best grade first", run: function () {
				sortRows("grade", function (a, b) { return (a.grades || 9) - (b.grades || 9) || byName(a, b); });
			} },
			{ label: "Most units first", run: function () {
				sortRows("units", function (a, b) { return b.units - a.units || byName(a, b); });
			} }
		]);
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
	if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol) &&
		window.location.hostname !== "appassets.androidplatform.net") {
		window.addEventListener("load", function () {
			navigator.serviceWorker.register("sw.js").catch(function () {});
		});
	}

	// Exposed for automated tests only.
	window.__gcalc = { compute: compute, academicStanding: academicStanding, formatGwa: formatGwa };
})();
