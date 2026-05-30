// ==UserScript==
// @name         Ozon Scraper - 产品类目爬取工具
// @namespace    https://github.com/vision-png/ozon
// @version      2.0.0
// @description  手动采集 Ozon.ru 产品类目和搜索结果，支持 CSV/Excel 导出
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
// @connect      ir-2.ozon.ru
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
        panelWidth: 320,
        scrapeDelay: 800,
    };

    // ============================================================
    // Adaptive selectors for Ozon's React CSS Modules
    // ============================================================
    const SELECTORS = {
        productCards: [
            '[data-widget="searchResultsV2"] a[href*="/product/"]',
            '[data-widget="searchResults"] a[href*="/product/"]',
            'a[href*="/product/"][class*="tile"]',
            'div[class*="widget"] a[href*="/product/"]',
            'a[href^="/product/"]',
        ],
        categoryLinks: [
            'a[href*="/category/"]',
            '[class*="catalog"] a',
            'nav a[href*="/category/"]',
        ],
    };

    // ============================================================
    // Utilities
    // ============================================================
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    function safeText(el) { return el ? (el.innerText || el.textContent || '').trim() : ''; }

    function parsePrice(str) {
        if (!str) return null;
        const n = parseFloat(str.replace(/[^\d,.]/g, '').replace(/\s/g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    function extractSku(url) {
        const m = (url || '').match(/-(\d+)\/?/);
        return m ? m[1] : '';
    }

    function buildUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return 'https://www.ozon.ru' + (path.startsWith('/') ? '' : '/') + path;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    // ============================================================
    // IndexedDB Storage
    // ============================================================
    const DB_NAME = 'OzonScraperDB';
    let dbInstance = null;

    function initDB() {
        if (dbInstance) return Promise.resolve(dbInstance);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('products')) {
                    const store = db.createObjectStore('products', { keyPath: 'id' });
                    store.createIndex('sku', 'sku', { unique: false });
                    store.createIndex('category', 'category', { unique: false });
                }
            };
            req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function saveProduct(product) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('products', 'readwrite');
            const store = tx.objectStore('products');
            const req = store.put(product);
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function getAllProducts() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('products', 'readonly');
            const store = tx.objectStore('products');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function clearAllProducts() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('products', 'readwrite');
            const store = tx.objectStore('products');
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function countProducts() {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('products', 'readonly');
            const store = tx.objectStore('products');
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // ============================================================
    // Scraping Engine
    // ============================================================
    function getCurrentCategory() {
        // Try breadcrumbs first
        const crumbs = document.querySelectorAll('[class*="breadcrumb"] a, [class*="bread"] a, nav[aria-label] a');
        const parts = [];
        for (const c of crumbs) {
            const t = safeText(c);
            if (t && t.length > 1 && t.length < 50) parts.push(t);
        }
        if (parts.length > 0) return parts.join(' > ');

        // Fallback: path
        const pathParts = location.pathname.split('/').filter(p => p && p !== 'category');
        return pathParts.join(' > ') || '';
    }

    function scrapeProducts() {
        const category = getCurrentCategory();
        const now = new Date().toISOString();
        const scraped = [];
        const seen = new Set();

        // Try each selector strategy
        let links = [];
        for (const sel of SELECTORS.productCards) {
            try {
                const found = document.querySelectorAll(sel);
                if (found.length > 0) {
                    links = Array.from(found);
                    break;
                }
            } catch (e) { /* next */ }
        }

        console.log('[OzonScraper] Found', links.length, 'product links');

        for (const link of links) {
            const href = link.getAttribute('href') || '';
            const sku = extractSku(href);
            if (!sku || seen.has(sku)) continue;
            seen.add(sku);

            // Find the parent card element
            const card = link.closest('[class*="widget"], [class*="tile"], [class*="card"], [class*="item"], div') || link;

            // Extract name
            let name = '';
            const nameEl = card.querySelector('span[class*="tsBody"], h3, a[class*="tsBody"], span');
            name = safeText(nameEl) || safeText(link);
            if (!name || name.length < 2) name = href.split('/').filter(Boolean).pop() || '';

            // Extract price
            let price = null;
            const priceEls = card.querySelectorAll('span');
            for (const el of priceEls) {
                const t = safeText(el);
                if (/\d/.test(t) && (t.includes('₽') || t.includes('\u20BD'))) {
                    const p = parsePrice(t);
                    if (p !== null) { price = p; break; }
                }
            }

            // Extract old price
            let oldPrice = null;
            const crossed = card.querySelectorAll('s, [class*="old"], [class*="crossed"]');
            for (const el of crossed) {
                const p = parsePrice(safeText(el));
                if (p !== null && p > (price || 0)) { oldPrice = p; break; }
            }

            // Extract rating
            let rating = null;
            const ratingEl = card.querySelector('[class*="rating"], [class*="star"], [class*="ra"]');
            if (ratingEl) {
                const r = parseFloat(safeText(ratingEl));
                if (!isNaN(r) && r <= 5) rating = r;
            }

            // Extract review count
            let reviews = null;
            const reviewEls = card.querySelectorAll('span, a');
            for (const el of reviewEls) {
                const t = safeText(el);
                if (/^\d+$/.test(t) && parseInt(t) > 0 && parseInt(t) < 100000) {
                    reviews = parseInt(t);
                     // Only use if it looks like a review count (adjacent to rating or icon)
                    if (el.closest('[class*="review"], [class*="rating"]') || rating !== null) {
                        break;
                    }
                }
            }

            // Extract image
            let imageUrl = '';
            const img = card.querySelector('img');
            if (img) imageUrl = img.src || img.getAttribute('data-src') || '';

            scraped.push({
                id: generateId(),
                sku: sku,
                name: name,
                priceRub: price,
                originalPriceRub: oldPrice,
                rating: rating,
                reviews: reviews,
                category: category,
                imageUrl: imageUrl,
                url: buildUrl(href),
                scrapedAt: now,
            });
        }

        return scraped;
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
        const products = await getAllProducts();
        if (products.length === 0) {
            alert('没有数据可导出！请先采集商品。');
            return;
        }
        const BOM = '\uFEFF';
        const h = ['SKU','名称','价格(RUB)','原价(RUB)','折扣%','评分','评论数','类目','URL','图片','采集时间'];
        const rows = products.map(p => {
            const disc = (p.originalPriceRub && p.priceRub) ? Math.round((1 - p.priceRub / p.originalPriceRub) * 100) + '%' : '';
            return [
                p.sku || '',
                '"' + (p.name || '').replace(/"/g, '""') + '"',
                p.priceRub ?? '',
                p.originalPriceRub ?? '',
                disc,
                p.rating || '',
                p.reviews || '',
                '"' + (p.category || '').replace(/"/g, '""') + '"',
                p.url || '',
                p.imageUrl || '',
                p.scrapedAt || '',
            ].join(',');
        });
        downloadBlob(BOM + h.join(',') + '\n' + rows.join('\n'), 'ozon-products-' + Date.now() + '.csv', 'text/csv;charset=utf-8');
        showMsg('CSV 导出完成！共 ' + products.length + ' 条', 'ok');
    }

    async function exportExcel() {
        const products = await getAllProducts();
        if (products.length === 0) {
            alert('没有数据可导出！请先采集商品。');
            return;
        }
        if (typeof XLSX === 'undefined') {
            showMsg('正在加载 Excel 库...', 'info');
            const ok = await loadSheetJS();
            if (!ok) { showMsg('Excel 库加载失败，请用 CSV 导出', 'err'); return; }
        }
        const data = products.map(p => {
            const disc = (p.originalPriceRub && p.priceRub) ? Math.round((1 - p.priceRub / p.originalPriceRub) * 100) + '%' : '';
            return {
                'SKU': p.sku || '',
                '名称': p.name || '',
                '价格(RUB)': p.priceRub ?? '',
                '原价(RUB)': p.originalPriceRub ?? '',
                '折扣%': disc,
                '评分': p.rating || '',
                '评论数': p.reviews || '',
                '类目': p.category || '',
                'URL': p.url || '',
                '图片': p.imageUrl || '',
                '采集时间': p.scrapedAt || '',
            };
        });
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ozon');
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(new Blob([buf], { type: 'application/octet-stream' }), 'ozon-products-' + Date.now() + '.xlsx');
        showMsg('Excel 导出完成！共 ' + products.length + ' 条', 'ok');
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
#oz-scraper.mini { width: 36px; height: 36px; border-radius: 50%; overflow: hidden; cursor: pointer; }
#oz-scraper.mini .oz-body { display: none; }
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
    font-size: 11px; flex-shrink: 0;
    color: #fff;
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
.oz-stat .oz-status.stopped { background: #3a1a1a; color: #f38ba8; }
@keyframes oz-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }
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
    // UI: Toast
    // ============================================================
    function showMsg(text, type) {
        const el = document.createElement('div');
        el.className = 'oz-msg ' + (type || 'ok');
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 2600);
    }

    // ============================================================
    // UI: Panel Creation
    // ============================================================
    let isRunning = false;
    let observer = null;
    let panelEl = null;

    function updateStatus() {
        countProducts().then(n => {
            const cnt = document.getElementById('oz-count');
            const st = document.getElementById('oz-status');
            if (cnt) cnt.textContent = n;
            if (st) {
                st.textContent = isRunning ? '采集中' : '待命中';
                st.className = 'oz-status ' + (isRunning ? 'running' : 'idle');
            }
        }).catch(() => {});
    }

    function createPanel() {
        GM_addStyle(CSS);

        panelEl = document.createElement('div');
        panelEl.id = 'oz-scraper';
        panelEl.innerHTML = `
            <div class="oz-head" id="oz-head">
                <div class="oz-logo">O</div>
                <div class="oz-title">Ozon Scraper</div>
                <button class="oz-btn-close" id="oz-close" title="关闭面板">✕</button>
            </div>
            <div class="oz-body">
                <div class="oz-stat">
                    <span>已采集</span>
                    <span class="oz-count" id="oz-count">0</span>
                    <span>条</span>
                    <span class="oz-status idle" id="oz-status">待命中</span>
                </div>
                <div class="oz-btn-row">
                    <button class="oz-btn oz-btn-start" id="oz-start">▶ 开始采集</button>
                    <button class="oz-btn oz-btn-stop" id="oz-stop" disabled>■ 停止</button>
                </div>
                <div class="oz-btn-row">
                    <button class="oz-btn oz-btn-csv" id="oz-csv">导出 CSV</button>
                    <button class="oz-btn oz-btn-xlsx" id="oz-xlsx">导出 Excel</button>
                </div>
                <button class="oz-btn-clear" id="oz-clear">清空数据</button>
            </div>
        `;
        document.body.appendChild(panelEl);

        // Draggable
        makeDraggable();

        // Bind events
        document.getElementById('oz-start').addEventListener('click', startScraping);
        document.getElementById('oz-stop').addEventListener('click', stopScraping);
        document.getElementById('oz-close').addEventListener('click', () => panelEl.remove());
        document.getElementById('oz-csv').addEventListener('click', exportCSV);
        document.getElementById('oz-xlsx').addEventListener('click', exportExcel);
        document.getElementById('oz-clear').addEventListener('click', clearData);

        // Initial count
        updateStatus();

        // Expose for console debugging
        window.__ozonScraper = { start: startScraping, stop: stopScraping, exportCSV, exportExcel, clearData, status: () => isRunning };
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
        startBtn.disabled = true;
        stopBtn.disabled = false;
        updateStatus();

        showMsg('开始采集当前页面商品...', 'info');
        await scrapeAndSave();
        updateStatus();

        // Activate MutationObserver to detect new products as user navigates
        startObserver();
    }

    function stopScraping() {
        isRunning = false;
        stopObserver();

        const startBtn = document.getElementById('oz-start');
        const stopBtn = document.getElementById('oz-stop');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        updateStatus();
        showMsg('已停止采集', 'ok');
    }

    async function scrapeAndSave() {
        const products = scrapeProducts();
        if (products.length === 0) {
            showMsg('当前页面未发现商品链接，请浏览到商品列表页', 'info');
            return;
        }
        let saved = 0;
        for (const p of products) {
            await saveProduct(p);
            saved++;
        }
        showMsg('采集完成！本页 ' + saved + ' 个商品', 'ok');
    }

    function startObserver() {
        stopObserver();
        observer = new MutationObserver(() => {
            if (!isRunning) return;
            // Check if page content changed (user navigated to new category)
            const links = document.querySelectorAll('a[href*="/product/"]');
            if (links.length > 0) {
                // Debounce: wait for page to settle, then scrape
                clearTimeout(window.__oz_obs_timer);
                window.__oz_obs_timer = setTimeout(() => {
                    if (isRunning) scrapeAndSave().then(updateStatus);
                }, 2000);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function stopObserver() {
        if (observer) { observer.disconnect(); observer = null; }
        clearTimeout(window.__oz_obs_timer);
    }

    async function clearData() {
        if (!confirm('确定要清空所有已采集的数据吗？')) return;
        await clearAllProducts();
        updateStatus();
        showMsg('数据已清空', 'ok');
    }

    // ============================================================
    // Boot: Always show panel
    // ============================================================
    function boot() {
        if (document.getElementById('oz-scraper')) return;
        if (!/ozon\.ru/.test(location.hostname)) return;
        // Skip purely personal pages
        if (/\/my\//.test(location.pathname) || /\/cart\//.test(location.pathname)) return;

        console.log('[OzonScraper] v2.0.0 boot on', location.href);
        createPanel();
    }

    // Run immediately — no waiting for React, no retry logic
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
