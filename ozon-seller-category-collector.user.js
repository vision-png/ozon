// ==UserScript==
// @name         Ozon 类目批量采集器
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  批量采集 Ozon 卖家后台类目。三种模式：①智能展开（点击展开按钮自动递归展开并采集整棵树）②手动追踪（点哪记哪）③全量扫描（一键抓取当前可见类目）。FAB 悬浮按钮 + 展开式面板。
// @author       You
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/vision-png/ozon/main/ozon-seller-category-collector.user.js
// @downloadURL  https://raw.githubusercontent.com/vision-png/ozon/main/ozon-seller-category-collector.user.js
// @supportURL   https://github.com/vision-png/ozon/issues
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 配置 ====================
    const CONFIG = {
        maxExpandRounds: 80,
        expandDelay: 350,        // 展开后等待 DOM 更新的时间
        stableThreshold: 3,
        scrollStep: 800,
        debug: false,
        clickReadDelay: 150,
        smartExpandTimeout: 60000, // 智能展开最大耗时
    };

    // ==================== 状态 ====================
    let collectedData = [];       // [{path, depth, name}]
    let trackedElements = new Map(); // element -> {path, name, depth}
    let isExpanding = false;
    let isSmartExpanding = false; // 智能展开进行中
    let autoDetectTimer = null;
    let clickTrackerActive = false;
    let currentMode = 'smart';    // 'smart' | 'click' | 'scan'
    let treeContainerRef = null;
    let smartExpandAbort = false; // 中止智能展开

    // ==================== 工具函数 ====================
    function log(...args) {
        console.log('%c[Ozon类目采集]', 'color:#005bff;font-weight:bold;', ...args);
    }
    function debug(...args) {
        if (CONFIG.debug) console.log('%c[OzonDebug]', 'color:#f57c00;', ...args);
    }
    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
    function escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = text;
        return d.innerHTML;
    }

    // ==================== DOM 查找 ====================

    function findTreeContainer() {
        const semanticSelectors = [
            '[data-testid*="category"][data-testid*="tree"]',
            '[data-testid*="category-tree"]',
            '[data-testid*="categoryTree"]',
            '[class*="category-tree" i]',
            '[class*="categoryTree" i]',
            '[class*="CategoryTree" i]',
            '[class*="tree-select" i]',
            '[class*="tree_select" i]',
        ];
        for (const sel of semanticSelectors) {
            const el = document.querySelector(sel);
            if (el) { debug('✓ 树容器 (语义):', sel); return el; }
        }

        const candidates = document.querySelectorAll('div, ul, ol');
        let best = null, bestScore = 0;

        candidates.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 100 || rect.height < 150) return;

            let score = 0;
            score += el.querySelectorAll('input[type="checkbox"], [role="checkbox"]').length * 5;
            score += el.querySelectorAll('[aria-checked], [aria-expanded]').length * 4;
            score += el.querySelectorAll('svg').length * 0.5;
            const text = el.textContent || '';
            if (/Применить|Очистить|应用|清除|Apply|Clear/i.test(text)) score += 10;
            if (/Категории|Категория|类目|Category/i.test(text)) score += 8;

            const spans = el.querySelectorAll('span, div');
            let textCount = 0;
            spans.forEach(n => {
                const t = n.childNodes[0];
                if (t && t.nodeType === 3 && t.textContent.trim().length > 1) textCount++;
            });
            score += textCount * 0.3;

            let depth = 0, p = el;
            while (p) { depth++; p = p.parentElement; }
            score -= depth * 0.2;

            if (score > bestScore && score > 10) {
                bestScore = score;
                best = el;
            }
        });

        if (best) { debug('✓ 树容器 (评分):', bestScore.toFixed(1)); return best; }

        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            const text = div.textContent.trim();
            if (/Применить|Очистить|应用|清除|Apply|Clear/i.test(text)) {
                const rect = div.getBoundingClientRect();
                if (rect.width > 200 && rect.height > 150) {
                    if (div.querySelectorAll('svg').length > 3) {
                        debug('✓ 树容器 (Ozon 面板)');
                        return div;
                    }
                }
            }
        }

        const overlays = document.querySelectorAll([
            '[class*="modal" i] [class*="content" i]:not([class*="modal-overlay" i])',
            '[class*="dropdown" i] [class*="menu" i]',
            '[class*="popover" i] [class*="content" i]',
            '[class*="popup" i]',
        ].join(','));
        for (const ov of overlays) {
            const rect = ov.getBoundingClientRect();
            if (rect.width > 150 && rect.height > 200 && ov.querySelectorAll('div').length > 10) {
                debug('✓ 树容器 (弹窗)');
                return ov;
            }
        }

        debug('✗ 未找到树容器');
        return null;
    }

    /**
     * 查找一行内的展开/折叠按钮
     */
    function findRowExpander(rowEl) {
        if (!rowEl) return null;

        // 策略1：找 aria-expanded 的元素
        const ariaEl = rowEl.querySelector('[aria-expanded]');
        if (ariaEl) return ariaEl;

        // 策略2：找展开相关 class
        const expanders = rowEl.querySelectorAll([
            '[class*="expand" i]',
            '[class*="toggle" i]',
            '[class*="arrow" i]',
            '[class*="chevron" i]',
            '[class*="collapse" i]',
        ].join(','));
        for (const el of expanders) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.width < 40 && rect.height < 40) {
                return el;
            }
        }

        // 策略3：找小 SVG（通常在行左侧）
        const rowRect = rowEl.getBoundingClientRect();
        const svgs = rowEl.querySelectorAll('svg');
        for (const svg of svgs) {
            const rect = svg.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.width < 30 && rect.height < 30) {
                const relativeX = rect.left - rowRect.left;
                if (relativeX < 80) { // 左侧区域才可能是展开按钮
                    return svg;
                }
            }
        }

        // 策略4：找 button（排除 checkbox 按钮）
        const buttons = rowEl.querySelectorAll('button');
        for (const btn of buttons) {
            const rect = btn.getBoundingClientRect();
            if (rect.width < 40 && rect.height < 40) {
                const relativeX = rect.left - rowRect.left;
                if (relativeX < 80) return btn;
            }
        }

        return null;
    }

    /**
     * 判断一行是否已经展开
     */
    function isRowExpanded(rowEl, container) {
        const expander = findRowExpander(rowEl);
        if (expander) {
            const aria = expander.getAttribute('aria-expanded');
            if (aria === 'true') return true;
            if (aria === 'false') return false;
        }

        // 通过子节点存在性判断
        const allRows = getAllVisibleRows(container);
        const idx = allRows.indexOf(rowEl);
        if (idx === -1 || idx >= allRows.length - 1) return false;

        const parentIndent = getIndent(rowEl);
        const nextRow = allRows[idx + 1];
        if (nextRow) {
            const nextIndent = getIndent(nextRow);
            const nextName = extractRowName(nextRow);
            if (nextName && nextIndent > parentIndent) return true;
        }

        return false;
    }

    /**
     * 查找容器内所有已折叠的展开按钮
     */
    function findCollapsedExpanders(container) {
        if (!container) return [];
        const found = new Set();

        container.querySelectorAll('[aria-expanded="false"]').forEach(el => found.add(el));

        const classHints = [
            '[class*="expand" i]:not([class*="expanded" i]):not([class*="open" i])',
            '[class*="toggle" i]:not([class*="open" i])',
            '[class*="arrow-right" i]',
            '[class*="chevron-right" i]',
        ];
        classHints.forEach(sel => {
            container.querySelectorAll(sel).forEach(el => {
                if (!el.closest('[aria-expanded="true"]') && !el.closest('[class*="expanded" i]')) {
                    found.add(el);
                }
            });
        });

        container.querySelectorAll('svg').forEach(svg => {
            const rect = svg.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.width < 30 && rect.height < 30) {
                if (!svg.closest('[aria-expanded="true"]')) found.add(svg);
            }
        });

        const result = [];
        found.forEach(el => {
            let clickable = el;
            while (clickable && clickable !== container) {
                const tag = clickable.tagName.toLowerCase();
                const style = window.getComputedStyle(clickable);
                if (tag === 'button' || tag === 'a' || style.cursor === 'pointer') break;
                clickable = clickable.parentElement;
            }
            result.push(clickable !== container ? clickable : el);
        });

        return [...new Set(result)];
    }

    // ==================== 数据提取 ====================

    function extractRowName(rowEl) {
        if (!rowEl) return '';
        const candidates = [];

        rowEl.querySelectorAll('span, div, p, label, a').forEach(el => {
            const hasTextChild = Array.from(el.children).some(c => {
                const t = c.textContent.trim();
                return t.length > 0 && c.getBoundingClientRect().height > 0;
            });
            if (hasTextChild) return;

            const text = (el.textContent || '').trim();
            if (text.length === 0 || text.length > 150) return;
            if (/^\d+$/.test(text)) return;
            if (!/[\u4e00-\u9fa5a-zA-Zа-яА-ЯЁё0-9]/.test(text)) return;

            const rect = el.getBoundingClientRect();
            candidates.push({ text, width: rect.width, el });
        });

        if (candidates.length > 0) {
            const visible = candidates.filter(c => c.width > 15 && c.el.getBoundingClientRect().height > 0);
            if (visible.length > 0) {
                visible.sort((a, b) => b.width - a.width);
                return visible[0].text.split('\n')[0].trim();
            }
        }

        const allText = rowEl.textContent.trim();
        const lines = allText.split('\n').map(l => l.trim()).filter(l => l.length > 1 && l.length < 100);
        for (const line of lines) {
            if (/[\u4e00-\u9fa5a-zA-Zа-яА-ЯЁё]/.test(line) && /^\d+$/.test(line)) return line;
        }
        return '';
    }

    function getIndent(el) {
        if (!el) return 0;
        const s = window.getComputedStyle(el);
        return (parseFloat(s.paddingLeft) || 0) + (parseFloat(s.marginLeft) || 0);
    }

    function getAllVisibleRows(container) {
        const rows = [];
        const excluded = /Применить|Очистить|应用|清除|Apply|Clear|选择|Выбрать|Категории|搜索|Search|Найти/i;

        for (const child of container.children) {
            const rect = child.getBoundingClientRect();
            const text = child.textContent.trim();
            if (rect.height > 12 && rect.height < 120 && text.length > 1 && text.length < 500) {
                if (excluded.test(text) && rect.height < 60) continue;
                rows.push(child);
            }
        }

        if (rows.length < 3) {
            for (const child of container.children) {
                for (const gc of child.children) {
                    const rect = gc.getBoundingClientRect();
                    const text = gc.textContent.trim();
                    if (rect.height > 12 && rect.height < 120 && text.length > 1 && text.length < 500) {
                        if (excluded.test(text) && rect.height < 60) continue;
                        if (!rows.includes(gc)) rows.push(gc);
                    }
                }
            }
        }

        return rows;
    }

    /**
     * 通过缩进栈构建行的完整路径
     */
    function buildRowPath(targetRow, allRows) {
        const name = extractRowName(targetRow);
        if (!name) return { path: '未知', depth: 1, name: '未知' };

        const targetIndent = getIndent(targetRow);
        const stack = [];

        for (const row of allRows) {
            const indent = getIndent(row);
            const rName = extractRowName(row);
            if (!rName) continue;

            while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
                stack.pop();
            }
            stack.push({ indent, name: rName });

            if (row === targetRow) {
                const pathParts = stack.map(s => s.name).filter(Boolean);
                return {
                    path: pathParts.join(' > '),
                    depth: pathParts.length,
                    name
                };
            }
        }

        return { path: name, depth: 1, name };
    }

    /**
     * 查找某一行的直接子行
     */
    function findChildRows(parentRow, allRows) {
        const parentIdx = allRows.indexOf(parentRow);
        if (parentIdx === -1) return [];

        const parentIndent = getIndent(parentRow);
        const children = [];
        let childIndent = null;

        for (let i = parentIdx + 1; i < allRows.length; i++) {
            const row = allRows[i];
            const indent = getIndent(row);
            const name = extractRowName(row);

            if (!name) continue;

            if (indent <= parentIndent) {
                break; // 遇到同级或更高级节点
            }

            if (childIndent === null) {
                childIndent = indent; // 记录第一个子节点的缩进
            }

            if (indent === childIndent) {
                children.push(row);
            }
            // indent > childIndent 的是孙节点，跳过
        }

        return children;
    }

    /**
     * 找到被点击元素对应的行容器
     */
    function findClickedRow(clickedEl, container) {
        let current = clickedEl;
        for (let i = 0; i < 12; i++) {
            if (!current || current === container || current === document.body) return null;
            const parent = current.parentElement;
            if (parent && parent !== container && parent.children.length > 1) {
                const pRect = parent.getBoundingClientRect();
                if (pRect.width > 60 && pRect.height > 16 && pRect.height < 200) {
                    return parent;
                }
            }
            current = parent || current.parentElement;
        }
        return current;
    }

    // ==================== 数据采集 ====================

    function addCollectedData(item) {
        if (!item.name || item.name === '未知') return;
        // 去重
        const exists = collectedData.some(d => d.path === item.path);
        if (!exists) {
            collectedData.push(item);
        }
    }

    // ==================== 智能展开采集（v3.0 核心）====================

    async function smartExpandAndCollect(startRow, container, visited = new Set()) {
        if (!startRow || visited.has(startRow)) return;
        if (smartExpandAbort) return;

        visited.add(startRow);

        // 先采集当前行
        const allRows = getAllVisibleRows(container);
        const { path, depth, name } = buildRowPath(startRow, allRows);
        if (name && name !== '未知') {
            addCollectedData({ path, depth, name });
            trackedElements.set(startRow, { path, name, depth });
        }

        // 查找展开按钮
        const expander = findRowExpander(startRow);
        if (!expander) {
            debug('叶子节点:', name);
            return;
        }

        // 检查是否已展开
        const alreadyExpanded = isRowExpanded(startRow, container);

        if (!alreadyExpanded) {
            // 需要展开
            debug('展开节点:', name);
            try {
                expander.scrollIntoView({ block: 'center', behavior: 'instant' });
                expander.click();
            } catch (e) {
                debug('展开点击失败:', e);
            }

            // 等待子节点加载（最多等待 3 秒）
            let prevChildCount = 0;
            let stableRounds = 0;
            for (let i = 0; i < 15; i++) {
                await sleep(200);
                if (smartExpandAbort) return;

                const currentRows = getAllVisibleRows(container);
                const children = findChildRows(startRow, currentRows);

                if (children.length === prevChildCount) {
                    stableRounds++;
                    if (stableRounds >= 2) break;
                } else {
                    stableRounds = 0;
                    prevChildCount = children.length;
                }
            }
        } else {
            debug('节点已展开:', name);
        }

        // 获取展开后的子节点
        if (smartExpandAbort) return;
        const currentRows = getAllVisibleRows(container);
        const childRows = findChildRows(startRow, currentRows);

        debug('子节点:', childRows.length, '个 ←', name);

        // 递归展开每个子节点
        for (const child of childRows) {
            if (smartExpandAbort) return;
            await smartExpandAndCollect(child, container, visited);
        }
    }

    async function runSmartExpandFromClick(targetRow, container) {
        if (isSmartExpanding) {
            alert('智能展开采集中，请稍候...');
            return;
        }

        isSmartExpanding = true;
        smartExpandAbort = false;
        updateStatus('智能展开采集中...');

        // 在面板上显示中止按钮
        showAbortButton();

        const startTime = Date.now();
        const visited = new Set();

        try {
            await smartExpandAndCollect(targetRow, container, visited);
        } catch (e) {
            debug('智能展开异常:', e);
        }

        isSmartExpanding = false;
        hideAbortButton();

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        updateStatus(`智能展开完成 ✓ ${collectedData.length} 条 (${elapsed}秒)`);
        renderResults();
        log('智能展开完成:', collectedData.length, '条, 耗时', elapsed, '秒');
    }

    function abortSmartExpand() {
        smartExpandAbort = true;
        isSmartExpanding = false;
        hideAbortButton();
        updateStatus('已中止');
    }

    // ==================== 展开全部（保留）====================

    async function expandAll() {
        if (isExpanding) { alert('正在展开中，请稍候...'); return; }

        const container = findTreeContainer();
        if (!container) {
            alert('未找到类目树！\n\n请先点击「类目」按钮打开类目筛选弹窗/下拉框。');
            return;
        }

        isExpanding = true;
        updateStatus('展开中...');

        let round = 0, stableRounds = 0;

        while (round < CONFIG.maxExpandRounds && stableRounds < CONFIG.stableThreshold) {
            container.scrollTop = container.scrollHeight;
            await sleep(100);

            const toExpand = findCollapsedExpanders(container);
            if (toExpand.length === 0) {
                stableRounds++;
            } else {
                stableRounds = 0;
                for (const btn of toExpand) {
                    try {
                        btn.scrollIntoView({ block: 'center', behavior: 'instant' });
                        btn.click();
                    } catch (e) { debug('点击展开失败:', e); }
                }
            }

            updateStatus(`展开中... 第 ${round + 1} 轮 (${toExpand.length} 个)`);
            await sleep(CONFIG.expandDelay);
            round++;
        }

        isExpanding = false;
        updateStatus(`展开完成 ✓ 共 ${round} 轮`);
        refreshTreeContainer();
    }

    // ==================== 点击追踪模式（保留）====================

    function startClickTracker() {
        if (clickTrackerActive) return;
        clickTrackerActive = true;
        document.addEventListener('mousedown', onTreeClick, true);
        log('点击追踪已启用');
    }

    function stopClickTracker() {
        clickTrackerActive = false;
        document.removeEventListener('mousedown', onTreeClick, true);
        log('点击追踪已关闭');
    }

    function onTreeClick(e) {
        if (e.target.closest('#ozon-fab-root')) return;
        if (e.target.closest('#ozon-panel')) return;

        const container = treeContainerRef || findTreeContainer();
        if (!container || !container.contains(e.target)) return;

        const row = findClickedRow(e.target, container);
        if (!row) return;

        if (currentMode === 'smart') {
            // 智能展开模式
            const expander = findRowExpander(row);
            const isExpanderClick = expander && (expander === e.target || expander.contains(e.target));
            const expanded = isRowExpanded(row, container);

            if (isExpanderClick || !expanded) {
                // 点击展开按钮 或 节点未展开 → 智能展开采集
                e.preventDefault();
                e.stopPropagation();
                runSmartExpandFromClick(row, container);
            } else {
                // 节点已展开，点击文本区 → 当作普通追踪
                setTimeout(() => handleTreeItemClick(e.target, container), CONFIG.clickReadDelay);
            }
        } else {
            // 普通点击追踪
            setTimeout(() => handleTreeItemClick(e.target, container), CONFIG.clickReadDelay);
        }
    }

    function handleTreeItemClick(target, container) {
        const row = findClickedRow(target, container);
        if (!row) { debug('点击追踪：未找到行', target); return; }

        const name = extractRowName(row);
        if (!name) { debug('点击追踪：未提取到名称', row); return; }

        const allRows = getAllVisibleRows(container);
        const { path, depth } = buildRowPath(row, allRows);

        if (trackedElements.has(row)) {
            trackedElements.delete(row);
            collectedData = collectedData.filter(d => d.path !== path);
            debug('取消追踪:', name);
        } else {
            trackedElements.set(row, { path, name, depth });
            addCollectedData({ path, depth, name });
            debug('追踪:', name, '→', path);
        }

        updateStatus(`已追踪 ${collectedData.length} 条类目`);
        renderResults();
        flashRow(row);
    }

    function flashRow(rowEl) {
        if (!rowEl) return;
        const orig = rowEl.style.outline;
        const origTransition = rowEl.style.transition;
        rowEl.style.transition = 'outline 0.15s';
        rowEl.style.outline = '2px solid #005bff';
        setTimeout(() => {
            rowEl.style.outline = '2px solid #34a853';
            setTimeout(() => {
                rowEl.style.outline = orig || '';
                rowEl.style.transition = origTransition || '';
            }, 400);
        }, 200);
    }

    // ==================== 全量扫描（保留）====================

    async function scanAll() {
        const container = findTreeContainer();
        if (!container) {
            alert('未找到类目树！\n\n请先点击「类目」按钮打开类目筛选弹窗。');
            return;
        }

        updateStatus('扫描中...');

        const totalHeight = container.scrollHeight;
        let scrolled = 0;
        const step = CONFIG.scrollStep;
        while (scrolled < totalHeight) {
            container.scrollTop = scrolled;
            await sleep(80);
            scrolled += step;
        }
        container.scrollTop = 0;
        await sleep(200);

        const allRows = getAllVisibleRows(container);
        collectedData = [];
        trackedElements.clear();
        const seen = new Set();

        for (const row of allRows) {
            const { path, depth, name } = buildRowPath(row, allRows);
            if (name && name !== '未知' && !seen.has(path)) {
                seen.add(path);
                collectedData.push({ path, depth, name });
                trackedElements.set(row, { path, name, depth });
            }
        }

        updateStatus(`扫描完成 ✓ 共 ${collectedData.length} 条类目`);
        renderResults();
        log('全量扫描结果:', collectedData.length, '条');
    }

    // ==================== 结果渲染 & 导出 ====================

    function renderResults() {
        const tbody = document.getElementById('ozon-collector-tbody');
        if (!tbody) return;

        document.getElementById('ozon-result-count').textContent = collectedData.length;

        if (collectedData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">暂无数据</td></tr>';
            return;
        }

        tbody.innerHTML = collectedData.map((item, i) => `
            <tr>
                <td style="text-align:center;color:#999;">${i + 1}</td>
                <td>${escapeHtml(item.path)}</td>
                <td style="text-align:center;">${item.depth}</td>
                <td style="text-align:center;">
                    <button class="ozon-remove-btn" data-idx="${i}" title="移除此条" style="background:none;border:1px solid #dadce0;border-radius:4px;padding:2px 8px;cursor:pointer;color:#5f6368;font-size:11px;">✕</button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.ozon-remove-btn').forEach(btn => {
            btn.onclick = () => {
                const idx = parseInt(btn.dataset.idx);
                const removed = collectedData.splice(idx, 1)[0];
                for (const [el, info] of trackedElements) {
                    if (info.path === removed.path) trackedElements.delete(el);
                }
                renderResults();
                updateStatus(`已追踪 ${collectedData.length} 条类目`);
            };
        });
    }

    function clearAll() {
        collectedData = [];
        trackedElements.clear();
        renderResults();
        updateStatus('已清空');
    }

    function downloadCSV() {
        if (collectedData.length === 0) {
            alert('没有数据！请先采集类目。');
            return;
        }

        const headers = ['完整路径', '层级深度', '类目名称'];
        const rows = collectedData.map(d => [d.path, d.depth, d.name]);

        const csv = [
            headers.join(','),
            ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
        ].join('\r\n');

        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const ts = new Date().toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        }).replace(/[/:]/g, '-').replace(/\s/g, '_');

        const a = document.createElement('a');
        a.href = url;
        a.download = `ozon-categories-${ts}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        updateStatus(`CSV 已下载 ✓ ${collectedData.length} 条`);
    }

    // ==================== 自动检测 & 刷新 ====================

    function refreshTreeContainer() {
        const c = findTreeContainer();
        if (c) {
            treeContainerRef = c;
            debug('容器已刷新');
        }
    }

    // ==================== UI ====================

    function updateStatus(text) {
        const el = document.getElementById('ozon-collector-status');
        if (el) {
            el.textContent = text;
            el.className = text.includes('✓') ? 'status-ok' : text.includes('✗') ? 'status-warn' : '';
        }
        const badge = document.getElementById('ozon-fab-badge');
        if (badge) {
            const match = text.match(/(\d+)\s*条/);
            badge.textContent = match ? match[1] : '';
            badge.style.display = match ? 'flex' : 'none';
        }
    }

    function showAbortButton() {
        const btn = document.getElementById('ozon-btn-abort');
        if (btn) btn.style.display = 'flex';
    }

    function hideAbortButton() {
        const btn = document.getElementById('ozon-btn-abort');
        if (btn) btn.style.display = 'none';
    }

    function initUI() {
        if (document.getElementById('ozon-fab-root')) return;

        const style = document.createElement('style');
        style.textContent = `
            /* ===== FAB ===== */
            #ozon-fab-root {
                position: fixed;
                bottom: 32px;
                right: 32px;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif;
            }
            #ozon-fab {
                width: 56px; height: 56px; border-radius: 50%;
                background: linear-gradient(135deg, #005bff 0%, #003d99 100%);
                border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
                box-shadow: 0 4px 16px rgba(0,91,255,0.4), 0 2px 4px rgba(0,0,0,0.12);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative; outline: none; color: #fff;
            }
            #ozon-fab:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(0,91,255,0.5); }
            #ozon-fab:active { transform: scale(0.95); }
            #ozon-fab.open { border-radius: 16px; width: 44px; height: 44px; background: linear-gradient(135deg, #e8eaed 0%, #dadce0 100%); box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
            #ozon-fab svg { width: 26px; height: 26px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
            #ozon-fab.open svg { transform: rotate(90deg); width: 20px; height: 20px; color: #5f6368; }
            #ozon-fab.tracking { background: linear-gradient(135deg, #34a853 0%, #1e8e3e 100%); box-shadow: 0 4px 16px rgba(52,168,83,0.4); }
            #ozon-fab.tracking.open { background: linear-gradient(135deg, #e8eaed 0%, #dadce0 100%); }
            #ozon-fab::before {
                content: ''; position: absolute; width: 100%; height: 100%; border-radius: 50%;
                background: rgba(0,91,255,0.3); animation: ozon-fab-pulse 2.5s ease-in-out infinite; z-index: -1;
            }
            #ozon-fab.tracking::before { background: rgba(52,168,83,0.3); }
            #ozon-fab.open::before { animation: none; opacity: 0; }
            @keyframes ozon-fab-pulse { 0%,100%{transform:scale(1);opacity:0.4;} 50%{transform:scale(1.6);opacity:0;} }
            #ozon-fab-badge {
                position: absolute; top: -4px; right: -4px; min-width: 20px; height: 20px; padding: 0 6px;
                border-radius: 10px; background: #e37400; color: #fff; font-size: 11px; font-weight: 600;
                display: none; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(227,116,0,0.3); line-height: 1;
            }
            #ozon-fab-tip {
                position: absolute; right: 68px; top: 50%; transform: translateY(-50%);
                background: #323232; color: #fff; font-size: 13px; padding: 6px 12px; border-radius: 6px;
                white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            }
            #ozon-fab-tip::after { content:''; position: absolute; right: -6px; top: 50%; transform: translateY(-50%) rotate(45deg); width: 10px; height: 10px; background: #323232; }
            #ozon-fab:hover #ozon-fab-tip { opacity: 1; }

            /* ===== 面板 ===== */
            #ozon-panel {
                position: fixed; bottom: 100px; right: 32px; width: 520px; max-height: 620px;
                background: #fff; border-radius: 16px;
                box-shadow: 0 12px 48px rgba(0,0,0,0.2), 0 4px 12px rgba(0,0,0,0.08);
                font-size: 13px; color: #333; z-index: 2147483646;
                overflow: hidden; display: flex; flex-direction: column; line-height: 1.5;
                transform-origin: bottom right;
                transform: scale(0.4) translateY(20px); opacity: 0; pointer-events: none;
                transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease;
            }
            #ozon-panel.visible { transform: scale(1) translateY(0); opacity: 1; pointer-events: auto; }
            #ozon-panel-header {
                background: linear-gradient(135deg, #005bff 0%, #003d99 100%); color: #fff;
                padding: 14px 18px; font-weight: 600; font-size: 15px;
                display: flex; justify-content: space-between; align-items: center;
                cursor: move; user-select: none; flex-shrink: 0; letter-spacing: 0.3px;
            }
            #ozon-panel-header .ozon-header-title { display: flex; align-items: center; gap: 8px; }
            #ozon-panel-header button {
                background: rgba(255,255,255,0.15); border: none; color: #fff; font-size: 15px;
                cursor: pointer; width: 28px; height: 28px; line-height: 28px; text-align: center;
                border-radius: 8px; padding: 0; transition: background 0.15s;
            }
            #ozon-panel-header button:hover { background: rgba(255,255,255,0.3); }
            #ozon-panel-body { padding: 16px 18px 18px; overflow-y: auto; flex: 1; min-height: 0; }

            /* 模式切换 */
            #ozon-mode-bar {
                display: flex; gap: 4px; margin-bottom: 14px; padding: 4px;
                background: #f1f3f4; border-radius: 10px;
            }
            .ozon-mode-btn {
                flex: 1; padding: 8px 4px; border: none; border-radius: 8px; font-size: 12px;
                font-weight: 500; cursor: pointer; transition: all 0.2s; background: transparent; color: #5f6368;
                display: flex; align-items: center; justify-content: center; gap: 4px;
                white-space: nowrap;
            }
            .ozon-mode-btn.active {
                background: #fff; color: #1967d2; box-shadow: 0 1px 4px rgba(0,0,0,0.12); font-weight: 600;
            }
            .ozon-mode-btn:hover:not(.active) { background: #e8eaed; }
            .ozon-mode-btn svg { width: 14px; height: 14px; flex-shrink: 0; }

            /* 模式提示 */
            #ozon-mode-hint {
                margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; font-size: 12px;
                background: linear-gradient(135deg, #e6f4ea 0%, #ceead6 100%);
                border: 1px solid #a8dab5; color: #1e8e3e;
                display: flex; align-items: center; gap: 8px;
            }
            #ozon-mode-hint svg { width: 18px; height: 18px; flex-shrink: 0; }
            #ozon-mode-hint.paused { display: none; }
            #ozon-mode-hint.smart-hint { background: linear-gradient(135deg, #e8f0fe 0%, #d2e3fc 100%); border-color: #a8c7fa; color: #1967d2; }
            #ozon-mode-hint.scan-hint { background: linear-gradient(135deg, #fef3e8 0%, #fce8cc 100%); border-color: #f5c88a; color: #e37400; }

            /* 操作按钮 */
            #ozon-panel-buttons { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }
            #ozon-panel-buttons button {
                flex: 1; min-width: 90px; padding: 9px 6px; border: none; border-radius: 10px;
                font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
                display: flex; align-items: center; justify-content: center; gap: 5px;
            }
            #ozon-panel-buttons button:active { transform: scale(0.97); }
            #ozon-panel-buttons button svg { width: 14px; height: 14px; }
            .ozon-btn-blue { background: linear-gradient(135deg, #e8f0fe, #d2e3fc); color: #1967d2; border: 1px solid #a8c7fa !important; }
            .ozon-btn-blue:hover { background: linear-gradient(135deg, #d2e3fc, #aecbfa); }
            .ozon-btn-green { background: linear-gradient(135deg, #e6f4ea, #ceead6); color: #1e8e3e; border: 1px solid #a8dab5 !important; }
            .ozon-btn-green:hover { background: linear-gradient(135deg, #ceead6, #b7e1c7); }
            .ozon-btn-orange { background: linear-gradient(135deg, #fef3e8, #fce8cc); color: #e37400; border: 1px solid #f5c88a !important; }
            .ozon-btn-orange:hover { background: linear-gradient(135deg, #fce8cc, #fad9a8); }
            .ozon-btn-red { background: linear-gradient(135deg, #fce8e6, #f7d7d5); color: #d93025; border: 1px solid #f0b8b5 !important; }
            .ozon-btn-red:hover { background: linear-gradient(135deg, #f7d7d5, #f0b8b5); }
            .ozon-btn-gray { background: #f1f3f4; color: #5f6368; border: 1px solid #dadce0 !important; }
            .ozon-btn-gray:hover { background: #e8eaed; }

            /* 中止按钮 */
            #ozon-btn-abort {
                display: none; background: linear-gradient(135deg, #fce8e6, #f7d7d5) !important;
                color: #d93025 !important; border: 1px solid #f0b8b5 !important;
                animation: ozon-abort-pulse 1.5s ease-in-out infinite;
            }
            @keyframes ozon-abort-pulse { 0%,100%{opacity:1;} 50%{opacity:0.6;} }

            /* 选项栏 */
            #ozon-panel-options {
                display: flex; align-items: center; justify-content: space-between;
                margin-bottom: 10px; padding: 6px 0;
                border-top: 1px solid #f1f3f4; border-bottom: 1px solid #f1f3f4;
            }
            #ozon-panel-options label { cursor: pointer; display: flex; align-items: center; gap: 5px; font-size: 12px; color: #666; }
            #ozon-panel-options input[type="checkbox"] { cursor: pointer; accent-color: #005bff; }

            /* 状态栏 */
            #ozon-collector-status {
                font-size: 12px; color: #5f6368; margin-bottom: 12px; padding: 8px 12px;
                background: #f8f9fa; border-radius: 8px; border-left: 3px solid #005bff; transition: all 0.3s;
            }
            #ozon-collector-status.status-ok { border-left-color: #34a853; background: #f0faf0; color: #1e8e3e; }
            #ozon-collector-status.status-warn { border-left-color: #e37400; background: #fef8f0; color: #e37400; }

            /* 结果表格 */
            #ozon-collector-results { max-height: 240px; overflow-y: auto; border: 1px solid #e8eaed; border-radius: 10px; background: #fafbfc; }
            #ozon-collector-results table { width: 100%; border-collapse: collapse; font-size: 12px; }
            #ozon-collector-results th, #ozon-collector-results td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #e8eaed; white-space: nowrap; }
            #ozon-collector-results th { background: #f1f3f4; font-weight: 600; position: sticky; top: 0; color: #5f6368; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; z-index: 1; }
            #ozon-collector-results tr:last-child td { border-bottom: none; }
            #ozon-collector-results tr:hover td { background: #e8f0fe; }
            #ozon-collector-results td:nth-child(2) { white-space: normal; word-break: break-all; max-width: 280px; }
            .ozon-remove-btn { transition: all 0.15s; }
            .ozon-remove-btn:hover { background: #d93025 !important; color: #fff !important; border-color: #d93025 !important; }

            /* 结果计数 */
            #ozon-result-bar { margin-top: 10px; font-size: 11px; color: #999; text-align: center; }
        `;

        document.head.appendChild(style);

        const root = document.createElement('div');
        root.id = 'ozon-fab-root';
        root.innerHTML = `
            <button id="ozon-fab" title="Ozon 类目采集器">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 7h16M4 12h16M4 17h10"/>
                </svg>
                <span id="ozon-fab-badge"></span>
                <span id="ozon-fab-tip">类目采集器</span>
            </button>
            <div id="ozon-panel">
                <div id="ozon-panel-header">
                    <div class="ozon-header-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                        <span>Ozon 类目采集器 v3.0</span>
                    </div>
                    <button id="ozon-btn-collapse" title="收起">▾</button>
                </div>
                <div id="ozon-panel-body">
                    <!-- 模式切换 -->
                    <div id="ozon-mode-bar">
                        <button class="ozon-mode-btn active" data-mode="smart">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-3 3"/></svg>
                            智能展开
                        </button>
                        <button class="ozon-mode-btn" data-mode="click">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>
                            手动追踪
                        </button>
                        <button class="ozon-mode-btn" data-mode="scan">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
                            全量扫描
                        </button>
                    </div>

                    <!-- 模式提示 -->
                    <div id="ozon-mode-hint" class="smart-hint">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                        <span>点击类目旁的「展开箭头」→ 自动递归展开并采集该节点下所有子类目</span>
                    </div>

                    <!-- 操作按钮 -->
                    <div id="ozon-panel-buttons">
                        <button id="ozon-btn-expand" class="ozon-btn-blue" title="递归展开所有类目节点（不采集）">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
                            展开全部
                        </button>
                        <button id="ozon-btn-scan" class="ozon-btn-green" title="一键抓取当前页面所有可见类目">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                            扫描当前
                        </button>
                        <button id="ozon-btn-download" class="ozon-btn-orange" title="导出 CSV">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                            下载 CSV
                        </button>
                        <button id="ozon-btn-abort" class="ozon-btn-red" title="中止智能展开">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                            中止
                        </button>
                        <button id="ozon-btn-clear" class="ozon-btn-red" title="清空所有采集数据">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            清空
                        </button>
                    </div>

                    <!-- 选项 -->
                    <div id="ozon-panel-options">
                        <label title="控制台输出详细日志">
                            <input type="checkbox" id="ozon-debug-toggle"> 调试模式
                        </label>
                        <button id="ozon-btn-detect" class="ozon-btn-gray" style="padding:4px 12px;font-size:11px;border-radius:6px;border:1px solid #dadce0;background:#f8f9fa;cursor:pointer;color:#5f6368;">检测树</button>
                    </div>

                    <div id="ozon-collector-status">就绪 — 请先打开「类目」筛选弹窗</div>
                    <div id="ozon-collector-results">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width:30px;text-align:center;">#</th>
                                    <th>完整路径</th>
                                    <th style="width:50px;text-align:center;">深度</th>
                                    <th style="width:40px;text-align:center;"></th>
                                </tr>
                            </thead>
                            <tbody id="ozon-collector-tbody">
                                <tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">暂无数据</td></tr>
                            </tbody>
                        </table>
                    </div>
                    <div id="ozon-result-bar">共 <span id="ozon-result-count">0</span> 条</div>
                </div>
            </div>
        `;

        document.body.appendChild(root);

        const fab = document.getElementById('ozon-fab');
        const panel = document.getElementById('ozon-panel');
        const modeHint = document.getElementById('ozon-mode-hint');
        let panelOpen = false;

        // FAB 点击
        fab.addEventListener('click', () => {
            panelOpen = !panelOpen;
            panel.classList.toggle('visible', panelOpen);
            fab.classList.toggle('open', panelOpen);
            fab.innerHTML = panelOpen
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg><span id="ozon-fab-badge"></span>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg><span id="ozon-fab-badge"></span><span id="ozon-fab-tip">类目采集器</span>`;
            updateStatus(document.getElementById('ozon-collector-status')?.textContent || '');
        });

        // 模式切换
        document.querySelectorAll('.ozon-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.ozon-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentMode = btn.dataset.mode;

                // 更新提示文本和样式
                modeHint.className = '';
                if (currentMode === 'smart') {
                    modeHint.classList.add('smart-hint');
                    modeHint.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>点击类目旁的「展开箭头」→ 自动递归展开并采集该节点下所有子类目</span>`;
                    startClickTracker();
                    fab.classList.add('tracking');
                } else if (currentMode === 'click') {
                    modeHint.classList.add('paused');
                    modeHint.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>追踪模式已启用 — 在左侧类目树里点击即可记录/取消</span>`;
                    startClickTracker();
                    fab.classList.add('tracking');
                } else {
                    modeHint.classList.add('scan-hint');
                    modeHint.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg><span>全量扫描模式 — 点击下方「扫描当前」按钮抓取所有可见类目</span>`;
                    stopClickTracker();
                    fab.classList.remove('tracking');
                }
                log(`切换到${currentMode === 'smart' ? '智能展开' : currentMode === 'click' ? '手动追踪' : '全量扫描'}模式`);
            });
        });

        // 面板内收起
        document.getElementById('ozon-btn-collapse').onclick = () => {
            panelOpen = false;
            panel.classList.remove('visible');
            fab.classList.remove('open');
            fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg><span id="ozon-fab-badge"></span><span id="ozon-fab-tip">类目采集器</span>`;
        };

        // 操作按钮
        document.getElementById('ozon-btn-expand').onclick = expandAll;
        document.getElementById('ozon-btn-scan').onclick = scanAll;
        document.getElementById('ozon-btn-download').onclick = downloadCSV;
        document.getElementById('ozon-btn-clear').onclick = clearAll;
        document.getElementById('ozon-btn-abort').onclick = abortSmartExpand;
        document.getElementById('ozon-debug-toggle').onchange = (e) => {
            CONFIG.debug = e.target.checked;
            log('调试模式:', CONFIG.debug ? '已开启' : '已关闭');
        };
        document.getElementById('ozon-btn-detect').onclick = () => {
            const c = findTreeContainer();
            const status = document.getElementById('ozon-collector-status');
            if (c) {
                status.textContent = '已检测到类目树 ✓';
                status.className = 'status-ok';
                treeContainerRef = c;
                log('手动检测成功');
            } else {
                status.textContent = '未检测到类目树 ✗';
                status.className = 'status-warn';
            }
        };

        // 面板拖拽
        let dragging = false, offset = { x: 0, y: 0 };
        const header = document.getElementById('ozon-panel-header');
        header.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offset.x = e.clientX - rect.left;
            offset.y = e.clientY - rect.top;
            panel.style.bottom = 'auto'; panel.style.right = 'auto';
            panel.style.left = rect.left + 'px'; panel.style.top = rect.top + 'px';
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            panel.style.left = (e.clientX - offset.x) + 'px';
            panel.style.top = (e.clientY - offset.y) + 'px';
        });
        document.addEventListener('mouseup', () => dragging = false);

        // 自动检测类目树
        autoDetectTimer = setInterval(() => {
            const c = findTreeContainer();
            const status = document.getElementById('ozon-collector-status');
            if (c) treeContainerRef = c;
            if (c && status && status.textContent.includes('请先打开')) {
                status.textContent = '就绪 — 已检测到类目树 ✓';
                status.className = 'status-ok';
                if (!clickTrackerActive && (currentMode === 'click' || currentMode === 'smart')) {
                    startClickTracker();
                    fab.classList.add('tracking');
                }
            }
        }, 1500);

        // 默认启用智能展开模式（启用点击追踪）
        startClickTracker();
        fab.classList.add('tracking');

        log('Ozon 类目采集器 v3.0 已加载（智能展开 + 手动追踪 + 全量扫描）');
    }

    // ==================== 启动 ====================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUI);
    } else {
        initUI();
    }
})();
