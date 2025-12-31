(() => {
  const progressGraph = document.getElementById("progressGraph");
  if (!progressGraph) return;

  const dmp = typeof diff_match_patch !== "undefined" ? new diff_match_patch() : null;

  let graphState = null;

  function createGraphElements(svg) {
    svg.innerHTML = "";
    const ns = "http://www.w3.org/2000/svg";

    const axisLeft = document.createElementNS(ns, "line");
    axisLeft.setAttribute("stroke", "#e0e0e0");
    axisLeft.setAttribute("stroke-width", "1");
    svg.appendChild(axisLeft);

    const axisRight = document.createElementNS(ns, "line");
    axisRight.setAttribute("stroke", "#e0e0e0");
    axisRight.setAttribute("stroke-width", "1");
    svg.appendChild(axisRight);

    const axisBottom = document.createElementNS(ns, "line");
    axisBottom.setAttribute("stroke", "#e0e0e0");
    axisBottom.setAttribute("stroke-width", "1");
    svg.appendChild(axisBottom);

    const processLine = document.createElementNS(ns, "polyline");
    processLine.setAttribute("fill", "none");
    processLine.setAttribute("stroke", "#0a6cff");
    processLine.setAttribute("stroke-width", "2");
    svg.appendChild(processLine);

    const productLine = document.createElementNS(ns, "polyline");
    productLine.setAttribute("fill", "none");
    productLine.setAttribute("stroke", "#0a7a2a");
    productLine.setAttribute("stroke-width", "2");
    svg.appendChild(productLine);

    const positionLine = document.createElementNS(ns, "polyline");
    positionLine.setAttribute("fill", "none");
    positionLine.setAttribute("stroke", "#0a7a2a");
    positionLine.setAttribute("stroke-width", "2.5");
    positionLine.setAttribute("stroke-dasharray", "4 3");
    positionLine.setAttribute("stroke-linecap", "round");
    positionLine.setAttribute("opacity", "0.9");
    svg.appendChild(positionLine);

    const pauseGroup = document.createElementNS(ns, "g");
    svg.appendChild(pauseGroup);

    const nowLine = document.createElementNS(ns, "line");
    nowLine.setAttribute("stroke", "#999");
    nowLine.setAttribute("stroke-width", "1");
    svg.appendChild(nowLine);

    const processDot = document.createElementNS(ns, "circle");
    processDot.setAttribute("r", "3.5");
    processDot.setAttribute("fill", "#0a6cff");
    svg.appendChild(processDot);

    const productDot = document.createElementNS(ns, "circle");
    productDot.setAttribute("r", "3.5");
    productDot.setAttribute("fill", "#0a7a2a");
    svg.appendChild(productDot);

    const positionDot = document.createElementNS(ns, "circle");
    positionDot.setAttribute("r", "3.5");
    positionDot.setAttribute("fill", "#0a7a2a");
    svg.appendChild(positionDot);

    return {
      axisLeft,
      axisRight,
      axisBottom,
      processLine,
      productLine,
      positionLine,
      pauseGroup,
      nowLine,
      processDot,
      productDot,
      positionDot
    };
  }

  function countInsertions(prevText, currText) {
    if (!dmp) return Math.max(0, currText.length - prevText.length);
    const diff = dmp.diff_main(prevText, currText);
    dmp.diff_cleanupSemantic(diff);
    let total = 0;
    diff.forEach(([op, text]) => {
      if (op === DIFF_INSERT) total += text.length;
    });
    return total;
  }

  function countUserInsertions(prevText, currText, cursorPos) {
    if (!dmp) return Math.max(0, currText.length - prevText.length);
    const diff = dmp.diff_main(prevText, currText);
    dmp.diff_cleanupSemantic(diff);

    let pos = 0;
    const ops = [];
    diff.forEach(([op, text]) => {
      if (op === DIFF_EQUAL) {
        pos += text.length;
        return;
      }
      if (op === DIFF_INSERT) {
        ops.push({ type: "insert", text, start: pos, end: pos + text.length });
        pos += text.length;
        return;
      }
      if (op === DIFF_DELETE) {
        ops.push({ type: "delete", text, start: pos, end: pos });
      }
    });

    let userIndex = -1;
    if (Number.isFinite(cursorPos)) {
      for (let i = ops.length - 1; i >= 0; i -= 1) {
        const op = ops[i];
        if (op.type === "insert" && cursorPos >= op.start && cursorPos <= op.end) {
          userIndex = i;
          break;
        }
      }
      if (userIndex === -1) {
        for (let i = ops.length - 1; i >= 0; i -= 1) {
          const op = ops[i];
          if (op.type === "delete" && cursorPos === op.start) {
            userIndex = i;
            break;
          }
        }
      }
    }
    if (userIndex === -1 && ops.length) userIndex = ops.length - 1;

    const op = ops[userIndex];
    if (!op || op.type !== "insert") return 0;
    return op.text.length;
  }

  function lastPoint(series, t) {
    let lo = 0;
    let hi = series.length - 1;
    let best = null;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const ev = series[mid];
      if (ev.ts <= t) {
        best = ev;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best;
  }

  function buildGraph({ textEvents, cursorEvents, t0, tEnd, duration }) {
    if (duration <= 0) return;

    const w = 1000;
    const h = 180;
    const pad = { left: 40, right: 24, top: 10, bottom: 24 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;

    const textSeries = [];
    const processSeries = [];
    const productSeries = [];
    const positionSeries = [];
    const pauseSeries = [];

    let cumulativeInsert = 0;
    let prevText = "";
    const cursorAtTs = new Map();
    cursorEvents.forEach(ev => {
      const pos = Number(String(ev.value).split(":")[0]);
      if (Number.isFinite(pos)) cursorAtTs.set(ev.ts, pos);
    });

    textEvents.forEach((ev, idx) => {
      const text = String(ev.value || "");
      const cursorPos = cursorAtTs.has(ev.ts) ? cursorAtTs.get(ev.ts) : null;
      const inserts = countUserInsertions(prevText, text, cursorPos);
      cumulativeInsert += inserts;
      prevText = text;

      textSeries.push({ ts: ev.ts, text });
      processSeries.push({ ts: ev.ts, value: cumulativeInsert });
      productSeries.push({ ts: ev.ts, value: text.length });

      if (idx > 0) {
        const gap = (ev.ts - textEvents[idx - 1].ts) / 1000;
        if (gap >= 0) pauseSeries.push({ ts: ev.ts, value: gap });
      }
    });

    const sortedCursor = cursorEvents.slice().sort((a, b) => a.ts - b.ts);
    if (sortedCursor.length) {
      sortedCursor.forEach(ev => {
        const pos = Number(String(ev.value).split(":")[0]);
        positionSeries.push({ ts: ev.ts, value: Number.isFinite(pos) ? pos : 0 });
      });
    } else {
      textSeries.forEach(ev => {
        positionSeries.push({ ts: ev.ts, value: ev.text.length });
      });
    }

    const maxRight = Math.max(
      1,
      ...processSeries.map(p => p.value),
      ...productSeries.map(p => p.value),
      ...positionSeries.map(p => p.value)
    );
    const maxPause = Math.max(1, ...pauseSeries.map(p => p.value));

    const scaleX = (ts) => pad.left + ((ts - t0) / duration) * innerW;
    const scaleYRight = (val) => pad.top + (1 - (val / maxRight)) * innerH;
    const scaleYLeft = (val) => pad.top + (1 - (val / maxPause)) * innerH;

    const pointsFrom = (series, scaleY) => series.map(ev => {
      const x = scaleX(ev.ts);
      const y = scaleY(ev.value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");

    const elements = createGraphElements(progressGraph);
    elements.axisLeft.setAttribute("x1", pad.left);
    elements.axisLeft.setAttribute("x2", pad.left);
    elements.axisLeft.setAttribute("y1", pad.top);
    elements.axisLeft.setAttribute("y2", h - pad.bottom);

    elements.axisRight.setAttribute("x1", w - pad.right);
    elements.axisRight.setAttribute("x2", w - pad.right);
    elements.axisRight.setAttribute("y1", pad.top);
    elements.axisRight.setAttribute("y2", h - pad.bottom);

    elements.axisBottom.setAttribute("x1", pad.left);
    elements.axisBottom.setAttribute("x2", w - pad.right);
    elements.axisBottom.setAttribute("y1", h - pad.bottom);
    elements.axisBottom.setAttribute("y2", h - pad.bottom);

    elements.processLine.setAttribute("points", pointsFrom(processSeries, scaleYRight));
    elements.productLine.setAttribute("points", pointsFrom(productSeries, scaleYRight));
    elements.positionLine.setAttribute("points", pointsFrom(positionSeries, scaleYRight));

    elements.pauseGroup.innerHTML = "";
    pauseSeries.forEach(ev => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "3");
      dot.setAttribute("fill", "#f29f05");
      dot.setAttribute("cx", scaleX(ev.ts));
      dot.setAttribute("cy", scaleYLeft(ev.value));
      elements.pauseGroup.appendChild(dot);
    });

    graphState = {
      w,
      h,
      pad,
      elements,
      t0,
      tEnd,
      scaleX,
      scaleYRight,
      scaleYLeft,
      processSeries,
      productSeries,
      positionSeries
    };

    updateCursor(t0, 0, 0);
  }

  function updateCursor(absTime, textLen, cursorPos) {
    if (!graphState) return;
    const {
      elements,
      t0,
      tEnd,
      scaleX,
      scaleYRight,
      pad,
      h,
      processSeries,
      productSeries,
      positionSeries
    } = graphState;
    const clampedTime = Math.min(Math.max(absTime, t0), tEnd);
    const x = scaleX(clampedTime);

    const processPoint = lastPoint(processSeries, clampedTime);
    const productPoint = lastPoint(productSeries, clampedTime);
    const positionPoint = lastPoint(positionSeries, clampedTime);

    const processY = scaleYRight(processPoint ? processPoint.value : 0);
    const productY = scaleYRight(productPoint ? productPoint.value : textLen);
    const positionY = scaleYRight(positionPoint ? positionPoint.value : cursorPos);

    elements.nowLine.setAttribute("x1", x);
    elements.nowLine.setAttribute("x2", x);
    elements.nowLine.setAttribute("y1", pad.top);
    elements.nowLine.setAttribute("y2", h - pad.bottom);

    elements.processDot.setAttribute("cx", x);
    elements.processDot.setAttribute("cy", processY);
    elements.productDot.setAttribute("cx", x);
    elements.productDot.setAttribute("cy", productY);
    elements.positionDot.setAttribute("cx", x);
    elements.positionDot.setAttribute("cy", positionY);
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
