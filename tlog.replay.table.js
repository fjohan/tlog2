(() => {
  const revisionTable = document.getElementById("revisionTable");
  const revisionStatus = document.getElementById("revisionStatus");
  if (!revisionTable || !revisionStatus) return;
  if (typeof diff_match_patch === "undefined") {
    revisionStatus.textContent = "diff_match_patch not loaded.";
    return;
  }

  const myDmp = new diff_match_patch();

  let text_record = {};
  let cursor_record = {};
  let header_record = {};
  let recordKeys = [];
  let prevClassification = "";
  let prevStartLocation = -1;
  let prevEndLocation = -1;
  let groupStartText = "";
  let groupStartTime = 0;

  function diff_prettyHtml_short(diffs, context) {
    var html = [];
    var pattern_amp = /&/g;
    var pattern_lt = /</g;
    var pattern_gt = />/g;
    var pattern_para = /\n/g;
    for (var x = 0; x < diffs.length; x++) {
      var op = diffs[x][0];
      var data = diffs[x][1];
      var text = data.replace(pattern_amp, "&amp;")
        .replace(pattern_lt, "&lt;")
        .replace(pattern_gt, "&gt;")
        .replace(pattern_para, "&para;<br>");
      switch (op) {
        case DIFF_INSERT:
          html[x] = '<ins style="background:#e6ffe6;">' + text + '</ins>';
          break;
        case DIFF_DELETE:
          html[x] = '<del style="background:#ffe6e6;">' + text + '</del>';
          break;
        case DIFF_EQUAL:
          if (x === 0) {
            html[x] = '<span>' + text.substring(text.length - context) + '</span>';
          } else {
            html[x] = '<span>' + text.substring(0, context) + '</span>';
          }
          break;
      }
    }
    return html.join('');
  }

  function classifyDiff(diff) {
    let hasInsertion = false;
    let hasDeletion = false;

    for (const d of diff) {
      if (d[0] === 1) {
        hasInsertion = true;
      } else if (d[0] === -1) {
        hasDeletion = true;
      }
    }

    if (hasInsertion && hasDeletion) {
      return 'REPLACE';
    } else if (hasInsertion) {
      return 'INSERT';
    } else if (hasDeletion) {
      return 'DELETE';
    } else {
      return 'NOCHANGE';
    }
  }

  function calculateLocation(diff, classification) {
    let start = -1;
    let end = -1;

    if (classification === 'INSERT' || classification === 'DELETE') {
      if (diff.length === 1) {
        start = 0;
        end = diff[0][1].length;
      } else {
        start = diff[0][1].length;
        end = start + diff[1][1].length;
      }
    } else if (classification === 'REPLACE') {
      if (diff.length === 2) {
        start = 0;
        end = diff[0][1].length;
      } else {
        start = diff[0][1].length;
        end = start + diff[2][1].length;
      }
    }

    return { start, end };
  }

  function checkNewGroup(classification, location, index) {
    const isNewClassification = classification !== prevClassification;

    let isNewLocation = false;
    if (classification === 'INSERT') {
      isNewLocation = location.start !== prevEndLocation;
    }
    if (classification === 'REPLACE') {
      isNewLocation = location.start !== prevEndLocation;
    }
    if (classification === 'DELETE') {
      isNewLocation = location.end !== prevStartLocation;
    }

    const isNewGroup = isNewClassification || isNewLocation;

    prevClassification = classification;
    prevStartLocation = location.start;
    prevEndLocation = location.end;

    if (isNewGroup) {
      groupStartText = text_record[recordKeys[index]];
    }

    return isNewGroup;
  }

  function computeSecondDiff(currentText, groupStartTextValue) {
    const secondDiff = myDmp.diff_main(groupStartTextValue, currentText);
    myDmp.diff_cleanupSemantic(secondDiff);
    return diff_prettyHtml_short(secondDiff, 20);
  }

  let groupTime = -1;

  function playFromRow(e, onSeek, timeInfo) {
    groupTime = Number(e.currentTarget.dataset.time);
    let textTime = -1;

    for (var t in text_record) {
      if (Number(t) < groupTime) {
        textTime = Number(t);
      }
    }

    if (typeof onSeek === "function") {
      if (textTime <= 0 && timeInfo && Number.isFinite(timeInfo.t0)) {
        onSeek(timeInfo.t0 - 1, timeInfo, false);
      } else if (textTime > -1) {
        onSeek(textTime, timeInfo, false);
      }
    }
  }

  function clearTable(message) {
    revisionTable.querySelector("tbody").innerHTML = "";
    revisionStatus.textContent = message || "";
  }

  function makeRevisionTable(onSeek, timeInfo) {
    const tbody = revisionTable.getElementsByTagName('tbody')[0];
    tbody.innerHTML='';
    text_record["0"] = '';
    recordKeys = Object.keys(text_record).sort((a, b) => Number(a) - Number(b));

    for (let i = 1; i < recordKeys.length; i++) {
      const previousText = text_record[recordKeys[i - 1]];
      const currentText = text_record[recordKeys[i]];

      const diff = myDmp.diff_main(previousText, currentText);
      myDmp.diff_cleanupSemantic(diff);

      const prettyHtml = diff_prettyHtml_short(diff, 20);
      const classification = classifyDiff(diff);
      const location = calculateLocation(diff, classification);
      const isNewGroup = checkNewGroup(classification, location, i - 1);
      const secondDiff = computeSecondDiff(currentText, groupStartText, location);

      if (isNewGroup) {
        groupStartTime = Number(recordKeys[i]);
        if (tbody.rows.length) {
          tbody.rows[tbody.rows.length - 1].className = 'last-in-group';
        }
      }

      const row = tbody.insertRow();
      const cell1 = row.insertCell(0);
      const cell2 = row.insertCell(1);
      const cell3 = row.insertCell(2);
      const cell4 = row.insertCell(3);
      const cell5 = row.insertCell(4);
      const cell6 = row.insertCell(5);
      const cell7 = row.insertCell(6);

      cell1.textContent = i;
      cell2.innerHTML = prettyHtml;
      cell3.textContent = classification;
      cell3.className = classification.toLowerCase();
      cell4.textContent = location.start + '-' + location.end;
      cell5.textContent = isNewGroup ? 'Yes' : 'No';
      cell5.className = isNewGroup ? 'new-group' : '';
      cell6.innerHTML = secondDiff;
      cell7.textContent = (groupStartTime - header_record['starttime']) / 1000.0;
      cell7.id = groupStartTime;
      row.dataset.time = String(groupStartTime);
    }

    if (tbody.rows.length) {
      tbody.rows[tbody.rows.length - 1].className = 'last-in-group';
    }

    const rows = tbody.getElementsByTagName('tr');
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].classList.contains('last-in-group')) {
        rows[i].style.display = 'none';
      }
    }

    delete text_record["0"];

    const playFromRows = tbody.getElementsByClassName('last-in-group');
    for (let i = 0; i < playFromRows.length; i++) {
      playFromRows[i].addEventListener('click', (e) => playFromRow(e, onSeek, timeInfo), false);
    }
  }

  function buildTable({ note, logs, entries, timeInfo, onSeek }) {
    if (!note) {
      clearTable("No note selected.");
      return;
    }

    if (!entries || entries.length === 0) {
      clearTable("No text records for this note.");
      return;
    }

    text_record = {};
    entries.forEach(entry => {
      text_record[String(entry.ts)] = String(entry.text || "");
    });
    cursor_record = logs.cursor_records || {};
    header_record = logs.header_records || { starttime: entries[0].ts };

    prevClassification = '';
    prevStartLocation = -1;
    prevEndLocation = -1;
    groupStartText = '';
    groupStartTime = Number(entries[0].ts);

    makeRevisionTable(onSeek, timeInfo);
    revisionStatus.textContent = 'Rows: ' + Object.keys(text_record).length;
  }

  window.tlogReplayTable = {
    buildTable,
    clearTable
  };
})();
