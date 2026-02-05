(() => {
  const linearOutput = document.getElementById("linearOutput");
  const linearStatus = document.getElementById("linearStatus");
  const linearCompare = document.getElementById("linearCompare");
  const pauseThresholdInput = document.getElementById("pauseThreshold");
  if (!linearOutput || !linearStatus) return;
  if (typeof diff_match_patch === "undefined") {
    linearStatus.textContent = "diff_match_patch not loaded.";
    return;
  }

  const dmp = new diff_match_patch();
  let lastBuild = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[ch]));
  }

  function buildLinearData({ logs, entries, thresholdOverride }) {
    if (!logs) {
      return { tokens: [], debug: ["no logs"] };
    }

    const outputParts = [];
    const monitorLines = [];
    let lastToken = null;

    function pushToken(token, actualText) {
      if (!token) return;
      if (!lastToken) {
        if (typeof actualText === "string") token.actualText = actualText;
        outputParts.push(token);
        lastToken = token;
        return;
      }
      if (token.type === "delete" && lastToken.type === "delete" && token.applyPos === lastToken.applyPos) {
        lastToken.count += token.count;
        if (typeof actualText === "string") lastToken.actualText = actualText;
        outputParts[outputParts.length - 1] = lastToken;
        return;
      }
      if (token.type === "navkey" && lastToken.type === "navkey" && token.code === lastToken.code) {
        lastToken.count = (lastToken.count || 1) + 1;
        if (typeof actualText === "string") lastToken.actualText = actualText;
        if (!lastToken.reasons) lastToken.reasons = [];
        lastToken.reasons.push(`collapsed keydown ${token.key || token.code}`);
        outputParts[outputParts.length - 1] = lastToken;
        return;
      }
      if (typeof actualText === "string") token.actualText = actualText;
      outputParts.push(token);
      lastToken = token;
    }

    function pushPause(seconds, actualText) {
      outputParts.push({
        type: "pause",
        value: `<${seconds.toFixed(2)}>`,
        reasons: [`pause ${seconds.toFixed(2)}s >= ${threshold.toFixed(2)}s`],
        actualText
      });
      lastToken = outputParts[outputParts.length - 1];
    }

    const navKeyMap = {
      arrowleft: "LEFT",
      arrowright: "RIGHT",
      arrowup: "UP",
      arrowdown: "DOWN",
      left: "LEFT",
      right: "RIGHT",
      up: "UP",
      down: "DOWN",
      enter: "CR",
      return: "CR"
    };

    function keyLabelIsBackspace(keyLabel) {
      const key = String(keyLabel || "").toLowerCase();
      return key === "backspace";
    }

    function keyLabelIsDelete(keyLabel) {
      const key = String(keyLabel || "").toLowerCase();
      return key === "delete";
    }

    const textEvents = (entries || [])
      .map((entry, index) => ({ ts: entry.ts, text: entry.text || "", index }))
      .filter(entry => Number.isFinite(entry.ts))
      .sort((a, b) => a.ts - b.ts);

    function findPrevText(ts) {
      let lo = 0;
      let hi = textEvents.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const ev = textEvents[mid];
        if (ev.ts <= ts) {
          best = ev;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best || { ts: Number.NEGATIVE_INFINITY, text: "", index: -1 };
    }

    function findNextText(ts) {
      let lo = 0;
      let hi = textEvents.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const ev = textEvents[mid];
        if (ev.ts > ts) {
          best = ev;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      return best;
    }

    const diffMeta = [];
    let prevCursorSum = 0;
    for (let idx = 0; idx < textEvents.length; idx += 1) {
      const prevText = idx === 0 ? "" : textEvents[idx - 1].text;
      const currText = textEvents[idx].text;
      const diff = dmp.diff_main(prevText, currText);
      dmp.diff_cleanupSemantic(diff);
      let firstEq = 0;
      if (diff.length && diff[0][0] === DIFF_EQUAL) firstEq = diff[0][1].length;
      let cursorSum = 0;
      diff.forEach(([op, text], i) => {
        if (!text) return;
        if (op === DIFF_EQUAL) {
          if (i !== diff.length - 1) cursorSum += text.length;
        }
        else if (op === DIFF_INSERT) cursorSum += text.length;
        else if (op === DIFF_DELETE) cursorSum -= text.length;
      });
      diffMeta.push({ firstEq, cursorSum, prevCursor: prevCursorSum });
      prevCursorSum = cursorSum;
    }

    const cursorEvents = Object.entries(logs.cursor_records || {})
      .map(([ts, value]) => ({
        ts: Number(ts),
        value: String(value || "")
      }))
      .filter(ev => Number.isFinite(ev.ts))
      .sort((a, b) => a.ts - b.ts);

    function cursorBefore(ts) {
      let lo = 0;
      let hi = cursorEvents.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const ev = cursorEvents[mid];
        if (ev.ts < ts) {
          best = ev;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (!best) return null;
      const parts = best.value.split(":");
      const start = Number(parts[0]);
      return Number.isFinite(start) ? start : null;
    }

    function simpleKeyDiff(ts, keyLabel, currentPos) {
      if (!textEvents.length) return null;
      const prev = findPrevText(ts);
      const next = findNextText(ts);
      if (!prev || !next) return null;
      if (prev.text === next.text) return null;

      const isLineBreak =
        next.text.startsWith(`${prev.text}\n`) &&
        next.text.length === prev.text.length + 1;
      if (isLineBreak) return null;

      const diffs = dmp.diff_main(prev.text, next.text);
      dmp.diff_cleanupSemantic(diffs);

      let firstEq = 0;
      if (diffs.length && diffs[0][0] === DIFF_EQUAL) firstEq = diffs[0][1].length;
      const prevCursor = prev.index >= 0 && diffMeta[prev.index]
        ? diffMeta[prev.index].cursorSum
        : 0;

      let insert = null;
      let del = null;
      for (let i = 0; i < diffs.length; i += 1) {
        const [op, text] = diffs[i];
        if (!text) continue;
        if (op === DIFF_INSERT) {
          if (insert) return null;
          insert = text;
        } else if (op === DIFF_DELETE) {
          if (del) return null;
          del = text;
        }
      }
      const isBackspace = keyLabelIsBackspace(keyLabel) || keyLabelIsDelete(keyLabel);
      if (isBackspace && insert && !del) return null;

      const navNeeded = prevCursor > (firstEq + 1) && currentPos !== firstEq;
      const navToken = navNeeded
        ? {
            type: "nav",
            pos: firstEq,
            reasons: [`nav inserted: prevCursor ${prevCursor} > firstEq ${firstEq} + 1`]
          }
        : null;
      if (insert && !del) {
        return {
          navToken,
          token: {
            type: "text",
            value: insert,
            applyPos: firstEq,
            reasons: [`diff insert from ${prev.ts} to ${next.ts} for keydown ${keyLabel || "unknown"}`]
          }
        };
      }
      if (del && !insert) {
        return {
          navToken,
          token: {
            type: "delete",
            count: del.length,
            applyPos: firstEq,
            reasons: [`diff delete from ${prev.ts} to ${next.ts} for keydown ${keyLabel || "unknown"}`]
          }
        };
      }
      return null;
    }

    function expectedTextAt(ts) {
      let lo = 0;
      let hi = textEvents.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const ev = textEvents[mid];
        if (ev.ts <= ts) {
          best = ev;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best ? best.text : "";
    }

    function expectedTextAfter(ts) {
      let lo = 0;
      let hi = textEvents.length - 1;
      let best = null;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const ev = textEvents[mid];
        if (ev.ts >= ts) {
          best = ev;
          hi = mid - 1;
        } else {
          lo = mid + 1;
        }
      }
      return best ? best.text : expectedTextAt(ts);
    }

    function buildCatchUpTokens(currentText, expectedText) {
      if (currentText === expectedText) return [];
      const diffs = dmp.diff_main(currentText, expectedText);
      dmp.diff_cleanupSemantic(diffs);
      let firstEq = 0;
      if (diffs.length && diffs[0][0] === DIFF_EQUAL) firstEq = diffs[0][1].length;
      let insert = null;
      let del = null;
      for (let i = 0; i < diffs.length; i += 1) {
        const [op, text] = diffs[i];
        if (!text) continue;
        if (op === DIFF_INSERT) {
          if (insert) return [];
          insert = text;
        } else if (op === DIFF_DELETE) {
          if (del) return [];
          del = text;
        }
      }
      if (insert && !del) {
        return [{
          type: "text",
          value: insert,
          applyPos: firstEq,
          reasons: [`catch-up insert to match text record`]
        }];
      }
      if (del && !insert) {
        return [{
          type: "delete",
          count: del.length,
          applyPos: firstEq,
          reasons: [`catch-up delete to match text record`]
        }];
      }
      return [];
    }

    const keyEventsRaw = Object.entries(logs.key_records || {})
      .map(([ts, value]) => ({ ts: Number(ts), value: String(value || "") }))
      .filter(ev => Number.isFinite(ev.ts))
      .sort((a, b) => a.ts - b.ts)
      .map(ev => {
        const parts = ev.value.split(":");
        if (parts.length < 2) return null;
        const kind = parts[0].trim().toLowerCase();
        if (kind !== "keydown") return null;
        const keyRaw = parts.slice(1).join(":").trim();
        const key = keyRaw.toLowerCase();
        const code = navKeyMap[key];
        if (code) return { ts: ev.ts, kind: "navkey", code, key: keyRaw };
        return { ts: ev.ts, kind: "unknown", key: keyRaw };
      })
      .filter(Boolean);

    const navTimes = keyEventsRaw.filter(ev => ev.kind === "navkey").map(ev => ev.ts);
    const NAV_SUPPRESS_MS = 30;
    function hasNearbyNav(ts) {
      for (let i = 0; i < navTimes.length; i += 1) {
        const delta = Math.abs(navTimes[i] - ts);
        if (delta <= NAV_SUPPRESS_MS) return true;
        if (navTimes[i] > ts + NAV_SUPPRESS_MS) return false;
      }
      return false;
    }

    const keyEvents = keyEventsRaw.filter(ev => {
      if (ev.kind !== "unknown") return true;
      return !hasNearbyNav(ev.ts);
    });

    if (keyEvents.length === 0) {
      return { tokens: [], debug: ["no keydown records"] };
    }

    const startTime = Number.isFinite(logs.header_records?.starttime)
      ? logs.header_records.starttime
      : keyEvents[0].ts;
    const endTime = Number.isFinite(logs.header_records?.endtime)
      ? logs.header_records.endtime
      : keyEvents[keyEvents.length - 1].ts;

    const threshold = Math.max(0, Number(thresholdOverride ?? pauseThresholdInput?.value) || 0);
    let lastTime = startTime;
    let currentPos = 0;
    let currentText = "";
    let currentExpected = "";

    outputParts.push({ type: "marker", value: "<START>", reasons: ["marker start"], actualText: "" });
    lastToken = outputParts[0];

    keyEvents.forEach(ev => {
      const delta = ev.ts - lastTime;
      if (delta > 0) {
        const secs = delta / 1000;
        if (secs >= threshold) pushPause(secs, currentExpected);
      }

      const expectedBefore = expectedTextAt(ev.ts);
      const catchUp = buildCatchUpTokens(currentText, expectedBefore);
      if (catchUp.length) {
        const token = catchUp[0];
        if (Number.isFinite(token.applyPos) && currentPos !== token.applyPos) {
          pushToken({
            type: "nav",
            pos: token.applyPos,
            reasons: [`catch-up nav to ${token.applyPos}`]
          }, expectedBefore);
          currentPos = token.applyPos;
        }
        pushToken(token, expectedBefore);
        if (token.type === "text") {
          currentText = `${currentText.slice(0, currentPos)}${token.value}${currentText.slice(currentPos)}`;
          currentPos += token.value.length;
        } else if (token.type === "delete") {
          currentText = `${currentText.slice(0, currentPos)}${currentText.slice(currentPos + token.count)}`;
        }
      }

      currentExpected = expectedTextAfter(ev.ts);
      const cursorPos = cursorBefore(ev.ts);
      if (ev.kind === "navkey") {
        pushToken({ type: "navkey", code: ev.code, key: ev.key, reasons: [`keydown ${ev.key}`] }, currentExpected);
        if (ev.code === "LEFT") currentPos = Math.max(0, currentPos - 1);
        if (ev.code === "RIGHT") currentPos += 1;
        if (ev.code === "CR") {
          currentText = `${currentText.slice(0, currentPos)}\n${currentText.slice(currentPos)}`;
          currentPos += 1;
        }
      } else {
        const token = simpleKeyDiff(ev.ts, ev.key, currentPos);
        const suppressCursorNav = keyLabelIsBackspace(ev.key) || keyLabelIsDelete(ev.key);
        const deleteToken = token && token.token && token.token.type === "delete";
        if (Number.isFinite(cursorPos) && cursorPos !== currentPos && !suppressCursorNav && !deleteToken) {
          pushToken({
            type: "nav",
            pos: cursorPos,
            reasons: [`cursor record move to ${cursorPos}`]
          }, currentExpected);
          currentPos = cursorPos;
        }
        if (token) {
          if (token.navToken) {
            if (currentPos !== token.navToken.pos) {
              pushToken(token.navToken, currentExpected);
              currentPos = token.navToken.pos;
            }
          }
          pushToken(token.token, currentExpected);
          if (token.token.type === "text") {
            if (Number.isFinite(token.token.applyPos) && currentPos !== token.token.applyPos) {
              currentPos = token.token.applyPos;
            }
            currentText = `${currentText.slice(0, currentPos)}${token.token.value}${currentText.slice(currentPos)}`;
            currentPos += token.token.value.length;
          } else if (token.token.type === "delete") {
            if (Number.isFinite(token.token.applyPos) && currentPos !== token.token.applyPos) {
              currentPos = token.token.applyPos;
            }
            currentText = `${currentText.slice(0, currentPos)}${currentText.slice(currentPos + token.token.count)}`;
          }
        } else {
          if (!suppressCursorNav) {
            pushToken({ type: "unknown", reasons: [`keydown ${ev.key} no simple diff`] }, currentExpected);
            currentText = `${currentText.slice(0, currentPos)}?${currentText.slice(currentPos)}`;
            currentPos += 1;
          }
        }
      }

      const expected = expectedTextAfter(ev.ts);
      if (expected !== currentText) {
        monitorLines.push(`CHECK ${ev.ts} mismatch expected_len=${expected.length} actual_len=${currentText.length}`);
      } else {
        monitorLines.push(`CHECK ${ev.ts} ok len=${currentText.length}`);
      }

      lastTime = ev.ts;
    });

    const finalDelta = endTime - lastTime;
    if (finalDelta > 0) {
      const secs = finalDelta / 1000;
      if (secs >= threshold) pushPause(secs);
    }

    outputParts.push({ type: "marker", value: "<END>", reasons: ["marker end"], actualText: currentExpected });

    const debug = buildDebugLines(outputParts);
    const combinedDebug = debug.concat(monitorLines);
    const mismatches = monitorLines.filter(line => line.includes("mismatch")).length;
    return { tokens: outputParts, debug: combinedDebug, mismatches };
  }

  function tokenToText(token) {
    if (token.type === "navkey") {
      const count = token.count || 1;
      return count > 1 ? `<${token.code}${count}>` : `<${token.code}>`;
    }
    if (token.type === "nav") return `<NAV,${token.pos}>`;
    if (token.type === "unknown") return "x";
    if (token.type === "text") return String(token.value).replace(/ /g, "<SPACE>");
    if (token.type === "delete") return token.count > 1 ? `<DELETE${token.count}>` : "<DELETE>";
    if (token.type === "pause") return token.value;
    return token.value;
  }

  function buildDebugLines(tokens) {
    return tokens.map(token => {
      const text = tokenToText(token);
      const reasons = token.reasons && token.reasons.length ? token.reasons.join("; ") : "no reason";
      return `${text} :: ${reasons}`;
    });
  }

  function buildLinear({ logs, entries }) {
    const data = buildLinearData({ logs, entries });
    if (!data.tokens.length) {
      linearOutput.innerHTML = "";
      linearStatus.textContent = data.debug[0] || "No output.";
      if (linearCompare) linearCompare.textContent = "";
      lastBuild = { logs, entries };
      return;
    }

    const output = data.tokens.map((token, index) => {
      const attrs = `data-index="${index}" tabindex="0"`;
      if (token.type === "navkey") {
        const count = token.count || 1;
        const value = count > 1 ? `<${token.code}${count}>` : `<${token.code}>`;
        return `<span ${attrs} class="linear-token linear-nav">${escapeHtml(value)}</span>`;
      }
      if (token.type === "unknown") {
        return `<span ${attrs} class="linear-token linear-insert">x</span>`;
      }
      if (token.type === "nav") {
        const value = `<NAV,${token.pos}>`;
        return `<span ${attrs} class="linear-token linear-nav">${escapeHtml(value)}</span>`;
      }
      if (token.type === "text") {
        const value = String(token.value).replace(/ /g, "<SPACE>");
        return `<span ${attrs} class="linear-token linear-insert">${escapeHtml(value)}</span>`;
      }
      if (token.type === "delete") {
        const value = token.count > 1 ? `<DELETE${token.count}>` : "<DELETE>";
        return `<span ${attrs} class="linear-token linear-delete">${escapeHtml(value)}</span>`;
      }
      if (token.type === "pause") {
        return `<span ${attrs} class="linear-token linear-time">${escapeHtml(token.value)}</span>`;
      }
      return `<span ${attrs} class="linear-token linear-marker">${escapeHtml(token.value)}</span>`;
    }).join("");

    linearOutput.innerHTML = output;
    const keyCount = (logs.key_records && Object.keys(logs.key_records).length) || 0;
    linearStatus.textContent = `Events: ${keyCount} | mismatches: ${data.mismatches || 0}`;
    lastBuild = { logs, entries, tokens: data.tokens };
  }

  function applyTokenState(state, token) {
    if (!token) return;
    if (token.type === "nav") {
      state.pos = Math.max(0, token.pos);
      return;
    }
    if (token.type === "navkey") {
      const count = token.count || 1;
      if (token.code === "LEFT") state.pos = Math.max(0, state.pos - count);
      if (token.code === "RIGHT") state.pos += count;
      if (token.code === "CR") {
        for (let i = 0; i < count; i += 1) {
          state.text = `${state.text.slice(0, state.pos)}\n${state.text.slice(state.pos)}`;
          state.pos += 1;
        }
      }
      return;
    }
    if (token.type === "text") {
      if (Number.isFinite(token.applyPos) && state.pos !== token.applyPos) {
        state.pos = Math.max(0, token.applyPos);
      }
      state.text = `${state.text.slice(0, state.pos)}${token.value}${state.text.slice(state.pos)}`;
      state.pos += token.value.length;
      return;
    }
    if (token.type === "unknown") {
      state.text = `${state.text.slice(0, state.pos)}?${state.text.slice(state.pos)}`;
      state.pos += 1;
      return;
    }
    if (token.type === "delete") {
      if (Number.isFinite(token.applyPos) && state.pos !== token.applyPos) {
        state.pos = Math.max(0, token.applyPos);
      }
      state.text = `${state.text.slice(0, state.pos)}${state.text.slice(state.pos + token.count)}`;
    }
  }

  function rebuildToIndex(tokens, index) {
    const state = { text: "", pos: 0 };
    for (let i = 0; i <= index; i += 1) {
      applyTokenState(state, tokens[i]);
    }
    return state.text;
  }

  function renderCompare(actual, reconstructed) {
    const a = String(actual || "");
    const b = String(reconstructed || "");
    const max = Math.max(a.length, b.length);
    const row = (label, text, compare) => {
      const cells = [];
      for (let i = 0; i < max; i += 1) {
        const ch = i < text.length ? text[i] : " ";
        const other = i < compare.length ? compare[i] : " ";
        const diff = ch !== other;
        cells.push(`<span class="linear-compare-cell${diff ? " diff" : ""}">${escapeHtml(ch)}</span>`);
      }
      return `<div class="linear-compare-row"><div class="linear-compare-label">${label}</div><div class="linear-compare-line">${cells.join("")}</div></div>`;
    };
    return [
      "<div class=\"linear-compare-grid\">",
      row("Reconstructed", b, a),
      row("Actual", a, b),
      "</div>"
    ].join("");
  }

  function clearLinear(message) {
    linearOutput.innerHTML = "";
    linearStatus.textContent = message || "";
    if (linearCompare) linearCompare.textContent = "";
    lastBuild = null;
  }

  if (pauseThresholdInput) {
    pauseThresholdInput.addEventListener("input", () => {
      if (lastBuild) buildLinear(lastBuild);
    });
  }

  window.tlogReplayLinear = {
    buildLinear,
    buildLinearDebug: buildLinearData,
    buildLinearStep: (args) => {
      const data = buildLinearData(args);
      if (!data.tokens.length) return [];
      const steps = [];
      const state = { text: "", pos: 0 };
      data.tokens.forEach((token, index) => {
        applyTokenState(state, token);
        steps.push({
          index,
          token: tokenToText(token),
          actual: token.actualText ?? "",
          reconstructed: state.text
        });
      });
      return steps;
    },
    clearLinear
  };

  if (linearOutput) {
    linearOutput.addEventListener("click", (e) => {
      const target = e.target.closest ? e.target.closest(".linear-token") : null;
      if (!target || !lastBuild || !lastBuild.tokens) return;
      const index = Number(target.dataset.index);
      if (!Number.isFinite(index)) return;
      const token = lastBuild.tokens[index];
      const reconstructed = rebuildToIndex(lastBuild.tokens, index);
      const actual = token?.actualText ?? "";
      if (linearCompare) {
        linearCompare.innerHTML = renderCompare(actual, reconstructed);
      }
    });
  }
})();
