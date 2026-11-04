// ---- History Module for Strata ------------------------------------
// Monkey-patching Strata functions to inject History logic
// Requires: app.js loaded first with window exports at the bottom
(function() {
   "use strict"; // Теперь этот strict относится ТОЛЬКО к этому блоку

// Берем зависимости из глобального объекта window
    const $ = window.$;
    const store = window.store;
    const toast = window.toast;
    const esc = window.esc;

    // Проверяем, что экспорты на месте
    if (!$ || !store) {
        console.error("[History] Missing dependencies from app.js. Ensure script order.");
        return;
    }
	// Keep window.messages synchronized with app.js internal messages
if (typeof window.setMessages === "function") {
    const originalSetMessages = window.setMessages;

    window.setMessages = function (newMessages) {
        const result = originalSetMessages.apply(this, arguments);
        window.messages = newMessages;
        return result;
    };
}
	
// ===== 1. PATCH: saveChat ==========================================
if (typeof window.saveChat === 'function') {
    const originalSaveChat = window.saveChat;
    window.saveChat = function () {
        const result = originalSaveChat.apply(this, arguments);
        // Пропускаем синхронизацию если явно запрещено (оптимизация New Chat)
        if (!window.__strata_history_skip_sync) {
            try { syncCurrentHistory(); } catch (e) { console.error("History sync failed", e); }
        }
        return result;
    };
} else {
    console.warn("[History] window.saveChat not found. Check app.js exports.");
}

// ===== 2. PATCH: New Chat button ================================
const newBtn = document.getElementById("new-btn");

if (newBtn && typeof newBtn.onclick === "function") {
    const originalNewChatHandler = newBtn.onclick;

    newBtn.onclick = function (e) {
        if (window.__strata_history_skip_sync) {
            return originalNewChatHandler.call(this, e);
        }

        // Сохраняем старый чат до очистки messages
        syncCurrentHistory();

        window.__strata_history_skip_sync = true;

        try {
            const result = originalNewChatHandler.call(this, e);

            // Новый пустой чат пока не сохраняем.
            // Следующее сообщение создаст отдельную запись.
            setCurrentHistoryId(null);

            return result;
        } finally {
            window.__strata_history_skip_sync = false;
        }
    };
} else {
    console.error("[History] Cannot patch new-btn onclick.");
}

// ===== 3. PATCH: openDrawer (без копипасты!) ========================
if (typeof window.openDrawer === 'function') {
    const originalOpenDrawer = window.openDrawer;
    window.openDrawer = function (open) {
        if (open) openHistory(false); // Закрываем историю при открытии настроек
        return originalOpenDrawer.apply(this, arguments);
    };
} else {
    console.warn("[History] window.openDrawer not found. Check app.js exports.");
}

// ===== History Storage Layer =======================================
let isSwitchingChat = false; // Флаг: идет загрузка чата из истории
let currentHistoryId = store.get("currentHistoryId", null);
let searchHighlights = [];
let currentHighlightIndex = -1;

// ============ Server storage ============
const SERVER = "/api/chats";
let localHistory = [];
let historyLoadState = "unknown";   // "unknown" | "ok" | "error"
const historyFilters = {
    pinnedOnly: !!store.get("historyPinnedOnly", false),
	aiMode: !!store.get("historyAiMode", false), // <--- НОВОЕ
    pageSize: 120,
    loadedPage: 0,
    hasMore: false,
    total: 0,
};
let searchSeq = 0;
let searchAbort = null;
let searchTimer = null;
let lastSearchResults = null;
let lastSearchQuery = "";

async function fetchWithRetry(url, options, retries = 3) {
    const delays = [1000, 2000, 4000];
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const r = await fetch(url, options);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r;
        } catch (e) {
            lastErr = e;
            if (i < retries) await new Promise(res => setTimeout(res, delays[i]));
        }
    }
    throw lastErr;
}

async function saveChatToServer(chat) {
    const body = {
        id: chat.id,
        title: chat.title,
		pinned: !!chat.pinned,
        created_at: new Date(chat.created).toISOString(),
        updated_at: new Date(chat.updated).toISOString(),
        model: chat.model || "unknown",
        source: chat.source || "native",
        original_id: chat.original_id ?? null,
        source_updated_at: chat.source_updated_at ?? null,
        source_message_count: chat.source_message_count ?? null,
        source_content_hash: chat.source_content_hash ?? null,
        source_content_hash_version: chat.source_content_hash_version ?? null,
		imported_at: chat.imported_at ? new Date(chat.imported_at).toISOString() : null,
        messages: chat.messages || []
    };
    if (chat.number != null) body.number = chat.number;
    try {
        await fetchWithRetry(`${SERVER}/${encodeURIComponent(chat.id)}`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body)
        });
    } catch (e) {
        console.error("[History] Save failed:", e);
        toast("error", "Not saved", "History server did not save the chat", 6000);
    }
}

async function deleteChatFromServer(id) {
    try {
        await fetchWithRetry(`${SERVER}/${encodeURIComponent(id)}`, {method: "DELETE"});
    } catch (e) {
        console.error("[History] Delete failed:", e);
        toast("error", "Not deleted", "History server did not delete the chat", 6000);
    }
}

async function fetchChatFromServer(id) {
    const r = await fetch(`${SERVER}/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}

async function loadHistoryFromServer(page = 0, append = false) {
    const params = new URLSearchParams();
    if (historyFilters.pinnedOnly) params.set("pinned_only", "true");
    params.set("page", String(page));
    params.set("page_size", String(historyFilters.pageSize));
    try {
        const r = await fetch(`${SERVER}?${params.toString()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const mapped = (data.chats || []).map(c => ({
            id: c.id, number: c.number, title: c.title, model: c.model,
            created: c.created_at ? new Date(c.created_at).getTime()
                     : (c.updated_at ? new Date(c.updated_at).getTime() : Date.now()),
            updated: c.updated_at ? new Date(c.updated_at).getTime() : Date.now(),
            message_count: c.message_count || 0,
            source: c.source ?? null,
            original_id: c.original_id ?? null,
            source_updated_at: c.source_updated_at ?? null,
            source_message_count: c.source_message_count ?? null,
            source_content_hash: c.source_content_hash ?? null,
            source_content_hash_version: c.source_content_hash_version ?? null,
            imported_at: c.imported_at ? new Date(c.imported_at).getTime() : null,
            source_created_at: c.source_created_at ?? null,
            pinned: !!c.pinned,
            has_card: !!c.has_card,      // <--- ДОБАВИТЬ
            summary: c.summary || "",    // <--- ДОБАВИТЬ
            ai_tags: c.ai_tags || [],    // <--- ДОБАВИТЬ
        }));
        if (append) {
            const seen = new Set(localHistory.map(h => h.id));
            for (const c of mapped) if (!seen.has(c.id)) localHistory.push(c);
        } else {
            localHistory = mapped;
        }
        historyFilters.loadedPage = page;
        historyFilters.hasMore = !!data.has_more;
        historyFilters.total = data.total || 0;
        localStorage.setItem('strata.history', JSON.stringify(localHistory));
        historyLoadState = "ok";
        if (!append && currentHistoryId && !localHistory.find(h => h.id === currentHistoryId)) {
            // Чат не на первой странице. Проверяем на сервере, существует ли он вообще.
            try {
                const check = await fetch(`${SERVER}/${encodeURIComponent(currentHistoryId)}`);
                if (check.ok) {
                    // Чат существует, просто он на другой странице. Восстанавливаем метаданные.
                    const full = await check.json();
                    localHistory.push({
                        id: currentHistoryId,
                        title: full.title || currentHistoryId,
                        model: full.model || "unknown",
                        created: full.created_at ? new Date(full.created_at).getTime() : Date.now(),
                        updated: full.updated_at ? new Date(full.updated_at).getTime() : Date.now(),
                        message_count: full.messages ? full.messages.length : 0,
                        source: full.source || "native",
                        pinned: !!full.pinned,
                        // messages не заполняем, lazy-load сработает при переключении
                    });
                    sortHistory();
                } else if (check.status === 404) {
                    // Вот теперь точно удалён
                    setCurrentHistoryId(null);
                    if (typeof window.setMessages === "function") window.setMessages([]);
                    if (typeof window.saveChat === "function" && !window.__strata_history_skip_sync) {
                        window.saveChat();
                    }
                    if (typeof window.renderChat === "function") window.renderChat();
                    toast("info", "Chat was deleted", "Starting a new chat");
                }
            } catch (e) {
                console.error("[History] Failed to verify chat existence:", e);
            }
        }
        renderHistory();
    } catch (e) {
        console.error("[History] Server unavailable:", e);
        toast("warn", "History server unavailable", "Archive will not load or save", 6000);
        if (!append) { localHistory = []; historyLoadState = "error"; renderHistory(); }
    }
}
window.loadHistoryFromServer = loadHistoryFromServer;

function refreshHistoryIfOpen() {
    const d = document.getElementById("history-drawer");
    if (d && d.dataset.open === "true") renderHistory();
}


function sortHistory() {
    localHistory.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.updated || 0) - (a.updated || 0);
    });
}

