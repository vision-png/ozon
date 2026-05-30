// ==UserScript==
// @name         Ozon Scraper - 四层类目树采集 + MD导出
// @namespace    https://github.com/vision-png/ozon
// @version      4.0.0
// @description  采集 Ozon.ru 类目树（一级→二级→三级→四级），导出 CSV / Excel / Markdown
// @author       Qin Yucheng
// @match        https://www.ozon.ru/*
// @match        https://ozon.ru/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
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
    const BASE = 'https://www.ozon.ru';

    // ============================================================
    // Utilities
    // ============================================================
    function safeText(el) {
        return el ? (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    }

    function buildUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return BASE + (path.startsWith('/') ? '' : '/') + path;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ============================================================
    // DOM Context Helpers
    // ============================================================

    // Check if element is in header/footer/sidebar
    function isChrome(el) {
        const chromeSelectors = [
            'header', 'footer', 'nav',
            '[class*="header"]', '[class*="footer"]',
            '[class*="sidebar"]', '[class*="nav-"]',
            '[data-widget="header"]', '[data-widget="footer"]',
            '#__next > div:first-child', // Next.js default wrapper
        ];
        for (const sel of chromeSelectors) {
            try {
                if (sel.startsWith('#') && el.id === sel.slice(1)) return true;
                if (el.closest(sel)) return true;
            } catch (e) { /* ignore */ }
        }
        return false;
    }

    // Find the nearest ancestor heading element (h1-h6) or heading-like div
    function findNearestHeading(el) {
        // Walk up DOM looking for h1-h6
        let current = el.parentElement;
        let found = null;
        while (current && current !== document.body) {
            // Check h1-h6
            const h = current.querySelector('h1, h2, h3, h4, h5, h6');
            if (h) {
                // Verify the heading is ABOVE this element in the DOM, not inside it
                const pos = h.compareDocumentPosition(el);
                if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
                    found = h;
                    // Keep walking up to find a higher-level heading
                }
            }
            current = current.parentElement;
        }
        return found;
    }

    // Find the nearest previous heading (sibling or ancestor's previous sibling)
    function findPreviousHeading(el) {
        // Walk backwards through siblings, then up
        let node = el.previousSibling;
        while (node) {
            if (node.nodeType === 1) {
                const tag = node.tagName;
                if (tag && /^H[1-6]$/.test(tag)) return node;
                const inner = node.querySelector('h1, h2, h3, h4, h5, h6');
                if (inner) return inner;
            }
            node = node.previousSibling;
        }
        // If no previous sibling heading, check parent
        if (el.parentElement) {
            return findPreviousHeading(el.parentElement) || findNearestHeading(el);
        }
        return null;
    }

    // Find all preceding text that looks like a section title before this element
    function findSectionTitle(el) {
        // Strategy: look at the parent container, find text elements before this one
        const parent = el.closest('section, article, div[class*="grid"], div[class*="categ"], div[class*="list"]') || el.parentElement;
        if (!parent) return '';

        const children = Array.from(parent.children);
        const idx = children.indexOf(el.closest('div, a, li') || el);
        if (idx <= 0) return '';

        // Look backwards for heading-like elements
        for (let i = idx - 1; i >= 0; i--) {
            const child = children[i];
            const tag = child.tagName;
            if (tag && /^H[1-6]$/.test(tag)) return safeText(child);
            // Check for div that looks like heading (bold, larger font, title class)
            const txt = safeText(child);
            if (txt && txt.length > 1 && txt.length < 80) {
                const style = window.getComputedStyle(child);
                const fw = parseInt(style.fontWeight) || 400;
                const fs = parseFloat(style.fontSize) || 14;
                const isHeadingLike = (
                    fw >= 600 || fs >= 16 ||
                    /title|heading|header|caption/i.test(child.className || '')
                );
                if (isHeadingLike && !child.querySelector('a')) return txt;
            }
        }
        return '';
    }

    // ============================================================
    // Category Detection: is this link a category (not a product)?
    // ============================================================
    function isCategoryLink(link) {
        const href = (link.getAttribute('href') || '').toLowerCase();
        const text = safeText(link).toLowerCase();

        // Must have content
        if (!text || text.length < 2) return false;
        if (text.length > 100) return false; // Too long = product name

        // Product pages: /product/xxx/
        if (/\/product\//.test(href)) return false;

        // Category pages
        if (/\/category\//.test(href)) return true;

        // Catalog/collection pages
        if (/\/(catalog|collection|tag|brand)\//.test(href)) return true;

        // Search/category filter pages (Ozon often links to search with category filter)
        if (/\/search\/.*category/.test(href)) return true;
        if (/\/category/.test(href)) return true;

        // Non-category stuff
        if (/\/seller\//.test(href)) return false;
        if (/\/my\//.test(href)) return false;
        if (/\/cart\//.test(href)) return false;
        if (/\/checkout\//.test(href)) return false;
        if (/\/info\//.test(href)) return false;
        if (href === '/' || href === '') return false;
        if (/^https?:\/\//.test(href) && !/ozon\.ru/.test(href)) return false;

        // For pages with category-like URL structure but no /category/ prefix
        // e.g., /electronika/ or /bytovaya-tehnika/
        if (href.match(/^\/[a-zа-яё-]+\/\d*\/?$/) || href.match(/^\/[a-zа-яё-]+-[a-zа-яё-]+\/\d*\/?$/)) {
            return true;
        }

        return false;
    }

    // ============================================================
    // Scraping Engine: Hierarchical Category Extraction
    // ============================================================
    function scrapeAllCategories() {
        const L1 = getL1Category();
        const allLinks = Array.from(document.querySelectorAll('a'));

        // Filter: category links in main content area
        const catLinks = allLinks.filter(link => {
            if (isChrome(link)) return false;
            return isCategoryLink(link);
        });

        console.log('[OzonCat] Raw category links found:', catLinks.length);

        // ============================================================
        // Strategy 1: Find tab/button bar for L2
        // ============================================================
        let l2Items = [];
        const tabBarCandidate = findTabBar();
        if (tabBarCandidate) {
            const tabs = tabBarCandidate.querySelectorAll('a, button, [role="tab"], [role="button"]');
            for (const tab of tabs) {
                const text = safeText(tab);
                if (text && text.length >= 2 && text.length < 60) {
                    const href = tab.getAttribute('href') || tab.closest('a')?.getAttribute('href') || '';
                    l2Items.push({ name: text, url: href, level: 2 });
                }
            }
        }

        // Strategy 2: If no tab bar, use URL structure to find L2
        if (l2Items.length === 0) {
            // Top-level category links (direct children of main content)
            l2Items = catLinks
                .filter(l => {
                    const href = l.getAttribute('href') || '';
                    return /\/category\//.test(href) && !/\/category\/[^/]+\//.test(href.replace(/\/$/, ''));
                })
                .map(l => ({ name: safeText(l), url: l.getAttribute('href') || '', level: 2 }))
                .slice(0, 20);
        }

        // Deduplicate L2
        const seen2 = new Set();
        l2Items = l2Items.filter(item => {
            const key = item.name.trim();
            if (seen2.has(key)) return false;
            seen2.add(key);
            return true;
        });

        // ============================================================
        // Strategy 3: Find sections with headings (L3) and their children (L4)
        // ============================================================
        // Group remaining links by their section context
        const sections = [];

        // Find all heading-like elements in the main content
        const headings = findAllHeadings();

        for (const h of headings) {
            const title = safeText(h);
            if (!title || title.length < 2 || title.length > 80) continue;
            if (/купить|корзина|избран|цена|скидк|фильтр|сортир|показать|страниц/i.test(title)) continue;

            // Find links that belong to this section
            const sectionLinks = [];
            let current = h.nextElementSibling;
            let safety = 0;

            while (current && safety < 200) {
                safety++;
                // Stop at next heading
                if (current.tagName && /^H[1-4]$/.test(current.tagName)) break;

                // Collect links
                const links = current.querySelectorAll('a');
                for (const l of links) {
                    if (isChrome(l)) continue;
                    if (!isCategoryLink(l) && !/\/product\//.test(l.getAttribute('href') || '')) continue;
                    const text = safeText(l);
                    if (text && text.length >= 2 && text.length < 120) {
                        const href = l.getAttribute('href') || '';
                        sectionLinks.push({ name: text, url: href });
                    }
                }

                current = current.nextElementSibling;
            }

            if (sectionLinks.length > 0) {
                sections.push({ title, links: sectionLinks });
            }
        }

        // ============================================================
        // Strategy 4: DOM position-based grouping (fallback)
        // ============================================================
        if (sections.length === 0) {
            // Group by parent container
            const groups = new Map();
            for (const link of catLinks) {
                // Find the section container
                const section = link.closest(
                    'section, article, [class*="group"], [class*="block"], [class*="row"], [class*="col"]'
                ) || link.parentElement;
                if (!section) continue;

                const sectionKey = section.className || section.tagName;
                if (!groups.has(sectionKey)) groups.set(sectionKey, []);
                groups.get(sectionKey).push({ name: safeText(link), url: link.getAttribute('href') || '' });
            }

            for (const [key, links] of groups) {
                if (links.length >= 2) {
                    // Find title for this group
                    let title = '';
                    const container = document.querySelector('.' + key.split(' ')[0]) ||
                                    document.querySelector(key);
                    if (container) {
                        const h = container.querySelector('h2, h3, h4, h5');
                        if (h) title = safeText(h);
                    }
                    if (!title) {
                        // Use first link parent's section context
                        title = findSectionTitle(links[0].el);
                    }
                    if (title && links.length > 0) {
                        sections.push({ title, links });
                    }
                }
            }
        }

        // Deduplicate L3 sections by title
        const seen3 = new Set();
        const dedupedSections = sections.filter(s => {
            const key = s.title.trim();
            if (seen3.has(key)) return false;
            seen3.add(key);
            return s.links.length > 0;
        });

        return {
            l1: L1,
            l2: l2Items,
            l3and4: dedupedSections,
            rawCount: catLinks.length,
        };
    }

    function getL1Category() {
        const path = location.pathname;

        // Breadcrumb approach
        const breadLinks = document.querySelectorAll(
            'a[href*="/category/"], [class*="bread"] a, [data-widget*="bread"] a, nav[aria-label] a'
        );
        const crumbs = [];
        for (const b of breadLinks) {
            const t = safeText(b);
            if (t && t.length > 1 && t.length < 80) crumbs.push(t);
        }

        if (crumbs.length > 0) {
            // The deepest breadcrumb that's not the current page
            return crumbs[crumbs.length - 1];
        }

        // URL approach
        if (/\/category\//.test(path)) {
            const m = path.match(/\/category\/([^/]+)/);
            if (m) {
                return m[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
            }
        }

        // Page title fallback
        const h1 = document.querySelector('h1');
        if (h1) return safeText(h1);

        return 'Все категории';
    }

    function findTabBar() {
        // Look for horizontal scrollable container with category links
        const candidates = document.querySelectorAll(
            '[class*="tabs"], [class*="tab"], [class*="catalogNav"], [class*="catNav"], ' +
            '[class*="subcat"], [class*="submenu"], [class*="pill"], [class*="chip"], ' +
            '[class*="scroll"]'
        );

        for (const c of candidates) {
            const style = window.getComputedStyle(c);
            const links = c.querySelectorAll('a');
            // Must have multiple links and be a horizontal container
            if (links.length >= 3 && (style.display === 'flex' || style.overflowX === 'auto' || style.overflowX === 'scroll')) {
                // Verify links point to categories
                let catCount = 0;
                for (const l of links) {
                    if (isCategoryLink(l) || /\/category\//.test(l.getAttribute('href') || '')) catCount++;
                }
                if (catCount >= 2) return c;
            }
        }

        // Fallback: find any flex container with category links
        const flexContainers = document.querySelectorAll('[style*="display: flex"], [style*="display:flex"]');
        for (const c of flexContainers) {
            const links = c.querySelectorAll('a[href*="/category/"]');
            if (links.length >= 3) return c;
        }

        return null;
    }

    function findAllHeadings() {
        // Find all h1-h6 elements in main content (excluding chrome)
        const hs = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
        const result = [];
        for (const h of hs) {
            if (!isChrome(h)) result.push(h);
        }

        // If no headings found, look for heading-like divs
        if (result.length === 0) {
            const headingLike = document.querySelectorAll(
                '[class*="title"], [class*="heading"], [class*="header"], ' +
                '[class*="section-name"], [class*="group-title"]'
            );
            for (const h of headingLike) {
                if (!isChrome(h) && !h.querySelector('a[href]')) result.push(h);
            }
        }

        return result;
    }

    // ============================================================
    // IndexedDB Storage
    // ============================================================
    const DB_NAME = 'OzonCatTreeV4';
    const STORE_NAME = 'categories';
    let dbInstance = null;

    function initDB() {
        if (dbInstance) return Promise.resolve(dbInstance);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    // Save a batch of categories (replace all for current level)
    async function saveBatch(items) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const item of items) {
                store.put(item);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async function getAll() {
        const db = await initDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
        });
    }

    async function clearAll() {
        const db = await initDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.clear();
            tx.oncomplete = () => resolve();
        });
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

    function downloadBlob(content, filename, mime) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // ============================================================
    // Export: Markdown
    // ============================================================
    async function exportMarkdown() {
        const all = await getAll();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }

        // Group by level
        const l1Items = all.filter(c => c.level === 1);
        const l2Items = all.filter(c => c.level === 2);
        const l3Items = all.filter(c => c.level === 3);
        const l4Items = all.filter(c => c.level === 4);

        let md = '# Ozon 类目树\n\n';
        md += '> 采集时间: ' + new Date().toISOString() + '\n';
        md += '> 来源: ' + location.origin + '\n';
        md += '> 总计: ' + all.length + ' 条类目\n\n';
        md += '---\n\n';

        // L1 → L2 → L3 → L4 hierarchy
        if (l1Items.length > 0) {
            for (const l1 of l1Items) {
                md += '## ' + (l1.emoji || '📁') + ' ' + l1.name + '\n\n';
                md += l1.url ? '> ' + buildUrl(l1.url) + '\n\n' : '\n';

                // Find L2 items under this L1
                const children2 = l2Items.filter(c => c.parent === l1.name);
                for (const l2 of children2) {
                    md += '### ' + (l2.emoji || '📂') + ' ' + l2.name + '\n\n';
                    md += l2.url ? '> ' + buildUrl(l2.url) + '\n\n' : '\n';

                    // Find L3 items under this L2
                    const children3 = l3Items.filter(c => c.parent === l2.name);
                    for (const l3 of children3) {
                        md += '#### ' + (l3.emoji || '📋') + ' ' + l3.name + '\n\n';
                        md += l3.url ? '> ' + buildUrl(l3.url) + '\n\n' : '\n';

                        // Find L4 items under this L3
                        const children4 = l4Items.filter(c => c.parent === l3.name);
                        for (const l4 of children4) {
                            md += '- **' + l4.name + '**';
                            md += l4.url ? ' — [' + buildUrl(l4.url) + '](' + buildUrl(l4.url) + ')' : '';
                            md += '\n';
                        }
                        md += '\n';
                    }
                }
            }
        } else {
            // Flat export with level indicators
            md += '## 📊 按层级分类\n\n';
            for (let lv = 1; lv <= 4; lv++) {
                const items = all.filter(c => c.level === lv);
                if (items.length === 0) continue;
                md += '### ' + ['', '一级类目', '二级类目', '三级类目', '四级类目'][lv] + ' (' + items.length + '个)\n\n';
                for (const item of items) {
                    md += '- **' + item.name + '**';
                    if (item.parent) md += ' ← ' + item.parent;
                    if (item.url) md += ' [' + buildUrl(item.url) + '](' + buildUrl(item.url) + ')';
                    md += '\n';
                }
                md += '\n';
            }
        }

        // Stats footer
        md += '---\n\n';
        md += '## 📈 统计\n\n';
        md += '| 层级 | 数量 |\n| --- | --- |\n';
        md += '| 一级 | ' + l1Items.length + ' |\n';
        md += '| 二级 | ' + l2Items.length + ' |\n';
        md += '| 三级 | ' + l3Items.length + ' |\n';
        md += '| 四级 | ' + l4Items.length + ' |\n';
        md += '| **合计** | **' + all.length + '** |\n';

        downloadBlob(md, 'ozon-category-tree-' + Date.now() + '.md', 'text/markdown;charset=utf-8');
        showMsg('Markdown 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    // ============================================================
    // Export: CSV
    // ============================================================
    async function exportCSV() {
        const all = await getAll();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }
        const BOM = '\uFEFF';
        const h = ['层级','类目名','完整路径','父类目','URL','采集时间'];
        const rows = all.map(c => {
            const path = c.path || c.name;
            return [
                c.level || '',
                '"' + (c.name || '').replace(/"/g, '""') + '"',
                '"' + (path || '').replace(/"/g, '""') + '"',
                '"' + (c.parent || '').replace(/"/g, '""') + '"',
                c.url ? buildUrl(c.url) : '',
                c.scrapedAt || '',
            ].join(',');
        });
        downloadBlob(BOM + h.join(',') + '\n' + rows.join('\n'), 'ozon-categories-' + Date.now() + '.csv', 'text/csv;charset=utf-8');
        showMsg('CSV 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    async function exportExcel() {
        const all = await getAll();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }
        if (typeof XLSX === 'undefined') {
            showMsg('加载 Excel 库...', 'info');
            const ok = await loadSheetJS();
            if (!ok) { showMsg('Excel 库加载失败，请用 CSV', 'err'); return; }
        }
        const data = all.map(c => ({
            '层级': c.level || '',
            '类目名': c.name || '',
            '完整路径': c.path || c.name,
            '父类目': c.parent || '',
            'URL': c.url ? buildUrl(c.url) : '',
            '采集时间': c.scrapedAt || '',
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        ws['!cols'] = [{wch:6},{wch:35},{wch:50},{wch:30},{wch:60},{wch:22}];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ozon类目');
        const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(new Blob([buf]), 'ozon-categories-' + Date.now() + '.xlsx');
        showMsg('Excel 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    // ============================================================
    // UI: Panel
    // ============================================================
    const CSS = `
#oz-scraper{position:fixed;top:10px;right:10px;z-index:2147483647;width:300px;background:#1a1a2e;color:#cdd6f4;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.6);font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid #313244;user-select:none;}
.oz-hd{display:flex;align-items:center;padding:7px 10px;background:#1e1e2e;border-radius:10px 10px 0 0;border-bottom:1px solid #313244;cursor:grab;gap:6px}
.oz-hd:active{cursor:grabbing}
.oz-lg{width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#667eea,#cba6f7);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;color:#1a1a2e;font-weight:700}
.oz-tt{flex:1;font-weight:700;font-size:12px;letter-spacing:.3px}
.oz-cl{background:0;border:0;color:#585b70;cursor:pointer;font-size:15px;padding:0 3px;line-height:1}
.oz-cl:hover{color:#f38ba8}
.oz-bd{padding:10px;display:flex;flex-direction:column;gap:7px}
.oz-st{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#181825;border-radius:6px;font-size:11px}
.oz-nm{font-weight:700;color:#89b4fa;font-size:15px;min-width:20px;text-align:center}
.oz-lb{font-size:8px;padding:2px 6px;border-radius:8px;text-transform:uppercase;letter-spacing:.5px}
.oz-lb.idle{background:#313244;color:#6c7086}
.oz-lb.run{background:#1a3a1a;color:#a6e3a1;animation:oz-p .8s infinite}
@keyframes oz-p{0%,100%{opacity:1}50%{opacity:.5}}
.oz-inf{font-size:10px;color:#6c7086;padding:3px 6px;background:#11111b;border-radius:4px;text-align:center;line-height:1.5}
.oz-br{display:flex;gap:4px}
.oz-bt{flex:1;padding:9px 6px;border:0;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;text-align:center;transition:transform .1s}
.oz-bt:active{transform:scale(.96)}
.oz-bt:disabled{opacity:.25;cursor:not-allowed}
.oz-scan{background:#89b4fa;color:#1a1a2e}
.oz-stop{background:#f38ba8;color:#1a1a2e}
.oz-csv{background:#45475a;color:#cdd6f4;font-size:10px;padding:5px}
.oz-xls{background:#a6e3a1;color:#1a1a2e;font-size:10px;padding:5px}
.oz-md{background:#fab387;color:#1a1a2e;font-size:10px;padding:5px}
.oz-clr{background:none;border:1px solid #45475a;color:#6c7086;font-size:9px;padding:5px 8px;border-radius:5px;cursor:pointer}
.oz-clr:hover{color:#f38ba8;border-color:#f38ba8}
.oz-log{max-height:140px;overflow-y:auto;font-size:9px;background:#11111b;border-radius:6px;padding:5px;color:#585b70;line-height:1.4;display:none;font-family:monospace}
.oz-log.on{display:block}
.oz-log i{padding:1px 0;border-bottom:1px solid #181825;display:block}
.oz-msg{position:fixed;top:10px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:8px;font-size:13px;z-index:2147483648;box-shadow:0 2px 12px rgba(0,0,0,.5);pointer-events:none;animation:oz-fd 2.5s ease forwards}
.oz-msg.ok{background:#a6e3a1;color:#1a1a2e}
.oz-msg.err{background:#f38ba8;color:#1a1a2e}
.oz-msg.inf{background:#89b4fa;color:#1a1a2e}
@keyframes oz-fd{0%{opacity:0;top:20px}15%{opacity:1;top:10px}80%{opacity:1;top:10px}100%{opacity:0;top:0}}
#oz-scraper .oz-br2{display:flex;gap:4px;margin-top:0}
`;

    function showMsg(txt, typ) {
        const e = document.createElement('div');
        e.className = 'oz-msg ' + (typ || 'ok');
        e.textContent = txt;
        document.body.appendChild(e);
        setTimeout(() => e.remove(), 2600);
    }

    function addLog(txt) {
        const el = document.getElementById('oz-log');
        if (!el) return;
        el.classList.add('on');
        const i = document.createElement('i');
        i.textContent = '[' + new Date().toLocaleTimeString() + '] ' + txt;
        el.prepend(i);
        while (el.children.length > 80) el.lastChild.remove();
    }

    let panelEl = null;

    function updateUI() {
        getAll().then(cats => {
            const cnt = document.getElementById('oz-cnt');
            const st = document.getElementById('oz-sta');
            const inf = document.getElementById('oz-inf');
            if (cnt) cnt.textContent = cats.length;
            if (st) { st.textContent = '待命中'; st.className = 'oz-lb idle'; }
            if (inf) {
                const l1c = cats.filter(c => c.level === 1).length;
                const l2c = cats.filter(c => c.level === 2).length;
                const l3c = cats.filter(c => c.level === 3).length;
                const l4c = cats.filter(c => c.level === 4).length;
                inf.innerHTML = 'L1:' + l1c + ' L2:' + l2c + ' L3:' + l3c + ' L4:' + l4c;
            }
        }).catch(() => {});
    }

    function createPanel() {
        GM_addStyle(CSS);
        panelEl = document.createElement('div');
        panelEl.id = 'oz-scraper';
        panelEl.innerHTML = `
<div class="oz-hd" id="oz-hd">
  <div class="oz-lg">O</div>
  <div class="oz-tt">Ozon 类目采集 v4</div>
  <button class="oz-cl" id="oz-cl">✕</button>
</div>
<div class="oz-bd">
  <div class="oz-st">
    <span>已存</span><span class="oz-nm" id="oz-cnt">0</span><span>条</span>
    <span class="oz-lb idle" id="oz-sta">待命中</span>
  </div>
  <div class="oz-inf" id="oz-inf">L1:0 L2:0 L3:0 L4:0</div>
  <div class="oz-br">
    <button class="oz-bt oz-scan" id="oz-go">▶ 采集本页</button>
    <button class="oz-bt oz-stop" id="oz-off" disabled>■ 停</button>
  </div>
  <div class="oz-br">
    <button class="oz-bt oz-csv" id="oz-csv">CSV</button>
    <button class="oz-bt oz-xls" id="oz-xls">Excel</button>
    <button class="oz-bt oz-md" id="oz-md">MD文档</button>
  </div>
  <button class="oz-clr" id="oz-clr">清空缓存数据</button>
  <div class="oz-log" id="oz-log"></div>
</div>`;
        document.body.appendChild(panelEl);

        // Draggable
        const hd = document.getElementById('oz-hd');
        let dx = 0, dy = 0, dr = false;
        hd.addEventListener('mousedown', e => {
            if (e.target.id === 'oz-cl') return;
            dr = true; const r = panelEl.getBoundingClientRect();
            dx = e.clientX - r.left; dy = e.clientY - r.top;
            hd.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', e => {
            if (!dr) return;
            const x = Math.max(0, Math.min(e.clientX - dx, innerWidth - panelEl.offsetWidth));
            const y = Math.max(0, Math.min(e.clientY - dy, innerHeight - panelEl.offsetHeight));
            panelEl.style.right = 'auto'; panelEl.style.top = y + 'px'; panelEl.style.left = x + 'px';
        });
        document.addEventListener('mouseup', () => { if (dr) { dr = false; hd.style.cursor = 'grab'; } });

        document.getElementById('oz-go').addEventListener('click', scrapeCurrentPage);
        document.getElementById('oz-off').addEventListener('click', () => {});
        document.getElementById('oz-cl').addEventListener('click', () => panelEl.remove());
        document.getElementById('oz-csv').addEventListener('click', exportCSV);
        document.getElementById('oz-xls').addEventListener('click', exportExcel);
        document.getElementById('oz-md').addEventListener('click', exportMarkdown);
        document.getElementById('oz-clr').addEventListener('click', clearData);

        updateUI();

        // Expose debug
        window.__ozon = {
            dump: () => {
                const r = scrapeAllCategories();
                console.log('=== L1 ===', r.l1);
                console.log('=== L2 ===', r.l2);
                console.log('=== L3+L4 SECTIONS ===', r.l3and4.length, 'sections');
                r.l3and4.forEach((s, i) => {
                    console.log('  [' + i + '] L3:', s.title, '→', s.links.length, 'L4 items');
                });
                return r;
            },
            save: async () => { const r = window.__ozon.dump(); await storeResults(r); },
            cats: getAll,
            clear: clearAll,
            allLinks: () => {
                const links = document.querySelectorAll('a');
                const result = [];
                links.forEach((l, i) => {
                    if (!isChrome(l)) {
                        result.push({ idx: i, text: safeText(l), href: l.getAttribute('href'), tag: l.outerHTML.substring(0, 120) });
                    }
                });
                console.table(result.slice(0, 50));
                return result;
            }
        };
    }

    // ============================================================
    // Scrape + Store
    // ============================================================
    async function scrapeCurrentPage() {
        addLog('🔍 扫描中...');
        showMsg('正在分析页面类目结构...', 'inf');

        const result = scrapeAllCategories();
        const now = new Date().toISOString();
        const items = [];

        // L1
        if (result.l1) {
            items.push({
                id: generateId(),
                name: result.l1,
                level: 1,
                parent: '',
                path: result.l1,
                url: location.pathname,
                emoji: '📁',
                scrapedAt: now,
            });
        }

        // L2
        for (const item of result.l2) {
            items.push({
                id: generateId(),
                name: item.name,
                level: 2,
                parent: result.l1,
                path: (result.l1 ? result.l1 + ' > ' : '') + item.name,
                url: item.url,
                emoji: '📂',
                scrapedAt: now,
            });
        }

        // L3 + L4
        for (const section of result.l3and4) {
            const l3item = {
                id: generateId(),
                name: section.title,
                level: 3,
                parent: result.l2.length > 0 ? result.l2[0]?.name : result.l1,
                path: (result.l1 ? result.l1 + ' > ' : '') + section.title,
                url: '',
                emoji: '📋',
                scrapedAt: now,
            };
            items.push(l3item);

            for (const link of section.links) {
                // Determine which L2 this L4 belongs to
                let parentL2 = result.l2.length > 0 ? result.l2[0]?.name : '';
                items.push({
                    id: generateId(),
                    name: link.name,
                    level: 4,
                    parent: section.title,
                    path: (result.l1 ? result.l1 + ' > ' : '') + (parentL2 ? parentL2 + ' > ' : '') + section.title + ' > ' + link.name,
                    url: link.url,
                    emoji: '📄',
                    scrapedAt: now,
                });
            }
        }

        addLog('L1:' + (result.l1 ? '1' : '0') +
               ' L2:' + result.l2.length +
               ' L3:' + result.l3and4.length +
               ' L4:' + result.l3and4.reduce((s, sec) => s + sec.links.length, 0));

        if (items.length === 0) {
            addLog('⚠ 未提取到类目！');
            addLog('提示: 打开控制台运行 __ozon.dump() 查看详情');
            showMsg('未提取到类目数据！打开 F12 控制台运行 __ozon.dump() 调试', 'err');
            updateUI();
            return;
        }

        await saveBatch(items);
        addLog('✅ 保存 ' + items.length + ' 条');
        showMsg('采集完成！L1~L4 共 ' + items.length + ' 条', 'ok');
        updateUI();
    }

    async function clearData() {
        if (!confirm('确定要清空所有已采集的类目数据？')) return;
        await clearAll();
        addLog('🗑 数据已清空');
        updateUI();
        showMsg('数据已清空', 'ok');
    }

    // ============================================================
    // Boot
    // ============================================================
    function boot() {
        if (document.getElementById('oz-scraper')) return;
        if (!/ozon\.ru/.test(location.hostname)) return;
        if (/\/my\//.test(location.pathname) || /\/cart\//.test(location.pathname) || /\/checkout\//.test(location.pathname)) return;

        console.log('[OzonCat] v4.0.0 boot', location.href);
        createPanel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
