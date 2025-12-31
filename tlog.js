(() => {
  // ---------- IndexedDB ----------
  const DB_NAME = "keep_lite_db";
  const DB_VERSION = 2; // bump because we add 'logs' to note records
  const STORE = "notes";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        } else {
          // existing store; keep as-is
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode="readonly") {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  function id() {
    return "n_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function nowISO() { return new Date().toISOString(); }
  function nowMS() { return Date.now(); }

  function formatTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch { return ""; }
  }

  // ---------- UI refs ----------
  const notesListEl = document.getElementById("notesList");
  const searchEl = document.getElementById("search");
  const newBtn = document.getElementById("newBtn");
  const exportBtn = document.getElementById("exportBtn");
  const exportLogsBtn = document.getElementById("exportLogsBtn");
  const clearLogsBtn = document.getElementById("clearLogsBtn");

  const mainTitleEl = document.getElementById("mainTitle");
  const statusEl = document.getElementById("status");
  const emptyStateEl = document.getElementById("emptyState");
  const editorEl = document.getElementById("editor");

  const titleInput = document.getElementById("titleInput");
  const bodyInput = document.getElementById("bodyInput");

  const saveBtn = document.getElementById("saveBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const fullscreenBtn = document.getElementById("fullscreenBtn");

  const modeRecordBtn = document.getElementById("modeRecord");
  const modeAnalysisBtn = document.getElementById("modeAnalysis");
  const recordPanel = document.getElementById("recordPanel");
  const analysisPanel = document.getElementById("analysisPanel");

  const fontSelect = document.getElementById("fontSelect");
  const root = document.documentElement;

  const logStatsEl = document.getElementById("logStats");

  // Overlay
  const overlay = document.getElementById("overlay");
  const overlayClose = document.getElementById("overlayClose");
  const overlaySave = document.getElementById("overlaySave");
  const overlayTitle = document.getElementById("overlayTitle");
  const overlayBody = document.getElementById("overlayBody");

  // ---------- App state ----------
  let db;
  let notes = [];
  let activeId = null;
  let dirty = false;
  let isReplaying = false;

  // ---------- Logging ----------
  function emptyLogs() {
    return {
      header_records: { starttime: null, endtime: null },
      text_records: {},      // ts -> full text
      cursor_records: {},    // ts -> "a:b"
      key_records: {},       // ts -> "keydown: X"
      scroll_records: {},    // ts -> "top:left" or number
      mouse_records: {}      // ts -> cursor position (number)
    };
  }

  function ensureLogs(note) {
    if (!note.logs || typeof note.logs !== "object") note.logs = emptyLogs();
    if (!note.logs.header_records) note.logs.header_records = { starttime: null, endtime: null };
    if (!note.logs.text_records) note.logs.text_records = {};
    if (!note.logs.cursor_records) note.logs.cursor_records = {};
    if (!note.logs.key_records) note.logs.key_records = {};
    if (!note.logs.scroll_records) note.logs.scroll_records = {};
    if (!note.logs.mouse_records) note.logs.mouse_records = {};
    return note.logs;
  }

  // Adds a record; if same millisecond already exists, bump timestamp until free
  function putRecord(map, ts, value) {
    let t = ts;
    // avoid overwriting if two events land in same ms
    while (Object.prototype.hasOwnProperty.call(map, String(t))) t += 1;
    map[String(t)] = value;
    return t;
  }

  function cursorStringFor(el) {
    // selectionStart/End can be null on some weird edge-cases; coerce safely
    const a = typeof el.selectionStart === "number" ? el.selectionStart : 0;
    const b = typeof el.selectionEnd === "number" ? el.selectionEnd : a;
    return `${a}:${b}`;
  }

  function noteSessionStart(note) {
    const logs = ensureLogs(note);
    if (logs.header_records.starttime == null) logs.header_records.starttime = nowMS();
    // also: refresh "endtime" to indicate activity
    logs.header_records.endtime = nowMS();
  }

  function noteSessionTouch(note) {
    const logs = ensureLogs(note);
    if (logs.header_records.starttime == null) logs.header_records.starttime = nowMS();
    logs.header_records.endtime = nowMS();
  }

  function updateLogStatsUI() {
    const n = getActive();
    if (!n) { logStatsEl.textContent = "logs: —"; return; }
    const logs = ensureLogs(n);
    const c1 = Object.keys(logs.text_records).length;
    const c2 = Object.keys(logs.cursor_records).length;
    const c3 = Object.keys(logs.key_records).length;
    const c4 = Object.keys(logs.scroll_records).length;
    logStatsEl.textContent = `logs: text ${c1} · cursor ${c2} · keys ${c3} · scroll ${c4}`;
  }

  // ---------- Logging core ----------
  // We log into the ACTIVE note only.
  // We *do not* write to IndexedDB on every event (too heavy); we debounce-persist via autosave.
  function logTextSnapshot(text, ts) {
    if (isReplaying) return;
    const n = getActive(); if (!n) return;
    const logs = ensureLogs(n);
    noteSessionTouch(n);
    putRecord(logs.text_records, typeof ts === "number" ? ts : nowMS(), text);
    updateLogStatsUI();
  }

  function logCursor(el, ts) {
    if (isReplaying) return;
    const n = getActive(); if (!n) return;
    const logs = ensureLogs(n);
    noteSessionTouch(n);
    putRecord(logs.cursor_records, typeof ts === "number" ? ts : nowMS(), cursorStringFor(el));
    updateLogStatsUI();
  }

  function logKey(kind, e) {
    if (isReplaying) return;
    const n = getActive(); if (!n) return;
    const logs = ensureLogs(n);
    noteSessionTouch(n);

    // On mobile, e.key can be "Unidentified". Still useful with timing.
    const key = e && typeof e.key === "string" ? e.key : "Unknown";
    const rep = e && e.repeat ? "repeat" : kind;
    putRecord(logs.key_records, nowMS(), `${rep}: ${key}`);
    updateLogStatsUI();
  }

  function logScroll(el) {
    if (isReplaying) return;
    const n = getActive(); if (!n) return;
    const logs = ensureLogs(n);
    noteSessionTouch(n);
    // record scrollTop (and optionally scrollLeft)
    putRecord(logs.scroll_records, nowMS(), `${Math.round(el.scrollTop)}:${Math.round(el.scrollLeft || 0)}`);
    updateLogStatsUI();
  }



  // Attach logging listeners to a textarea-like element
  function attachEditorLogging(el, { isOverlay=false } = {}) {
    // Text changes
    el.addEventListener("input", () => {
      // snapshot text *after* input
      const ts = nowMS();
      logTextSnapshot(el.value, ts);
      logCursor(el, ts); // keep cursor aligned to the text snapshot
      markDirtyAndAutosaveFrom(el);
    }, { passive: true });

    // Key events
    el.addEventListener("keydown", (e) => {
      logKey("keydown", e);
    });

    el.addEventListener("keyup", (e) => {
      logKey("keyup", e);
    });

    // Selection changes can also happen without mouseup (e.g. iOS selection handles)
    // selectionchange fires on document; we'll filter by focused element.
    // (registered below globally)

    // Scroll changes
    el.addEventListener("scroll", () => logScroll(el), { passive: true });

    // Cursor changes are logged via input + selectionchange.


    // Focus/blur update session endtime
    el.addEventListener("focus", () => {
      const n = getActive(); if (!n) return;
      noteSessionTouch(n);
    });

    el.addEventListener("blur", () => {
      const n = getActive(); if (!n) return;
      noteSessionTouch(n);
    });
  }

  // ---------- Other app logic ----------
  function setViewportHeightVar() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    root.style.setProperty("--vvh", h + "px");
  }

  function applyFont(fontValue) {
    root.style.setProperty("--editor-font", fontValue);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[ch]));
  }

  function snippet(text) {
    const t = (text || "").trim().replace(/\s+/g, " ");
    return t.length > 140 ? t.slice(0, 140) + "…" : t;
  }

  function getActive() {
    return notes.find(n => n.id === activeId) || null;
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function setDirty(isDirty) {
    dirty = isDirty;
    if (!activeId) return;
    setStatus(isDirty ? "Unsaved changes…" : "Saved");
  }

  function notifyActiveNote() {
    document.dispatchEvent(new CustomEvent("tlog:notechange", { detail: { id: activeId } }));
    if (window.tlogReplay && typeof window.tlogReplay.refreshReplayNote === "function") {
      window.tlogReplay.refreshReplayNote();
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function setMode(mode) {
    const isRecord = mode !== "analysis";
    recordPanel.classList.toggle("is-active", isRecord);
    analysisPanel.classList.toggle("is-active", !isRecord);
    modeRecordBtn.classList.toggle("is-active", isRecord);
    modeAnalysisBtn.classList.toggle("is-active", !isRecord);
    modeRecordBtn.setAttribute("aria-selected", String(isRecord));
    modeAnalysisBtn.setAttribute("aria-selected", String(!isRecord));
    if (!isRecord && overlay.classList.contains("is-open")) {
      closeOverlay({save:true});
    }
    if (isRecord && window.tlogReplay && typeof window.tlogReplay.stopReplay === "function") {
      window.tlogReplay.stopReplay();
    }
  }

  // ---------- DB ops ----------
  async function loadNotes() {
    return new Promise((resolve, reject) => {
      const store = tx(db, "readonly");
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        // Sort newest first
        rows.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        // Ensure logs exist for backward compatibility
        rows.forEach(ensureLogs);
        notes = rows;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function putNote(note) {
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.put(note);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteNote(noteId) {
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.delete(noteId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- Rendering ----------
  function renderList() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const filtered = q
      ? notes.filter(n =>
          (n.title || "").toLowerCase().includes(q) ||
          (n.body || "").toLowerCase().includes(q)
        )
      : notes;

    notesListEl.innerHTML = filtered.map(n => {
      const isActive = n.id === activeId;
      const title = (n.title || "").trim() || "Untitled";
      const logs = ensureLogs(n);
      const tc = Object.keys(logs.text_records).length;
      const kc = Object.keys(logs.key_records).length;
      return `
        <div class="note-card ${isActive ? "active" : ""}" data-id="${escapeHtml(n.id)}" tabindex="0">
          <div class="note-title">${escapeHtml(title)}</div>
          <p class="note-snippet">${escapeHtml(snippet(n.body))}</p>
          <div class="note-meta">
            <span>${escapeHtml(formatTime(n.updatedAt))}</span>
            <span>${tc}T ${kc}K</span>
          </div>
        </div>
      `;
    }).join("");

    [...notesListEl.querySelectorAll(".note-card")].forEach(card => {
      card.addEventListener("click", () => selectNote(card.dataset.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectNote(card.dataset.id);
        }
      });
    });

    updateNoteFocusEffects();
  }

  function renderEditor() {
    const n = getActive();
    if (!n) {
      mainTitleEl.textContent = "No note selected";
      emptyStateEl.style.display = "block";
      editorEl.style.display = "none";
      fullscreenBtn.disabled = true;
      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      setStatus("Create a note or pick one from the list.");
      logStatsEl.textContent = "logs: —";
      return;
    }

    ensureLogs(n);

    emptyStateEl.style.display = "none";
    editorEl.style.display = "grid";
    fullscreenBtn.disabled = false;
    saveBtn.disabled = false;
    deleteBtn.disabled = false;

    const title = (n.title || "").trim() || "Untitled";
    mainTitleEl.textContent = title;
    titleInput.value = n.title || "";
    bodyInput.value = n.body || "";

    setStatus(dirty ? "Unsaved changes…" : "Saved");
    updateLogStatsUI();
  }

  function resortNotes() {
    notes.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  // ---------- Actions ----------
  async function createNewNote() {
    const note = {
      id: id(),
      title: "",
      body: "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      logs: emptyLogs()
    };
    noteSessionStart(note);
    await putNote(note);
    notes.unshift(note);
    activeId = note.id;
    setDirty(false);
    renderList();
    renderEditor();
    notifyActiveNote();

    titleInput.focus();
  }

  async function selectNote(noteId) {
    if (!noteId || noteId === activeId) return;
    activeId = noteId;
    setDirty(false);
    renderList();
    renderEditor();
    notifyActiveNote();
  }

  async function saveActiveFromInputs() {
    const n = getActive();
    if (!n) return;

    n.title = titleInput.value;
    n.body = bodyInput.value;
    n.updatedAt = nowISO();
    ensureLogs(n);
    noteSessionTouch(n);

    await putNote(n);
    resortNotes();
    setDirty(false);
    renderList();
    renderEditor();
  }

  async function deleteActive() {
    const n = getActive();
    if (!n) return;

    const ok = confirm("Delete this note?");
    if (!ok) return;

    await deleteNote(n.id);
    notes = notes.filter(x => x.id !== n.id);
    activeId = notes.length ? notes[0].id : null;
    setDirty(false);
    renderList();
    renderEditor();
  }

  // ---------- Autosave (debounced) ----------
  const autosave = debounce(async () => {
    if (!activeId) return;
    await saveActiveFromInputs();
  }, 450);

  function markDirtyAndAutosaveFrom(sourceEl) {
    if (!activeId) return;

    // Sync between main and overlay bodies:
    // If typing in overlay, keep main in sync immediately (so save works consistently).
    if (sourceEl === overlayBody) {
      bodyInput.value = overlayBody.value;
    } else if (sourceEl === bodyInput && overlay.classList.contains("is-open")) {
      overlayBody.value = bodyInput.value;
    }

    setDirty(true);
    autosave();
  }

  // Title changes (we still log keys/cursor only for body textarea, as requested).
  titleInput.addEventListener("input", () => {
    const t = (titleInput.value || "").trim() || "Untitled";
    mainTitleEl.textContent = t;
    overlayTitle.textContent = t;
    setDirty(true);
    autosave();
  });

  // ---------- Fullscreen overlay ----------
  function openOverlay() {
    const n = getActive();
    if (!n) return;

    overlayTitle.textContent = (titleInput.value || "").trim() || "Untitled";
    overlayBody.value = bodyInput.value;

    setViewportHeightVar();
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";

    requestAnimationFrame(() => {
      overlayBody.focus();
      overlayBody.setSelectionRange(overlayBody.value.length, overlayBody.value.length);
      // log cursor/focus moment
      logCursor(overlayBody);
    });
  }

  function closeOverlay({save=false} = {}) {
    if (!overlay.classList.contains("is-open")) return;

    if (save) {
      bodyInput.value = overlayBody.value;
      setDirty(true);
      autosave();
    }

    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  // ---------- Export ----------
  function exportAll() {
    const payload = {
      exportedAt: nowISO(),
      notes: notes.slice().sort((a,b)=> (a.createdAt||"").localeCompare(b.createdAt||"")),
    };
    downloadJSON(payload, "keep-lite-export.json");
  }

  function exportActiveLogs() {
    const n = getActive();
    if (!n) { alert("No active note."); return; }
    ensureLogs(n);
    const payload = {
      noteId: n.id,
      title: n.title || "",
      exportedAt: nowISO(),
      logs: n.logs
    };
    downloadJSON(payload, `keep-lite-${n.id}-logs.json`);
  }

  function clearActiveLogs() {
    const n = getActive();
    if (!n) return;
    const ok = confirm("Clear logs for this note? (Text remains.)");
    if (!ok) return;
    n.logs = emptyLogs();
    noteSessionStart(n);
    setDirty(true);
    autosave();
    renderList();
    updateLogStatsUI();
  }

  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- List rendering helpers ----------
  function renderList() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const filtered = q
      ? notes.filter(n =>
          (n.title || "").toLowerCase().includes(q) ||
          (n.body || "").toLowerCase().includes(q)
        )
      : notes;

    notesListEl.innerHTML = filtered.map(n => {
      const isActive = n.id === activeId;
      const title = (n.title || "").trim() || "Untitled";
      const logs = ensureLogs(n);
      const tc = Object.keys(logs.text_records).length;
      const kc = Object.keys(logs.key_records).length;
      return `
        <div class="note-card ${isActive ? "active" : ""}" data-id="${escapeHtml(n.id)}" tabindex="0">
          <div class="note-title">${escapeHtml(title)}</div>
          <p class="note-snippet">${escapeHtml(snippet(n.body))}</p>
          <div class="note-meta">
            <span>${escapeHtml(formatTime(n.updatedAt))}</span>
            <span>${tc}T ${kc}K</span>
          </div>
        </div>
      `;
    }).join("");

    [...notesListEl.querySelectorAll(".note-card")].forEach(card => {
      card.addEventListener("click", () => selectNote(card.dataset.id));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectNote(card.dataset.id);
        }
      });
    });
  }

  function renderEditor() {
    const n = getActive();
    if (!n) {
      mainTitleEl.textContent = "No note selected";
      emptyStateEl.style.display = "block";
      editorEl.style.display = "none";
      fullscreenBtn.disabled = true;
      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      setStatus("Create a note or pick one from the list.");
      logStatsEl.textContent = "logs: —";
      return;
    }

    ensureLogs(n);

    emptyStateEl.style.display = "none";
    editorEl.style.display = "grid";
    fullscreenBtn.disabled = false;
    saveBtn.disabled = false;
    deleteBtn.disabled = false;

    const title = (n.title || "").trim() || "Untitled";
    mainTitleEl.textContent = title;
    titleInput.value = n.title || "";
    bodyInput.value = n.body || "";
    overlayTitle.textContent = title;

    setStatus(dirty ? "Unsaved changes…" : "Saved");
    updateLogStatsUI();
  }

  function resortNotes() {
    notes.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  // ---------- Main note ops ----------
  async function putNote(note) {
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.put(note);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function saveActiveFromInputs() {
    const n = getActive();
    if (!n) return;

    n.title = titleInput.value;
    n.body = bodyInput.value;
    n.updatedAt = nowISO();
    ensureLogs(n);
    noteSessionTouch(n);

    await putNote(n);
    resortNotes();
    setDirty(false);
    renderList();
    renderEditor();
  }

  async function createNewNote() {
    const note = {
      id: id(),
      title: "",
      body: "",
      createdAt: nowISO(),
      updatedAt: nowISO(),
      logs: emptyLogs()
    };
    noteSessionStart(note);
    await putNote(note);
    notes.unshift(note);
    activeId = note.id;
    setDirty(false);
    renderList();
    renderEditor();
    notifyActiveNote();
    titleInput.focus();
  }

  async function selectNote(noteId) {
    if (!noteId || noteId === activeId) return;
    activeId = noteId;
    setDirty(false);
    renderList();
    renderEditor();
    notifyActiveNote();
  }

  async function deleteActive() {
    const n = getActive();
    if (!n) return;
    const ok = confirm("Delete this note?");
    if (!ok) return;

    await new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const req = store.delete(n.id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    notes = notes.filter(x => x.id !== n.id);
    activeId = notes.length ? notes[0].id : null;
    setDirty(false);
    renderList();
    renderEditor();
    notifyActiveNote();
  }

  async function loadNotes() {
    return new Promise((resolve, reject) => {
      const store = tx(db, "readonly");
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        rows.sort((a,b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
        rows.forEach(ensureLogs);
        notes = rows;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- Wire up events ----------
  newBtn.addEventListener("click", createNewNote);
  saveBtn.addEventListener("click", saveActiveFromInputs);
  deleteBtn.addEventListener("click", deleteActive);
  fullscreenBtn.addEventListener("click", openOverlay);

  exportBtn.addEventListener("click", exportAll);
  exportLogsBtn.addEventListener("click", exportActiveLogs);
  clearLogsBtn.addEventListener("click", clearActiveLogs);

  searchEl.addEventListener("input", renderList);

  let focusRaf = null;
  function updateNoteFocusEffects() {
    if (!notesListEl) return;
    if (focusRaf) cancelAnimationFrame(focusRaf);
    focusRaf = requestAnimationFrame(() => {
      const rect = notesListEl.getBoundingClientRect();
      if (rect.height === 0) return;
      const centerY = rect.top + rect.height / 2;
      const maxDistance = rect.height / 2;
      const cards = notesListEl.querySelectorAll(".note-card");
      cards.forEach(card => {
        const cRect = card.getBoundingClientRect();
        const cCenter = cRect.top + cRect.height / 2;
        const dist = Math.abs(cCenter - centerY);
        const t = Math.min(dist / maxDistance, 1);
        const opacity = 1 - (t * 0.75);
        const scale = 1 - (t * 0.05);
        card.style.opacity = opacity.toFixed(2);
        card.style.transform = `scale(${scale.toFixed(3)})`;
      });
    });
  }

  notesListEl.addEventListener("scroll", updateNoteFocusEffects);
  window.addEventListener("resize", updateNoteFocusEffects);

  overlayClose.addEventListener("click", () => closeOverlay({save:false}));
  overlaySave.addEventListener("click", () => closeOverlay({save:true}));

  modeRecordBtn.addEventListener("click", () => setMode("record"));
  modeAnalysisBtn.addEventListener("click", () => setMode("analysis"));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOverlay({save:false});
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveActiveFromInputs();
    }
  });

  // Viewport height tracking (keyboard)
  setViewportHeightVar();
  window.addEventListener("resize", setViewportHeightVar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", setViewportHeightVar);
    window.visualViewport.addEventListener("scroll", setViewportHeightVar);
  }

  // Font selector
  fontSelect.addEventListener("change", (e) => {
    applyFont(e.target.value);
  });

  // Global selectionchange hook (important for iOS selection handles)
  document.addEventListener("selectionchange", () => {
    const active = document.activeElement;
    // Only log if focused element is one of our editors
    if (active === bodyInput || active === overlayBody) {
      // selectionStart/End should be updated by now
      logCursor(active);
    }
  });

  // Attach logging to both editors
  attachEditorLogging(bodyInput, { isOverlay:false });
  attachEditorLogging(overlayBody, { isOverlay:true });

  // ---------- App API (for replay) ----------
  window.tlogApp = {
    getActive,
    ensureLogs,
    bodyInput,
    overlayBody,
    titleInput,
    mainTitleEl,
    overlayTitle,
    overlay,
    setStatus,
    updateLogStatsUI,
    renderEditor,
    setReplayState: (value) => { isReplaying = Boolean(value); }
  };

  // ---------- Init ----------
  (async function init() {
    applyFont(fontSelect.value);
    setStatus("Loading…");
    db = await openDB();
    await loadNotes();

    // If empty DB, create a welcome note
    if (notes.length === 0) {
      const welcome = {
        id: id(),
        title: "Welcome",
        body: "This is a Keep-like demo with per-note process logging.\n\nType in the editor and then use \u201cExport logs\u201d.\n\nLogs include:\n\u2022 text snapshots\n\u2022 cursor/selection\n\u2022 key events\n\u2022 scroll\n\nTip: logs can get big quickly.",
        createdAt: nowISO(),
        updatedAt: nowISO(),
        logs: emptyLogs()
      };
      noteSessionStart(welcome);
      await putNote(welcome);
      notes = [welcome];
    } else {
      // Touch session header to reflect current activity windows only when you start editing;
      // leaving as-is so you can interpret sessions however you like.
    }

    activeId = notes[0]?.id || null;
    setDirty(false);
    renderList();
    renderEditor();
    notifyActiveNote();
    setMode("record");

  })().catch(err => {
    console.error(err);
    setStatus("Failed to load IndexedDB.");
    alert("Error initializing app: " + (err?.message || err));
  });
})();
