// ==UserScript==
// @name         Ozon Scraper - 类目树爬取工具
// @namespace    https://github.com/vision-png/ozon
// @version      3.0.0
// @description  手动采集 Ozon.ru 类目树结构，支持 CSV/Excel 导出
// @author       Qin Yucheng
// @match        https://www.ozon.ru/*
// @match        https://ozon.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @connect      ozon.ru
// @connect      www.ozon.ru
// @license      MIT
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/vision-png/ozon/main/ozon-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/vision-png/ozon/main/ozon-scraper.user.js
// @supportURL   https://github.com/vision-png/ozon/issues
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // Config
    // ============================================================
    const CONFIG = {
        baseUrl: 'https://www.ozon.ru',
    };

    // ============================================================
    // Category Selectors — multi-strategy for Ozon's React SPA
    // ============================================================
    const CAT_SELECTORS = {
        // Strategy 1: Look for category widget containers
        containers: [
            '[data-widget="catalog"]',
            '[data-widget="catalogNew"]',
            '[class*="catalog"]',
            '[class*="category"]',
        ],
        // Strategy 2: Category links inside main content area
        catLinks: [
            // Direct category links in main content
            'a[href*="/category/"]',
        ],
        // Exclude these areas (header, footer, sidebar nav dupes)
        excludeAreas: [
            'header', 'nav', 'footer',
            '[class*="header"]', '[class*="footer"]',
            '[class*="sidebar"]', '[class*="nav"]',
        ],
    };

    // ============================================================
    // Utilities
    // ============================================================
    function safeText(el) { return el ? (el.innerText || el.textContent || '').trim() : ''; }

    function buildUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return CONFIG.baseUrl + (path.startsWith('/') ? '' : '/') + path;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    // Extract category slug from URL
    function extractSlug(url) {
        // /category/some-slug-12345/ → some-slug-12345
        const m = (url || '').match(/\/category\/([^/]+)/);
        return m ? m[1] : '';
    }

    // Determine the "level" of a category based on current page context
    function getCurrentLevel() {
        const path = location.pathname;
        // / → top-level categories grid
        if (path === '/' || path === '/category/' || path === '/category') return 1;
        // /category/xxx-12345/ → level 2, /category/xxx/category/yyy/ → level 3
        const parts = path.split('/').filter(Boolean);
        let depth = 0;
        for (const p of parts) {
            if (p === 'category') depth++;
        }
        return depth;
    }

    // Guess parent info from breadcrumbs or URL
    function getParentInfo() {
        // Try breadcrumbs
        const breadEls = document.querySelectorAll(
            '[class*="bread"] a, [data-widget="breadcrumbs"] a, nav[aria-label*="bread"] a'
        );
        const crumbs = [];
        for (const el of breadEls) {
            const t = safeText(el);
            const href = el.getAttribute('href') || '';
            if (t && t.length > 1 && t.length < 80) {
                crumbs.push({ name: t, url: href });
            }
        }
        if (crumbs.length > 0) {
            const parent = crumbs[crumbs.length - 1];
            return { parentName: parent.name, parentUrl: parent.url };
        }

        // Fallback: derive from current URL
        // If on /category/bytovaya-tehnika-10500/, parent is "/"
        const path = location.pathname;
        if (/\/category\/[^/]+/.test(path) && !/\/category\/[^/]+\/category\//.test(path)) {
            return { parentName: 'Все категории', parentUrl: '/category/' };
        }

        return { parentName: '', parentUrl: '' };
    }

    function isExcluded(el) {
        for (const sel of CAT_SELECTORS.excludeAreas) {
            if (el.closest(sel)) return true;
        }
        return false;
    }

    // ============================================================
    // IndexedDB Storage — Categories
    // ============================================================
    const DB_NAME = 'OzonCatDB';
    const STORE_NAME = 'categories';
    let dbInstance = null;

    function initDB() {
        if (dbInstance) return Promise.resolve(dbInstance);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('slug', 'slug', { unique: true });
                    store.createIndex('level', 'level', { unique: false });
                    store.createIndex('parentUrl', 'parentUrl', { unique: false });
                }
            };
            req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveCategory(cat) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            // Use slug as dedup key — update if exists
            const idx = store.index('slug');
            const getReq = idx.getKey(cat.slug);
            getReq.onsuccess = () => {
                if (getReq.result) {
                    // Update existing
                    cat.id = getReq.result;
                }
                const putReq = store.put(cat);
                putReq.onsuccess = () => resolve();
                putReq.onerror = (e) => reject(e.target.error);
            };
            getReq.onerror = () => {
                // If index doesn't work, just put
                const putReq = store.put(cat);
                putReq.onsuccess = () => resolve();
                putReq.onerror = (e) => reject(e.target.error);
            };
        });
    }

    async function getAllCategories() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => {
                const results = req.result || [];
                // Sort by level then name
                results.sort((a, b) => {
                    if (a.level !== b.level) return a.level - b.level;
                    return (a.name || '').localeCompare(b.name || '');
                });
                resolve(results);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function countCategories() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function clearAllCategories() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // ============================================================
    // Category Scraping Engine
    // ============================================================
    function scrapeCategories() {
        const currentLevel = getCurrentLevel();
        const { parentName, parentUrl } = getParentInfo();
        const now = new Date().toISOString();
        const currentPageUrl = location.pathname + location.search;
        const scraped = [];
        const seen = new Set();

        // Strategy: Find category links, excluding header/footer nav
        const allCatLinks = document.querySelectorAll('a[href*="/category/"]');

        console.log('[OzonCat] Found', allCatLinks.length, 'total category links on page');

        for (const link of allCatLinks) {
            const href = link.getAttribute('href') || '';
            const slug = extractSlug(href);
            if (!slug) continue;

            // Skip duplicates (same slug)
            if (seen.has(slug)) continue;
            seen.add(slug);

            // Skip excluded areas
            if (isExcluded(link)) continue;

            // Skip current page link (self-referencing)
            if (href === currentPageUrl || href === location.pathname) continue;

            // Skip utility links (back to all categories, etc.)
            const text = safeText(link).toLowerCase();
            if (text === 'все категории' || text === 'назад' || text === 'all categories') continue;
            if (!text || text.length < 2) continue;

            // Find the parent card/container for more context
            const card = link.closest('[class*="widget"], [class*="tile"], [class*="card"], [class*="item"], [class*="cell"]');

            // Try to get image
            let imageUrl = '';
            if (card) {
                const img = card.querySelector('img');
                if (img) imageUrl = img.src || img.getAttribute('data-src') || '';
            }

            // Try to count children — look for nested category links inside this card
            let childrenCount = 0;
            if (card) {
                childrenCount = card.querySelectorAll('a[href*="/category/"]').length - 1; // exclude self
            }

            const cat = {
                id: generateId(),
                name: text,
                url: href,
                fullUrl: buildUrl(href),
                slug: slug,
                level: currentLevel + 1, // child of current page
                parentUrl: parentUrl || currentPageUrl,
                parentName: parentName || 'Все категории',
                imageUrl: imageUrl,
                childrenCount: Math.max(0, childrenCount),
                scrapedAt: now,
            };

            scraped.push(cat);
        }

        // ============================================================
        // Post-filtering: remove nav-like duplicates
        // Filter out links that look like they came from the global nav
        // by keeping only those inside main content widgets/cards
        // ============================================================

        // If we found cards with widget containers, prioritize those
        const fromCards = scraped.filter(c => c.childrenCount > 0 || c.imageUrl);
        const result = fromCards.length > 0 ? fromCards : scraped;

        // Deduplicate by name within same level
        const deduped = [];
        const nameSeen = new Set();
        for (const c of result) {
            const key = c.level + '|' + c.name;
            if (!nameSeen.has(key)) {
                nameSeen.add(key);
                deduped.push(c);
            }
        }

        return deduped;
    }

    // ============================================================
    // SheetJS Dynamic Loader
    // ============================================================
    function loadSheetJS() {
        const urls = [
            'https://cdn.bootcdn.net/ajax/libs/xlsx/0.20.3/xlsx.full.min.js',
            'https://unpkg.com/xlsx@0.20.3/dist/xlsx.full.min.js',
            'https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js',
        ];
        return new Promise((resolve) => {
            if (typeof XLSX !== 'undefined') { resolve(true); return; }
            let idx = 0;
            function tryNext() {
                if (idx >= urls.length) { resolve(false); return; }
                const s = document.createElement('script');
                s.src = urls[idx];
                s.onload = () => resolve(true);
                s.onerror = () => { idx++; tryNext(); };
                document.head.appendChild(s);
            }
            tryNext();
        });
    }

    // ============================================================
    // Export Functions
    // ============================================================
    function downloadBlob(content, filename, mime) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    async function exportCSV() {
        const cats = await getAllCategories();
        if (cats.length === 0) {
            alert('没有数据可导出！请先在类目页面点击"开始采集"。');
            return;
        }
        const BOM = '\uFEFF';
        const h = ['层级','类目名','完整路径','父类目','URL','子类目数','抓取时间'];
        const rows = cats.map(c => {
            const fullPath = c.parentName && c.parentName !== 'Все категории'
                ? c.parentName + ' > ' + c.name
                : c.name;
            return [
                c.level || '',
                '"' + (c.name || '').replace(/"/g, '""') + '"',
                '"' + (fullPath || '').replace(/"/g, '""') + '"',
                '"' + (c.parentName || '').replace(/"/g, '""') + '"',
                c.fullUrl || '',
                c.childrenCount ?? '',
                c.scrapedAt || '',
            ].join(',');
        });
        downloadBlob(BOM + h.join(',') + '\n' + rows.join('\n'), 'ozon-categories-' + Date.now() + '.csv', 'text/csv;charset=utf-8');
        showMsg('CSV 导出完成！共 ' + cats.length + ' 条类目', 'ok');
    }

    async function exportExcel() {
        const cats = await getAllCategories();
        if (cats.length === 0) {
            alert('没有数据可导出！请先在类目页面点击"开始采集"。');
            return;
        }
        if (typeof XLSX === 'undefined') {
            showMsg('正在加载 Excel 库...', 'info');
            const ok = await loadSheetJS();
            if (!ok) { showMsg('Excel 库加载失败，请用 CSV 导出', 'err'); return; }
        }
        const data = cats.map(c => ({
            '层级': c.level || '',
            '类目名': c.name || '',
            '完整路径': (c.parentName && c.parentName !== 'Все категории' ? c.parentName + ' > ' + c.name : c.name),
            '父类目': c.parentName || '',
            'URL': c.fullUrl || '',
            '子类目数': c.childrenCount ?? '',
            '抓取时间': c.scrapedAt || '',
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        // Auto-fit column widths
        const colWidths = [
            { wch: 6 },   // 层级
            { wch: 35 },  // 类目名
            { wch: 50 },  // 完整路径
            { wch: 30 },  // 父类目
            { wch: 60 },  // URL
            { wch: 10 },  // 子类目数
            { wch: 22 },  // 抓取时间
        ];
        ws['!cols'] = colWidths;
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ozon类目');
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), 'ozon-categories-' + Date.now() + '.xlsx');
        showMsg('Excel 导出完成！共 ' + cats.length + ' 条类目', 'ok');
    }

    // ============================================================
    // UI: Panel CSS
    // ============================================================
    const CSS = `
#oz-scraper {
    position: fixed; top: 10px; right: 10px; z-index: 2147483647;
    width: 280px;
    background: #1a1a2e; color: #e0e0e0;
    border-radius: 10px; box-shadow: 0 4px 24px rgba(0,0,0,0.6);
    font: 12px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
    border: 1px solid #333;
    user-select: none;
}
.oz-head {
    display: flex; align-items: center; padding: 6px 10px;
    background: #252540; border-radius: 10px 10px 0 0; border-bottom: 1px solid #333;
    cursor: grab; gap: 6px;
}
.oz-head:active { cursor: grabbing; }
.oz-head .oz-logo {
    width: 20px; height: 20px; border-radius: 4px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; flex-shrink: 0; color: #fff;
}
.oz-head .oz-title { flex: 1; font-weight: 700; color: #cdd6f4; font-size: 12px; letter-spacing: 0.3px; }
.oz-head .oz-btn-close {
    background: none; border: none; color: #888; cursor: pointer;
    font-size: 14px; padding: 0 3px; line-height: 1;
}
.oz-head .oz-btn-close:hover { color: #f38ba8; }
.oz-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.oz-stat {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 8px; background: #252540; border-radius: 6px;
    font-size: 11px;
}
.oz-stat .oz-count { font-weight: 700; color: #89b4fa; font-size: 14px; }
.oz-stat .oz-status { font-size: 10px; padding: 2px 6px; border-radius: 8px; }
.oz-stat .oz-status.idle { background: #333; color: #888; }
.oz-stat .oz-status.running { background: #1a3a1a; color: #a6e3a1; animation: oz-pulse 1s infinite; }
@keyframes oz-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
.oz-info {
    font-size: 10px; color: #6c7086; padding: 2px 4px;
    background: #11111b; border-radius: 4px; text-align: center;
}
.oz-btn-row { display: flex; gap: 5px; }
.oz-btn {
    flex: 1; padding: 10px 8px; border: none; border-radius: 8px;
    cursor: pointer; font-size: 13px; font-weight: 600; text-align: center;
    transition: opacity 0.15s, transform 0.1s;
}
.oz-btn:active { transform: scale(0.97); }
.oz-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.oz-btn-start { background: #89b4fa; color: #1a1a2e; }
.oz-btn-stop  { background: #f38ba8; color: #1a1a2e; }
.oz-btn-csv   { background: #45475a; color: #cdd6f4; font-size: 11px; padding: 6px 8px; }
.oz-btn-xlsx  { background: #a6e3a1; color: #1a1a2e; font-size: 11px; padding: 6px 8px; }
.oz-btn-clear { background: none; border: 1px solid #45475a; color: #888; font-size: 10px; padding: 6px 8px; border-radius: 6px; cursor: pointer; margin-top: 2px; }
.oz-btn-clear:hover { color: #f38ba8; border-color: #f38ba8; }
.oz-log {
    max-height: 200px; overflow-y: auto; font-size: 10px;
    background: #11111b; border-radius: 6px; padding: 6px;
    color: #6c7086; line-height: 1.4;
    display: none;
}
.oz-log.show { display: block; }
.oz-log .oz-log-item { padding: 1px 0; border-bottom: 1px solid #1a1a2e; }
.oz-msg {
    position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
    padding: 8px 18px; border-radius: 8px; font-size: 13px; z-index: 2147483648;
    box-shadow: 0 2px 12px rgba(0,0,0,0.5); pointer-events: none;
    animation: oz-fade 2.5s ease forwards;
}
.oz-msg.ok  { background: #a6e3a1; color: #1a1a2e; }
.oz-msg.err { background: #f38ba8; color: #1a1a2e; }
.oz-msg.info { background: #89b4fa; color: #1a1a2e; }
@keyframes oz-fade { 0% { opacity: 0; top: 20px; } 15% { opacity: 1; top: 10px; } 80% { opacity: 1; top: 10px; } 100% { opacity: 0; top: 0; } }
`;

    // ============================================================
    // UI: Toast & Log
    // ============================================================
    function showMsg(text, type) {
        const el = document.createElement('div');
        el.className = 'oz-msg ' + (type || 'ok');
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }

    function addLog(text) {
        const logEl = document.getElementById('oz-log');
        if (!logEl) return;
        logEl.classList.add('show');
        const item = document.createElement('div');
        item.className = 'oz-log-item';
        const time = new Date().toLocaleTimeString();
        item.textContent = '[' + time + '] ' + text;
        logEl.insertBefore(item, logEl.firstChild);
        // Keep max 50 entries
        while (logEl.children.length > 50) logEl.lastChild.remove();
    }

    // ============================================================
    // UI: Panel Creation
    // ============================================================
    let isRunning = false;
    let observer = null;
    let panelEl = null;

    function updateStatus() {
        countCategories().then(n => {
            const cnt = document.getElementById('oz-count');
            const st = document.getElementById('oz-status');
            const info = document.getElementById('oz-info');
            if (cnt) cnt.textContent = n;
            if (st) {
                st.textContent = isRunning ? '采集中...' : '待命中';
                st.className = 'oz-status ' + (isRunning ? 'running' : 'idle');
            }
            if (info) {
                const lvl = getCurrentLevel();
                const pageLabel = lvl === 1 ? '顶级类目页' : lvl === 2 ? '二级类目页' : '更深层级';
                info.textContent = '当前: ' + pageLabel + ' | 已采 ' + n + ' 条';
            }
        }).catch(() => {});
    }

    function createPanel() {
        GM_addStyle(CSS);

        panelEl = document.createElement('div');
        panelEl.id = 'oz-scraper';
        panelEl.innerHTML = `
            <div class="oz-head" id="oz-head">
                <div class="oz-logo">C</div>
                <div class="oz-title">Ozon 类目采集</div>
                <button class="oz-btn-close" id="oz-close" title="关闭面板">✕</button>
            </div>
            <div class="oz-body">
                <div class="oz-stat">
                    <span>已采集</span>
                    <span class="oz-count" id="oz-count">0</span>
                    <span>条类目</span>
                    <span class="oz-status idle" id="oz-status">待命中</span>
                </div>
                <div class="oz-info" id="oz-info">当前: -- | 已采 0 条</div>
                <div class="oz-btn-row">
                    <button class="oz-btn oz-btn-start" id="oz-start">▶ 采集本页</button>
                    <button class="oz-btn oz-btn-stop" id="oz-stop" disabled>■ 停止</button>
                </div>
                <div class="oz-btn-row">
                    <button class="oz-btn oz-btn-csv" id="oz-csv">导出 CSV</button>
                    <button class="oz-btn oz-btn-xlsx" id="oz-xlsx">导出 Excel</button>
                </div>
                <button class="oz-btn-clear" id="oz-clear">清空数据</button>
                <div class="oz-log" id="oz-log"></div>
            </div>
        `;
        document.body.appendChild(panelEl);

        makeDraggable();

        document.getElementById('oz-start').addEventListener('click', startScraping);
        document.getElementById('oz-stop').addEventListener('click', stopScraping);
        document.getElementById('oz-close').addEventListener('click', () => panelEl.remove());
        document.getElementById('oz-csv').addEventListener('click', exportCSV);
        document.getElementById('oz-xlsx').addEventListener('click', exportExcel);
        document.getElementById('oz-clear').addEventListener('click', clearData);

        updateStatus();
        window.__ozonScraper = {
            start: startScraping, stop: stopScraping,
            exportCSV, exportExcel, clearData,
            status: () => isRunning,
            debug: () => {
                const cats = scrapeCategories();
                console.table(cats.map(c => ({ name: c.name, level: c.level, parent: c.parentName, slug: c.slug })));
                return cats;
            }
        };
    }

    function makeDraggable() {
        const head = document.getElementById('oz-head');
        if (!head) return;
        let offsetX = 0, offsetY = 0, dragging = false;

        head.addEventListener('mousedown', (e) => {
            if (e.target.id === 'oz-close') return;
            dragging = true;
            const rect = panelEl.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            head.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - panelEl.offsetWidth));
            const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - panelEl.offsetHeight));
            panelEl.style.right = 'auto';
            panelEl.style.top = y + 'px';
            panelEl.style.left = x + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (dragging) { dragging = false; head.style.cursor = 'grab'; }
        });
    }

    // ============================================================
    // Core: Start / Stop / Clear
    // ============================================================
    async function startScraping() {
        if (isRunning) return;
        isRunning = true;

        const startBtn = document.getElementById('oz-start');
        const stopBtn = document.getElementById('oz-stop');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        updateStatus();

        showMsg('正在采集当前页面类目...', 'info');
        addLog('开始采集 ' + location.pathname);

        const cats = scrapeCategories();
        addLog('发现 ' + cats.length + ' 个类目链接');

        if (cats.length === 0) {
            addLog('⚠ 未发现类目！当前页面可能不是类目页');
            showMsg('未发现类目链接！请浏览到 Ozon 类目页面（如 /category/）', 'info');
        } else {
            let saved = 0;
            let skipped = 0;
            for (const cat of cats) {
                try {
                    await saveCategory(cat);
                    saved++;
                } catch (e) {
                    skipped++;
                }
            }
            const lvl = cats[0].level || '?';
            addLog('保存: ' + saved + ' 条 | 层级: ' + lvl);
            showMsg('采集完成！保存 ' + saved + ' 条类目 (层级 ' + lvl + ')', 'ok');
        }

        // Auto-stop after one scrape
        stopScraping(false);
        updateStatus();

        // Start observer to detect navigation to new pages
        startObserver();
    }

    function stopScraping(showToast = true) {
        isRunning = false;
        stopObserver();

        const startBtn = document.getElementById('oz-start');
        const stopBtn = document.getElementById('oz-stop');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        updateStatus();
        if (showToast) showMsg('已停止', 'ok');
    }

    function startObserver() {
        stopObserver();
        observer = new MutationObserver(() => {
            // Detect SPA navigation — URL changed or content replaced
            const currentPath = location.pathname + location.search;
            if (window.__oz_last_path && window.__oz_last_path !== currentPath) {
                window.__oz_last_path = currentPath;
                addLog('检测到页面切换: ' + currentPath);
                updateStatus(); // Update level display
            }
            window.__oz_last_path = currentPath;
        });
        observer.observe(document.body, { childList: true, subtree: true });
        window.__oz_last_path = location.pathname + location.search;
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
    }

    async function clearData() {
        if (!confirm('确定要清空所有已采集的类目数据吗？')) return;
        await clearAllCategories();
        addLog('数据已清空');
        updateStatus();
        showMsg('数据已清空', 'ok');
    }

    // ============================================================
    // Boot
    // ============================================================
    function boot() {
        if (document.getElementById('oz-scraper')) return;
        if (!/ozon\.ru/.test(location.hostname)) return;
        if (/\/my\//.test(location.pathname) || /\/cart\//.test(location.pathname)) return;

        console.log('[OzonCat] v3.0.0 boot on', location.href);
        createPanel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
