(() => {
  const app = window.tlogApp;
  if (!app) return;

  const replayBtn = document.getElementById("replayBtn");
  const replayPauseBtn = document.getElementById("replayPauseBtn");
  const replayStopBtn = document.getElementById("replayStopBtn");
  const replaySpeed = document.getElementById("replaySpeed");
  const replaySlider = document.getElementById("replaySlider");
  const replayTime = document.getElementById("replayTime");
  const replayTitle = document.getElementById("replayTitle");
  const replayBody = document.getElementById("replayBody");
  const replayOverlay = document.getElementById("replayOverlay");
  const replayMeasure = document.getElementById("replayMeasure");
  const notesListEl = document.getElementById("notesList");
  const exportDiffsBtn = document.getElementById("exportDiffsBtn");
  const reportBtn = document.getElementById("reportBtn");
  const importLogsBtn = document.getElementById("importLogsBtn");
  const importLogsInput = document.getElementById("importLogsInput");

  const controlsToDisable = [
    document.getElementById("newBtn"),
    document.getElementById("saveBtn"),
    document.getElementById("deleteBtn"),
    document.getElementById("fullscreenBtn"),
    document.getElementById("exportBtn"),
    document.getElementById("exportLogsBtn"),
    document.getElementById("clearLogsBtn"),
    document.getElementById("search"),
    document.getElementById("fontSelect")
  ];

  let isPlaying = false;
  let rafId = null;
  let t0 = 0;
  let tEnd = 0;
  let duration = 0;
  let startWallTime = 0;
  let startReplayTime = 0;
  let speed = 1;
  let textEvents = [];
  let cursorEvents = [];
  let originalState = null;
  let inputLocked = false;
  let overlayState = { text: "", start: 0, end: 0 };
  let overrideLogs = null;

  function setControlsDisabled(disabled) {
    controlsToDisable.forEach(el => { if (el) el.disabled = disabled; });
    inputLocked = disabled;
    if (replayBody) replayBody.readOnly = true;
  }

  function formatMs(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const m = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const s = String(totalSeconds % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function updateTimeLabel(currentMs) {
    replayTime.textContent = `${formatMs(currentMs)} / ${formatMs(duration)}`;
  }

  function toSortedEvents(records) {
    return Object.entries(records || {})
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(e => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);
  }

  function collectEvents(logs) {
    textEvents = toSortedEvents(logs.text_records);
    cursorEvents = toSortedEvents(logs.cursor_records);

    const times = [
      ...textEvents.map(e => e.ts),
      ...cursorEvents.map(e => e.ts)
    ];

    if (times.length === 0) return false;

    t0 = Math.min(...times);
    tEnd = Math.max(...times);
    duration = Math.max(1, tEnd - t0);
    replaySlider.max = String(duration);
    replaySlider.value = "0";
    updateTimeLabel(0);

    if (window.tlogReplayGraph) {
      window.tlogReplayGraph.buildGraph({ textEvents, cursorEvents, t0, tEnd, duration });
    }
    return true;
  }

  function lastEventBefore(events, t) {
    let lo = 0;
    let hi = events.length - 1;
    let best = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const ev = events[mid];
      if (ev.ts <= t) {
        best = ev;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function applyStateAtTime(absTime) {
    const textEv = lastEventBefore(textEvents, absTime);
    const cursorEv = lastEventBefore(cursorEvents, absTime);

    const text = textEv ? textEv.value : "";
    replayBody.value = text;

    let start = 0;
    let end = 0;
    if (cursorEv) {
      const parts = String(cursorEv.value).split(":");
      start = Number(parts[0]);
      end = Number(parts[1]);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start;
      const max = text.length;
      start = Math.min(Math.max(start, 0), max);
      end = Math.min(Math.max(end, 0), max);
    }

    if (document.activeElement === replayBody) {
      replayBody.blur();
    }

    const cursorPos = cursorEv ? Number(String(cursorEv.value).split(":")[0]) : 0;
    if (window.tlogReplayGraph) {
      window.tlogReplayGraph.updateCursor(absTime, text.length, cursorPos);
    }
    updateReplayOverlay(text, start, end);
  }

  function captureOriginalState() {
    originalState = {
      replayText: replayBody.value,
      replayTitle: replayTitle.value,
      selectionStart: replayBody.selectionStart,
      selectionEnd: replayBody.selectionEnd
    };
  }

  function restoreOriginalState() {
    if (!originalState) return;
    replayBody.value = originalState.replayText;
    replayTitle.value = originalState.replayTitle;

    if (typeof originalState.selectionStart === "number" && typeof originalState.selectionEnd === "number") {
      updateReplayOverlay(
        originalState.replayText,
        originalState.selectionStart,
        originalState.selectionEnd
      );
    }

    originalState = null;
  }

  function setReplayMode(active) {
    app.setReplayState(active);
    setControlsDisabled(active);
    replayBtn.disabled = active;
    replayPauseBtn.disabled = !active;
    replayStopBtn.disabled = !active;
    replaySlider.disabled = !active;
    replaySpeed.disabled = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[ch]));
  }

  function syncMeasureStyle() {
    if (!replayBody || !replayMeasure) return;
    const style = window.getComputedStyle(replayBody);
    replayMeasure.style.fontFamily = style.fontFamily;
    replayMeasure.style.fontSize = style.fontSize;
    replayMeasure.style.lineHeight = style.lineHeight;
    replayMeasure.style.letterSpacing = style.letterSpacing;
    replayMeasure.style.wordSpacing = style.wordSpacing;
    replayMeasure.style.padding = style.padding;
    replayMeasure.style.border = style.border;
    replayMeasure.style.boxSizing = style.boxSizing;
    replayMeasure.style.width = `${replayBody.clientWidth}px`;
    replayMeasure.style.height = `${replayBody.clientHeight}px`;
  }

  function ensureCaretEl() {
    if (!replayOverlay) return null;
    let caret = replayOverlay.querySelector(".replay-caret");
    if (!caret) {
      caret = document.createElement("div");
      caret.className = "replay-caret";
      replayOverlay.appendChild(caret);
    }
    return caret;
  }

  function updateReplayOverlay(text, start, end) {
    if (!replayOverlay || !replayMeasure || !replayBody) return;
    syncMeasureStyle();
    const max = text.length;
    let a = Number.isFinite(start) ? start : 0;
    let b = Number.isFinite(end) ? end : a;
    a = Math.min(Math.max(a, 0), max);
    b = Math.min(Math.max(b, 0), max);
    if (a > b) [a, b] = [b, a];

    overlayState = { text, start: a, end: b };

    const before = text.slice(0, a);
    const selected = text.slice(a, b);
    const after = text.slice(b);
    if (selected.length > 0) {
      replayMeasure.innerHTML = `${escapeHtml(before)}<span class="sel-range">${escapeHtml(selected)}</span><span class="cursor-marker"></span>${escapeHtml(after)}`;
    } else {
      replayMeasure.innerHTML = `${escapeHtml(before)}<span class="cursor-marker"></span>${escapeHtml(after)}`;
    }

    replayMeasure.scrollTop = replayBody.scrollTop;
    replayMeasure.scrollLeft = replayBody.scrollLeft;

    const baseRect = replayBody.getBoundingClientRect();
    const caretMarker = replayMeasure.querySelector(".cursor-marker");
    const caretRect = caretMarker ? caretMarker.getBoundingClientRect() : null;
    const caretEl = ensureCaretEl();
    if (caretEl && caretRect) {
      caretEl.style.left = `${caretRect.left - baseRect.left}px`;
      caretEl.style.top = `${caretRect.top - baseRect.top}px`;
      caretEl.style.height = `${Math.max(14, caretRect.height)}px`;
      caretEl.style.opacity = "1";
    }

    replayOverlay.querySelectorAll(".replay-selection").forEach(el => el.remove());
    const selRange = replayMeasure.querySelector(".sel-range");
    if (selRange) {
      [...selRange.getClientRects()].forEach(rect => {
        const selEl = document.createElement("div");
        selEl.className = "replay-selection";
        selEl.style.left = `${rect.left - baseRect.left}px`;
        selEl.style.top = `${rect.top - baseRect.top}px`;
        selEl.style.width = `${Math.max(1, rect.width)}px`;
        selEl.style.height = `${Math.max(12, rect.height)}px`;
        replayOverlay.appendChild(selEl);
      });
    }
  }

  function refreshOverlay() {
    if (!overlayState) return;
    updateReplayOverlay(overlayState.text, overlayState.start, overlayState.end);
  }

  function clearGraph() {
    if (window.tlogReplayGraph) window.tlogReplayGraph.clearGraph();
    replaySlider.max = "1";
    replaySlider.value = "0";
    updateTimeLabel(0);
  }

  function stopReplay() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    isPlaying = false;
    setReplayMode(false);
    replaySlider.value = "0";
    updateTimeLabel(0);
    restoreOriginalState();
    if (replayOverlay) replayOverlay.querySelectorAll(".replay-selection").forEach(el => el.remove());
    const caretEl = replayOverlay ? replayOverlay.querySelector(".replay-caret") : null;
    if (caretEl) caretEl.style.opacity = "0";
  }

  function tick() {
    if (!isPlaying) return;
    const now = performance.now();
    const elapsed = (now - startWallTime) * speed;
    const current = Math.min(startReplayTime + elapsed, duration);
    const absTime = t0 + current;

    applyStateAtTime(absTime);
    replaySlider.value = String(Math.round(current));
    updateTimeLabel(current);

    if (current >= duration) {
      isPlaying = false;
      setReplayMode(true);
      replayPauseBtn.textContent = "Resume";
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function startReplay() {
    const note = app.getActive();
    if (!note) {
      app.setStatus("Pick a note to replay.");
      return;
    }

    const logs = app.ensureLogs(note);
    const hasEvents = collectEvents(logs);
    if (!hasEvents) {
      app.setStatus("No log events to replay.");
      return;
    }

    captureOriginalState();
    replayTitle.value = (note.title || "").trim() || "Untitled";
    setReplayMode(true);
    app.setStatus("Replaying logs...");

    startReplayTime = 0;
    startWallTime = performance.now();
    speed = Number(replaySpeed.value) || 1;
    isPlaying = true;
    replayPauseBtn.textContent = "Pause";
    tick();
  }

  function resumeReplay() {
    if (duration <= 0) return;
    startReplayTime = Number(replaySlider.value) || 0;
    startWallTime = performance.now();
    speed = Number(replaySpeed.value) || 1;
    isPlaying = true;
    replayPauseBtn.textContent = "Pause";
    tick();
  }

  function pauseReplay() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    isPlaying = false;
    replayPauseBtn.textContent = "Resume";
  }

  function handleSliderInput() {
    if (duration <= 0) return;
    const current = Number(replaySlider.value) || 0;
    applyStateAtTime(t0 + current);
    updateTimeLabel(current);
    startReplayTime = current;
    startWallTime = performance.now();
  }

  function updateSpeed() {
    speed = Number(replaySpeed.value) || 1;
    if (isPlaying) {
      startReplayTime = Number(replaySlider.value) || 0;
      startWallTime = performance.now();
    }
  }

  function blockEditing(e) {
    if (!inputLocked) return;
    e.preventDefault();
  }

  function seekToTimestamp(ts, timeInfo, shouldPlay) {
    if (!Number.isFinite(ts)) return;
    const baseT0 = timeInfo && Number.isFinite(timeInfo.t0) ? timeInfo.t0 : t0;
    const baseDuration = timeInfo && Number.isFinite(timeInfo.duration) ? timeInfo.duration : duration;
    const raw = ts - baseT0;
    const current = Math.max(0, Math.min(baseDuration, raw));
    replaySlider.value = String(Math.round(current));
    if (raw < 0) {
      applyStateAtTime(baseT0 - 1);
      updateTimeLabel(0);
      startReplayTime = 0;
    } else {
      applyStateAtTime(baseT0 + current);
      updateTimeLabel(current);
      startReplayTime = current;
    }
    startWallTime = performance.now();
    if (shouldPlay) {
      if (!originalState) captureOriginalState();
      setReplayMode(true);
      speed = Number(replaySpeed.value) || 1;
      isPlaying = true;
      replayPauseBtn.textContent = "Pause";
      tick();
    }
  }

  function refreshReplayNote() {
    const note = app.getActive();
    if (overrideLogs) {
      const logs = overrideLogs.logs;
      const entries = Object.entries(logs.text_records || {})
        .map(([ts, value]) => ({ ts: Number(ts), text: String(value || "") }))
        .filter(e => Number.isFinite(e.ts))
        .sort((a, b) => a.ts - b.ts);

      replayTitle.value = overrideLogs.title || "Imported log";
      replayBody.value = entries.length ? entries[entries.length - 1].text : "";
      updateReplayOverlay(replayBody.value, 0, 0);

      if (!collectEvents(logs)) {
        clearGraph();
      }

      if (window.tlogReplayTable) {
        window.tlogReplayTable.buildTable({
          note: { id: "imported" },
          logs,
          entries,
          timeInfo: { t0, duration },
          onSeek: seekToTimestamp
        });
      }

      if (window.tlogReplayLinear) {
        window.tlogReplayLinear.buildLinear({ logs, entries });
      }
      return;
    }
    if (!note) {
      replayTitle.value = "";
      replayBody.value = "";
      updateReplayOverlay("", 0, 0);
      clearGraph();
      if (window.tlogReplayTable) window.tlogReplayTable.clearTable("No note selected.");
      if (window.tlogReplayLinear) window.tlogReplayLinear.clearLinear("No note selected.");
      return;
    }

    const logs = app.ensureLogs(note);
    const entries = Object.entries(logs.text_records || {})
      .map(([ts, value]) => ({ ts: Number(ts), text: String(value || "") }))
      .filter(e => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);

    replayTitle.value = (note.title || "").trim() || "Untitled";
    replayBody.value = note.body || "";
    updateReplayOverlay(replayBody.value, 0, 0);

    if (!collectEvents(logs)) {
      clearGraph();
    }

    if (window.tlogReplayTable) {
      window.tlogReplayTable.buildTable({
        note,
        logs,
        entries,
        timeInfo: { t0, duration },
        onSeek: seekToTimestamp
      });
    }

    if (window.tlogReplayLinear) {
      window.tlogReplayLinear.buildLinear({ logs, entries });
    }
  }

  replayBtn.addEventListener("click", startReplay);
  replayPauseBtn.addEventListener("click", () => {
    if (!isPlaying) {
      resumeReplay();
    } else {
      pauseReplay();
    }
  });
  replayStopBtn.addEventListener("click", stopReplay);
  replaySlider.addEventListener("input", handleSliderInput);
  replaySpeed.addEventListener("change", updateSpeed);

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

  function downloadText(text, filename) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function diffPrettyShort(diffs, context) {
    const html = [];
    const pattern_amp = /&/g;
    const pattern_lt = /</g;
    const pattern_gt = />/g;
    const pattern_para = /\n/g;
    for (let x = 0; x < diffs.length; x += 1) {
      const op = diffs[x][0];
      const data = diffs[x][1];
      const text = data
        .replace(pattern_amp, "&amp;")
        .replace(pattern_lt, "&lt;")
        .replace(pattern_gt, "&gt;")
        .replace(pattern_para, "&para;<br>");
      switch (op) {
        case DIFF_INSERT:
          html[x] = `<ins style="background:#e6ffe6;">${text}</ins>`;
          break;
        case DIFF_DELETE:
          html[x] = `<del style="background:#ffe6e6;">${text}</del>`;
          break;
        case DIFF_EQUAL:
          if (x === 0) {
            html[x] = `<span>${text.substring(text.length - context)}</span>`;
          } else {
            html[x] = `<span>${text.substring(0, context)}</span>`;
          }
          break;
      }
    }
    return html.join("");
  }

  function buildDiffLines(logs, entries) {
    const diffLines = [];
    if (typeof diff_match_patch === "undefined") {
      return diffLines;
    }
    const dmp = new diff_match_patch();
    const cursorEvents = Object.entries(logs.cursor_records || {})
      .map(([ts, value]) => ({
        ts: Number(ts),
        value: String(value || "")
      }))
      .filter(ev => Number.isFinite(ev.ts))
      .sort((a, b) => a.ts - b.ts);

    function cursorAt(ts) {
      let lo = 0;
      let hi = cursorEvents.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const ev = cursorEvents[mid];
        if (ev.ts <= ts) {
          best = ev;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (!best) return 0;
      const parts = best.value.split(":");
      const start = Number(parts[0]);
      return Number.isFinite(start) ? start : 0;
    }

    let prevCursor = 0;
    const diffEvents = [];
    for (let i = 0; i < entries.length; i += 1) {
      const prevText = i === 0 ? "" : entries[i - 1].text;
      const currText = entries[i].text;
      const diff = dmp.diff_main(prevText, currText);
      dmp.diff_cleanupSemantic(diff);
      let firstEq = 0;
      if (diff.length && diff[0][0] === DIFF_EQUAL) {
        firstEq = diff[0][1].length;
      }

      const parts = diff.map(([op, text]) => `(${op},"${text}")`);
      const currCursor = cursorAt(entries[i].ts);
      diffEvents.push({
        ts: entries[i].ts,
        kind: "diff",
        line: `${prevCursor} ${firstEq} ${currCursor} ${parts.join(" ")}`
      });

      let cursor = 0;
      diff.forEach(([op, text], idx) => {
        if (!text) return;
        if (op === DIFF_EQUAL) {
          if (idx !== diff.length - 1) cursor += text.length;
        }
        else if (op === DIFF_INSERT) cursor += text.length;
        else if (op === DIFF_DELETE) cursor -= text.length;
      });
      prevCursor = cursor;
    }

    const cursorLines = cursorEvents.map(ev => {
      const parts = ev.value.split(":");
      const start = Number(parts[0]);
      const cursorPos = Number.isFinite(start) ? start : 0;
      return { ts: ev.ts, kind: "cursor", line: `CURSOR ${cursorPos}` };
    });

    const merged = [...diffEvents, ...cursorLines].sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.kind === b.kind) return 0;
      return a.kind === "diff" ? -1 : 1;
    });

    merged.forEach(item => diffLines.push(item.line));
    return diffLines;
  }

  function exportDiffs() {
    const note = app.getActive();
    const source = overrideLogs || (note ? { logs: app.ensureLogs(note), title: note.title || "", id: note.id } : null);
    if (!source) {
      app.setStatus("Pick a note to export diffs.");
      return;
    }

    const logs = source.logs;
    const entries = Object.entries(logs.text_records || {})
      .map(([ts, value]) => ({ ts: Number(ts), text: String(value || "") }))
      .filter(e => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);

    const diffLines = buildDiffLines(logs, entries);
    const exportVersion = "diffs-v4";

    const linearDebug = window.tlogReplayLinear?.buildLinearDebug
      ? window.tlogReplayLinear.buildLinearDebug({ logs, entries }).debug
      : [];

    const header = [
      `noteId: ${source.id || "imported"}`,
      `title: ${source.title || ""}`,
      `exportedAt: ${new Date().toISOString()}`,
      `format: prevCursor firstEq currCursor (op,"text") | CURSOR pos`,
      `exporter: ${exportVersion}`,
      ""
    ].join("\n");

    const diffText = diffLines.join("\n");
    const linearText = linearDebug.length ? `\n\n[linear_debug]\n${linearDebug.join("\n")}\n` : "";
    const stepThrough = window.tlogReplayLinear?.buildLinearStep
      ? window.tlogReplayLinear.buildLinearStep({ logs, entries })
      : [];
    const stepLines = stepThrough.map(step => {
      return `${step.index} ${step.token} | actual:${step.actual} | reconstructed:${step.reconstructed}`;
    });
    const stepText = stepLines.length ? `\n\n[linear_steps]\n${stepLines.join("\n")}\n` : "";
    const logsText = `\n\n[logs]\n${JSON.stringify(logs, null, 2)}\n`;
    const payloadText = `${header}[diffs]\n${diffText}${linearText}${stepText}${logsText}`;

    downloadText(payloadText, `keep-lite-${source.id || "import"}-diffs.txt`);
    app.setStatus(`Exported diffs (${exportVersion}).`);
  }

  if (exportDiffsBtn) {
    exportDiffsBtn.addEventListener("click", exportDiffs);
  }

  async function reportCurrentState() {
    const note = app.getActive();
    const source = overrideLogs || (note ? { logs: app.ensureLogs(note), title: note.title || "", id: note.id } : null);
    if (!source) {
      app.setStatus("Pick a note to report.");
      return;
    }
    if (window.location && window.location.protocol === "file:") {
      app.setStatus("Report requires HTTP (PHP). Open via a local server.");
      return;
    }
    app.setStatus("Reporting...");
    const logs = source.logs;
    const entries = Object.entries(logs.text_records || {})
      .map(([ts, value]) => ({ ts: Number(ts), text: String(value || "") }))
      .filter(e => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);
    const diffLines = buildDiffLines(logs, entries);
    const linearDebug = window.tlogReplayLinear?.buildLinearDebug
      ? window.tlogReplayLinear.buildLinearDebug({ logs, entries }).debug
      : [];
    const linearSteps = window.tlogReplayLinear?.buildLinearStep
      ? window.tlogReplayLinear.buildLinearStep({ logs, entries })
      : [];
    const linearRendered = document.getElementById("linearOutput")?.innerText || "";
    const payload = {
      noteId: source.id || "imported",
      title: source.title || "",
      reportedAt: new Date().toISOString(),
      diffs: diffLines,
      linear_rendered: linearRendered,
      linear_debug: linearDebug,
      linear_steps: linearSteps,
      logs
    };

    try {
      console.log('Here');
      const res = await fetch("report.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = result && result.error ? `: ${result.error}` : "";
        app.setStatus(`Report failed (${res.status})${detail}`);
        return;
      }
      app.setStatus(result.path ? `Report saved: ${result.path}` : "Report saved.");
    } catch (err) {
      console.error(err);
      app.setStatus("Report failed (network).");
    }
  }

  if (reportBtn) {
    reportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      reportCurrentState();
    });
  }

  function normalizeLogs(payload) {
    if (!payload || typeof payload !== "object") return null;
    const rawLogs = payload.logs && typeof payload.logs === "object" ? payload.logs : payload;
    if (!rawLogs.text_records) return null;
    const temp = { logs: rawLogs };
    const logs = app.ensureLogs(temp);
    return {
      logs,
      title: payload.title || "",
      id: payload.noteId || "imported"
    };
  }

  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        const normalized = normalizeLogs(payload);
        if (!normalized) {
          app.setStatus("Invalid log file.");
          return;
        }
        overrideLogs = normalized;
        app.setStatus("Loaded external logs.");
        refreshReplayNote();
      } catch (err) {
        console.error(err);
        app.setStatus("Failed to parse log file.");
      }
    };
    reader.readAsText(file);
  }

  if (importLogsBtn && importLogsInput) {
    importLogsBtn.addEventListener("click", () => importLogsInput.click());
    importLogsInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImportFile(file);
      importLogsInput.value = "";
    });
  }

  ["beforeinput", "keydown", "paste", "drop"].forEach(type => {
    replayBody.addEventListener(type, blockEditing, true);
  });

  replayBody.addEventListener("focus", () => replayBody.blur());
  replayBody.addEventListener("scroll", refreshOverlay);
  window.addEventListener("resize", refreshOverlay);

  document.addEventListener("tlog:notechange", () => {
    if (overrideLogs) {
      overrideLogs = null;
    }
    refreshReplayNote();
  });

  if (notesListEl) {
    notesListEl.addEventListener("click", () => setTimeout(refreshReplayNote, 0));
    notesListEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        setTimeout(refreshReplayNote, 0);
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (!inputLocked) return;
    const card = e.target.closest ? e.target.closest(".note-card") : null;
    if (card) stopReplay();
  });

  window.tlogReplay = {
    stopReplay,
    refreshReplayNote,
    seekToTimestamp
  };

  setReplayMode(false);
  refreshReplayNote();
})();