function restoreHistoryFilters() {
    const toolbar = document.querySelector(".st-history-toolbar");
    if (!toolbar) return;

    if (!document.getElementById("history-pinned-toggle")) {
        const btn = document.createElement("button");
        btn.id = "history-pinned-toggle";
        btn.type = "button";
        btn.className = "st-btn st-btn--secondary";
        btn.style.cssText = "flex-shrink:0;height:32px;padding:0 10px;font-size:12px;";
        btn.textContent = "★ Pinned only";
        btn.setAttribute("aria-pressed", String(historyFilters.pinnedOnly));
        if (historyFilters.pinnedOnly) btn.style.background = "var(--st-accent, #007bff)";
        btn.onclick = () => {
            historyFilters.pinnedOnly = !historyFilters.pinnedOnly;
            store.set("historyPinnedOnly", historyFilters.pinnedOnly);
            btn.setAttribute("aria-pressed", String(historyFilters.pinnedOnly));
            btn.style.background = historyFilters.pinnedOnly ? "var(--st-accent, #007bff)" : "";
            runSearchNow(); // Всегда перезапускаем поиск (сам поймет, пустой он или нет)
        };
        toolbar.appendChild(btn);
    }

    if (!document.getElementById("history-ai-toggle")) {
        const aiBtn = document.createElement("button");
        aiBtn.id = "history-ai-toggle";
        aiBtn.type = "button";
        aiBtn.className = "st-btn st-btn--secondary";
        aiBtn.style.cssText = "flex-shrink:0;height:32px;padding:0 10px;font-size:12px;";
        aiBtn.textContent = "AI";
        aiBtn.title = "Показывать саммари и теги";
        aiBtn.setAttribute("aria-pressed", String(historyFilters.aiMode));
        if (historyFilters.aiMode) aiBtn.style.background = "var(--st-accent, #007bff)";
        aiBtn.onclick = () => {
            historyFilters.aiMode = !historyFilters.aiMode;
            store.set("historyAiMode", historyFilters.aiMode);
            aiBtn.setAttribute("aria-pressed", String(historyFilters.aiMode));
            aiBtn.style.background = historyFilters.aiMode ? "var(--st-accent, #007bff)" : "";
            
            if (lastSearchResults) {
                renderSearchResults(lastSearchResults); // Обновляем текущие результаты поиска
            } else {
                renderHistory();
            }
        };
        toolbar.appendChild(aiBtn);
    }
}

function setCurrentHistoryId(id) {
    currentHistoryId = id;
    store.set("currentHistoryId", id);
    updateActiveChatHeader();
}

function updateActiveChatHeader() {
  const box = document.getElementById("chat-header");
  const titleEl = document.getElementById("chat-header-title");
  const metaEl = document.getElementById("chat-header-meta");
  if (!box || !titleEl || !metaEl) return;
  const chat = currentHistoryId ? getChatById(currentHistoryId) : null;
  if (!chat) {
    box.classList.add("st-chat-header--empty");
    titleEl.textContent = "New chat";
    metaEl.textContent = "";
    return;
  }
  box.classList.remove("st-chat-header--empty");
  titleEl.textContent = chat.title || "Untitled chat";
  const src = chat.source && chat.source !== "native" ? String(chat.source) : "";
  metaEl.textContent = src ? `Source: ${src}` : "";    // ← как было
}

function getAllChats() {
    return localHistory;
}

function getChatById(id) {
    return getAllChats().find((h) => h.id === id) || null;
}

// ✅ FIX от Swift: try-catch для защиты от переполнения localStorage
function addNewChat(chat) {
    chat.message_count = (chat.messages || []).length;
    localHistory.unshift(chat);
	sortHistory();
    saveChatToServer(chat);
    refreshHistoryIfOpen();
}

// ✅ FIX от Swift: try-catch для защиты от переполнения localStorage
async function saveHistoryChat(chat) {
    // Rename without a prior open: messages are lazily loaded, so they are absent
    // on the list object. Fetch the full chat so we do not overwrite them with [].
    if (!Array.isArray(chat.messages)) {
        let full;
        try {
            full = await fetchChatFromServer(chat.id);
        } catch (e) {
            console.error("[History] Cannot load chat before save:", e);
            toast("error", "Not saved", "Could not load the chat from the server");
            return false;
        }
        if (!Array.isArray(full.messages)) {
            console.error("[History] Server returned chat without messages:", chat.id);
            toast("error", "Not saved", "Server returned an invalid chat");
            return false;
        }
        chat.messages = full.messages;
    }
    chat.message_count = chat.messages.length;
    const index = localHistory.findIndex((h) => h.id === chat.id);
    if (index === -1) return false;
    localHistory[index] = chat;
	sortHistory();
    saveChatToServer(chat);
    refreshHistoryIfOpen();
    return true;
}

function deleteChatById(id) {
    const index = localHistory.findIndex((h) => h.id === id);
    if (index === -1) return false;
    localHistory.splice(index, 1);
    deleteChatFromServer(id);
    refreshHistoryIfOpen();
    return true;
}

// ===== Snapshot & Sync =============================================

function historySnapshot() {
    const msgs = window.messages || [];
    return msgs.map((m) => {
        const copy = { ...m };
        if (m.images) {
            copy.images = m.images.map((i) => {
                // Если url есть (даже если это длинный base64) - передаем его на сервер,
                // чтобы бэкенд вытащил файл в папку attachments.
                const hasUrl = !!i.url; 
                return {
                    ...i,
                    kind: i.kind || "image",
                    source: i.source || "native",
                    source_id: i.source_id ?? null,
                    name: i.name ?? null,
                    url: hasUrl ? i.url : null,
                    status: i.status || (hasUrl ? "available" : "missing")
                };
            });
        }
        if (m.files) {
            copy.files = m.files.map((f) => ({
                ...f,
                kind: f.kind || "file",
                source: f.source || "native",
                source_id: f.source_id ?? null,
                name: f.name ?? null,
                text: f.text ?? null,
                status: f.status || (f.text != null ? "available" : "missing")
            }));
        }
        return copy;
    });
}
function nextHistoryNumber() {
    const next = Number(store.get("historyNextNumber", 1)) || 1;
    store.set("historyNextNumber", next + 1);
    return next;
}



