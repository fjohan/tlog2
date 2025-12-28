(() => {
  const progressGraph = document.getElementById("progressGraph");
  if (!progressGraph) return;

  let graphState = null;

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
    svg.appendChild(textLine);

    const cursorLine = document.createElementNS(ns, "polyline");
    cursorLine.setAttribute("fill", "none");
    cursorLine.setAttribute("stroke", "#0a6cff");
    cursorLine.setAttribute("stroke-width", "2");
    svg.appendChild(cursorLine);

    const nowLine = document.createElementNS(ns, "line");
    nowLine.setAttribute("stroke", "#999");
    nowLine.setAttribute("stroke-width", "1");
    svg.appendChild(nowLine);

    const textDot = document.createElementNS(ns, "circle");
    textDot.setAttribute("r", "3.5");
    textDot.setAttribute("fill", "#111");
    svg.appendChild(textDot);

    const cursorDot = document.createElementNS(ns, "circle");
    cursorDot.setAttribute("r", "3.5");
    cursorDot.setAttribute("fill", "#0a6cff");
    svg.appendChild(cursorDot);

    return { axis, textLine, cursorLine, nowLine, textDot, cursorDot };
  }

  function buildGraph({ textEvents, cursorEvents, t0, tEnd, duration }) {
    if (duration <= 0) return;

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

    graphState = { w, h, pad, maxLen, elements, scaleX, scaleY, t0, tEnd };
    updateCursor(t0, 0, 0);
  }

  function updateCursor(absTime, textLen, cursorPos) {
    if (!graphState) return;
    const { elements, scaleX, scaleY, pad, h, t0, tEnd } = graphState;
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

  function clearGraph() {
    progressGraph.innerHTML = "";
    graphState = null;
  }

  window.tlogReplayGraph = {
    buildGraph,
    updateCursor,
    clearGraph,
    getState: () => graphState
  };
})();
