const elements = Object.fromEntries(["message","metrics","rooms","search","refresh","updated","detail","close-detail","detail-code","detail-title","detail-meta","participants","participants-count","tracks","tracks-count","reactions","reactions-count","activity","activity-count"].map((id) => [id, document.getElementById(id)]));
let overview = null;

function showMessage(message = "") {
  elements.message.hidden = !message;
  elements.message.textContent = message;
}

function date(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle:"medium", timeStyle:"short" }).format(new Date(value));
}

function text(tag, value, className = "") {
  const node = document.createElement(tag);
  node.textContent = value ?? "—";
  if (className) node.className = className;
  return node;
}

function renderMetrics(totals) {
  const values = [["Rooms",totals.rooms],["Live now",totals.liveRooms],["Humans",totals.participants],["Tracks",totals.tracks],["Reactions",totals.reactions]];
  elements.metrics.replaceChildren(...values.map(([label,value]) => {
    const card = document.createElement("article");
    card.className = "metric";
    card.append(text("strong",String(value)),text("span",label));
    return card;
  }));
}

function renderRooms() {
  const query = elements.search.value.trim().toLowerCase();
  const rooms = (overview?.rooms ?? []).filter((room) => !query || room.code.toLowerCase().includes(query) || room.title.toLowerCase().includes(query));
  if (!rooms.length) {
    elements.rooms.replaceChildren(text("p",query ? "No matching rooms." : "No parties have left evidence yet.","empty"));
    return;
  }
  elements.rooms.replaceChildren(...rooms.map((room) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "room";
    button.addEventListener("click",() => loadRoom(room.code));
    const copy = document.createElement("span");
    copy.className = "room-copy";
    copy.append(text("strong",room.title),text("span",`${date(room.createdAt)} · ${room.queueMode}`),text("span",`${room.participants} humans · ${room.tracks} tracks · ${room.reactions} reactions`,"room-stats"));
    const status = text("span",room.status,`status ${room.status}`);
    button.append(text("span",room.code,"room-code"),copy,status);
    return button;
  }));
}

function renderTable(target, columns, rows) {
  if (!rows.length) {
    target.replaceChildren(text("p","Nothing here yet.","empty"));
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of columns) headRow.append(text("th",column.label));
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) tr.append(text("td",column.format ? column.format(row[column.key],row) : row[column.key]));
    body.append(tr);
  }
  table.append(head,body);
  target.replaceChildren(table);
}

async function requestData(search = "") {
  const response = await fetch(`/api/data${search}`, { cache:"no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not read HackMusic data.");
  return data;
}

async function loadOverview() {
  elements.refresh.disabled = true;
  showMessage();
  try {
    overview = await requestData();
    renderMetrics(overview.totals);
    renderRooms();
    elements.updated.textContent = `Updated ${date(overview.generatedAt)}`;
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not load the database.");
  } finally {
    elements.refresh.disabled = false;
  }
}

async function loadRoom(code) {
  showMessage();
  try {
    const data = await requestData(`?code=${encodeURIComponent(code)}`);
    elements.detail.hidden = false;
    elements["detail-code"].textContent = `ROOM ${data.room.code}`;
    elements["detail-title"].textContent = data.room.title;
    elements["detail-meta"].textContent = `${data.room.status.toUpperCase()} · ${data.room.queueMode} queue · created ${date(data.room.createdAt)}`;
    elements["participants-count"].textContent = `${data.participants.length} rows`;
    elements["tracks-count"].textContent = `${data.submissions.length} rows`;
    elements["reactions-count"].textContent = `${data.reactions.length} rows`;
    elements["activity-count"].textContent = `${data.activity.length} rows`;
    renderTable(elements.participants,[{key:"name",label:"Name"},{key:"score",label:"Score"},{key:"joinedAt",label:"Joined",format:date}],data.participants);
    renderTable(elements.tracks,[{key:"title",label:"Track"},{key:"artist",label:"Artist"},{key:"submittedBy",label:"Added by"},{key:"status",label:"Status"},{key:"submittedAt",label:"When",format:date}],data.submissions);
    renderTable(elements.reactions,[{key:"kind",label:"Reaction",format:(value)=>value === "up" ? "🙌 Cheer" : "👻 Boo"},{key:"actor",label:"Person"},{key:"track",label:"Track"},{key:"createdAt",label:"When",format:date}],data.reactions);
    renderTable(elements.activity,[{key:"kind",label:"Event"},{key:"actor",label:"Person"},{key:"track",label:"Track"},{key:"createdAt",label:"When",format:date}],data.activity);
    elements.detail.scrollIntoView({ behavior:"smooth", block:"start" });
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "Could not load that room.");
  }
}

elements.search.addEventListener("input",renderRooms);
elements.refresh.addEventListener("click",loadOverview);
elements["close-detail"].addEventListener("click",() => { elements.detail.hidden = true; window.scrollTo({ top:0, behavior:"smooth" }); });
loadOverview();
