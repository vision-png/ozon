// ==UserScript==
// @name         Ozon Scraper - 四层类目树 + 俄语转中文
// @namespace    https://github.com/vision-png/ozon
// @version      7.1.0
// @description  采集 Ozon.ru 类目树（L1-L4），hover触发子菜单展开，导出 CSV/Excel/MD（含中文翻译）
// @author       Qin Yucheng
// @match        https://www.ozon.ru/*
// @match        https://ozon.ru/*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
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
    // 俄语 → 中文 类目翻译字典（常用）
    // ============================================================
    var RU_ZH_DICT = {
        // 一级类目
        'Электроника': '电子产品',
        'Бытовая техника': '家用电器',
        'Компьютеры': '电脑',
        'Строительство и ремонт': '建筑装修',
        'Дом и сад': '家居园艺',
        'Детские товары': '儿童用品',
        'Одежда, обувь и аксессуары': '服装鞋包',
        'Красота и здоровье': '美容健康',
        'Спорт и отдых': '运动户外',
        'Автотовары': '汽车用品',
        'Книги': '图书',
        'Продукты питания': '食品饮料',
        'Бытовая химия и гигиена': '日用化工',
        'Зоотовары': '宠物用品',
        'Канцелярские товары': '办公文具',
        'Товары для творчества': '创意手工',
        'Ювелирные украшения': '珠宝首饰',
        'Часы': '钟表',
        'Сумки и чемоданы': '箱包',
        'Товары для взрослых': '成人用品',

        // 二级类目 - 电子产品
        'Телефоны и смарт-часы': '手机手表',
        'Телевизоры': '电视',
        'Ноутбуки и планшеты': '笔记本平板',
        'Компьютеры и комплектующие': '电脑配件',
        'Наушники и аудиотехника': '耳机音响',
        'Умный дом': '智能家居',
        'Фото и видеокамеры': '摄影摄像',
        'Игры и консоли': '游戏主机',
        'Офисная техника': '办公设备',
        'Аксессуары для смартфонов': '手机配件',
        'Сетевое оборудование': '网络设备',
        'GPS-навигаторы': 'GPS导航',
        'Электронные книги': '电子书',
        'Радиоуправляемые модели': '遥控模型',
        'Музыкальные инструменты': '乐器',
        'Проекторы и экраны': '投影仪',

        // 二级类目 - 家电
        'Крупная бытовая техника': '大家电',
        'Техника для кухни': '厨房电器',
        'Техника для дома': '生活电器',
        'Климатическая техника': '环境电器',
        'Техника для красоты и здоровья': '个护健康',
        'Тепловые витрины и подогреватели': '保温展示柜',
        'Шкафы и печи пекарские': '烘焙设备',
        'Торговые автоматы': '自动售货机',
        'Запчасти для оборудования общепита': '餐饮设备配件',

        // 三级类目 - 大家电
        'Холодильники': '冰箱',
        'Стиральные машины': '洗衣机',
        'Варочные панели': '炉灶面板',
        'Кухонные вытяжки': '抽油烟机',
        'Плиты': '烤箱灶台',
        'Посудомоечные машины': '洗碗机',
        'Духовые шкафы': '嵌入式烤箱',
        'Холодильные витрины': '冷藏展示柜',
        'Морозильные камеры': '冷冻柜',
        'Винные шкафы': '酒柜',
        'Сушильные машины': '干衣机',
        'Кулеры для воды и аксессуары': '饮水机及配件',
        'Аксессуары для крупной бытовой техники': '大家电配件',

        // 三级类目 - 厨房电器
        'Кофеварки и кофемашины': '咖啡机',
        'Электрические чайники и термопоты': '电热水壶',
        'Миксеры, блендеры и измельчители': '搅拌机料理机',
        'Печи и грили': '烤箱烤架',
        'Мультиварки и техника для варки': '电饭煲压力锅',
        'Соковыжималки': '榨汁机',
        'Тостеры и бутербродницы': '吐司机',
        'Фритюрницы': '油炸锅',
        'Хлебопечки': '面包机',
        'Йогуртницы и мороженицы': '酸奶机冰淇淋机',
        'Аэрогрили': '空气烤架',
        'Электрошашлычницы': '电烤串机',
        'Вафельницы': '华夫饼机',
        'Мясорубки': '绞肉机',
        'Кухонные весы': '厨房秤',

        // 三级类目 - 生活电器
        'Пылесосы и аксессуары': '吸尘器及配件',
        'Утюги и отпариватели': '电熨斗挂烫机',
        'Швейные машины и аксессуары': '缝纫机',
        'Пароочистители': '蒸汽清洁机',
        'Паровые швабры': '蒸汽拖把',
        'Стеклоочистители': '擦窗机',
        'Сушилки для рук': '干手器',
        'Электровеники': '电动扫帚',
        'Вертикальные пылесосы': '立式吸尘器',
        'Роботы-пылесосы': '扫地机器人',
        'Моющие пылесосы': '洗地机',

        // 三级类目 - 环境电器
        'Кондиционеры и сплит-системы': '空调',
        'Вентиляторы': '电风扇',
        'Увлажнители воздуха и аромадиффузоры': '加湿器香薰机',
        'Водонагреватели': '热水器',
        'Техника для вентиляции': '通风设备',
        'Охладители воздуха': '冷风机',
        'Очистители воздуха': '空气净化器',
        'Осушители воздуха': '除湿机',
        'Обогреватели и тепловентиляторы': '取暖器',
        'Погодные станции и датчики': '气象站传感器',
        'Расходные материалы для климатической техники': '环境电器耗材',

        // 三级类目 - 个护健康
        'Фены и термощетки': '吹风机',
        'Эпиляторы': '脱毛器',
        'Электрические зубные щетки и насадки': '电动牙刷',
        'Электробритвы и аксессуары': '电动剃须刀',
        'Выпрямители для волос': '直发器',
        'Щипцы для завивки волос и стайлеры': '卷发棒',
        'Электробигуди': '电热卷发器',
        'Машинки для стрижки волос и насадки': '理发器',
        'Триммеры для волос': '毛发修剪器',
        'Массажное оборудование и аксессуары': '按摩器材',
        'Напольные весы': '体重秤',

        // 手机相关
        'Смартфоны': '智能手机',
        'Мобильные телефоны': '功能手机',
        'Смарт-часы и браслеты': '智能手表手环',
        'Чехлы для телефонов': '手机壳',
        'Защитные стекла и пленки': '钢化膜',
        'Зарядные устройства и кабели': '充电器数据线',
        'Внешние аккумуляторы': '移动电源',
        'Держатели для телефонов': '手机支架',
        'Наушники': '耳机',
        'Беспроводные наушники': '蓝牙耳机',
        'Наушники с микрофоном': '耳麦',
        'Аудиосистемы': '音响系统',
        'Портативная акустика': '便携音箱',
        'Саундбары': '回音壁',
        'Усилители и ресиверы': '功放接收器',

        // 电脑相关
        'Ноутбуки': '笔记本电脑',
        'Планшеты': '平板电脑',
        'Мониторы': '显示器',
        'Клавиатуры': '键盘',
        'Мыши': '鼠标',
        'Веб-камеры': '摄像头',
        'Микрофоны': '麦克风',
        'Коврики для мыши': '鼠标垫',
        'USB-хабы и док-станции': 'USB扩展坞',
        'Жесткие диски и SSD': '硬盘固态硬盘',
        'Видеокарты': '显卡',
        'Процессоры': 'CPU处理器',
        'Материнские платы': '主板',
        'Оперативная память': '内存条',
        'Блоки питания': '电源',
        'Корпуса': '机箱',
        'Системы охлаждения': '散热器',

        // 摄影摄像
        'Фотоаппараты': '相机',
        'Видеокамеры': '摄像机',
        'Экшн-камеры': '运动相机',
        'Объективы': '镜头',
        'Штативы и стабилизаторы': '三脚架稳定器',
        'Вспышки и освещение': '闪光灯灯光',
        'Карты памяти': '存储卡',
        'Сумки для камер': '相机包',

        // 游戏
        'Игровые консоли': '游戏主机',
        'Игры для консолей': '主机游戏',
        'Игровые ноутбуки': '游戏笔记本',
        'Игровые клавиатуры': '机械键盘',
        'Игровые мыши': '游戏鼠标',
        'Игровые наушники': '游戏耳机',
        'Кресла и столы для геймеров': '电竞桌椅',
        'Рули и джойстики': '方向盘手柄',

        // 通用词汇
        'Каталог': '目录',
        'Все категории': '所有类目',
        'Подробнее': '详情',
        'Свернуть': '收起',
        'Еще': '更多',
        'Популярные бренды': '热门品牌',
    };

    function translateRuToZh(text) {
        if (!text) return '';
        // 先尝试完整匹配
        if (RU_ZH_DICT[text]) return RU_ZH_DICT[text];
        // 尝试首字母大写匹配
        var capitalized = text.charAt(0).toUpperCase() + text.slice(1);
        if (RU_ZH_DICT[capitalized]) return RU_ZH_DICT[capitalized];
        return text;
    }

    function translateAll(text) {
        // 尝试逐词翻译（针对复合词）
        var result = translateRuToZh(text);
        if (result !== text) return result;
        // 如果整词没找到，返回原文
        return text;
    }

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
        return 'https://www.ozon.ru' + (path.startsWith('/') ? '' : '/') + path;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 8);
    }

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    // ============================================================
    // 核心：模拟 hover 触发子菜单 → 递归采集多层级类目树
    // Ozon 的 L2/L3/L4 类目是 hover 时才动态渲染的
    // ============================================================

    // 已知的 Ozon 类目 popover 容器特征
    var POPOVER_SELECTORS = [
        '[data-widget="catalogMenu"]',
        '[data-widget="menu"]',
        '[class*="catalogMenu"]',
        '[class*="catalog-menu"]',
        '[class*="subcategory"]',
        '[class*="sub-category"]',
        '[class*="dropdown"]',
        '[class*="popover"]',
        '[class*="popup"]',
        '[class*="flyout"]',
        '[role="menu"]',
        '[role="tooltip"]',
        '[data-popper-placement]',
        '[class*="popper"]',
        'div[style*="position: fixed"], div[style*="position: absolute"]'
    ];

    // 类目卡片/入口元素选择器（需要 hover 来展开子类目的元素）
    var CAT_TRIGGER_SELECTORS = [
        'a[href*="/category/"]',
        '[data-widget="categoryItem"]',
        '[class*="categoryItem"]',
        '[class*="category-item"]',
        '[class*="menuItem"]',
        '[class*="menu-item"]',
    ];

    function isVisible(el) {
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        return true;
    }

    function isCategoryLink(txt, href) {
        if (!txt || txt.length < 2 || txt.length > 120) return false;
        if (!href) return false;
        var lower = href.toLowerCase();
        if (/\/product\//.test(lower)) return false;
        if (/\/seller\//.test(lower)) return false;
        if (/\/my\//.test(lower)) return false;
        if (/\/cart\//.test(lower)) return false;
        if (/\/checkout\//.test(lower)) return false;
        if (/\/brand\//.test(lower)) return false;
        if (/\/search\//.test(lower)) return false;
        // 纯数字类目ID链接也算
        if (/\/category\//.test(lower)) return true;
        // /highlight/ 类链接
        if (/\/highlight\//.test(lower)) return true;
        return false;
    }

    // 安全的 MouseEvent 构造（绕过 Tampermonkey 沙箱的 isTrusted 问题）
    var _MouseEvent = (typeof unsafeWindow !== 'undefined' && unsafeWindow.MouseEvent) || MouseEvent;
    function createMouseEvent(type, opts) {
        try {
            return new _MouseEvent(type, opts);
        } catch (e) {
            // 回退到 Event（部分浏览器限制 MouseEvent 构造）
            return new Event(type, { bubbles: opts.bubbles, cancelable: opts.cancelable });
        }
    }

    // 模拟 hover 事件
    function simulateHover(el) {
        try {
            var rect = el.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            var opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            el.dispatchEvent(createMouseEvent('mouseenter', opts));
            el.dispatchEvent(createMouseEvent('mouseover', opts));
            el.dispatchEvent(createMouseEvent('mousemove', opts));
            el.dispatchEvent(new Event('focus', { bubbles: true }));
        } catch (e) {
            // 静默失败，不影响后续流程
        }
    }

    // 查找页面上所有 popover/menu 容器
    function findPopoverContainers() {
        var containers = [];
        for (var s = 0; s < POPOVER_SELECTORS.length; s++) {
            try {
                var els = document.querySelectorAll(POPOVER_SELECTORS[s]);
                for (var i = 0; i < els.length; i++) {
                    if (isVisible(els[i])) containers.push(els[i]);
                }
            } catch (e) { /* selector might be invalid */ }
        }
        return containers;
    }

    // 从容器中提取所有类目链接，返回 { name, url, level }
    function extractLinksFromContainer(container) {
        var links = [];
        if (!container) return links;
        var as = container.querySelectorAll('a');
        for (var i = 0; i < as.length; i++) {
            var a = as[i];
            var txt = safeText(a);
            var href = a.getAttribute('href') || '';
            // 跳过嵌套的内层 popover（只取当前容器的直接子节点或浅层链接）
            if (a.closest('[class*="popover"]') !== container.closest('[class*="popover"]') &&
                a.closest('[data-popper-placement]') !== container.closest('[data-popper-placement]')) {
                // 可能是更深层的嵌套 popover，跳过
                // 但简单起见我们先都收
            }
            if (!txt || txt.length < 2 || txt.length > 100) continue;
            if (!isCategoryLink(txt, href)) continue;
            // 去重
            if (!links.some(function(l) { return l.name === txt; })) {
                links.push({ name: txt, url: href, el: a });
            }
        }
        return links;
    }

    // 等待 popover 出现（MutationObserver + timeout）
    function waitForPopover(timeoutMs) {
        return new Promise(function(resolve) {
            var startTime = Date.now();
            var checkInterval = 200;
            var maxWait = timeoutMs || 1500;

            function check() {
                var containers = findPopoverContainers();
                var links = [];
                for (var c = 0; c < containers.length; c++) {
                    var cl = extractLinksFromContainer(containers[c]);
                    links = links.concat(cl);
                }
                // 去重
                var seen = {};
                var unique = [];
                for (var l = 0; l < links.length; l++) {
                    if (!seen[links[l].name]) {
                        seen[links[l].name] = true;
                        unique.push(links[l]);
                    }
                }
                if (unique.length > 0) {
                    resolve(unique);
                    return;
                }
                if (Date.now() - startTime > maxWait) {
                    resolve([]);
                    return;
                }
                setTimeout(check, checkInterval);
            }
            check();
        });
    }

    // 记录 popover 出现时的变化，返回找到的链接
    function watchForChange(el, timeoutMs) {
        return new Promise(function(resolve) {
            var resolved = false;
            var observer = new MutationObserver(function() {
                if (resolved) return;
                var containers = findPopoverContainers();
                var allLinks = [];
                for (var c = 0; c < containers.length; c++) {
                    allLinks = allLinks.concat(extractLinksFromContainer(containers[c]));
                }
                if (allLinks.length > 0) {
                    resolved = true;
                    observer.disconnect();
                    resolve(allLinks);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
            setTimeout(function() {
                if (!resolved) {
                    resolved = true;
                    observer.disconnect();
                    // 最后再检查一次
                    var containers = findPopoverContainers();
                    var allLinks = [];
                    for (var c = 0; c < containers.length; c++) {
                        allLinks = allLinks.concat(extractLinksFromContainer(containers[c]));
                    }
                    resolve(allLinks);
                }
            }, timeoutMs || 2000);
        });
    }

    async function scrapeCategories() {
        addLog('开始扫描类目（含hover展开）...');
        var now = new Date().toISOString();
        var items = [];
        var seen = {};
        var pagePath = location.pathname;

        // ========================================================
        // L1: 页面主类目名
        // ========================================================
        var l1Name = '';
        var h1 = document.querySelector('h1');
        if (h1) l1Name = safeText(h1);
        if (!l1Name) {
            var bcLinks = document.querySelectorAll('nav[aria-label] a, [class*="breadcrumb"] a');
            if (bcLinks.length > 0) l1Name = safeText(bcLinks[bcLinks.length - 1]);
        }
        if (!l1Name) {
            var m = pagePath.match(/\/category\/([a-z0-9\-]+)-?\d*\/?$/);
            if (m) l1Name = m[1].replace(/-/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
        }

        if (l1Name) {
            items.push({
                id: 'l1_' + l1Name.replace(/\s+/g, '_'),
                name: l1Name, nameZh: translateAll(l1Name),
                level: 1, parent: '', parentZh: '',
                url: pagePath, scrapedAt: now
            });
            seen[l1Name + '|1'] = true;
            addLog('L1: ' + l1Name + ' (' + translateAll(l1Name) + ')');
        }

        // ========================================================
        // 策略A：静态扫描页面主内容区链接（无hover时直接可见的类目）
        // ========================================================
        addLog('策略A: 静态扫描...');
        var mainContent = document.querySelector('main, [role="main"], #__next, [id*="content"], [class*="content"]');
        if (!mainContent && document.body) {
            // 尝试找最大的主要内容区
            var bodyChildren = document.body.children;
            var maxArea = 0;
            for (var bc = 0; bc < bodyChildren.length; bc++) {
                var child = bodyChildren[bc];
                if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'LINK') continue;
                if (child.id === 'oz-scraper') continue;
                var r = child.getBoundingClientRect();
                var area = r.width * r.height;
                if (area > maxArea && r.top < window.innerHeight * 0.8) {
                    maxArea = area;
                    mainContent = child;
                }
            }
        }
        if (!mainContent) mainContent = document.body;

        // 在主内容区找所有类目链接
        var staticLinks = mainContent.querySelectorAll('a');
        var staticCategories = [];
        for (var sl = 0; sl < staticLinks.length; sl++) {
            var a = staticLinks[sl];
            if (a.closest('header, footer, [class*="header"], [class*="footer"], [class*="sidebar"]')) continue;
            var txt = safeText(a);
            var href = a.getAttribute('href') || '';
            if (isCategoryLink(txt, href)) {
                var dup = staticCategories.some(function(c) { return c.name === txt; });
                if (!dup) staticCategories.push({ name: txt, url: href, el: a });
            }
        }
        addLog('静态扫描找到 ' + staticCategories.length + ' 个类目链接');

        // 静态链接 → L2 候选（排除 L1 自己）
        for (var sc = 0; sc < staticCategories.length; sc++) {
            var cat = staticCategories[sc];
            if (cat.name === l1Name) continue;
            if (seen[cat.name + '|2']) continue;
            seen[cat.name + '|2'] = true;
            items.push({
                id: generateId(),
                name: cat.name, nameZh: translateAll(cat.name),
                level: 2, parent: l1Name, parentZh: translateAll(l1Name),
                url: cat.url, scrapedAt: now
            });
            addLog('  L2(静态): ' + cat.name);
        }

        // ========================================================
        // 策略B：hover 触发子菜单，采集深层类目
        // ========================================================
        addLog('策略B: hover触发子菜单...');

        // 先关闭所有已有的 popover（移动鼠标到角落）
        var cornerEvent = createMouseEvent('mousemove', {
            bubbles: true, cancelable: true, view: window,
            clientX: 0, clientY: window.innerHeight
        });
        document.dispatchEvent(cornerEvent);
        await sleep(300);

        // B1: 找页面上所有需要 hover 的类目触发器元素
        var triggers = [];
        for (var ts = 0; ts < CAT_TRIGGER_SELECTORS.length; ts++) {
            try {
                var els = document.querySelectorAll(CAT_TRIGGER_SELECTORS[ts]);
                for (var te = 0; te < els.length; te++) {
                    var el = els[te];
                    if (!isVisible(el)) continue;
                    if (el.closest('header, footer')) continue;
                    var txt = safeText(el);
                    var href = el.getAttribute('href') || '';
                    if (!txt || txt.length < 2 || txt === l1Name) continue;
                    if (triggers.some(function(t) { return t.name === txt; })) continue;
                    triggers.push({ name: txt, url: href, el: el });
                }
            } catch (e) {}
        }

        // B2: 额外找 visual category cards（图片+文字的类目卡片）
        var allDivs = document.querySelectorAll('div, section, article');
        for (var dv = 0; dv < allDivs.length; dv++) {
            var div = allDivs[dv];
            if (!isVisible(div)) continue;
            if (div.closest('header, footer, #oz-scraper')) continue;
            // 找包含一个 category 链接和一个 img 的卡片型容器
            var catLink = div.querySelector('a[href*="/category/"]');
            if (!catLink) continue;
            var txt = safeText(catLink);
            if (!txt || txt.length < 2) continue;
            if (triggers.some(function(t) { return t.name === txt; })) continue;
            // 确认是卡片：相对紧凑的尺寸
            var r = div.getBoundingClientRect();
            if (r.width < 80 || r.width > 500 || r.height < 30 || r.height > 400) continue;
            triggers.push({ name: txt, url: catLink.getAttribute('href') || '', el: catLink });
        }

        addLog('发现 ' + triggers.length + ' 个hover触发点');

        // B3: 逐个 hover，抓取弹出子菜单
        var totalL3 = 0, totalL4 = 0;
        var l3Links = {};  // parentName -> [links]

        for (var tg = 0; tg < triggers.length; tg++) {
            var trigger = triggers[tg];
            if (!isRunning) break;

            // 先移开鼠标关闭之前的 popover
            document.dispatchEvent(createMouseEvent('mousemove', {
                bubbles: true, cancelable: true, view: window,
                clientX: 0, clientY: window.innerHeight
            }));
            await sleep(200);

            // hover 触发器
            simulateHover(trigger.el);
            addLog('Hover: ' + trigger.name.substring(0, 30));

            // 等待 popover 出现
            var subLinks = await waitForPopover(1500);

            if (subLinks.length > 0) {
                addLog('  弹出 ' + subLinks.length + ' 个子类目');
                l3Links[trigger.name] = subLinks;

                // 添加为 L3
                for (var sli = 0; sli < subLinks.length; sli++) {
                    var slink = subLinks[sli];
                    if (seen[slink.name + '|3']) continue;
                    seen[slink.name + '|3'] = true;
                    items.push({
                        id: generateId(),
                        name: slink.name, nameZh: translateAll(slink.name),
                        level: 3, parent: trigger.name, parentZh: translateAll(trigger.name),
                        url: slink.url, scrapedAt: now
                    });
                    totalL3++;
                }

                // B4: 在 popover 内 hover 每个 L3，尝试获取 L4
                for (var sli2 = 0; sli2 < subLinks.length; sli2++) {
                    if (!isRunning) break;
                    var l3Link = subLinks[sli2];
                    simulateHover(l3Link.el);
                    await sleep(300);
                    var l4SubLinks = await waitForPopover(1000);
                    if (l4SubLinks.length > 0) {
                        for (var l4i = 0; l4i < l4SubLinks.length; l4i++) {
                            var l4link = l4SubLinks[l4i];
                            // 跳过和 L3 同名的
                            if (l4link.name === l3Link.name) continue;
                            if (seen[l4link.name + '|4']) continue;
                            seen[l4link.name + '|4'] = true;
                            items.push({
                                id: generateId(),
                                name: l4link.name, nameZh: translateAll(l4link.name),
                                level: 4, parent: l3Link.name, parentZh: translateAll(l3Link.name),
                                url: l4link.url, scrapedAt: now
                            });
                            totalL4++;
                        }
                    }
                }
            } else {
                addLog('  (无子菜单)');
            }
        }

        addLog('L3: ' + totalL3 + '  L4: ' + totalL4);

        // ========================================================
        // 策略C：如果 hover 也没拿到数据，走兜底
        // ========================================================
        if (items.length <= triggers.length + 1) {
            addLog('策略C: 兜底扫描...');
            // Hover 也没用，页面可能是静态类目列表。尝试导航到各子类目 URL。
            // 暂时先扫描所有可见链接
            var allVisibleAs = document.querySelectorAll('a');
            for (var av = 0; av < allVisibleAs.length; av++) {
                var avEl = allVisibleAs[av];
                if (!isVisible(avEl)) continue;
                if (avEl.closest('header, footer')) continue;
                var avTxt = safeText(avEl);
                var avHref = avEl.getAttribute('href') || '';
                if (!isCategoryLink(avTxt, avHref)) continue;
                if (avTxt === l1Name) continue;
                // 检测层级：URL深的就是深层类目
                var depth = (avHref.match(/\//g) || []).length;
                var lvl = depth >= 5 ? 4 : depth >= 4 ? 3 : 2;
                var key = avTxt + '|' + lvl;
                if (seen[key]) continue;
                seen[key] = true;
                items.push({
                    id: generateId(),
                    name: avTxt, nameZh: translateAll(avTxt),
                    level: lvl, parent: l1Name, parentZh: translateAll(l1Name),
                    url: avHref, scrapedAt: now
                });
            }
        }

        // 统计
        var l1c = 0, l2c = 0, l3c = 0, l4c = 0;
        for (var ic = 0; ic < items.length; ic++) {
            if (items[ic].level === 1) l1c++;
            else if (items[ic].level === 2) l2c++;
            else if (items[ic].level === 3) l3c++;
            else if (items[ic].level === 4) l4c++;
        }
        addLog('完成: L1=' + l1c + ' L2=' + l2c + ' L3=' + l3c + ' L4=' + l4c);

        return items;
    }

    // ============================================================
    // IndexedDB 存储
    // ============================================================
    var DB_NAME = 'OzonCatTreeV7';
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
    // 导出：Markdown（含中文翻译）
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

        var md = '# Ozon 类目树（俄语 + 中文对照）\n\n';
        md += '> 采集时间: ' + new Date().toLocaleString('zh-CN') + '\n';
        md += '> 来源: ' + location.origin + '\n';
        md += '> 总计: ' + all.length + ' 条类目\n\n';
        md += '---\n\n';

        // 构建树形结构
        for (var i = 0; i < l1Items.length; i++) {
            var l1 = l1Items[i];
            var l1Zh = l1.nameZh || translateAll(l1.name);
            md += '## ' + l1.name + '（' + l1Zh + '）\n\n';
            if (l1.url) md += '> ' + buildUrl(l1.url) + '\n\n';

            var children2 = l2Items.filter(function (c) { return c.parent === l1.name; });
            for (var j = 0; j < children2.length; j++) {
                var l2 = children2[j];
                var l2Zh = l2.nameZh || translateAll(l2.name);
                md += '### ' + l2.name + '（' + l2Zh + '）\n\n';
                if (l2.url) md += '> ' + buildUrl(l2.url) + '\n\n';

                var children3 = l3Items.filter(function (c) { return c.parent === l2.name; });
                for (var k = 0; k < children3.length; k++) {
                    var l3 = children3[k];
                    var l3Zh = l3.nameZh || translateAll(l3.name);
                    md += '#### ' + l3.name + '（' + l3Zh + '）\n\n';

                    var children4 = l4Items.filter(function (c) { return c.parent === l3.name; });
                    for (var m = 0; m < children4.length; m++) {
                        var l4 = children4[m];
                        var l4Zh = l4.nameZh || translateAll(l4.name);
                        md += '- **' + l4.name + '（' + l4Zh + '）**';
                        if (l4.url) md += ' — [' + buildUrl(l4.url) + '](' + buildUrl(l4.url) + ')';
                        md += '\n';
                    }
                    md += '\n';
                }
            }
        }

        // 如果没有树形结构，按层级平铺
        if (l1Items.length === 0) {
            md += '## 📊 按层级分类\n\n';
            for (var lv = 1; lv <= 4; lv++) {
                var items = all.filter(function (c) { return c.level === lv; });
                if (items.length === 0) continue;
                md += '### ' + ['', '一级类目', '二级类目', '三级类目', '四级类目'][lv] + ' (' + items.length + '个)\n\n';
                for (var n = 0; n < items.length; n++) {
                    var item = items[n];
                    var itemZh = item.nameZh || translateAll(item.name);
                    md += '- **' + item.name + '（' + itemZh + '）**';
                    if (item.parent) md += ' ← ' + item.parent;
                    if (item.url) md += ' [' + buildUrl(item.url) + '](' + buildUrl(item.url) + ')';
                    md += '\n';
                }
                md += '\n';
            }
        }

        // 添加翻译对照表
        md += '\n---\n\n';
        md += '## 📖 类目翻译对照表\n\n';
        md += '| 俄语 | 中文 |\n| --- | --- |\n';
        var translated = {};
        for (var t = 0; t < all.length; t++) {
            var it = all[t];
            if (it.nameZh && it.nameZh !== it.name && !translated[it.name]) {
                translated[it.name] = true;
                md += '| ' + it.name + ' | ' + it.nameZh + ' |\n';
            }
        }

        md += '\n---\n\n';
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
    // 导出：CSV（含中文翻译）
    // ============================================================
    async function exportCSV() {
        var all = await getAllItems();
        if (all.length === 0) {
            alert('没有数据！请先在类目页点击"采集本页"。');
            return;
        }
        var BOM = '\uFEFF';
        var header = ['层级', '类目名(俄语)', '类目名(中文)', '完整路径', '父类目(俄语)', '父类目(中文)', 'URL', '采集时间'];
        var rows = all.map(function (c) {
            var nameZh = c.nameZh || translateAll(c.name);
            var parentZh = c.parentZh || translateAll(c.parent);
            return [
                c.level || '',
                '"' + (c.name || '').replace(/"/g, '""') + '"',
                '"' + (nameZh || '').replace(/"/g, '""') + '"',
                '"' + ((c.parent ? c.parent + ' > ' : '') + c.name).replace(/"/g, '""') + '"',
                '"' + (c.parent || '').replace(/"/g, '""') + '"',
                '"' + (parentZh || '').replace(/"/g, '""') + '"',
                c.url ? buildUrl(c.url) : '',
                c.scrapedAt || ''
            ].join(',');
        });
        downloadBlob(BOM + header.join(',') + '\n' + rows.join('\n'), 'ozon-categories-' + Date.now() + '.csv', 'text/csv;charset=utf-8');
        showMsg('CSV 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    // ============================================================
    // 导出：Excel（含中文翻译）
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
            var nameZh = c.nameZh || translateAll(c.name);
            var parentZh = c.parentZh || translateAll(c.parent);
            return {
                '层级': c.level || '',
                '类目名(俄语)': c.name || '',
                '类目名(中文)': nameZh,
                '完整路径': (c.parent ? c.parent + ' > ' : '') + c.name,
                '父类目(俄语)': c.parent || '',
                '父类目(中文)': parentZh,
                'URL': c.url ? buildUrl(c.url) : '',
                '采集时间': c.scrapedAt || ''
            };
        });
        var ws = XLSX.utils.json_to_sheet(data);
        ws['!cols'] = [{ wch: 6 }, { wch: 35 }, { wch: 25 }, { wch: 50 }, { wch: 25 }, { wch: 20 }, { wch: 60 }, { wch: 22 }];
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Ozon类目');
        var buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(new Blob([buf]), 'ozon-categories-' + Date.now() + '.xlsx');
        showMsg('Excel 导出完成！共 ' + all.length + ' 条', 'ok');
    }

    // ============================================================
    // UI
    // ============================================================
    var CSS = '#oz-scraper{position:fixed;top:10px;right:10px;z-index:2147483647;width:320px;background:#1a1a2e;color:#cdd6f4;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,0.6);font:12px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;border:1px solid #313244;user-select:none}.oz-hd{display:flex;align-items:center;padding:7px 10px;background:#1e1e2e;border-radius:10px 10px 0 0;border-bottom:1px solid #313244;cursor:grab;gap:6px}.oz-hd:active{cursor:grabbing}.oz-lg{width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#667eea,#cba6f7);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;color:#1a1a2e;font-weight:700}.oz-tt{flex:1;font-weight:700;font-size:12px;letter-spacing:0.3px}.oz-cl{background:none;border:none;color:#585b70;cursor:pointer;font-size:15px;padding:0 3px;line-height:1}.oz-cl:hover{color:#f38ba8}.oz-bd{padding:10px;display:flex;flex-direction:column;gap:7px}.oz-st{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#181825;border-radius:6px;font-size:11px}.oz-nm{font-weight:700;color:#89b4fa;font-size:15px;min-width:20px;text-align:center}.oz-lb{font-size:8px;padding:2px 6px;border-radius:8px;text-transform:uppercase;letter-spacing:0.5px}.oz-lb.idle{background:#313244;color:#6c7086}.oz-lb.run{background:#1a3a1a;color:#a6e3a1;animation:oz-pulse 0.8s infinite}@keyframes oz-pulse{0%,100%{opacity:1}50%{opacity:0.5}}.oz-inf{font-size:10px;color:#6c7086;padding:3px 6px;background:#11111b;border-radius:4px;text-align:center;line-height:1.5}.oz-br{display:flex;gap:4px}.oz-bt{flex:1;padding:9px 6px;border:none;border-radius:7px;cursor:pointer;font-size:12px;font-weight:600;text-align:center;transition:transform 0.1s}.oz-bt:active{transform:scale(0.96)}.oz-bt:disabled{opacity:0.25;cursor:not-allowed}.oz-scan{background:#89b4fa;color:#1a1a2e}.oz-stop{background:#f38ba8;color:#1a1a2e}.oz-csv{background:#45475a;color:#cdd6f4;font-size:10px;padding:5px}.oz-xls{background:#585b70;color:#cdd6f4;font-size:10px;padding:5px}.oz-md{background:#f9e2af;color:#1a1a2e;font-size:10px;padding:5px}.oz-clr{width:100%;padding:5px;border:none;border-radius:6px;background:#11111b;color:#585b70;cursor:pointer;font-size:10px;margin-top:2px}.oz-clr:hover{color:#f38ba8}.oz-log{display:none;max-height:90px;overflow-y:auto;background:#11111b;border-radius:6px;padding:5px;font-size:9px;color:#6c7086;line-height:1.6}.oz-log.on{display:block}.oz-log i{display:block;padding:1px 0;border-bottom:1px solid #1e1e2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.oz-log i:last-child{border-bottom:none}.oz-msg{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:8px;color:#fff;font-size:13px;font-weight:600;z-index:2147483647;animation:oz-fade 0.3s ease;box-shadow:0 4px 16px rgba(0,0,0,0.4)}.oz-msg.ok{background:#2ea043}.oz-msg.err{background:#f85149}.oz-msg.inf{background:#1f6feb}@keyframes oz-fade{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';

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
        item.textContent = '[' + new Date().toLocaleTimeString('zh-CN') + '] ' + txt;
        el.prepend(item);
        while (el.children.length > 80) el.lastChild.remove();
    }

    var panelEl = null;
    var isRunning = false;

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

    function createPanel() {
        var old = document.getElementById('oz-scraper');
        if (old) old.remove();

        GM_addStyle(CSS);
        panelEl = document.createElement('div');
        panelEl.id = 'oz-scraper';
        panelEl.innerHTML = '<div class="oz-hd" id="oz-hd">' +
            '<div class="oz-lg">O</div>' +
            '<div class="oz-tt">Ozon 类目采集 v7.1</div>' +
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
        document.getElementById('oz-cl').addEventListener('click', function () { panelEl.remove(); });
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
                        return { level: c.level, name: c.name, nameZh: c.nameZh, parent: c.parent, url: c.url ? c.url.substring(0, 50) : '' };
                    }));
                });
            }
        };
    }

    async function startScraping() {
        if (isRunning) return;
        isRunning = true;

        var startBtn = document.getElementById('oz-go');
        var stopBtn = document.getElementById('oz-off');
        if (startBtn) startBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = false;
        updateUI();

        showMsg('正在扫描类目...', 'inf');
        addLog('开始采集 ' + location.pathname);

        try {
            var items = await scrapeCategories();
            addLog('发现 ' + items.length + ' 条类目');

            if (items.length === 0) {
                addLog('⚠ 未发现类目！');
                showMsg('未发现类目数据！请确认当前是 Ozon 类目页', 'err');
            } else {
                await saveItems(items);
                addLog('保存 ' + items.length + ' 条');
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
        addLog('数据已清空');
        updateUI();
        showMsg('数据已清空', 'ok');
    }

    // ============================================================
    // 启动
    // ============================================================
    function boot() {
        if (document.getElementById('oz-scraper')) return;
        if (!/ozon\.ru/.test(location.hostname)) return;
        if (/\/my\/|\/cart\/|\/checkout\//.test(location.pathname)) return;

        console.log('[OzonCat] v7.1.0 boot', location.href);
        createPanel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})();