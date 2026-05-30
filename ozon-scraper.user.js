// ==UserScript==
// @name         Ozon Scraper - 产品类目爬取工具
// @namespace    https://github.com/vision-png/ozon
// @version      1.0.0
// @description  爬取 Ozon.ru 产品类目（3级）和搜索结果，支持 CSV/Excel 导出
// @author       Qin Yucheng
// @match        https://www.ozon.ru/*
// @match        https://ozon.ru/*
// @require      https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_getResourceText
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
    // Section 1: Configuration & Constants
    // ============================================================
    const CONFIG = {
        panelWidth: 400,
        panelDefaultTop: '20px',
        panelDefaultRight: '20px',
        maxPages: 10,
        maxProductsPerSession: 2000,
        scrapeDelay: 1500,
        autoScrapeSearch: false,
        autoDetectNewProducts: true,
        defaultExportFormat: 'xlsx',
        includeImageUrls: false,
        theme: 'dark',
        language: 'auto',
        logLevel: 'INFO',
    };

    const PAGE_TYPES = {
        HOMEPAGE: 'homepage',
        CATEGORY: 'category',
        SEARCH: 'search',
        PRODUCT: 'product',
        UNKNOWN: 'unknown',
    };

    const STORAGE_KEYS = {
        CATEGORY_TREE: 'ozon_category_tree',
        SETTINGS: 'ozon_settings',
        SESSION_DATA: 'ozon_session_data',
    };

    // Adaptive selectors — Ozon uses React CSS Modules (hashed class names)
    // These are ordered by priority; script tries each until one matches
    const SELECTORS = {
        productCardContainers: [
            '[data-widget="searchResultsV2"] a[href*="/product/"]',
            '[data-widget="searchResults"] a[href*="/product/"]',
            '[data-widget="searchResultsV2"] [class*="tile"] a[href*="/product/"]',
            'a[href*="/product/"][class*="b6q5"]',
            'div[class*="k7m"] a[href*="/product/"]',
            'div[class*="search"] a[href*="/product/"]',
            'a[href*="/product/"][class*="card"]',
            'a[href*="/product/"][class*="tile"]',
            'a[href^="/product/"]',
        ],
        productCardRoots: [
            '[class*="k7m"]',
            '[class*="tile"]',
            '[class*="product"]',
            '[class*="card"]',
        ],
        productName: [
            '[class*="tsBodyL"]',
            'span[class*="tsBody"]',
            'a[class*="tsBody"]',
            'h3',
            'span',
        ],
        productPrice: [
            '[class*="c1r8"]',
            '[class*="price"] span',
            '[class*="price"]',
            'span[class*="c1"]',
        ],
        productOriginalPrice: [
            '[class*="c1r8"][class*="old"]',
            's[class*="price"]',
            '[class*="original"]',
            '[class*="crossed"]',
        ],
        productRating: [
            '[class*="rating"]',
            '[class*="star"]',
            'span[class*="ra"]',
        ],
        productReviews: [
            '[class*="review"]',
            'span[class*="rv"]',
            'span[class*="count"]',
        ],
        productImage: [
            'img[class*="k7"]',
            'img[src*="ir-2.ozon.ru"]',
            'img[class*="picture"]',
            'img',
        ],
        categoryMenu: [
            '[data-widget="catalogMenu"]',
            'nav[data-widget="menu"]',
            '[class*="catalog"] nav',
            '[class*="menu"][class*="main"]',
            'nav[class*="header"]',
            'header nav',
        ],
        categoryTopLinks: [
            '[data-widget="catalogMenu"] > * > a',
            '[class*="catalog"] > li > a',
            'nav a[href*="/category/"]',
            'header a[href*="/category/"]',
        ],
        paginationNext: [
            '[data-widget="pagination"] [class*="next"]',
            '[class*="pagination"] [class*="next"]',
            'a[rel="next"]',
            'a[class*="next"]',
        ],
        mainContent: [
            '[data-widget="searchResultsV2"]',
            'main',
            '[class*="content"]',
            'body',
        ],
    };

    // ============================================================
    // Section 2: Logger
    // ============================================================
    const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    function logger(level, ...args) {
        if (LOG_LEVELS[level] < LOG_LEVELS[CONFIG.logLevel]) return;
        const prefix = `[OzonScraper][${level}]`;
        if (level === 'ERROR') console.error(prefix, ...args);
        else if (level === 'WARN') console.warn(prefix, ...args);
        else if (level === 'INFO') console.info(prefix, ...args);
        else console.debug(prefix, ...args);
    }

    // ============================================================
    // Section 3: Utility Helpers
    // ============================================================
    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function safeText(el) {
        if (!el) return '';
        return (el.innerText || el.textContent || '').trim();
    }

    function parsePrice(priceStr) {
        if (!priceStr) return null;
        const cleaned = priceStr
            .replace(/[^\d,.]s/g, '')
            .replace(/\s/g, '')
            .replace(',', '.');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num;
    }

    function extractSkuFromUrl(url) {
        if (!url) return '';
        const match = url.match(/-(\d+)\//);
        return match ? match[1] : '';
    }

    function buildFullUrl(pathOrUrl) {
        if (!pathOrUrl) return '';
        if (pathOrUrl.startsWith('http')) return pathOrUrl;
        return 'https://www.ozon.ru' + (pathOrUrl.startsWith('/') ? '' : '/') + pathOrUrl;
    }

    // ============================================================
    // Section 4: Adaptive Selector Engine
    // ============================================================
    function adaptiveQuery(root, selectorArray, method = 'querySelector') {
        if (!root || !selectorArray) return method === 'querySelectorAll' ? [] : null;
        for (const sel of selectorArray) {
            if (!sel) continue;
            try {
                const result = root[method](sel);
                if (method === 'querySelectorAll') {
                    if (result && result.length > 0) return result;
                } else {
                    if (result) return result;
                }
            } catch (e) {
                // Invalid selector, try next
            }
        }
        return method === 'querySelectorAll' ? [] : null;
    }

    function adaptiveQueryAll(root, selectorArray) {
        return adaptiveQuery(root, selectorArray, 'querySelectorAll') || [];
    }

    function getCurrentPageType() {
        const path = location.pathname;
        if (path === '/' || path === '/?') return PAGE_TYPES.HOMEPAGE;
        if (path.includes('/category/')) return PAGE_TYPES.CATEGORY;
        if (path.includes('/search/')) return PAGE_TYPES.SEARCH;
        if (path.includes('/product/')) return PAGE_TYPES.PRODUCT;
        return PAGE_TYPES.UNKNOWN;
    }

    // ============================================================
    // Section 5: SPA Navigation Handler
    // ============================================================
    let onPageChangeCallback = null;

    function patchHistoryAPI() {
        const origPush = history.pushState;
        const origReplace = history.replaceState;

        history.pushState = function (...args) {
            origPush.apply(this, args);
            onPageChange();
        };
        history.replaceState = function (...args) {
            origReplace.apply(this, args);
            onPageChange();
        };

        window.addEventListener('popstate', () => {
            setTimeout(onPageChange, 150);
        });
    }

    function onPageChange() {
        const pageType = getCurrentPageType();
        logger.info('Page changed:', pageType, location.href);

        if (onPageChangeCallback) {
            onPageChangeCallback(pageType, location.href);
        }

        // Wait for React to re-render, then update panel
        waitForStableDOM().then(() => {
            updatePanelForPageType(pageType);
            if (CONFIG.autoScrapeSearch && pageType === PAGE_TYPES.SEARCH) {
                scrapeCurrentPage().catch((e) =>
                    logger.warn('Auto-scrape failed:', e.message)
                );
            }
        });
    }

    async function waitForStableDOM(timeout = 8000) {
        const start = Date.now();
        let lastCount = -1;
        let stableCount = 0;

        while (Date.now() - start < timeout) {
            const count = document.querySelectorAll('a[href*="/product/"]').length;
            if (count > 0 && count === lastCount) {
                stableCount++;
                if (stableCount >= 2) return;
            } else {
                stableCount = 0;
            }
            lastCount = count;
            await sleep(200);
        }
    }

    // ============================================================
    // Section 6: Product Scraper
    // ============================================================
    async function scrapeCurrentPage() {
        logger.info('Scraping current page:', location.href);
        const links = adaptiveQueryAll(document, SELECTORS.productCardContainers);
        logger.info(`Found ${links.length} product links`);

        const products = [];
        const seen = new Set();

        for (const link of links) {
            const href = link.getAttribute('href');
            if (!href || seen.has(href)) continue;
            seen.add(href);

            const cardRoot = adaptiveQuery(link, SELECTORS.productCardRoots) || link;
            const product = extractProductFromCard(cardRoot, link);
            if (product.name || product.sku) {
                products.push(product);
            }
        }

        // Store to IndexedDB
        if (products.length > 0) {
            await storeProducts(products);
            logger.info(`Stored ${products.length} products`);
        }

        updateProductTable(products);
        updateStatus(products.length);
        return products;
    }

    function extractProductFromCard(cardEl, linkEl) {
        const product = {};
        const href = linkEl?.getAttribute('href') || '';

        product.url = href;
        product.fullUrl = buildFullUrl(href);
        product.sku = extractSkuFromUrl(href);
        product.scrapedAt = new Date().toISOString();
        product.sourcePage = location.href;

        // Name
        const nameEl = adaptiveQuery(cardEl, SELECTORS.productName);
        if (nameEl) {
            const txt = safeText(nameEl);
            if (txt.length > 2) product.name = txt.substring(0, 300);
        }
        // Fallback: extract from URL
        if (!product.name && href) {
            const parts = href.split('/');
            for (let i = parts.length - 1; i >= 0; i--) {
                if (/^[a-z0-9-]+$/i.test(parts[i]) && parts[i].length > 3) {
                    product.name = parts[i].replace(/-/g, ' ').replace(/\d+$/, '').trim();
                    break;
                }
            }
        }

        // Price
        const priceEl = adaptiveQuery(cardEl, SELECTORS.productPrice);
        if (priceEl) {
            const pt = safeText(priceEl);
            if (pt) {
                product.price = pt;
                product.priceRub = parsePrice(pt);
            }
        }

        // Original price
        const origEl = adaptiveQuery(cardEl, SELECTORS.productOriginalPrice);
        if (origEl) {
            const ot = safeText(origEl);
            if (ot) {
                product.originalPrice = ot;
                product.originalPriceRub = parsePrice(ot);
            }
        }

        // Rating
        const ratingEl = adaptiveQuery(cardEl, SELECTORS.productRating);
        if (ratingEl) {
            const rt = safeText(ratingEl);
            if (rt) product.rating = parseFloat(rt) || rt;
        }

        // Reviews count
        const revEl = adaptiveQuery(cardEl, SELECTORS.productReviews);
        if (revEl) {
            const rv = safeText(revEl);
            if (rv) product.reviews = parseInt(rv.replace(/\D/g, '')) || rv;
        }

        // Image URL
        const imgEl = adaptiveQuery(cardEl, SELECTORS.productImage);
        if (imgEl) {
            product.imageUrl = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
        }

        // Try to infer category from breadcrumb or URL
        product.category = inferCategory();

        return product;
    }

    function inferCategory() {
        // Try breadcrumb
        const breadcrumbs = document.querySelectorAll('[class*="breadcrumb"], [class*="bc"]');
        if (breadcrumbs.length > 0) {
            const parts = [];
            breadcrumbs.forEach((el) => {
                const t = safeText(el);
                if (t) parts.push(t);
            });
            if (parts.length > 0) return parts.join(' > ');
        }
        // Fallback: path segments
        const pathParts = location.pathname.split('/').filter((p) => p && !p.startsWith('?'));
        if (pathParts.length > 0) return pathParts.join(' > ');
        return '';
    }

    // ============================================================
    // Section 7: Category Tree Scraper
    // ============================================================
    async function scrapeCategoryTree() {
        logger.info('Starting category tree scrape...');
        showNotification('正在爬取类目树，请稍候...', 'info');

        // Try to open the catalog menu by hovering/clicking
        const menuTrigger = document.querySelector('[class*="catalog"] button, [class*="burger"] button, [class*="menu"] button');
        if (menuTrigger) {
            logger.info('Found menu trigger, clicking...');
            menuTrigger.click();
            await sleep(800);
        }

        // Also try mouseenter on catalog elements
        const catalogEls = document.querySelectorAll('[class*="catalog"], [class*="menu"]');
        for (const el of catalogEls) {
            try {
                el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            } catch (e) { /* ignore */ }
        }
        await sleep(800);

        const topLinks = findCategoryLinks();
        logger.info(`Found ${topLinks.length} top-level categories`);

        const tree = [];
        for (const link of topLinks) {
            const cat = extractCategoryFromLink(link, 1, null);
            tree.push(cat);

            // Try to expand sub-categories
            try {
                link.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                await sleep(400);
                const subLinks = findSubCategoryLinks();
                for (const subLink of subLinks) {
                    const subCat = extractCategoryFromLink(subLink, 2, cat.id);
                    cat.children = cat.children || [];
                    cat.children.push(subCat);

                    // Try level-3
                    try {
                        subLink.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                        await sleep(300);
                        const subSubLinks = findSubCategoryLinks();
                        for (const ssl of subSubLinks) {
                            const subSubCat = extractCategoryFromLink(ssl, 3, subCat.id);
                            subCat.children = subCat.children || [];
                            subCat.children.push(subSubCat);
                        }
                    } catch (e) { /* ignore */ }
                }
            } catch (e) {
                logger.warn('Error expanding category:', e.message);
            }

            // Avoid rate-limiting on Ozon servers
            await sleep(200);
        }

        const treeStr = JSON.stringify(tree);
        GM_setValue(STORAGE_KEYS.CATEGORY_TREE, treeStr);
        logger.info('Category tree saved, nodes:', countTreeNodes(tree));
        showNotification(`类目树爬取完成！共 ${countTreeNodes(tree)} 个类目`, 'success');
        renderCategoryTree(tree);
        return tree;
    }

    function findCategoryLinks() {
        const results = [];
        for (const sel of SELECTORS.categoryTopLinks) {
            try {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    logger.debug('Category links found with selector:', sel, els.length);
                    return Array.from(els).filter((a) => a.getAttribute('href')?.includes('/category/'));
                }
            } catch (e) { /* try next */ }
        }
        // Fallback: find all /category/ links
        return Array.from(document.querySelectorAll('a[href*="/category/"]'));
    }

    function findSubCategoryLinks() {
        // Look inside open popups/dropdowns for category links not yet captured
        const popups = document.querySelectorAll('[class*="popup"], [class*="dropdown"], [class*="sub"], [class*="child"]');
        const links = [];
        for (const popup of popups) {
            const as = popup.querySelectorAll('a[href*="/category/"]');
            links.push(...as);
        }
        return links;
    }

    function extractCategoryFromLink(linkEl, level, parentId) {
        const href = linkEl.getAttribute('href') || '';
        const name = safeText(linkEl) || href.split('/').pop() || 'unknown';
        const id = 'cat_' + Math.random().toString(36).substring(2, 10);
        return {
            id,
            name,
            url: href,
            fullUrl: buildFullUrl(href),
            level,
            parentId,
            children: [],
        };
    }

    function countTreeNodes(tree) {
        let count = 0;
        for (const node of tree) {
            count += 1 + (node.children ? countTreeNodes(node.children) : 0);
        }
        return count;
    }

    // ============================================================
    // Section 8: IndexedDB Storage Layer
    // ============================================================
    const DB_NAME = 'OzonScraperDB';
    const DB_VERSION = 1;
    let dbInstance = null;

    function initDB() {
        if (dbInstance) return Promise.resolve(dbInstance);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('products')) {
                    const store = db.createObjectStore('products', { keyPath: 'sku' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('category', 'category', { unique: false });
                    store.createIndex('scrapedAt', 'scrapedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains('sessions')) {
                    const sessStore = db.createObjectStore('sessions', { autoIncrement: true });
                    sessStore.createIndex('date', 'date', { unique: false });
                }
            };
            req.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async function storeProducts(products) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('products', 'readwrite');
            const store = tx.objectStore('products');
            let completed = 0;
            for (const p of products) {
                if (!p.sku) continue;
                const req = store.put(p);
                req.onsuccess = () => {
                    completed++;
                    if (completed === products.filter((x) => x.sku).length) resolve();
                };
                req.onerror = () => {
                    completed++;
                    if (completed === products.filter((x) => x.sku).length) resolve();
                };
            }
            if (products.filter((x) => x.sku).length === 0) resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async function getAllProducts(filter = {}) {
        const db = await initDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('products', 'readonly');
            const store = tx.objectStore('products');
            const req = store.getAll();
            req.onsuccess = () => {
                let results = req.result || [];
                // Client-side filtering
                if (filter.search) {
                    const q = filter.search.toLowerCase();
                    results = results.filter((p) => (p.name || '').toLowerCase().includes(q));
                }
                if (filter.category) {
                    results = results.filter((p) => (p.category || '').includes(filter.category));
                }
                if (filter.minPrice != null) {
                    results = results.filter((p) => p.priceRub != null && p.priceRub >= filter.minPrice);
                }
                if (filter.maxPrice != null) {
                    results = results.filter((p) => p.priceRub != null && p.priceRub <= filter.maxPrice);
                }
                resolve(results);
            };
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

    // ============================================================
    // Section 9: UI Panel — CSS
    // ============================================================
    const PANEL_CSS = `
#ozon-scraper-panel {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 400px;
    max-height: calc(100vh - 40px);
    background: #1e1e2e;
    color: #cdd6f4;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #313244;
    transition: width 0.2s, height 0.2s;
}
#ozon-scraper-panel.ozon-collapsed {
    width: 44px !important;
    height: 44px !important;
    overflow: hidden;
    border-radius: 50%;
    cursor: pointer;
}
#ozon-scraper-panel.ozon-collapsed *:not(#ozon-panel-header) {
    display: none !important;
}
#ozon-panel-header {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    background: #313244;
    border-bottom: 1px solid #45475a;
    cursor: move;
    user-select: none;
    flex-shrink: 0;
}
#ozon-panel-header h3 {
    flex: 1;
    margin: 0;
    font-size: 14px;
    color: #f5c2e7;
    font-weight: 600;
}
.ozon-header-btn {
    background: none;
    border: none;
    color: #cdd6f4;
    cursor: pointer;
    font-size: 15px;
    padding: 2px 7px;
    border-radius: 4px;
    margin-left: 2px;
    line-height: 1;
}
.ozon-header-btn:hover {
    background: #45475a;
}
.ozon-status-bar {
    padding: 5px 12px;
    background: #181825;
    border-bottom: 1px solid #313244;
    font-size: 11px;
    color: #a6adc8;
    flex-shrink: 0;
}
.ozon-section {
    padding: 8px 12px;
    border-bottom: 1px solid #313244;
    flex-shrink: 0;
}
.ozon-section-title {
    font-size: 11px;
    text-transform: uppercase;
    color: #89b4fa;
    margin-bottom: 6px;
    font-weight: 600;
    letter-spacing: 0.5px;
}
.ozon-category-tree {
    max-height: 180px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #45475a transparent;
}
.ozon-tree-item {
    padding: 3px 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: 12px;
    border-radius: 3px;
    padding-left: 2px;
}
.ozon-tree-item:hover {
    background: #313244;
}
.ozon-tree-item.level-1 { padding-left: 2px; font-weight: 600; color: #f5c2e7; }
.ozon-tree-item.level-2 { padding-left: 16px; color: #cdd6f4; }
.ozon-tree-item.level-3 { padding-left: 30px; color: #a6adc8; font-size: 11px; }
.ozon-tree-toggle {
    width: 16px;
    font-size: 10px;
    color: #6c7086;
    flex-shrink: 0;
}
.ozon-tree-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ozon-search-input {
    width: calc(100% - 60px);
    padding: 5px 8px;
    border: 1px solid #45475a;
    border-radius: 6px;
    background: #11111b;
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
}
.ozon-search-input:focus {
    border-color: #89b4fa;
}
.ozon-btn {
    padding: 5px 10px;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    margin: 2px 2px 2px 0;
    font-weight: 500;
    transition: opacity 0.15s;
}
.ozon-btn:hover { opacity: 0.85; }
.ozon-btn-primary { background: #89b4fa; color: #1e1e2e; }
.ozon-btn-success { background: #a6e3a1; color: #1e1e2e; }
.ozon-btn-danger  { background: #f38ba8; color: #1e1e2e; }
.ozon-btn-warning { background: #f9e2af; color: #1e1e2e; }
.ozon-btn-neutral { background: #45475a; color: #cdd6f4; }
.ozon-data-table {
    flex: 1;
    overflow-y: auto;
    min-height: 120px;
    max-height: 300px;
}
.ozon-data-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
}
.ozon-data-table th {
    position: sticky;
    top: 0;
    background: #313244;
    padding: 4px 6px;
    text-align: left;
    font-size: 11px;
    color: #a6adc8;
    border-bottom: 1px solid #45475a;
    z-index: 1;
}
.ozon-data-table td {
    padding: 3px 6px;
    border-bottom: 1px solid #313244;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ozon-data-table tr:hover td {
    background: #313244;
}
.ozon-btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
}
.ozon-notification {
    position: fixed;
    top: 70px;
    right: 30px;
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 2147483648;
    max-width: 360px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    animation: ozonNotifIn 0.3s ease;
}
.ozon-notification.info    { background: #89b4fa; color: #1e1e2e; }
.ozon-notification.success { background: #a6e3a1; color: #1e1e2e; }
.ozon-notification.warn    { background: #f9e2af; color: #1e1e2e; }
.ozon-notification.error   { background: #f38ba8; color: #1e1e2e; }
@keyframes ozonNotifIn {
    from { opacity: 0; transform: translateY(-10px); }
    to   { opacity: 1; transform: translateY(0); }
}
.ozon-progress-bar {
    width: 100%;
    height: 4px;
    background: #313244;
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
}
.ozon-progress-fill {
    height: 100%;
    background: #89b4fa;
    width: 0%;
    transition: width 0.3s;
}
`;

    // ============================================================
    // Section 10: UI Panel — Create & Bind
    // ============================================================
    let panelEl = null;
    let toggleBtnEl = null;
    let isCollapsed = false;

    function createPanel() {
        if (panelEl) return panelEl;

        GM_addStyle(PANEL_CSS);

        panelEl = document.createElement('div');
        panelEl.id = 'ozon-scraper-panel';
        panelEl.innerHTML = `
            <div id="ozon-panel-header">
                <h3>Ozon Scraper</h3>
                <button class="ozon-header-btn" id="ozon-btn-minimize" title="最小化">─</button>
                <button class="ozon-header-btn" id="ozon-btn-maximize" title="最大化/还原">□</button>
                <button class="ozon-header-btn" id="ozon-btn-close" title="关闭">✕</button>
            </div>
            <div class="ozon-status-bar" id="ozon-status-bar">
                Page: <span id="ozon-page-type">--</span> |
                Items: <span id="ozon-item-count">0</span>
            </div>
            <div class="ozon-section">
                <div class="ozon-section-title">类目树 (Categories)</div>
                <div class="ozon-category-tree" id="ozon-category-tree">
                    <div style="color:#6c7086;font-size:11px;padding:8px;">
                        点击"爬取类目"加载类目树
                    </div>
                </div>
            </div>
            <div class="ozon-section">
                <div class="ozon-btn-row" style="margin-bottom:6px;">
                    <input type="text" class="ozon-search-input" id="ozon-search-input"
                           placeholder="搜索商品关键词..." />
                    <button class="ozon-btn ozon-btn-primary" id="ozon-btn-do-search">搜索</button>
                </div>
                <div class="ozon-btn-row">
                    <button class="ozon-btn ozon-btn-primary" id="ozon-btn-scrape-page">爬取本页</button>
                    <button class="ozon-btn ozon-btn-success" id="ozon-btn-scrape-all">爬取全部页</button>
                    <button class="ozon-btn ozon-btn-warning" id="ozon-btn-stop">停止</button>
                </div>
                <div class="ozon-progress-bar" id="ozon-progress-bar" style="display:none;">
                    <div class="ozon-progress-fill" id="ozon-progress-fill"></div>
                </div>
            </div>
            <div class="ozon-data-table" id="ozon-data-table">
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>名称</th>
                            <th>价格(₽)</th>
                            <th>评分</th>
                            <th>评论</th>
                        </tr>
                    </thead>
                    <tbody id="ozon-table-body"></tbody>
                </table>
            </div>
            <div class="ozon-section" style="flex-shrink:0;">
                <div class="ozon-btn-row">
                    <button class="ozon-btn ozon-btn-success" id="ozon-btn-export-csv">导出 CSV</button>
                    <button class="ozon-btn ozon-btn-success" id="ozon-btn-export-xlsx">导出 Excel</button>
                    <button class="ozon-btn ozon-btn-danger"  id="ozon-btn-clear">清空数据</button>
                </div>
                <div class="ozon-btn-row" style="margin-top:4px;">
                    <button class="ozon-btn ozon-btn-neutral" id="ozon-btn-scrape-cats">爬取类目树</button>
                    <button class="ozon-btn ozon-btn-neutral" id="ozon-btn-load-all">加载已存数据</button>
                </div>
            </div>
        `;
        document.body.appendChild(panelEl);

        // Toggle button (shown when collapsed)
        toggleBtnEl = document.createElement('button');
        toggleBtnEl.id = 'ozon-scraper-toggle';
        toggleBtnEl.textContent = 'Oz';
        toggleBtnEl.title = 'Ozon Scraper — 点击展开';
        toggleBtnEl.style.cssText = `
            position:fixed; bottom:24px; right:24px; width:48px; height:48px;
            border-radius:50%; background:#89b4fa; color:#1e1e2e;
            border:none; cursor:pointer; font-size:15px; font-weight:700;
            box-shadow:0 4px 16px rgba(0,0,0,0.4); z-index:2147483647;
            display:none;
        `;
        toggleBtnEl.addEventListener('click', () => togglePanel(false));
        document.body.appendChild(toggleBtnEl);

        bindPanelEvents();
        loadCategoryTreeFromStorage();
        return panelEl;
    }

    function bindPanelEvents() {
        // Header buttons
        document.getElementById('ozon-btn-minimize').addEventListener('click', () => togglePanel(true));
        document.getElementById('ozon-btn-maximize').addEventListener('click', toggleMaximize);
        document.getElementById('ozon-btn-close').addEventListener('click', () => togglePanel(true));

        // Action buttons
        document.getElementById('ozon-btn-scrape-page').addEventListener('click', () => {
            scrapeCurrentPage().catch((e) => showNotification('爬取失败: ' + e.message, 'error'));
        });
        document.getElementById('ozon-btn-scrape-all').addEventListener('click', () => {
            scrapeAllPages().catch((e) => showNotification('爬取失败: ' + e.message, 'error'));
        });
        document.getElementById('ozon-btn-do-search').addEventListener('click', doSearch);
        document.getElementById('ozon-search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
        });
        document.getElementById('ozon-btn-scrape-cats').addEventListener('click', () => {
            scrapeCategoryTree().catch((e) => showNotification('类目爬取失败: ' + e.message, 'error'));
        });
        document.getElementById('ozon-btn-export-csv').addEventListener('click', exportCSV);
        document.getElementById('ozon-btn-export-xlsx').addEventListener('click', exportExcel);
        document.getElementById('ozon-btn-clear').addEventListener('click', clearData);
        document.getElementById('ozon-btn-load-all').addEventListener('click', loadAllProducts);
        document.getElementById('ozon-btn-stop').addEventListener('click', () => {
            window.__ozon_stop_flag = true;
            showNotification('已发送停止信号', 'warn');
        });

        // Drag
        makeDraggable(panelEl, '#ozon-panel-header');
    }

    function togglePanel(collapse) {
        isCollapsed = collapse === undefined ? !isCollapsed : collapse;
        if (isCollapsed) {
            panelEl.classList.add('ozon-collapsed');
            toggleBtnEl.style.display = 'block';
        } else {
            panelEl.classList.remove('ozon-collapsed');
            toggleBtnEl.style.display = 'none';
        }
    }

    let isMaximized = false;
    function toggleMaximize() {
        isMaximized = !isMaximized;
        if (isMaximized) {
            panelEl.style.width = '90vw';
            panelEl.style.maxHeight = '90vh';
            document.getElementById('ozon-btn-maximize').textContent = '❐';
        } else {
            panelEl.style.width = '';
            panelEl.style.maxHeight = '';
            document.getElementById('ozon-btn-maximize').textContent = '□';
        }
    }

    // ============================================================
    // Section 11: Drag Functionality
    // ============================================================
    function makeDraggable(el, handleSelector) {
        const handle = el.querySelector(handleSelector);
        if (!handle) return;
        let isDragging = false;
        let startX, startY, origLeft, origTop;

        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            origLeft = el.offsetLeft;
            origTop = el.offsetTop;
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            el.style.left = (origLeft + dx) + 'px';
            el.style.top = (origTop + dy) + 'px';
            el.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
            document.body.style.userSelect = '';
        });
    }

    // ============================================================
    // Section 12: Panel Update Functions
    // ============================================================
    function updatePanelForPageType(pageType) {
        const typeEl = document.getElementById('ozon-page-type');
        if (typeEl) {
            const labels = {
                [PAGE_TYPES.HOMEPAGE]: '首页',
                [PAGE_TYPES.CATEGORY]: '类目页',
                [PAGE_TYPES.SEARCH]: '搜索页',
                [PAGE_TYPES.PRODUCT]: '商品页',
                [PAGE_TYPES.UNKNOWN]: '未知',
            };
            typeEl.textContent = labels[pageType] || pageType;
        }
    }

    function updateStatus(itemCount) {
        const countEl = document.getElementById('ozon-item-count');
        if (countEl) countEl.textContent = itemCount;
    }

    function updateProductTable(products) {
        const tbody = document.getElementById('ozon-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        const maxShow = Math.min(products.length, 100); // Show max 100 in table
        for (let i = 0; i < maxShow; i++) {
            const p = products[i];
            if (!p) continue;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${i + 1}</td>
                <td title="${escapeHtml(p.name || p.url || '')}">${escapeHtml((p.name || '').substring(0, 40))}</td>
                <td>${p.priceRub != null ? p.priceRub.toLocaleString() : (p.price || '')}</td>
                <td>${p.rating || ''}</td>
                <td>${p.reviews || ''}</td>
            `;
            tbody.appendChild(tr);
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showNotification(message, type = 'info') {
        const el = document.createElement('div');
        el.className = 'ozon-notification ' + type;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(() => el.remove(), 300);
        }, 3000);
    }

    // ============================================================
    // Section 13: Category Tree UI
    // ============================================================
    function renderCategoryTree(tree) {
        const container = document.getElementById('ozon-category-tree');
        if (!container) return;
        container.innerHTML = '';

        if (!tree || tree.length === 0) {
            container.innerHTML = '<div style="color:#6c7086;font-size:11px;padding:8px;">暂无类目数据，请点击"爬取类目树"</div>';
            return;
        }

        const fragment = document.createDocumentFragment();
        for (const node of tree) {
            fragment.appendChild(renderTreeNode(node, 1));
        }
        container.appendChild(fragment);
    }

    function renderTreeNode(node, level) {
        const div = document.createElement('div');
        div.className = `ozon-tree-item level-${level}`;

        const hasChildren = node.children && node.children.length > 0;
        const toggle = document.createElement('span');
        toggle.className = 'ozon-tree-toggle';
        toggle.textContent = hasChildren ? '▶' : '　';
        div.appendChild(toggle);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'ozon-tree-name';
        nameSpan.textContent = node.name || node.url || 'unknown';
        nameSpan.title = node.url || '';
        div.appendChild(nameSpan);

        if (hasChildren) {
            const childContainer = document.createElement('div');
            childContainer.style.display = 'none';
            childContainer.className = 'ozon-tree-children';

            for (const child of node.children) {
                childContainer.appendChild(renderTreeNode(child, level + 1));
            }

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                if (childContainer.style.display === 'none') {
                    childContainer.style.display = 'block';
                    toggle.textContent = '▼';
                } else {
                    childContainer.style.display = 'none';
                    toggle.textContent = '▶';
                }
            });

            div.appendChild(childContainer);
        }

        return div;
    }

    function loadCategoryTreeFromStorage() {
        try {
            const raw = GM_getValue(STORAGE_KEYS.CATEGORY_TREE, '');
            if (raw) {
                const tree = JSON.parse(raw);
                renderCategoryTree(tree);
                logger.info('Loaded category tree from storage, nodes:', countTreeNodes(tree));
            }
        } catch (e) {
            logger.warn('Failed to load category tree from storage:', e.message);
        }
    }

    // ============================================================
    // Section 14: Search & Multi-page Scraping
    // ============================================================
    function doSearch() {
        const input = document.getElementById('ozon-search-input');
        const query = input?.value?.trim();
        if (!query) {
            showNotification('请输入搜索关键词', 'warn');
            return;
        }
        const url = 'https://www.ozon.ru/search/?text=' + encodeURIComponent(query);
        window.location.href = url;
    }

    window.__ozon_stop_flag = false;

    async function scrapeAllPages(maxPages) {
        maxPages = maxPages || CONFIG.maxPages;
        window.__ozon_stop_flag = false;

        const progressBar = document.getElementById('ozon-progress-bar');
        const progressFill = document.getElementById('ozon-progress-fill');
        if (progressBar) progressBar.style.display = 'block';

        showNotification(`开始爬取最多 ${maxPages} 页...`, 'info');
        const allProducts = [];
        let pageNum = 1;

        while (pageNum <= maxPages && !window.__ozon_stop_flag) {
            showNotification(`正在爬取第 ${pageNum}/${maxPages} 页...`, 'info');
            logger.info(`Scraping page ${pageNum}`);

            // Scrape current page
            const products = await scrapeCurrentPage();
            if (products) {
                for (const p of products) {
                    if (!allProducts.find((x) => x.sku === p.sku)) {
                        allProducts.push(p);
                    }
                }
            }

            // Update progress
            if (progressFill) {
                progressFill.style.width = ((pageNum / maxPages) * 100) + '%';
            }

            // Try to go to next page
            if (pageNum >= maxPages || window.__ozon_stop_flag) break;

            const hasNext = await goToNextPage();
            if (!hasNext) {
                showNotification('没有更多页面了', 'info');
                break;
            }

            pageNum++;
            await sleep(CONFIG.scrapeDelay);
        }

        if (progressBar) progressBar.style.display = 'none';
        showNotification(`爬取完成！共 ${allProducts.length} 个商品`, 'success');
        logger.info(`Total scraped: ${allProducts.length} products across ${pageNum} pages`);
    }

    async function goToNextPage() {
        // Method 1: modify URL with page param
        const url = new URL(location.href);
        const currentPage = parseInt(url.searchParams.get('page')) || 1;
        url.searchParams.set('page', currentPage + 1);
        window.location.href = url.toString();
        return true;

        // Method 2 (alternative): click next button
        // const nextBtn = adaptiveQuery(document, SELECTORS.paginationNext);
        // if (nextBtn) {
        //     nextBtn.click();
        //     return true;
        // }
        // return false;
    }

    // ============================================================
    // Section 15: Export Engine
    // ============================================================
    async function exportCSV() {
        showNotification('正在导出 CSV...', 'info');
        const products = await getAllProducts();
        if (products.length === 0) {
            showNotification('没有数据可导出', 'warn');
            return;
        }

        const BOM = '\uFEFF';
        const headers = ['SKU', '名称', '价格(RUB)', '原价(RUB)', '折扣%', '评分', '评论数', '类目', 'URL', '图片URL', '爬取时间'];
        const rows = products.map((p) => {
            const discount = (p.originalPriceRub && p.priceRub)
                ? Math.round((1 - p.priceRub / p.originalPriceRub) * 100) + '%' : '';
            return [
                p.sku || '',
                `"${(p.name || '').replace(/"/g, '""')}"`,
                p.priceRub ?? '',
                p.originalPriceRub ?? '',
                discount,
                p.rating || '',
                p.reviews || '',
                `"${(p.category || '').replace(/"/g, '""')}"`,
                p.fullUrl || '',
                CONFIG.includeImageUrls ? (p.imageUrl || '') : '',
                p.scrapedAt || '',
            ].join(',');
        });

        const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
        downloadBlob(csv, `ozon-products-${Date.now()}.csv`, 'text/csv;charset=utf-8');
        showNotification(`CSV 导出成功！共 ${products.length} 条`, 'success');
    }

    async function exportExcel() {
        showNotification('正在导出 Excel...', 'info');

        if (typeof XLSX === 'undefined') {
            showNotification('SheetJS 尚未加载，请刷新页面后重试', 'error');
            return;
        }

        const products = await getAllProducts();
        if (products.length === 0) {
            showNotification('没有数据可导出', 'warn');
            return;
        }

        const data = products.map((p) => {
            const discount = (p.originalPriceRub && p.priceRub)
                ? Math.round((1 - p.priceRub / p.originalPriceRub) * 100) + '%' : '';
            return {
                'SKU': p.sku || '',
                '名称': p.name || '',
                '价格(RUB)': p.priceRub ?? '',
                '原价(RUB)': p.originalPriceRub ?? '',
                '折扣%': discount,
                '评分': p.rating || '',
                '评论数': p.reviews || '',
                '类目': p.category || '',
                'URL': p.fullUrl || '',
                '图片URL': CONFIG.includeImageUrls ? (p.imageUrl || '') : '',
                '爬取时间': p.scrapedAt || '',
            };
        });

        const ws = XLSX.utils.json_to_sheet(data);

        // Auto column widths
        const colWidths = Object.keys(data[0] || {}).map((key, i) => {
            const maxLen = Math.max(
                key.length,
                ...data.map((row) => String(row[key] ?? '').length)
            );
            return { wch: Math.min(maxLen + 2, 50) };
        });
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ozon Products');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/octet-stream' });
        downloadBlob(blob, `ozon-products-${Date.now()}.xlsx`);
        showNotification(`Excel 导出成功！共 ${products.length} 条`, 'success');
    }

    function downloadBlob(content, filename, mimeType) {
        const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            a.remove();
        }, 1000);
    }

    // ============================================================
    // Section 16: Data Management
    // ============================================================
    async function clearData() {
        if (!confirm('确定要清空所有已爬取的数据吗？此操作不可撤销。')) return;
        await clearAllProducts();
        const tbody = document.getElementById('ozon-table-body');
        if (tbody) tbody.innerHTML = '';
        updateStatus(0);
        showNotification('数据已清空', 'success');
    }

    async function loadAllProducts() {
        showNotification('正在加载已存储的数据...', 'info');
        const products = await getAllProducts();
        updateProductTable(products);
        updateStatus(products.length);
        showNotification(`已加载 ${products.length} 条数据`, 'success');
    }

    // ============================================================
    // Section 17: MutationObserver for New Products
    // ============================================================
    function setupMutationObserver() {
        const target = adaptiveQuery(document, SELECTORS.mainContent) || document.body;

        const observer = new MutationObserver((mutations) => {
            if (!CONFIG.autoDetectNewProducts) return;
            let hasNew = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            if (node.querySelector?.('a[href*="/product/"]') || node.matches?.('a[href*="/product/"]')) {
                                hasNew = true;
                                break;
                            }
                        }
                    }
                }
                if (hasNew) break;
            }
            if (hasNew) {
                logger.debug('New product cards detected in DOM');
                // Debounced re-scrape
                clearTimeout(window.__ozon_debounce_timer);
                window.__ozon_debounce_timer = setTimeout(() => {
                    scrapeCurrentPage().catch(() => {});
                }, 1000);
            }
        });

        observer.observe(target, { childList: true, subtree: true });
        logger.info('MutationObserver set up on', target);
    }

    // ============================================================
    // Section 18: Main Entry Point
    // ============================================================
    function init() {
        logger.info('Ozon Scraper initializing on:', location.href);

        // Check if we're on Ozon
        const hostname = location.hostname;
        if (!hostname.includes('ozon.ru')) {
            logger.warn('Not on ozon.ru, skipping init');
            return;
        }

        // Patch SPA navigation
        patchHistoryAPI();

        // Create UI panel
        createPanel();

        // Set initial page type
        const pageType = getCurrentPageType();
        updatePanelForPageType(pageType);

        // Setup MutationObserver
        setupMutationObserver();

        // Load existing products count
        getAllProducts().then((products) => {
            updateStatus(products.length);
            logger.info(`Loaded ${products.length} existing products from DB`);
        }).catch(() => {});

        // Listen for page changes
        onPageChangeCallback = (pageType, url) => {
            // nothing extra needed here; handled in onPageChange()
        };

        logger.info('Ozon Scraper initialized successfully');
        showNotification('Ozon Scraper 已启动！', 'success');
    }

    // Wait for DOM ready, then init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Small delay to let React render
        setTimeout(init, 500);
    }

})();
