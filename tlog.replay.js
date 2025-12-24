(() => {
  const app = window.tlogApp;
  if (!app) return;

  const replayBtn = document.getElementById("replayBtn");
  const replayPauseBtn = document.getElementById("replayPauseBtn");
  const replayStopBtn = document.getElementById("replayStopBtn");
  const replaySpeed = document.getElementById("replaySpeed");
  const replaySlider = document.getElementById("replaySlider");
  const replayTime = document.getElementById("replayTime");
  const progressGraph = document.getElementById("progressGraph");
  const replayTitle = document.getElementById("replayTitle");
  const replayBody = document.getElementById("replayBody");
  const replayOverlay = document.getElementById("replayOverlay");
  const replayMeasure = document.getElementById("replayMeasure");
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
  let graphState = null;
  let overlayState = { text: "", start: 0, end: 0 };

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

  function collectEvents(logs) {
    const toSortedEvents = (records) => Object.entries(records || {})
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(e => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);

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
    buildGraph();
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
    updateGraphCursor(absTime, text.length, cursorPos);
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

  function createGraphElements(svg) {
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";
    const axis = document.createElementNS(ns, "path");
    axis.setAttribute("stroke", "#e0e0e0");
    axis.setAttribute("fill", "none");
    axis.setAttribute("stroke-width", "1");
    svg.appendChild(axis);

    const textLine = document.createElementNS(ns, "polyline");
    textLine.setAttribute("fill", "none");
    textLine.setAttribute("stroke", "#111");
    textLine.setAttribute("stroke-width", "2");
    textLine.setAttribute("id", "graphTextLine");
    svg.appendChild(textLine);

    const cursorLine = document.createElementNS(ns, "polyline");
    cursorLine.setAttribute("fill", "none");
    cursorLine.setAttribute("stroke", "#0a6cff");
    cursorLine.setAttribute("stroke-width", "2");
    cursorLine.setAttribute("id", "graphCursorLine");
    svg.appendChild(cursorLine);

    const nowLine = document.createElementNS(ns, "line");
    nowLine.setAttribute("stroke", "#999");
    nowLine.setAttribute("stroke-width", "1");
    nowLine.setAttribute("id", "graphNowLine");
    svg.appendChild(nowLine);

    const textDot = document.createElementNS(ns, "circle");
    textDot.setAttribute("r", "3.5");
    textDot.setAttribute("fill", "#111");
    textDot.setAttribute("id", "graphTextDot");
    svg.appendChild(textDot);

    const cursorDot = document.createElementNS(ns, "circle");
    cursorDot.setAttribute("r", "3.5");
    cursorDot.setAttribute("fill", "#0a6cff");
    cursorDot.setAttribute("id", "graphCursorDot");
    svg.appendChild(cursorDot);

    return { axis, textLine, cursorLine, nowLine, textDot, cursorDot };
  }

  function buildGraph() {
    if (!progressGraph || duration <= 0) return;

    const w = 1000;
    const h = 180;
    const pad = { left: 36, right: 10, top: 10, bottom: 24 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;

    const textLengths = textEvents.map(ev => String(ev.value || "").length);
    const cursorPositions = cursorEvents.map(ev => {
      const start = Number(String(ev.value).split(":")[0]);
      return Number.isFinite(start) ? start : 0;
    });

    const maxLen = Math.max(1, ...textLengths, ...cursorPositions);

    const scaleX = (ts) => pad.left + ((ts - t0) / duration) * innerW;
    const scaleY = (val) => pad.top + (1 - (val / maxLen)) * innerH;

    const pointsFrom = (events, valueFn) => events.map(ev => {
      const x = scaleX(ev.ts);
      const y = scaleY(valueFn(ev));
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    const elements = createGraphElements(progressGraph);
    elements.axis.setAttribute(
      "d",
      `M ${pad.left} ${pad.top} L ${pad.left} ${h - pad.bottom} L ${w - pad.right} ${h - pad.bottom}`
    );

    elements.textLine.setAttribute(
      "points",
      pointsFrom(textEvents, ev => String(ev.value || "").length)
    );
    elements.cursorLine.setAttribute(
      "points",
      pointsFrom(cursorEvents, ev => {
        const start = Number(String(ev.value).split(":")[0]);
        return Number.isFinite(start) ? start : 0;
      })
    );

    graphState = { w, h, pad, innerW, innerH, maxLen, elements, scaleX, scaleY };
    updateGraphCursor(t0, 0, 0);
  }

  function updateGraphCursor(absTime, textLen, cursorPos) {
    if (!graphState) return;
    const { elements, scaleX, scaleY, pad, h } = graphState;
    const clampedTime = Math.min(Math.max(absTime, t0), tEnd);
    const x = scaleX(clampedTime);
    const textY = scaleY(textLen);
    const cursorY = scaleY(cursorPos);

    elements.nowLine.setAttribute("x1", x);
    elements.nowLine.setAttribute("x2", x);
    elements.nowLine.setAttribute("y1", pad.top);
    elements.nowLine.setAttribute("y2", h - pad.bottom);

    elements.textDot.setAttribute("cx", x);
    elements.textDot.setAttribute("cy", textY);
    elements.cursorDot.setAttribute("cx", x);
    elements.cursorDot.setAttribute("cy", cursorY);
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

  function blockEditing(e) {
    if (!inputLocked) return;
    e.preventDefault();
  }

  // Prevent edits during replay while keeping caret visible.
  ["beforeinput", "keydown", "paste", "drop"].forEach(type => {
    replayBody.addEventListener(type, blockEditing, true);
  });

  replayBody.addEventListener("focus", () => replayBody.blur());
  replayBody.addEventListener("scroll", refreshOverlay);
  window.addEventListener("resize", refreshOverlay);

  document.addEventListener("click", (e) => {
    if (!inputLocked) return;
    const card = e.target.closest ? e.target.closest(".note-card") : null;
    if (card) stopReplay();
  });

  window.tlogReplay = {
    stopReplay
  };

  setReplayMode(false);
})();