function saveCurrentToHistory() {
    const msgs = window.messages || [];
	console.log("[PHOENIX-DEBUG] saveCurrentToHistory CALLED, msgs.length=", msgs.length, "stack=", new Error().stack);
    if (!msgs.length) return null;
    const now = Date.now();
    const number = nextHistoryNumber();
    const chat = {
        id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
        number,
        title: `Чат ${String(number).padStart(4, "0")}`,
        model: window.__lastResponseModel
			|| (window.Providers.getProvider(store.get("provider", "strata")).id === "strata"
				  ? (window.lastMetrics?.engine?.model || window.health?.model)
				  : store.get("model_id", ""))
			|| "unknown",
        pinned: false,
		created: msgs[0].time || now,
        updated: msgs[msgs.length - 1].time || now,
        messages: historySnapshot(),
        source: "native",
        original_id: null,
        source_updated_at: null,
        source_message_count: null,
        source_content_hash: null,
        source_content_hash_version: null
    };
    addNewChat(chat);
    setCurrentHistoryId(chat.id);
	console.log("[PHOENIX-DEBUG] CREATED chat id=", chat.id, "number=", number);
    return chat.id;
}

function syncCurrentHistory() {
    if (isSwitchingChat) return; // Не сохраняем, если мы просто открываем чат
	const msgs = window.messages || [];
	console.log("[SYNC-DEBUG] msgs.length=", msgs.length, "currentHistoryId=", currentHistoryId);
    if (!msgs.length) return;
    const now = Date.now();
    if (!currentHistoryId) {
        saveCurrentToHistory();
        return;
    }
    const chat = localHistory.find((h) => h.id === currentHistoryId);
    if (!chat) {
        setCurrentHistoryId(null);
        saveCurrentToHistory();
        return;
    }
    const lastTimeRaw = msgs[msgs.length - 1].time;
	let lastTime;
	if (typeof lastTimeRaw === "string") {
		const parsed = new Date(lastTimeRaw).getTime();
		lastTime = isNaN(parsed) ? now : parsed;
	} else if (typeof lastTimeRaw === "number" && !isNaN(lastTimeRaw)) {
		lastTime = lastTimeRaw;
	} else {
		lastTime = now;
	}
	chat.updated = Math.max(chat.updated || 0, lastTime);
    chat.messages = historySnapshot();
    chat.message_count = chat.messages.length;

    // Обновляем модель только для нативных чатов, импортам не трогаем исторические данные
	if (chat.source === "native" || !chat.source) {
        chat.model = window.__lastResponseModel 
              || window.health?.model 
              || window.lastMetrics?.engine?.model
              || "unknown";
    }

    saveHistoryChat(chat);
}

// ===== History Drawer UI ===========================================
function openHistory(open) {
    if (open && typeof window.openDrawer === 'function') {
        window.openDrawer(false);
    }
    $("history-drawer").dataset.open = String(open);
    $("history-drawer").setAttribute("aria-hidden", String(!open));
    $("scrim").hidden = !open;
    if (open) renderHistory();
}

