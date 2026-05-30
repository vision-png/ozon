// ==UserScript==
// @name         Ozon Scraper - 四层类目树 + 悬停展开 + 面板保活
// @namespace    https://github.com/vision-png/ozon
// @version      5.0.0
// @description  采集 Ozon.ru 类目树（L1→L2→L3→L4），模拟悬停展开子类目，导出 CSV/Excel/Markdown，面板自动保活
// @author       Qin Yucheng
// @match        https://www.ozon.ru/*
// @match        https://ozon.ru/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
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
    var BASE = 'https://www.ozon.ru';
    var HOVER_DELAY = 1000;   // 悬停后等待展开的时间(ms)
    var SCROLL_DELAY = 500;   // 滚动后的等待时间(ms)

    // ============================================================
    // Utilities
    // ============================================================
    function safeText(el) {
        if (!el) return '';
        return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function buildUrl(path) {
        if (!path) return '';
        if (path.startsWith('http')) return path;
        return BASE + (path.startsWith('/') ? '' : '/') + path;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    }

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    // 模拟鼠标悬停，触发 Ozon 的展开菜单
    function simulateHover(el) {
        if (!el) return;
        var events = ['mouseenter', 'mouseover', 'mousemove'];
        for (var i = 0; i < events.length; i++) {
            var ev = new MouseEvent(events[i], {
                bubbles: true,
                cancelable: true,
                view: window
            });
            el.dispatchEvent(ev);
        }
    }

    // ============================================================
    // 判断元素是否在页面顶部/底部导航区内
    // ============================================================
    function isNavChrome(el) {
        if (!el) return true;
        var selectors = [
            'header', 'footer', 'nav',
            '[class*="header"]', '[class*="footer"]',
            '[class*="sidebar"]', '[class*="nav-"]',
            '[class*="user"]', '[class*="auth"]',
            '[data-widget="header"]', '[data-widget="footer"]',
            '#__next > div:first-child'
        ];
        for (var i = 0; i < selectors.length; i++) {
            try {
                if (el.closest(selectors[i])) return true;
            } catch (e) { /* ignore */ }
        }
        // 也在可视区域顶部 150px 内的元素排除（通常是顶部导航）
        try {
            var rect = el.getBoundingClientRect();
            if (rect.top < 150) return true;
        } catch (e) { /* ignore */ }
        return false;
    }

    // ============================================================
    // 判断一个链接是否是"类目链接"（而不是商品/订单等）
    // ============================================================
    function isCategoryLink(el) {
        var href = (el.getAttribute('href') || '').toLowerCase();
        var text = safeText(el).toLowerCase();

        if (!text || text.length < 2) return false;
        if (text.length > 120) return false;

        // 明确排除
        if (/\/product\//.test(href)) return false;
        if (/\/seller\//.test(href)) return false;
        if (/\/my\//.test(href)) return false;
        if (/\/cart\//.test(href)) return false;
        if (/\/checkout\//.test(href)) return false;
        if (/\/info\//.test(href)) return false;
        if (href === '/' || href === '') return false;
        if (/^https?:\/\//.test(href) && !/ozon\.ru/.test(href)) return false;

        // 明确包含 /category/ 的一定是类目
        if (/\/category\//.test(href)) return true;

        // 形如 /electronics/ 或 /krupnaya-bytovaya-tekhnika-10500/ 的 URL
        if (/^\/[a-zа-яё0-9\-]+\/?$/.test(href)) return true;
        if (/^\/[a-zа-яё0-9\-]+\/\d*\/?$/.test(href)) return true;

        return false;
    }

    // ============================================================
    // 核心：采集当前页面的类目树
    // ============================================================
    async function scrapeCategories() {
        var now = new Date().toISOString();
        var items = [];
        var seen = {};

        // Step 1: 获取 L1（当前页面标题/面包屑）
        var l1Name = getPageCategory();
        if (l1Name) {
            items.push({
                id: generateId(),
                name: l1Name,
                level: 1,
                parent: '',
                url: location.pathname,
                emoji: '📁',
                scrapedAt: now
            });
            seen[l1Name] = true;
        }

        // Step 2: 找到页面上所有"类目链接"元素
        var allLinks = document.querySelectorAll('a');
        var catEls = [];
        for (var i = 0; i < allLinks.length; i++) {
            var el = allLinks[i];
            if (isNavChrome(el)) continue;
            if (!isCategoryLink(el)) continue;
            catEls.push(el);
        }

        console.log('[OzonCat] 找到类目链接:', catEls.length);

        // Step 3: 对可能是"带子类目"的元素模拟悬停
        // Ozon 的做法：鼠标悬停在左侧类目上 → 右侧展开子类目
        var hoverTargets = findHoverTargets(catEls);

        if (hoverTargets.length > 0) {
            addLog('🖱 发现 ' + hoverTargets.length + ' 个可悬停类目，开始模拟悬停...');
            for (var h = 0; h < hoverTargets.length; h++) {
                var target = hoverTargets[h];
                addLog('  悬停: ' + safeText(target.el).substring(0, 30));
                simulateHover(target.el);
                // 等待展开
                await sleep(HOVER_DELAY);
                // 有时需要滚动到元素位置才能触发
                try { target.el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {}
                simulateHover(target.el);
                await sleep(SCROLL_DELAY);
            }
            addLog('✅ 悬停完成，重新扫描页面...');
            // 重新获取链接（现在有了展开的内容）
            allLinks = document.querySelectorAll('a');
            catEls = [];
            for (var i2 = 0; i2 < allLinks.length; i2++) {
                var el2 = allLinks[i2];
                if (isNavChrome(el2)) continue;
                if (!isCategoryLink(el2)) continue;
                catEls.push(el2);
            }
            console.log('[OzonCat] 悬停后重新扫描，找到:', catEls.length);
        }

        // Step 4: 对所有类目链接分层级
        var result = assignLevels(catEls, l1Name);

        // 合并到 items
        for (var j = 0; j < result.length; j++) {
            var r = result[j];
            if (seen[r.name + '|' + r.level]) continue;
            seen[r.name + '|' + r.level] = true;
            items.push({
                id: generateId(),
                name: r.name,
                level: r.level,
                parent: r.parent || '',
                url: r.url || '',
                emoji: ['', '', '📂', '📋', '📄'][r.level] || '📄',
                scrapedAt: now
            });
        }

        return items;
    }

    // 获取当前页面的类目标题（L1）
    function getPageCategory() {
        // 方法1：面包屑最后一个
        var crumbs = document.querySelectorAll('[class*="bread"] a, nav[aria-label] a, [data-widget*="bread"] a');
        if (crumbs.length > 0) {
            var lastCrumb = crumbs[crumbs.length - 1];
            var t = safeText(lastCrumb);
            if (t && t.length > 1 && t.length < 80) return t;
        }

        // 方法2：h1
        var h1 = document.querySelector('h1');
        if (h1) { var t2 = safeText(h1); if (t2) return t2; }

        // 方法3：URL 中的 slug
        var m = location.pathname.match(/\/([a-z0-9\-]+)-(\d+)\/?$/);
        if (m) {
            return m[1].replace(/-/g, ' ').replace(/\d+/g, '').trim();
        }

        return '';
    }

    // 找出需要"悬停"才能展开子类目的元素
    function findHoverTargets(catEls) {
        var targets = [];
        var seen = {};

        for (var i = 0; i < catEls.length; i++) {
            var el = catEls[i];
            var text = safeText(el);
            if (!text || text.length < 2 || text.length > 60) continue;

            // 找父级容器（可能是悬停目标）
            var parent = el.closest('li, [role="menuitem"], [class*="item"], [class*="row"]');
            if (!parent) parent = el.parentElement;

            // 判断这个元素"可能有子类目"：
            //   - 它内部没有 /product/ 链接
            //   - 或者它有一个箭头/展开图标
            var hasProductLink = parent ? parent.querySelector('a[href*="/product/"]') : null;
            var hasArrow = parent ? (parent.querySelector('[class*="arrow"], [class*="chevron"], svg') || el.querySelector('[class*="arrow"], svg')) : null;

            if (!hasProductLink || hasArrow) {
                var key = text.substring(0, 40);
                if (!seen[key]) {
                    seen[key] = true;
                    targets.push({ el: parent || el, text: text });
                }
            }

            // 最多处理 15 个悬停目标（避免太慢）
            if (targets.length >= 15) break;
        }

        return targets;
    }

    // 对所有类目链接判断层级
    function assignLevels(catEls, l1Name) {
        var result = [];
        var l2Set = {};
        var l3Map = {};

        // 先找"主类目区块"——通常在页面中间，字体较大
        // 策略：通过 getComputedStyle 判断 font-size / font-weight
        var l2Candidates = [];

        for (var i = 0; i < catEls.length; i++) {
            var el = catEls[i];
            var text = safeText(el);
            if (!text || text.length < 2) continue;

            // 跳过 L1 自身
            if (l1Name && text === l1Name) continue;

            var style = null;
            try { style = window.getComputedStyle(el); } catch (e) { style = null; }

            var fontSize = style ? parseFloat(style.fontSize) : 14;
            var fontWeight = style ? parseInt(style.fontWeight) || 400 : 400;

            // L2 特征：字体较大(>=15px) 或 字体较粗(>=600)
            if (fontSize >= 15 || fontWeight >= 600) {
                if (!l2Set[text]) {
                    l2Set[text] = true;
                    l2Candidates.push({ name: text, url: el.getAttribute('href') || '', el: el });
                }
            }
        }

        // 如果没有通过样式找到 L2，就用 URL 深度判断
        if (l2Candidates.length === 0) {
            for (var i2 = 0; i2 < catEls.length; i2++) {
                var el2 = catEls[i2];
                var href2 = el2.getAttribute('href') || '';
                var text2 = safeText(el2);
                if (!text2 || text2.length < 2) continue;
                if (l1Name && text2 === l1Name) continue;
                // /category/xxx/ 是 L2
                if (/\/category\/[^/]+\/?$/.test(href2)) {
                    if (!l2Set[text2]) {
                        l2Set[text2] = true;
                        l2Candidates.push({ name: text2, url: href2, el: el2 });
                    }
                }
            }
        }

        // 现在找 L3/L4：在 L2 元素"附近"的链接
        for (var j = 0; j < l2Candidates.length; j++) {
            var l2 = l2Candidates[j];
            result.push({ name: l2.name, level: 2, parent: l1Name || '', url: l2.url });

            // 找这个 L2 元素之后的兄弟元素中的链接 → L3
            var l3Items = findSiblingLinks(l2.el, 3);
            for (var k = 0; k < l3Items.length; k++) {
                var l3 = l3Items[k];
                if (!l3Map[l2.name]) l3Map[l2.name] = [];
                l3Map[l2.name].push(l3);

                result.push({ name: l3.name, level: 3, parent: l2.name, url: l3.url });

                // L3 下方可能还有 L4
                // 找 L3 元素附近的链接
                var l4Items = findSiblingLinks(l3.el, 4);
                for (var m = 0; m < l4Items.length; m++) {
                    result.push({ name: l4Items[m].name, level: 4, parent: l3.name, url: l4Items[m].url });
                }
            }
        }

        // 如果以上都没找到，就把所有类目链接作为 L2 返回
        if (result.length === 0) {
            for (var n = 0; n < catEls.length; n++) {
                var text3 = safeText(catEls[n]);
                var href3 = catEls[n].getAttribute('href') || '';
                if (!text3 || text3.length < 2) continue;
                if (l1Name && text3 === l1Name) continue;
                result.push({ name: text3, level: 2, parent: l1Name || '', url: href3 });
            }
        }

        return result;
    }

    // 找一个元素"后面"的兄弟元素中的链接（用于发现 L3/L4）
    function findSiblingLinks(el, maxDepth) {
        var results = [];
        var seen = {};
        var current = el ? el.parentElement : null;
        if (!current) return results;

        // 向上找容器，然后找容器内所有链接
        var container = el.closest('li, div[class*="item"], div[class*="col"], div[class*="cell"]') || current;

        var links = container.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            if (link === el) continue;
            if (isNavChrome(link)) continue;
            var text = safeText(link);
            if (!text || text.length < 2 || text.length > 100) continue;
            if (seen[text]) continue;
            seen[text] = true;
            results.push({ name: text, url: link.getAttribute('href') || '', el: link });
        }

        return results.slice(0, 30);
    }

    // ============================================================
    // IndexedDB 存储
    // ============================================================
    var DB_NAME = 'OzonCatTreeV5';
    var STORE_NAME = 'categories';
    var dbInstance = null;

    function initDB() {
        if (dbInstance) return Promise.resolve(dbInstance);
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function (e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = function (e) {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            req.onerror = function (e) { reject(e.target.error); };
        });
    }

    function saveItems(items) {
        return initDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                for (var i = 0; i < items.length; i++) {
                    store.put(items[i]);
                }
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    function getAllItems() {
        return initDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var req = store.getAll();
                req.onsuccess = function () { resolve(req.result || []); };
                req.onerror = function () { resolve([]); };
            });
        });
    }

    function clearAll() {
        return initDB().then(function (db) {
            return new Promise(function (resolve) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                store.clear();
                tx.oncomplete = function () { resolve(); };
            });
        });
    }

    // ============================================================
    // SheetJS 动态加载
    // ============================================================
    function loadSheetJS() {
        var urls = [
            'https://cdn.bootcdn.net/ajax/libs/xlsx/0.20.3/xlsx.full.min.js',
            'https://unpkg.com/xlsx@0.20.3/dist/xlsx.full.min.js',
            'https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js'
        ];
        return new Promise(function (resolve) {
            if (typeof XLSX !== 'undefined') { resolve(true); return; }
            var idx = 0;
            function tryNext() {
                if (idx >= urls.length) { resolve(false); return; }
                var s = document.createElement('script');
                s.src = urls[idx];
                s.onload = function () { resolve(true); };
                s.onerror = function () { idx++; tryNext(); };
                document.head.appendChild(s);
            }
            tryNext();
        });
    }

    function downloadBlob(content, filename, mime) {
        var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = filename; a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // ============================================================
    // 导出：Markdown
    // ============================================================
    async function exportMarkdown() {
        var all = await getAllItems();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }

        var l1Items = all.filter(function (c) { return c.level === 1; });
        var l2Items = all.filter(function (c) { return c.level === 2; });
        var l3Items = all.filter(function (c) { return c.level === 3; });
        var l4Items = all.filter(function (c) { return c.level === 4; });

        var md = '# Ozon 类目树\n\n';
        md += '> 采集时间: ' + new Date().toISOString() + '\n';
        md += '> 来源: ' + location.origin + '\n';
        md += '> 总计: ' + all.length + ' 条类目\n\n';
        md += '---\n\n';

        if (l1Items.length > 0) {
            for (var i = 0; i < l1Items.length; i++) {
                var l1 = l1Items[i];
                md += '## ' + (l1.emoji || '📁') + ' ' + l1.name + '\n\n';
                if (l1.url) md += '> ' + buildUrl(l1.url) + '\n\n';

                var children2 = l2Items.filter(function (c) { return c.parent === l1.name; });
                for (var j = 0; j < children2.length; j++) {
                    var l2 = children2[j];
                    md += '### ' + (l2.emoji || '📂') + ' ' + l2.name + '\n\n';
                    if (l2.url) md += '> ' + buildUrl(l2.url) + '\n\n';

                    var children3 = l3Items.filter(function (c) { return c.parent === l2.name; });
                    for (var k = 0; k < children3.length; k++) {
                        var l3 = children3[k];
                        md += '#### ' + (l3.emoji || '📋') + ' ' + l3.name + '\n\n';
                        if (l3.url) md += '> ' + buildUrl(l3.url) + '\n\n';

                        var children4 = l4Items.filter(function (c) { return c.parent === l3.name; });
                        for (var m = 0; m < children4.length; m++) {
                            var l4 = children4[m];
                            md += '- **' + l4.name + '**';
                            if (l4.url) md += ' — [' + buildUrl(l4.url) + '](' + buildUrl(l4.url) + ')';
                            md += '\n';
                        }
                        md += '\n';
                    }
                }
            }
        } else {
            md += '## 📊 按层级分类\n\n';
            for (var lv = 1; lv <= 4; lv++) {
                var items = all.filter(function (c) { return c.level === lv; });
                if (items.length === 0) continue;
                md += '### ' + ['', '一级类目', '二级类目', '三级类目', '四级类目'][lv] + ' (' + items.length + '个)\n\n';
                for (var n = 0; n < items.length; n++) {
                    var item = items[n];
                    md += '- **' + item.name + '**';
                    if (item.parent) md += ' ← ' + item.parent;
                    if (item.url) md += ' [' + buildUrl(item.url) + '](' + buildUrl(item.url) + ')';
                    md += '\n';
                }
                md += '\n';
            }
        }

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
    // 导出：CSV
    // ============================================================
    async function exportCSV() {
        var all = await getAllItems();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }
        var BOM = '\uFEFF';
        var header = ['层级', '类目名', '完整路径', '父类目', 'URL', '采集时间'];
        var rows = all.map(function (c) {
            var path = c.path || c.name;
            return [
                c.level || '',
                '"' + (c.name || '').replace(/"/g, '""') + '"',
                '"' + (path || '').replace(/"/g, '""') + '"',
                '"' + (c.parent || '').replace(/"/g, '""') + '"',
                c.url ? buildUrl(c.url) : '',
                c.scrapedAt || ''
            ].join(',');
        });
        downloadBlob(BOM + header.join(',') + '\n' + rows.join('\n'), 'ozon-categories-' + Date.now() + '.csv', 'text/csv;charset=utf-8');
        showMsg('CSV 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    // ============================================================
    // 导出：Excel
    // ============================================================
    async function exportExcel() {
        var all = await getAllItems();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }
        if (typeof XLSX === 'undefined') {
            showMsg('加载 Excel 库...', 'info');
            var ok = await loadSheetJS();
            if (!ok) { showMsg('Excel 库加载失败，请用 CSV', 'err'); return; }
        }
        var data = all.map(function (c) {
            return {
                '层级': c.level || '',
                '类目名': c.name || '',
                '完整路径': c.path || c.name,
                '父类目': c.parent || '',
                'URL': c.url ? buildUrl(c.url) : '',
                '采集时间': c.scrapedAt || ''
            };
        });
        var ws = XLSX.utils.json_to_sheet(data);
        ws['!cols'] = [{ wch: 6 }, { wch: 35 }, { wch: 50 }, { wch: 30 }, { wch: 60 }, { wch: 22 }];
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ozon类目');
        var buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(new Blob([buf]), 'ozon-categories-' + Date.now() + '.xlsx');
        showMsg('Excel 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    // ============================================================
    // UI
    // ============================================================
    var CSS = '#oz-scraper{position:fixed;top:10px;right:10px;z-index:2147483647;width:310px;background:#1a1a2e;color:#cdd6f4;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.6);font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid #313244;user-select:none}.oz-hd{display:flex;align-items:center;padding:7px 10px;background:#1e1e2e;border-radius:10px 10px 0 0;border-bottom:1px solid #313244;cursor:grab;gap:6px}.oz-hd:active{cursor:grabbing}.oz-lg{width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#667eea,#cba6f7);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;color:#1a1a2e;font-weight:700}.oz-tt{flex:1;font-weight:700;font-size:12px;letter-spacing:0.3px}.oz-cl{background:none;border:none;color:#585b70;cursor:pointer;font-size:15px;padding:0 3px;line-height:1}.oz-cl:hover{color:#f38ba8}.oz-bd{padding:10px;display:flex;flex-direction:column;gap:7px}.oz-st{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#181825;border-radius:6px;font-size:11px}.oz-nm{font-weight:700;color:#89b4fa;font-size:15px;min-width:20px;text-align:center}.oz-lb{font-size:8px;padding:2px 6px;border-radius:8px;text-transform:uppercase;letter-spacing:0.5px}.oz-lb.idle{background:#313244;color:#6c7086}.oz-lb.run{background:#1a3a1a;color:#a6e3a1;animation:oz-pulse 0.8s infinite}@keyframes oz-pulse{0%,100%{opacity:1}50%{opacity:0.5}}.oz-inf{font-size:10px;color:#6c7086;padding:3px 6px;background:#11111b;border-radius:4px;text-align:center;line-height:1.5}.oz-br{display:flex;gap:4px}.oz-bt{flex:1;padding:9px 6px;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;text-align:center;transition:transform 0.1s}.oz-bt:active{transform:scale(0.96)}.oz-bt:disabled{opacity:0.25;cursor:not-allowed}.oz-scan{background:#89b4fa;color:#1a1a2e}.oz-stop{background:#f38ba8;color:#1a1a2e}.oz-csv{background:#45475a;color:#cdd6f4;font-size:10px;padding:5px}.oz-xls{background:#a6e3a1;color:#1a1a2e;font-size:10px;padding:5px}.oz-md{background:#fab387;color:#1a1a2e;font-size:10px;padding:5px}.oz-clr{background:none;border:1px solid #45475a;color:#6c7086;font-size:9px;padding:5px 8px;border-radius:5px;cursor:pointer}.oz-clr:hover{color:#f38ba8;border-color:#f38ba8}.oz-log{max-height:140px;overflow-y:auto;font-size:9px;background:#11111b;border-radius:6px;padding:5px;color:#585b70;line-height:1.4;display:none;font-family:monospace}.oz-log.on{display:block}.oz-log i{padding:1px 0;border-bottom:1px solid #181825;display:block}.oz-msg{position:fixed;top:10px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:8px;font-size:13px;z-index:2147483648;box-shadow:0 2px 12px rgba(0,0,0,0.5);pointer-events:none;animation:oz-fade 2.5s ease forwards}.oz-msg.ok{background:#a6e3a1;color:#1a1a2e}.oz-msg.err{background:#f38ba8;color:#1a1a2e}.oz-msg.inf{background:#89b4fa;color:#1a1a2e}@keyframes oz-fade{0%{opacity:0;top:20px}15%{opacity:1;top:10px}80%{opacity:1;top:10px}100%{opacity:0;top:0}}';

    function showMsg(txt, typ) {
        var e = document.createElement('div');
        e.className = 'oz-msg ' + (typ || 'ok');
        e.textContent = txt;
        document.body.appendChild(e);
        setTimeout(function () { e.remove(); }, 2600);
    }

    function addLog(txt) {
        var el = document.getElementById('oz-log');
        if (!el) return;
        el.classList.add('on');
        var item = document.createElement('i');
        item.textContent = '[' + new Date().toLocaleTimeString() + '] ' + txt;
        el.prepend(item);
        while (el.children.length > 80) el.lastChild.remove();
    }

    var panelEl = null;
    var isRunning = false;
    var keepAliveObserver = null;

    function updateUI() {
        getAllItems().then(function (cats) {
            var cnt = document.getElementById('oz-cnt');
            var st = document.getElementById('oz-sta');
            var inf = document.getElementById('oz-inf');
            if (cnt) cnt.textContent = cats.length;
            if (st) {
                st.textContent = isRunning ? '采集中...' : '待命中';
                st.className = 'oz-lb ' + (isRunning ? 'run' : 'idle');
            }
            if (inf) {
                var l1c = 0, l2c = 0, l3c = 0, l4c = 0;
                for (var i = 0; i < cats.length; i++) {
                    if (cats[i].level === 1) l1c++;
                    if (cats[i].level === 2) l2c++;
                    if (cats[i].level === 3) l3c++;
                    if (cats[i].level === 4) l4c++;
                }
                inf.innerHTML = 'L1:' + l1c + ' L2:' + l2c + ' L3:' + l3c + ' L4:' + l4c;
            }
        }).catch(function () { });
    }

    // 保活机制：如果面板被 React 销毁，重新创建
    function startKeepAlive() {
        if (keepAliveObserver) return;
        keepAliveObserver = new MutationObserver(function () {
            if (!document.getElementById('oz-scraper') && /ozon\.ru/.test(location.hostname)) {
                console.log('[OzonCat] Panel removed by React, recreating...');
                createPanel();
            }
        });
        keepAliveObserver.observe(document.body, { childList: true, subtree: true });
    }

    function stopKeepAlive() {
        if (keepAliveObserver) {
            keepAliveObserver.disconnect();
            keepAliveObserver = null;
        }
    }

    function createPanel() {
        // 如果已经存在，先移除旧的
        var old = document.getElementById('oz-scraper');
        if (old) old.remove();

        GM_addStyle(CSS);
        panelEl = document.createElement('div');
        panelEl.id = 'oz-scraper';
        panelEl.innerHTML = '<div class="oz-hd" id="oz-hd">' +
            '<div class="oz-lg">O</div>' +
            '<div class="oz-tt">Ozon 类目采集 v5</div>' +
            '<button class="oz-cl" id="oz-cl" title="关闭面板">✕</button>' +
            '</div>' +
            '<div class="oz-bd">' +
            '<div class="oz-st">' +
            '<span>已采集</span><span class="oz-nm" id="oz-cnt">0</span><span>条</span>' +
            '<span class="oz-lb idle" id="oz-sta">待命中</span>' +
            '</div>' +
            '<div class="oz-inf" id="oz-inf">L1:0 L2:0 L3:0 L4:0</div>' +
            '<div class="oz-br">' +
            '<button class="oz-bt oz-scan" id="oz-go">▶ 采集本页</button>' +
            '<button class="oz-bt oz-stop" id="oz-off" disabled>■ 停止</button>' +
            '</div>' +
            '<div class="oz-br">' +
            '<button class="oz-bt oz-csv" id="oz-csv">CSV</button>' +
            '<button class="oz-bt oz-xls" id="oz-xls">Excel</button>' +
            '<button class="oz-bt oz-md" id="oz-md">MD文档</button>' +
            '</div>' +
            '<button class="oz-clr" id="oz-clr">清空缓存数据</button>' +
            '<div class="oz-log" id="oz-log"></div>' +
            '</div>';
        document.body.appendChild(panelEl);

        // 拖拽
        var hd = document.getElementById('oz-hd');
        var dx = 0, dy = 0, dragging = false;
        hd.addEventListener('mousedown', function (e) {
            if (e.target.id === 'oz-cl') return;
            dragging = true;
            var r = panelEl.getBoundingClientRect();
            dx = e.clientX - r.left;
            dy = e.clientY - r.top;
            hd.style.cursor = 'grabbing';
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var x = Math.max(0, Math.min(e.clientX - dx, window.innerWidth - panelEl.offsetWidth));
            var y = Math.max(0, Math.min(e.clientY - dy, window.innerHeight - panelEl.offsetHeight));
            panelEl.style.right = 'auto';
            panelEl.style.top = y + 'px';
            panelEl.style.left = x + 'px';
        });
        document.addEventListener('mouseup', function () {
            if (dragging) { dragging = false; hd.style.cursor = 'grab'; }
        });

        // 按钮事件
        document.getElementById('oz-go').addEventListener('click', startScraping);
        document.getElementById('oz-off').addEventListener('click', stopScraping);
        document.getElementById('oz-cl').addEventListener('click', function () { stopKeepAlive(); panelEl.remove(); });
        document.getElementById('oz-csv').addEventListener('click', exportCSV);
        document.getElementById('oz-xls').addEventListener('click', exportExcel);
        document.getElementById('oz-md').addEventListener('click', exportMarkdown);
        document.getElementById('oz-clr').addEventListener('click', clearData);

        updateUI();

        // 暴露调试接口
        window.__ozon = {
            scrape: scrapeCategories,
            save: function (items) { return saveItems(items); },
            getAll: getAllItems,
            clear: clearAll,
            dump: function () {
                scrapeCategories().then(function (items) {
                    console.log('[OzonCat] 采集结果:', items.length, '条');
                    console.table(items.map(function (c) {
                        return { level: c.level, name: c.name, parent: c.parent, url: c.url ? c.url.substring(0, 50) : '' };
                    }));
                });
            }
        };

        // 启动保活
        startKeepAlive();
    }

    async function startScraping() {
        if (isRunning) return;
        isRunning = true;

        var startBtn = document.getElementById('oz-go');
        var stopBtn = document.getElementById('oz-off');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        updateUI();

        showMsg('正在扫描类目，模拟悬停展开...', 'inf');
        addLog('🔍 开始采集 ' + location.pathname);

        try {
            var items = await scrapeCategories();
            addLog('发现 ' + items.length + ' 条类目');

            if (items.length === 0) {
                addLog('⚠ 未发现类目！');
                showMsg('未发现类目数据！请确认当前是 Ozon 类目页', 'err');
            } else {
                await saveItems(items);
                addLog('✅ 保存 ' + items.length + ' 条');
                showMsg('采集完成！共 ' + items.length + ' 条', 'ok');
            }
        } catch (e) {
            addLog('❌ 错误: ' + e.message);
            showMsg('采集出错：' + e.message, 'err');
        }

        isRunning = false;
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        updateUI();
    }

    function stopScraping() {
        isRunning = false;
        var startBtn = document.getElementById('oz-go');
        var stopBtn = document.getElementById('oz-off');
        if (startBtn) startBtn.disabled = false;
        if (stopBtn) stopBtn.disabled = true;
        updateUI();
        showMsg('已停止', 'ok');
    }

    async function clearData() {
        if (!confirm('确定要清空所有已采集的类目数据？')) return;
        await clearAll();
        addLog('🗑 数据已清空');
        updateUI();
        showMsg('数据已清空', 'ok');
    }

    // ============================================================
    // 启动
    // ============================================================
    function boot() {
        if (document.getElementById('oz-scraper')) return;
        if (!/ozon\.ru/.test(location.hostname)) return;
        if (/\/my\//.test(location.pathname) || /\/cart\//.test(location.pathname) || /\/checkout\//.test(location.pathname)) return;

        console.log('[OzonCat] v5.0.0 boot', location.href);
        createPanel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();
