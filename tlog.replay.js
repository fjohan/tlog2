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

  function setControlsDisabled(disabled) {
    controlsToDisable.forEach(el => { if (el) el.disabled = disabled; });
    inputLocked = disabled;
  }

  function getReplayTarget() {
    return app.overlay.classList.contains("is-open") ? app.overlayBody : app.bodyInput;
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
    app.bodyInput.value = text;
    app.overlayBody.value = text;

    if (cursorEv) {
      const parts = String(cursorEv.value).split(":");
      let start = Number(parts[0]);
      let end = Number(parts[1]);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start;
      const max = text.length;
      start = Math.min(Math.max(start, 0), max);
      end = Math.min(Math.max(end, 0), max);

      app.bodyInput.setSelectionRange(start, end);
      app.overlayBody.setSelectionRange(start, end);
    }

    const target = getReplayTarget();
    if (document.activeElement !== target) {
      target.focus();
    }

    const cursorPos = cursorEv ? Number(String(cursorEv.value).split(":")[0]) : 0;
    updateGraphCursor(absTime, text.length, cursorPos);
  }

  function captureOriginalState() {
    const target = getReplayTarget();
    originalState = {
      bodyText: app.bodyInput.value,
      overlayText: app.overlayBody.value,
      selectionStart: target.selectionStart,
      selectionEnd: target.selectionEnd,
      focusedId: target.id
    };
  }

  function restoreOriginalState() {
    if (!originalState) return;
    app.bodyInput.value = originalState.bodyText;
    app.overlayBody.value = originalState.overlayText;

    const target = originalState.focusedId === app.overlayBody.id ? app.overlayBody : app.bodyInput;
    if (typeof originalState.selectionStart === "number" && typeof originalState.selectionEnd === "number") {
      target.setSelectionRange(originalState.selectionStart, originalState.selectionEnd);
    }

    app.renderEditor();
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

  function stopReplay() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    isPlaying = false;
    setReplayMode(false);
    replaySlider.value = "0";
    updateTimeLabel(0);
    restoreOriginalState();
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
    app.bodyInput.addEventListener(type, blockEditing, true);
    app.overlayBody.addEventListener(type, blockEditing, true);
  });

  document.addEventListener("click", (e) => {
    if (!inputLocked) return;
    const card = e.target.closest ? e.target.closest(".note-card") : null;
    if (card) stopReplay();
  });

  setReplayMode(false);
})();