function historyDayKey(timestamp) {
    const d = new Date(timestamp);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function historyDayLabel(timestamp) {
    const now = new Date();
    const date = new Date(timestamp);
    const todayKey = historyDayKey(now);
    const dateKey = historyDayKey(date);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = historyDayKey(yesterday);
    if (dateKey === todayKey) return "Today";
    if (dateKey === yesterdayKey) return "Yesterday";
    return date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function historyTimeLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function historyCreatedDateLabel(timestamp) {
    const d = new Date(timestamp);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}.${mm}.${yy}`;
}

function renderHistory() {
    const searchEl = document.getElementById("history-search");
    const q = searchEl ? searchEl.value.trim() : "";
    if (q) {
        if (lastSearchResults && lastSearchQuery === q) renderSearchResults(lastSearchResults);
        updateActiveChatHeader();
        return;
    }
    const list = $("history-list");
    if (!list) return;
    const history = getAllChats();
    if (!history.length) {
        list.innerHTML = `<div class="muted">No saved chats yet</div>`;
        updateActiveChatHeader();
        return;
    }
    
    // "Эффективная" дата: для свежих импортов (в пределах 24 часов) — imported_at,
    // иначе — updated или created. Это поднимает импорты наверх и группирует в "Сегодня".
    const now = Date.now();
    const NEW_WINDOW = 24 * 60 * 60 * 1000; // 24 часа
    const effectiveTime = (chat) => {
        const imp = chat.imported_at || 0;
        const upd = chat.updated || chat.created || 0;
        // если импорт свежий — показываем наверху
        if (imp && (now - imp) < NEW_WINDOW) return Math.max(imp, upd);
        return upd;
    };
    const isNewImport = (chat) => {
        const imp = chat.imported_at || 0;
        return imp && (now - imp) < NEW_WINDOW;
    };
    
    // 1. Функция сортировки по дате
    const byDate = (a, b) => effectiveTime(b) - effectiveTime(a);
    
    // 2. Разделяем на Pinned и обычные
    const pinnedChats = [...history].filter(c => c.pinned).sort(byDate);
    const unpinnedChats = [...history].filter(c => !c.pinned).sort(byDate);
    
    const groups = [];
    
    // 3. Сначала создаём группу для Pinned
    if (pinnedChats.length > 0) {
        groups.push({ label: "📌 Pinned", chats: pinnedChats });
    }
    
    // 4. Затем группируем остальные по дням
    for (const chat of unpinnedChats) {
        const timestamp = effectiveTime(chat);
        const label = historyDayLabel(timestamp);
        let group = groups.find((g) => g.label === label);
        if (!group) { group = { label, chats: [] }; groups.push(group); }
        group.chats.push(chat);
    }
    
    list.innerHTML = groups.map((group) => `
        <section class="history-group">
            <div class="history-group__title">${esc(group.label)}</div>
            <div class="history-group__items">
                ${group.chats.map((chat) => {
                    const isCurrent = chat.id === currentHistoryId;
                    const created = chat.created || Date.now();
                    const newBadge = isNewImport(chat)
                        ? `<span class="st-badge st-badge--reading" style="margin-left:6px;font-size:0.7em;padding:1px 5px;" title="Imported less than 24h ago">NEW</span>`
                        : "";
                    // Формируем AI-блок, если включен режим AI и есть данные
                    let aiHtml = "";
                    if (historyFilters.aiMode && chat.has_card) {
                        const summaryHtml = chat.summary 
                            ? `<div class="history-item__summary">${esc(chat.summary)}</div>` 
                            : "";
                        const tagsHtml = (chat.ai_tags && chat.ai_tags.length) 
                            ? `<div class="history-item__ai-tags">${chat.ai_tags.map(t => `<span class="tag-chip" data-history-tag="${esc(t)}">${esc(t)}</span>`).join("")}</div>` 
                            : "";
                        aiHtml = summaryHtml + tagsHtml;
                    }

                    return `
                        <div class="history-item${isCurrent ? " history-item--current" : ""}"
                             data-history-id="${esc(chat.id)}" data-pinned="${!!chat.pinned}">
                            <button type="button" class="history-item__open"
                                    data-history-open="${esc(chat.id)}">
                                <div class="history-item__title">
                                    <span class="history-item__title-text">${esc(chat.title)}</span>${newBadge}
                                </div>
                                <div class="history-item__meta">
                                    ${chat.message_count || 0} msgs · ${historyTimeLabel(created)} · ${historyCreatedDateLabel(created)}
                                </div>
                                ${aiHtml}
                            </button>
							<div class="history-item__actions">
								<button type="button" class="history-item__menu"
										data-history-menu="${esc(chat.id)}"
										aria-label="Chat actions" title="Chat actions">···</button>
                                <div class="history-item__popup" data-history-popup="${esc(chat.id)}" hidden>
                                    <button type="button" data-history-action="pin" data-history-id="${esc(chat.id)}">${chat.pinned ? "Unpin" : "Pin"}</button>
                                    <button type="button" data-history-action="rename" data-history-id="${esc(chat.id)}">Rename</button>
                                    <button type="button" data-history-action="info" data-history-id="${esc(chat.id)}">Info</button>
                                    <button type="button" data-history-action="delete" data-history-id="${esc(chat.id)}">Delete</button>
                                </div>
							</div>
                        </div>`;
                }).join("")}
            </div>
        </section>
    `).join("");
    if (historyFilters.hasMore) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "st-btn st-btn--secondary";
        more.style.cssText = "width:100%;margin-top:8px;font-size:12px;";
        more.textContent = `Load more (${localHistory.length}/${historyFilters.total})`;
        more.onclick = async () => {
            more.disabled = true;
            more.textContent = "Loading…";
            await loadHistoryFromServer(historyFilters.loadedPage + 1, true);
        };
        list.appendChild(more);
    } else if (localHistory.length > 0) {
        const info = document.createElement("div");
        info.className = "muted";
        info.style.cssText = "padding:8px 12px;font-size:11px;text-align:center;";
        info.textContent = `All ${localHistory.length} chats shown`;
        list.appendChild(info);
    }    
    updateActiveChatHeader();
	// Скроллим к текущему чату, если он есть в списке
    if (currentHistoryId) {
        setTimeout(() => {
            const el = document.querySelector(`[data-history-id="${CSS.escape(currentHistoryId)}"]`);
            if (el) el.scrollIntoView({ block: "center" });
        }, 10);
    }
}

// ===== Full-text search UI =========================================
function highlightSnippet(text, query) {
    if (!text) return "";
    if (!query) return esc(text);
    const lowerText = text.toLowerCase(), lowerQuery = query.toLowerCase();
    if (lowerText.indexOf(lowerQuery) === -1) return esc(text);
    const parts = [];
    let last = 0, i = 0;
    while ((i = lowerText.indexOf(lowerQuery, last)) !== -1) {
        if (i > last) parts.push(esc(text.slice(last, i)));
        parts.push(`<mark>${esc(text.slice(i, i + query.length))}</mark>`);
        last = i + query.length;
        if (last >= text.length) break;
    }
    if (last < text.length) parts.push(esc(text.slice(last)));
    return parts.join("");
}

function renderSearchResults(payload) {
    const list = $("history-list");
    if (!list || !payload) return;

    if (payload.error) {
        list.innerHTML = `<div class="muted" style="padding:8px 12px;">Search failed: ${esc(payload.error)}</div>`;
        return;
    }

    const query = payload.query || "";
    const results = payload.results || [];
    const took = payload.took_ms != null ? ` · ${payload.took_ms} ms` : "";
    const truncated = !!payload.truncated;
    const isSmartMode = payload.mode === "smart";

    if (!results.length) {
        list.innerHTML = `<div class="muted" style="padding:8px 12px;">No results for “${esc(query)}”${took}</div>`;
        return;
    }

    const header = truncated
        ? `Search results · first ${results.length}${took} — refine your query`
        : `Search results · ${results.length}${took}`;

    list.innerHTML = `
        <section class="history-group">
            <div class="history-group__title">${esc(header)}</div>
            <div class="history-group__items">
                ${results.map((r) => {
                    const local = getChatById(r.id);
                    const title = (local && local.title) || r.title || r.id;
                    const source = (local && local.source) || r.source;
                    const updatedMs = r.updated_at ? new Date(r.updated_at).getTime() : 0;
                    const dateStr = updatedMs ? historyCreatedDateLabel(updatedMs) : "";
                    
                    const isSmart = r.match_in === "card" || r.match_in === "tag";
                    const isPinned = !!(local && local.pinned); // Проверяем закреплен ли чат
                    
                    // Формируем сниппет
                    let snippetHtml = "";
                    if (isSmartMode) {
                        // В умном поиске показываем данные карточки
                        if (historyFilters.aiMode) {
                            if (r.snippet) {
                                snippetHtml = `<div class="history-item__snippet" style="border-left-color: #8b5cf6;">🤖 ${esc(r.snippet)}</div>`;
                            }
                            if (r.recall_cues && r.recall_cues.length) {
                                snippetHtml += `<div style="font-size: 11px; color: var(--st-ink-soft); margin-top: 4px;">Зацепки: ${esc((r.recall_cues || []).join(", "))}</div>`;
                            }
                        }
                    } else {
                        // В строгом поиске ВСЕГДА показываем точный сниппет с подсветкой
                        snippetHtml = `<div class="history-item__snippet">${highlightSnippet(r.snippet || "", query)}</div>`;
                    }
                    
                    return `
                        <!-- ВОТ ЗДЕСЬ ДОБАВЛЕН data-pinned -->
                        <div class="history-item${r.id === currentHistoryId ? " history-item--current" : ""}"
                             data-history-id="${esc(r.id)}" data-pinned="${isPinned}">
                            <button type="button" class="history-item__open"
                                    data-history-open="${esc(r.id)}"
                                    data-msg-index="${Number.isInteger(r.msg_index) ? r.msg_index : -1}">
                                <div class="history-item__title">
                                    <span class="history-item__title-text">${esc(title)}</span>
                                    ${isSmartMode ? '<span class="st-badge" style="margin-left:6px;font-size:0.7em;background:#8b5cf6;color:#fff;">AI</span>' : ''}
                                </div>
                                <div class="history-item__meta">
                                    ${r.message_count || 0} msgs · ${source ? `${esc(source)} · ` : ""}${dateStr ? `${esc(dateStr)}` : ""}
                                </div>
                                ${snippetHtml}
                            </button>
                            <div class="history-item__actions">
                                <button type="button" class="history-item__menu"
                                        data-history-menu="${esc(r.id)}"
                                        aria-label="Chat actions" title="Chat actions">···</button>
                                
                                <!-- А ВОТ ЗДЕСЬ ИСПРАВЛЕНЫ chat.id на r.id и chat.pinned на isPinned -->
                                <div class="history-item__popup" data-history-popup="${esc(r.id)}" hidden>
                                    <button type="button" data-history-action="pin" data-history-id="${esc(r.id)}">${isPinned ? "Unpin" : "Pin"}</button>
                                    <button type="button" data-history-action="rename" data-history-id="${esc(r.id)}">Rename</button>
                                    <button type="button" data-history-action="info" data-history-id="${esc(r.id)}">Info</button>
                                    <button type="button" data-history-action="delete" data-history-id="${esc(r.id)}">Delete</button>
                                </div>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        </section>
    `;
}

async function runSearchNow() {
    const input = document.getElementById("history-search");
    if (!input) return;
    const q = input.value.trim();
    searchSeq++;
    const mySeq = searchSeq;
    
    if (searchAbort) { try { searchAbort.abort(); } catch (e) {} searchAbort = null; }
    
    // Если поиск пуст — перезагружаем обычный список (с учетом pinned)
    if (!q) {
        lastSearchQuery = ""; 
        lastSearchResults = null;
        await loadHistoryFromServer(0, false);
        return;
    }
    
    searchAbort = new AbortController();
    try {
        const mode = document.getElementById("history-search-mode")?.value || "strict";
        const pinnedParam = historyFilters.pinnedOnly ? "&pinned_only=true" : "";
        const url = `${SERVER}/search?q=${encodeURIComponent(q)}&mode=${mode}${pinnedParam}`;
        
        const r = await fetch(url, {signal: searchAbort.signal});
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (mySeq !== searchSeq) return;
        
        lastSearchQuery = q; 
        lastSearchResults = data;
        renderSearchResults(data);
        
    } catch (e) {
        if (e && e.name === "AbortError") return;
        if (mySeq !== searchSeq) return;
        console.error("[History] Search failed:", e);
        lastSearchQuery = q;
        lastSearchResults = {results: [], query: q, error: String(e.message || e)};
        renderSearchResults(lastSearchResults);
        toast("error", "Search failed", String(e.message || e), 6000);
    } finally {
        if (mySeq === searchSeq) searchAbort = null;
    }
}

let highlightTimer = null;
function scheduleSearch() {
    searchSeq++;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchTimer = null;
        runSearchNow();
    }, 250);
    
    // Обновляем подсветку в открытом чате с задержкой 100мс
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
        highlightTimer = null;
        const searchInput = document.getElementById("history-search");
        if (searchInput) {
            highlightSearchMatches(searchInput.value.trim());
        }
    }, 100);
}

