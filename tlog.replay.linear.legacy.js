(() => {
  const linearOutput = document.getElementById("linearOutput");
  const linearStatus = document.getElementById("linearStatus");
  const pauseThresholdInput = document.getElementById("pauseThreshold");
  if (!linearOutput || !linearStatus) return;
  if (typeof diff_match_patch === "undefined") {
    linearStatus.textContent = "diff_match_patch not loaded.";
    return;
  }

  const dmp = new diff_match_patch();
  let lastBuild = null;

  function toSortedEvents(records) {
    return Object.entries(records || {})
      .map(([ts, value]) => ({ ts: Number(ts), value }))
      .filter(e => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);
  }

  function parseKeyRecord(value) {
    const parts = String(value || "").split(":");
    if (parts.length < 2) return null;
    const kind = parts[0].trim();
    const key = parts.slice(1).join(":").trim();
    return { kind, key };
  }

  function navCodeFromKey(key) {
    const k = String(key || "").toLowerCase();
    if (k === "arrowleft" || k === "left") return "LEFT";
    if (k === "arrowright" || k === "right") return "RIGHT";
    if (k === "arrowup" || k === "up") return "UP";
    if (k === "arrowdown" || k === "down") return "DOWN";
    if (k === "enter" || k === "return") return "CR";
    if (k === "click" || k === "mouse") return "CLICK";
    return null;
  }

  function isTypingKey(key) {
    const k = String(key || "");
    if (k.length === 1) return true;
    const lower = k.toLowerCase();
    return lower === "space" || lower === "backspace" || lower === "delete";
  }

  function diffTokens(prevText, currText, cursorPos) {
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
    if (userIndex === -1 && ops.length) {
      userIndex = ops.length - 1;
    }

    const tokens = [];
    for (let i = 0; i < ops.length; i += 1) {
      const op = ops[i];
      const isUser = i === userIndex;
      const next = ops[i + 1];

      if (!isUser && op.type === "delete" && next && next.type === "insert" && i + 1 !== userIndex) {
        tokens.push({ type: "auto", value: `<AUTO,${op.text}:${next.text}>` });
        i += 1;
        continue;
      }

      if (isUser) {
        if (op.type === "insert") {
          tokens.push({ type: "text", value: op.text });
        } else if (op.type === "delete") {
          const len = op.text.length;
          tokens.push({ type: "delete", count: len });
        }
      } else if (op.type === "insert") {
        tokens.push({ type: "auto", value: `<AUTO,${op.text}>` });
      } else if (op.type === "delete") {
        const len = op.text.length;
        tokens.push({ type: "auto", value: len > 1 ? `<AUTO,DELETE${len}>` : "<AUTO,DELETE>" });
      }
    }

    return tokens;
  }

  function formatPause(ms) {
    const secs = Math.max(0, ms / 1000);
    return `<${secs.toFixed(2)}>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[ch]));
  }

  function buildLinear({ logs, entries }) {
    if (!logs || !entries || entries.length === 0) {
      linearOutput.innerHTML = "";
      linearStatus.textContent = "No text records for this note.";
      return;
    }

    const cursorPosAtTs = new Map();
    toSortedEvents(logs.cursor_records).forEach(ev => {
      const parts = String(ev.value || "").split(":");
      const start = Number(parts[0]);
      if (Number.isFinite(start)) cursorPosAtTs.set(ev.ts, start);
    });

    const textEvents = entries.map((entry, idx) => {
      const prevText = idx === 0 ? "" : entries[idx - 1].text;
      const cursorPos = cursorPosAtTs.has(entry.ts) ? cursorPosAtTs.get(entry.ts) : null;
      const tokens = diffTokens(prevText, entry.text || "", cursorPos);
      return { ts: entry.ts, kind: "text", tokens };
    }).filter(e => e.tokens.length > 0);

    const textTsSet = new Set(entries.map(entry => entry.ts));

    const cursorEvents = toSortedEvents(logs.cursor_records)
      .map(ev => {
        const parts = String(ev.value || "").split(":");
        const start = Number(parts[0]);
        const end = Number(parts[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        return { ts: ev.ts, start, end, value: `${start}:${end}` };
      })
      .filter(Boolean);

    const allKeyEvents = toSortedEvents(logs.key_records)
      .map(ev => {
        const parsed = parseKeyRecord(ev.value);
        if (!parsed) return null;
        return { ts: ev.ts, kind: parsed.kind, key: parsed.key };
      })
      .filter(Boolean);

    const keyEvents = allKeyEvents
      .map(ev => {
        const code = navCodeFromKey(ev.key);
        if (!code) return null;
        return { ts: ev.ts, kind: ev.kind, code };
      })
      .filter(Boolean);

    const typingKeydowns = allKeyEvents
      .filter(ev => ev.kind === "keydown")
      .filter(ev => !navCodeFromKey(ev.key) && isTypingKey(ev.key))
      .map(ev => ev.ts)
      .sort((a, b) => a - b);

    const nonNavKeydowns = allKeyEvents
      .filter(ev => ev.kind === "keydown")
      .filter(ev => !navCodeFromKey(ev.key))
      .map(ev => ev.ts)
      .sort((a, b) => a - b);

    function hasRecentTypingKey(ts, windowMs) {
      if (!typingKeydowns.length) return false;
      let lo = 0;
      let hi = typingKeydowns.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const v = typingKeydowns[mid];
        if (v <= ts) {
          if (ts - v <= windowMs) return true;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return false;
    }

    function hasRecentNonNavKey(ts, windowMs) {
      if (!nonNavKeydowns.length) return false;
      let lo = 0;
      let hi = nonNavKeydowns.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const v = nonNavKeydowns[mid];
        if (v <= ts) {
          if (ts - v <= windowMs) return true;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return false;
    }

    const keyRanges = [];
    const keyDownMap = {};
    const keyDownTimes = [];
    keyEvents.forEach(ev => {
      if (ev.kind === "keydown") {
        keyDownMap[ev.code] = ev.ts;
        keyDownTimes.push({ code: ev.code, ts: ev.ts });
      } else if (ev.kind === "keyup") {
        const start = keyDownMap[ev.code];
        if (Number.isFinite(start) && ev.ts >= start) {
          keyRanges.push({ code: ev.code, start, end: ev.ts });
        }
        delete keyDownMap[ev.code];
      }
    });

    const navEventsRaw = keyEvents
      .filter(ev => ev.kind === "keydown" || ev.kind === "repeat")
      .map(ev => ({ ts: ev.ts, kind: "nav", code: ev.code }));

    const cursorValueTextTimes = new Map();
    cursorEvents.forEach(ev => {
      if (!textTsSet.has(ev.ts)) return;
      if (!cursorValueTextTimes.has(ev.value)) cursorValueTextTimes.set(ev.value, []);
      cursorValueTextTimes.get(ev.value).push(ev.ts);
    });
    cursorValueTextTimes.forEach(list => list.sort((a, b) => a - b));

    function hasNearbyTextCursor(value, ts, windowMs) {
      const list = cursorValueTextTimes.get(value);
      if (!list || list.length === 0) return false;
      let lo = 0;
      let hi = list.length - 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const v = list[mid];
        if (Math.abs(v - ts) <= windowMs) return true;
        if (v < ts) lo = mid + 1;
        else hi = mid - 1;
      }
      return false;
    }

    const filteredCursorEvents = [];
    let lastCursorValue = null;
    const NEAR_TEXT_MS = 80;
    const NAV_FUZZ_MS = 30;
    const TYPING_FUZZ_MS = 150;
    const NON_NAV_SUPPRESS_MS = 200;
    const matchedKeydownTimes = new Set();
    cursorEvents.forEach(ev => {
      if (textTsSet.has(ev.ts)) return;
      if (ev.value === lastCursorValue) return;
      lastCursorValue = ev.value;

      if (ev.start !== ev.end) {
        filteredCursorEvents.push({ ts: ev.ts, kind: "sel", start: ev.start, end: ev.end });
        return;
      }

      if (hasNearbyTextCursor(ev.value, ev.ts, NEAR_TEXT_MS)) return;
      if (hasRecentTypingKey(ev.ts, TYPING_FUZZ_MS)) return;
      if (hasRecentNonNavKey(ev.ts, NON_NAV_SUPPRESS_MS)) return;

      const match = keyRanges.find(range => ev.ts >= range.start && ev.ts <= range.end);
      if (match) {
        filteredCursorEvents.push({ ts: ev.ts, kind: "nav", code: match.code });
        matchedKeydownTimes.add(match.start);
        return;
      }

      let fuzzyMatch = null;
      for (let i = keyDownTimes.length - 1; i >= 0; i -= 1) {
        const kd = keyDownTimes[i];
        const delta = ev.ts - kd.ts;
        if (delta < 0) continue;
        if (delta <= NAV_FUZZ_MS) {
          fuzzyMatch = kd;
          break;
        }
        if (delta > NAV_FUZZ_MS) break;
      }
      if (fuzzyMatch) {
        filteredCursorEvents.push({ ts: ev.ts, kind: "nav", code: fuzzyMatch.code });
        matchedKeydownTimes.add(fuzzyMatch.ts);
        return;
      }

      filteredCursorEvents.push({ ts: ev.ts, kind: "navpos", pos: ev.start });
    });

    const navEvents = navEventsRaw.filter(ev => !matchedKeydownTimes.has(ev.ts));
    const order = { nav: 0, text: 1, navpos: 2, sel: 3 };
    const events = [...textEvents, ...filteredCursorEvents, ...navEvents]
      .sort((a, b) => (a.ts - b.ts) || (order[a.kind] - order[b.kind]));

    const grouped = [];
    let i = 0;
    while (i < events.length) {
      const ev = events[i];
      if (ev.kind === "nav") {
        let count = 1;
        let endTs = ev.ts;
        let j = i + 1;
        while (j < events.length && events[j].kind === "nav" && events[j].code === ev.code) {
          count += 1;
          endTs = events[j].ts;
          j += 1;
        }
        grouped.push({ kind: "nav", code: ev.code, count, ts: ev.ts, endTs });
        i = j;
      } else {
        grouped.push({ ...ev, endTs: ev.ts });
        i += 1;
      }
    }

    const startTime = Number.isFinite(logs.header_records?.starttime)
      ? logs.header_records.starttime
      : grouped[0]?.ts || entries[0].ts;
    const endTime = Number.isFinite(logs.header_records?.endtime)
      ? logs.header_records.endtime
      : grouped[grouped.length - 1]?.endTs || entries[entries.length - 1].ts;

    const threshold = Math.max(0, Number(pauseThresholdInput?.value) || 0);
    let outputParts = [];
    let lastTime = startTime;
    let lastToken = null;

    function pushToken(token) {
      if (!token) return;
      if (!lastToken) {
        outputParts.push(token);
        lastToken = token;
        return;
      }
      if (token.type === "text" && lastToken.type === "text") {
        lastToken.value += token.value;
        outputParts[outputParts.length - 1] = lastToken;
        return;
      }
      if (token.type === "delete" && lastToken.type === "delete") {
        lastToken.count += token.count;
        outputParts[outputParts.length - 1] = lastToken;
        return;
      }
      if (token.type === "nav" && lastToken.type === "nav" && token.code === lastToken.code) {
        lastToken.count += token.count;
        outputParts[outputParts.length - 1] = lastToken;
        return;
      }
      if (token.type === "navpos" && lastToken.type === "navpos" && token.pos === lastToken.pos) {
        return;
      }
      if (token.type === "sel" && lastToken.type === "sel") {
        return;
      }
      outputParts.push(token);
      lastToken = token;
    }

    function pushPause(seconds) {
      outputParts.push({ type: "pause", value: `<${seconds.toFixed(2)}>` });
      lastToken = outputParts[outputParts.length - 1];
    }

    outputParts.push({ type: "marker", value: "<START>" });
    lastToken = outputParts[0];

    grouped.forEach(ev => {
      const delta = ev.ts - lastTime;
      if (delta > 0) {
        const secs = delta / 1000;
        if (secs >= threshold) {
          pushPause(secs);
        }
      }

      if (ev.kind === "text") {
        ev.tokens.forEach(token => {
          if (token.type === "text") {
            pushToken({ type: "text", value: token.value });
          } else if (token.type === "delete") {
            pushToken({ type: "delete", count: token.count });
          } else if (token.type === "auto") {
            pushToken({ type: "auto", value: token.value });
          }
        });
      } else if (ev.kind === "sel") {
        pushToken({ type: "sel", start: ev.start, end: ev.end });
      } else if (ev.kind === "navpos") {
        pushToken({ type: "navpos", pos: ev.pos });
      } else if (ev.kind === "nav") {
        pushToken({ type: "nav", code: ev.code, count: ev.count });
      }

      lastTime = ev.endTs;
    });

    const finalDelta = endTime - lastTime;
    if (finalDelta > 0) {
      const secs = finalDelta / 1000;
      if (secs >= threshold) pushPause(secs);
    }
    outputParts.push({ type: "marker", value: "<END>" });

    const output = outputParts.map(token => {
      if (token.type === "text") {
        return `<span class="linear-insert">${escapeHtml(token.value)}</span>`;
      }
      if (token.type === "delete") {
        const value = token.count > 1 ? `<DELETE${token.count}>` : "<DELETE>";
        return `<span class="linear-delete">${escapeHtml(value)}</span>`;
      }
      if (token.type === "auto") {
        return `<span class="linear-auto">${escapeHtml(token.value)}</span>`;
      }
      if (token.type === "nav") {
        const value = token.count > 1 ? `<${token.code}${token.count}>` : `<${token.code}>`;
        return `<span class="linear-nav">${escapeHtml(value)}</span>`;
      }
      if (token.type === "navpos") {
        const value = `<NAV,${token.pos}>`;
        return `<span class="linear-nav">${escapeHtml(value)}</span>`;
      }
      if (token.type === "sel") {
        const value = `<SEL,${token.start},${token.end}>`;
        return `<span class="linear-nav">${escapeHtml(value)}</span>`;
      }
      if (token.type === "pause") {
        return `<span class="linear-time">${escapeHtml(token.value)}</span>`;
      }
      return `<span class="linear-marker">${escapeHtml(token.value)}</span>`;
    }).join("");

    linearOutput.innerHTML = output;
    linearStatus.textContent = `Events: ${grouped.length}`;
    lastBuild = { logs, entries };
  }

  function clearLinear(message) {
    linearOutput.innerHTML = "";
    linearStatus.textContent = message || "";
    lastBuild = null;
  }

  if (pauseThresholdInput) {
    pauseThresholdInput.addEventListener("input", () => {
      if (lastBuild) buildLinear(lastBuild);
    });
  }

  window.tlogReplayLinear = {
    buildLinear,
    clearLinear
  };
})();