function showChatInfo(infoText) {
    // 1. Создаем темный фон на весь экран
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;";

    // 2. Создаем само окошко
    const modal = document.createElement("div");
    modal.style.cssText = "background:var(--st-surface, #fff);padding:16px;border-radius:8px;width:min(450px, 90vw);box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:12px;color:var(--st-ink, #000);";

    // 3. Заголовок
    const title = document.createElement("div");
    title.textContent = "Chat Info";
    title.style.cssText = "font-weight:600;font-size:14px;";

    // 4. Поле с текстом (только для чтения)
    const ta = document.createElement("textarea");
    ta.value = infoText;
    ta.readOnly = true;
    ta.style.cssText = "width:100%;height:160px;resize:none;font-family:var(--st-font-mono, monospace);font-size:12.5px;line-height:1.4;padding:10px;border:1px solid var(--st-line, #ccc);border-radius:6px;background:var(--st-surface-2, #f5f5f5);color:inherit;box-sizing:border-box;outline:none;";

    // 5. Кнопка закрытия
    const btn = document.createElement("button");
    btn.textContent = "Close";
    btn.className = "st-btn st-btn--primary"; // Используем ваши стили кнопки
    btn.style.cssText = "align-self:flex-end;padding:6px 16px;cursor:pointer;";
    
    // Логика закрытия
    const closeModal = () => document.body.removeChild(overlay);
    btn.onclick = closeModal;
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };

    // Сборка и показ
    modal.appendChild(title);
    modal.appendChild(ta);
    modal.appendChild(btn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Автоматически выделяем весь текст, чтобы можно было сразу нажать Ctrl+C
    ta.select();
}

function goToCurrentChat() {
    const input = document.getElementById("history-search");
    searchSeq++;
    if (searchAbort) { try { searchAbort.abort(); } catch (e) {} searchAbort = null; }
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    lastSearchQuery = ""; lastSearchResults = null;
    if (input) input.value = "";
    renderHistory();

    if (historyLoadState === "error") {
        toast("warn", "History server unavailable", "Cannot locate the current chat");
        return;
    }
    if (historyLoadState === "unknown") {
        toast("warn", "History not loaded yet");
        return;
    }
    if (!localHistory.length) {
        toast("info", "History is empty");
        return;
    }
    if (!currentHistoryId) return;
    if (!getChatById(currentHistoryId)) {
        setCurrentHistoryId(null);
        renderHistory();
        toast("warn", "Current chat is no longer in history");
        return;
    }
    const list = $("history-list");
    if (!list) return;
    const el = list.querySelector(`[data-history-id="${CSS.escape(currentHistoryId)}"]`);
    if (!el) return;
    const body = el.closest(".st-drawer__body");
    if (body) {
        const er = el.getBoundingClientRect(), br = body.getBoundingClientRect();
        const top = body.scrollTop + (er.top - br.top) - (br.height / 2) + (er.height / 2);
        body.scrollTo({top: Math.max(0, top), behavior: "smooth"});
    } else {
        el.scrollIntoView({block: "center", behavior: "smooth"});
    }
    el.classList.add("history-item--flash");
    setTimeout(() => el.classList.remove("history-item--flash"), 1300);
}

// ===== Load Chat ===================================================

async function loadHistoryChat(id) {
    let chat = getChatById(id);
    
    // Если чат не в локальном кэше (например, найден через умный поиск) — загружаем его!
    if (!chat) {
        try {
            const full = await fetchChatFromServer(id);
            chat = {
                id: id,
                number: full.number,
                title: full.title || id,
                model: full.model || "unknown",
                created: full.created_at ? new Date(full.created_at).getTime() : Date.now(),
                updated: full.updated_at ? new Date(full.updated_at).getTime() : Date.now(),
                message_count: full.messages ? full.messages.length : 0,
                source: full.source || "native",
                original_id: full.original_id || null,
                source_updated_at: full.source_updated_at || null,
                source_message_count: full.source_message_count || null,
                source_content_hash: full.source_content_hash || null,
                source_content_hash_version: full.source_content_hash_version || null,
                imported_at: full.imported_at ? new Date(full.imported_at).getTime() : null,
                source_created_at: full.source_created_at || null,
                pinned: !!full.pinned,
                // messages специально НЕ заполняем, чтобы сработал lazy-load ниже
            };
            localHistory.push(chat); // Добавляем в кэш, чтобы Info и рендер работали
        } catch (e) {
            console.error("[History] Failed to fetch chat metadata:", e);
            toast("error", "Cannot load chat", String(e.message || e), 6000);
            return false;
        }
    }

    // 1. Stop current stream if any
    const busy = window.getBusy ? window.getBusy() : null;
    if (busy) {
        if (busy.msg) busy.msg.stopped = true;
        if (busy.controller) busy.controller.abort();
        if (window.setBusyState) window.setBusyState(null);
        if (window.setBusy) window.setBusy(false);
    }

    // === СТАВИМ ФЛАГ ЗАГРУЗКИ (чтобы syncCurrentHistory не спамил сохранениями) ===
    isSwitchingChat = true;
    
    try {
        // 2. Save current chat before switching
        syncCurrentHistory();

        // 3. Lazy-load full messages from server if not in memory
        if (!chat.messages) {
            try {
                const full = await fetchChatFromServer(id);
                chat.messages = full.messages || [];
                // Нормализация: строки ISO → timestamp (мс)
                for (const m of chat.messages) {
                    if (m && typeof m.time === "string") {
                        const parsed = new Date(m.time).getTime();
                        if (!isNaN(parsed)) m.time = parsed;
                    }
                }
                if (full.created_at) chat.created = new Date(full.created_at).getTime();
                if (full.updated_at) chat.updated = new Date(full.updated_at).getTime();
                chat.message_count = chat.messages.length;
                if (full.source !== undefined) chat.source = full.source;
                if (full.original_id !== undefined) chat.original_id = full.original_id;
                if (full.source_updated_at !== undefined) chat.source_updated_at = full.source_updated_at;
                if (full.source_message_count !== undefined) chat.source_message_count = full.source_message_count;
                if (full.source_content_hash !== undefined) chat.source_content_hash = full.source_content_hash;
                if (full.source_content_hash_version !== undefined) chat.source_content_hash_version = full.source_content_hash_version;
                if (full.number !== undefined) chat.number = full.number;
            } catch (e) {
                console.error("[History] Load failed:", e);
                toast("error", "Cannot load chat", String(e), 6000);
                return false;
            }
        }

        // PR-2.6: для импортных чатов модель сообщения = source + ☁️.
        if (chat.source && chat.source !== "native") {
            for (const msg of chat.messages || []) {
                if (msg && msg.role === "assistant" && !msg.model) {
                    msg.model = chat.source + " ☁️";
                }
            }
        }
        
        // 4. Set messages and render
        if (typeof window.setMessages === 'function') {
            window.setMessages(chat.messages || []);
        } else {
            console.error("[History] window.setMessages not found!");
            return false;
        }

        setCurrentHistoryId(chat.id);
        window.saveChat();
        window.renderChat();
        renderHistory();
        toast("info", "Chat opened", chat.title);

        // Если чат открыт из поиска — включаем подсветку и автоскролл к первому слову
        const searchInput = document.getElementById("history-search");
        if (searchInput && searchInput.value.trim() !== "") {
            // Задержка 50мс нужна, чтобы браузер успел отрисовать DOM после renderChat()
            setTimeout(() => {
                highlightSearchMatches(searchInput.value.trim());
            }, 50);
        } else {
            clearSearchHighlights();
        }
        return true;
        
    } finally {
        // === СНИМАЕМ ФЛАГ (сработает в любом случае: успех, ошибка, return) ===
        isSwitchingChat = false;
    }
}

async function togglePin(id, newPinned) {
    try {
        const r = await fetch(`${SERVER}/${encodeURIComponent(id)}/pin`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({pinned: newPinned}),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        
        const chat = getChatById(id);
        if (chat) chat.pinned = newPinned;
        
        if (historyFilters.pinnedOnly && !newPinned) {
            localHistory = localHistory.filter(c => c.id !== id);
        }
        sortHistory();
        
        if (lastSearchResults) {
            // Если мы в поиске, нужно перезапустить поиск, чтобы обновить список
            runSearchNow();
        } else {
            renderHistory();
        }
        toast("info", newPinned ? "Pinned" : "Unpinned", "");
    } catch (err) {
        toast("error", "Pin failed", String(err.message || err));
    }
}

// Обработчик ПРАВОГО КЛИКА МЫШИ по чату
document.getElementById("history-list")?.addEventListener("contextmenu", (e) => {
    const item = e.target.closest(".history-item");
    if (!item) return;
    
    e.preventDefault(); // Отменяем стандартное меню браузера
    
    const id = item.dataset.historyId;
    const chat = getChatById(id);
    if (!chat) return;
    
    // Переключаем пин
    togglePin(id, !chat.pinned);
});



// ===== Event Listeners =============================================
$("history-list")?.addEventListener("click", async (e) => {
    // Клик по тегу (чипу) в режиме AI
    // Клик по тегу (чипа) в режиме AI
    const tagChip = e.target.closest("[data-history-tag]");
    if (tagChip) {
        e.stopPropagation();
        e.preventDefault();
        const tag = tagChip.dataset.historyTag;
        
        const searchInput = document.getElementById("history-search");
        const modeSelect = document.getElementById("history-search-mode");
        
        if (searchInput) {
            searchInput.value = tag;
            if (modeSelect) modeSelect.value = "smart"; // Включаем умный режим
            
            // Вызываем функцию напрямую (без window)
            runSearchNow(); 
            
            // И обновляем панель фильтров (чтобы появилась кнопка "Сохранить")
            loadSavedFilters();
        }
        return;
    }
    

    // Закрытие попапа при клике на него без кнопки действия
    const popup = e.target.closest(".history-item__popup");
    if (popup && !e.target.closest("[data-history-action]")) return;

    // Меню-кнопка (···)
    const menuButton = e.target.closest("[data-history-menu]");
    if (menuButton) {
        const id = menuButton.dataset.historyMenu;
        document.querySelectorAll("[data-history-popup]").forEach((p) => {
            p.hidden = true;
            p.classList.remove("history-item__popup--up");
        });
        const pop = document.querySelector(`[data-history-popup="${CSS.escape(id)}"]`);
        if (!pop) return;
        pop.hidden = false;
        const body = pop.closest(".st-drawer__body");
        if (body) {
            const popRect = pop.getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            if (popRect.bottom > bodyRect.bottom) pop.classList.add("history-item__popup--up");
        }
        return;
    }

    // Действия из попапа
    const actionButton = e.target.closest("[data-history-action]");
    if (actionButton) {
        const action = actionButton.dataset.historyAction;
        const id = actionButton.dataset.historyId;
        if (action === "pin") {
            const chat = getChatById(id);
            if (!chat) return;
            await togglePin(id, !chat.pinned);
            return;
        }		
        if (action === "rename") {
			const chat = getChatById(id);
			if (!chat) { toast("warn", "Chat not found"); return; }
			const newTitle = prompt("Новое название:", chat.title);
			if (newTitle === null || !newTitle.trim()) return;
			chat.title = newTitle.trim();
			const ok = await saveHistoryChat(chat);
			renderHistory();
			if (ok) toast("info", "Chat renamed", chat.title);
			return;
        }
		if (action === "info") {
			const chat = getChatById(id);
			if (!chat) return;
			
			const lines = [
				`ID: ${chat.id}`,
				`Файл: chats/${chat.id}.json`,
				`Источник: ${chat.source || 'native'}`,
			];
			
			const isImported = chat.source && chat.source !== "native";
			
			if (isImported) {
				if (chat.original_id && chat.original_id !== chat.id) {
					lines.push(`Оригинальный ID: ${chat.original_id}`);
				}
				const mc = chat.message_count || 0;
				const smc = chat.source_message_count;
				lines.push(`Сообщений: ${mc}${smc != null && smc !== mc ? ` (в источнике: ${smc})` : ''}`);
				
				if (chat.imported_at) {
					lines.push(`Импортирован: ${new Date(chat.imported_at).toLocaleString()}`);
				}
				if (chat.source_created_at) {
					const d = new Date(chat.source_created_at);
					if (!isNaN(d.getTime())) lines.push(`Создан в источнике: ${d.toLocaleString()}`);
				}
				if (chat.source_updated_at) {
					const d = new Date(chat.source_updated_at);
					if (!isNaN(d.getTime())) lines.push(`Обновлён в источнике: ${d.toLocaleString()}`);
				}
			} else {
				lines.push(`Сообщений: ${chat.message_count || 0}`);
				if (chat.created) lines.push(`Создан: ${new Date(chat.created).toLocaleString()}`);
				if (chat.updated) lines.push(`Изменён: ${new Date(chat.updated).toLocaleString()}`);
			}
			
			showChatInfo(lines.join("\n"));
			return;
		}
		if (action === "delete") {
			const chat = getChatById(id);
			if (!chat) { toast("warn", "Chat not found"); return; }
			if (!confirm(`Delete "${chat.title}" from History?`)) return;
			const wasCurrent = (currentHistoryId === id);
			console.log("[DELETE-DEBUG] before: id=", id, "currentHistoryId=", currentHistoryId,
                "wasCurrent=", wasCurrent, "messages.length=", (window.messages || []).length);
			deleteChatById(id);
			if (wasCurrent) {
				// FIX phoenix: чистим окно чата — иначе syncCurrentHistory
				// создаст новый чат с тем же содержимым.
				setCurrentHistoryId(null);
				if (typeof window.setMessages === "function") window.setMessages([]);
				console.log("[DELETE-DEBUG] after setMessages: messages.length=", (window.messages || []).length);
				if (typeof window.saveChat === "function" && !window.__strata_history_skip_sync) {
					window.saveChat();
				}
				console.log("[DELETE-DEBUG] after saveChat: messages.length=", (window.messages || []).length,
                    "currentHistoryId=", currentHistoryId);
				if (typeof window.renderChat === "function") window.renderChat();
			}
			renderHistory();
			toast("info", "Chat deleted", chat.title);
			return;
		}
        return;
    }

    // Закрытие открытого попапа при клике вне его
    const openPopup = document.querySelector("[data-history-popup]:not([hidden])");
    if (openPopup) {
        document.querySelectorAll("[data-history-popup]").forEach((p) => {
            p.hidden = true;
            p.classList.remove("history-item__popup--up");
        });
        e.stopPropagation();
        return;
    }

    // Открытие чата
    const openButton = e.target.closest("[data-history-open]");
    if (openButton) {
 
        const chatId = openButton.dataset.historyOpen;
        const msgIdx = Number(openButton.dataset.msgIndex);
        const ok = await loadHistoryChat(chatId);


    }
});

document.addEventListener("click", (e) => {
    if (e.target.closest("[data-history-popup], [data-history-menu]")) return;
    document.querySelectorAll("[data-history-popup]").forEach((p) => {
        p.hidden = true;
        p.classList.remove("history-item__popup--up");
    });
});

// ===== Init ========================================================
async function initHistory() {
    // Сбрасываем поиск при загрузке страницы, чтобы не висел старый
    const searchEl = document.getElementById("history-search");
    const modeSelect = document.getElementById("history-search-mode");
    if (modeSelect) {
        modeSelect.addEventListener("change", () => {
            const q = document.getElementById("history-search").value.trim();
            if (q) runSearchNow(); // Мгновенно перезапускаем поиск при смене режима
        });
    }
    if (searchEl) searchEl.value = "";
    clearSearchHighlights();

    injectTrashButton();
    restoreHistoryFilters();
    injectTrashButton();
	renderHistory();
    const btn = document.getElementById("history-btn");
    if (btn) {
        btn.onclick = () => {
            const drawer = document.getElementById("history-drawer");
            if (drawer) openHistory(drawer.dataset.open !== "true");
        };
    }
    const closeBtn = document.getElementById("history-drawer-close");
    if (closeBtn) closeBtn.onclick = () => openHistory(false);
    const searchInput = document.getElementById("history-search");
    if (searchInput) {
        searchInput.addEventListener("input", scheduleSearch);
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                if (searchInput.value) { searchInput.value = ""; runSearchNow(); }
                else openHistory(false);
            } else if (e.key === "Enter") {
                if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
                runSearchNow();
            }
        });
    }
    const modeSelectEl = document.getElementById("history-search-mode");
    if (modeSelectEl) {
        modeSelectEl.addEventListener("change", () => {
            const q = document.getElementById("history-search").value.trim();
            if (q) runSearchNow();
        });
    }
    const curBtn = document.getElementById("history-goto-current");
    if (curBtn) curBtn.onclick = goToCurrentChat;
    await loadHistoryFromServer(0, false);
    
}

// ===== Trash UI ====================================================
const TRASH_API = "/api/trash";

async function fetchTrashList() {
    const r = await fetch(TRASH_API);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}
async function restoreFromTrash(trashId) {
    const r = await fetch(`${TRASH_API}/${encodeURIComponent(trashId)}/restore`, {method: "POST"});
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).detail || m; } catch(e){} throw new Error(m); }
    return await r.json();
}
async function purgeTrashItem(trashId) {
    const r = await fetch(`${TRASH_API}/${encodeURIComponent(trashId)}`, {method: "DELETE"});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}
async function purgeAllTrash() {
    const r = await fetch(TRASH_API, {method: "DELETE"});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
}
function _fmtSize(b) {
    if (b == null) return "";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
}
function _fmtDate(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(); } catch(e) { return iso; }
}

function openTrash() {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;";
    const modal = document.createElement("div");
    modal.style.cssText = "background:var(--st-surface,#fff);padding:16px;border-radius:8px;width:min(720px,95vw);max-height:85vh;box-shadow:0 4px 12px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px;color:var(--st-ink,#000);";

    const header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;";
    const title = document.createElement("div");
    title.textContent = "🗑 Trash";
    title.style.cssText = "font-weight:600;font-size:16px;";
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.className = "st-btn st-btn--icon";
    closeBtn.onclick = () => document.body.removeChild(overlay);
    overlay.onclick = (e) => { if (e.target === overlay) closeBtn.onclick(); };
    header.appendChild(title);
    header.appendChild(closeBtn);

    const list = document.createElement("div");
    list.style.cssText = "flex:1;overflow-y:auto;min-height:200px;max-height:60vh;border:1px solid var(--st-line,#ddd);border-radius:6px;padding:8px;";

    const footer = document.createElement("div");
    footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
    const purgeAllBtn = document.createElement("button");
    purgeAllBtn.className = "st-btn st-btn--secondary";
    purgeAllBtn.textContent = "Empty Trash";
    purgeAllBtn.onclick = async () => {
        if (!confirm("Delete ALL items in Trash permanently? This cannot be undone.")) return;
        try {
            const res = await purgeAllTrash();
            toast("success", "Trash emptied", `${res.purged || 0} item(s) deleted`);
            renderTrashList(list);
        } catch (e) { toast("error", "Failed", String(e.message || e)); }
    };
    footer.appendChild(purgeAllBtn);

    modal.appendChild(header);
    modal.appendChild(list);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    renderTrashList(list);
}

async function renderTrashList(container) {
    container.innerHTML = `<div class="muted" style="padding:12px;">Loading…</div>`;
    let data;
    try { data = await fetchTrashList(); }
    catch (e) {
        container.innerHTML = `<div class="msg-error" style="padding:12px;">Failed to load: ${esc(String(e.message || e))}</div>`;
        return;
    }
    const items = data.items || [];
    if (!items.length) {
        container.innerHTML = `<div class="muted" style="padding:12px;">Trash is empty</div>`;
        return;
    }
    container.innerHTML = "";
    for (const it of items) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--st-line,#eee);";

        const info = document.createElement("div");
        info.style.cssText = "flex:1;min-width:0;";
        info.innerHTML = `
            <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(it.title || it.chat_id)}</div>
            <div class="muted" style="font-size:11px;">${esc(it.source || "native")} · ${it.message_count ?? "?"} messages · ${_fmtSize(it.size)} · deleted ${esc(_fmtDate(it.deleted_at))}</div>
        `;

        const restoreBtn = document.createElement("button");
        restoreBtn.className = "st-btn st-btn--secondary";
        restoreBtn.textContent = "Restore";
        restoreBtn.onclick = async () => {
            try {
                await restoreFromTrash(it.trash_id);
                toast("success", "Restored", it.title || it.chat_id);
                await loadHistoryFromServer();
                renderTrashList(container);
            } catch (e) { toast("error", "Restore failed", String(e.message || e)); }
        };

        const purgeBtn = document.createElement("button");
        purgeBtn.className = "st-btn st-btn--icon";
        purgeBtn.title = "Delete forever";
        purgeBtn.textContent = "🗑";
        purgeBtn.onclick = async () => {
            if (!confirm(`Delete "${it.title || it.chat_id}" forever?`)) return;
            try {
                await purgeTrashItem(it.trash_id);
                toast("info", "Deleted", it.title || it.chat_id);
                renderTrashList(container);
            } catch (e) { toast("error", "Delete failed", String(e.message || e)); }
        };

        row.appendChild(info);
        row.appendChild(restoreBtn);
        row.appendChild(purgeBtn);
        container.appendChild(row);
    }
}

function injectTrashButton() {
    if (document.getElementById("history-trash-btn")) return;
    const list = document.getElementById("history-list");
    if (!list || !list.parentNode) return;
    const btn = document.createElement("button");
    btn.id = "history-trash-btn";
    btn.type = "button";
    btn.className = "st-btn st-btn--secondary";
    btn.style.cssText = "width:100%;margin-bottom:8px;font-size:12px;";
    btn.textContent = "🗑 Trash";
    btn.onclick = () => openTrash();
    list.parentNode.insertBefore(btn, list);
}


initHistory();
async function branchChatAndOpen(sourceId, upToIndex) {
    const cloneId = await branchChat(sourceId, upToIndex);
    if (!cloneId) return null;
    const ok = await loadHistoryChat(cloneId);
    if (!ok) {
        toast("warn", "Branch saved but not opened", "Find it in the history list", 5000);
    }
    return cloneId;
}
window.branchChatAndOpen = branchChatAndOpen;



async function branchChat(sourceId, upToIndex) {
    const orig = getChatById(sourceId);
    if (!orig) { toast("warn", "Chat not found"); return null; }
    if (!Array.isArray(orig.messages)) {
        try {
            const full = await fetchChatFromServer(sourceId);
            orig.messages = full.messages || [];
            if (full.created_at) orig.created = new Date(full.created_at).getTime();
            if (full.updated_at) orig.updated = new Date(full.updated_at).getTime();
        } catch (e) {
            console.error("[Branch] Cannot load chat:", e);
            toast("error", "Cannot load chat", String(e.message || e), 6000);
            return null;
        }
    }
    const sliced = (orig.messages || []).slice(0, upToIndex + 1);
    if (!sliced.length) {
        toast("warn", "Nothing to branch", "No messages up to that point");
        return null;
    }
    const now = Date.now();
    const cloneId = now + "-" + Math.random().toString(36).slice(2, 8);
    const cloneTitle = (orig.title || "Untitled") + " · ветка";
    const cloneNumber = nextHistoryNumber();
    const cloneMessages = JSON.parse(JSON.stringify(sliced));
    const body = {
        id: cloneId,
        title: cloneTitle,
        created_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        model: "",
        source: "native",
        original_id: null,
        source_updated_at: null,
        source_message_count: null,
        source_content_hash: null,
        source_content_hash_version: null,
        number: cloneNumber,
        messages: cloneMessages,
    };
    let r;
    try {
        r = await fetchWithRetry(SERVER + "/" + encodeURIComponent(cloneId), {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(body),
        });
        if (r.status !== 200) throw new Error("HTTP " + r.status);
    } catch (e) {
        console.error("[Branch] Copy not created:", e);
        toast("error", "Branch not created", String(e.message || e), 6000);
        return null;
    }
    const clone = {
        id: cloneId,
        number: cloneNumber,
        title: cloneTitle,
        model: "",
        created: now,
        updated: now,
        message_count: cloneMessages.length,
        source: "native",
        original_id: null,
        source_updated_at: null,
        source_message_count: null,
        source_content_hash: null,
        source_content_hash_version: null,
        messages: cloneMessages,
    };
    localHistory.unshift(clone);
    refreshHistoryIfOpen();
    return cloneId;
}

// Экспорт для app.js (после импорта)
window.loadHistoryFromServer = loadHistoryFromServer;

const __continueInput = document.getElementById("input");
// ================= SEARCH HIGHLIGHT =================


function clearSearchHighlights() {
    searchHighlights = [];
    currentHighlightIndex = -1;
    const nav = document.getElementById("search-nav");
    if (nav) nav.style.display = "none";
}

function goToHighlight(index) {
    if (searchHighlights.length === 0) return;
    
    // Снимаем активный класс с предыдущего
    if (currentHighlightIndex >= 0 && currentHighlightIndex < searchHighlights.length) {
        searchHighlights[currentHighlightIndex].classList.remove('search-highlight-active');
    }
    
    // Зацикливаем навигацию
    if (index < 0) index = searchHighlights.length - 1;
    if (index >= searchHighlights.length) index = 0;
    
    currentHighlightIndex = index;
    const el = searchHighlights[index];
    el.classList.add('search-highlight-active');
    
    // Плавный скролл к центру экрана
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    
    document.getElementById("search-nav-count").textContent = `${index + 1} из ${searchHighlights.length}`;
}

function highlightSearchMatches(query) {
    clearSearchHighlights();
    
    // Убираем старые маркеры из DOM
    document.querySelectorAll('#chat mark.search-highlight').forEach(mark => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
    
    if (!query || query.length < 2) return;
    
    // Ищем ТОЧНУЮ ФРАЗУ, а не отдельные слова.
    // Заменяем пробелы на \s+, чтобы фраза находилась, даже если между словами перенос строки
    const escapedQuery = query.trim().split(/\s+/)
        .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s+');
        
    const regex = new RegExp(`(${escapedQuery})`, 'giu');
    const bubbles = document.querySelectorAll('#chat .st-bubble');
    
    bubbles.forEach(bubble => {
        const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null, false);
        const nodesToReplace = [];
        let node;
        
        while (node = walker.nextNode()) {
            if (node.parentNode.tagName === 'MARK') continue;
            if (node.nodeValue.search(regex) !== -1) {
                nodesToReplace.push(node);
            }
        }
        
        nodesToReplace.forEach(textNode => {
            const text = textNode.nodeValue;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            regex.lastIndex = 0;
            
            while ((match = regex.exec(text)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                const mark = document.createElement('mark');
                mark.className = 'search-highlight';
                mark.textContent = match[0];
                fragment.appendChild(mark);
                searchHighlights.push(mark);
                lastIndex = regex.lastIndex;
            }
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            textNode.parentNode.replaceChild(fragment, textNode);
        });
    });

    if (searchHighlights.length > 0) {
        document.getElementById("search-nav").style.display = "flex";
        goToHighlight(0);
    }
}

// Обработчики кнопок панели
if (document.getElementById("search-nav-prev")) {
    document.getElementById("search-nav-prev").onclick = () => goToHighlight(currentHighlightIndex - 1);
    document.getElementById("search-nav-next").onclick = () => goToHighlight(currentHighlightIndex + 1);
    document.getElementById("search-nav-close").onclick = () => {
        clearSearchHighlights();
        // Перерисовываем чат, чтобы убрать теги <mark> из DOM
        if (window.renderChat) window.renderChat();
    };
}
})();