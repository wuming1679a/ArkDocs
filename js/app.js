/* ==========================================================================
   Ark Docs — 文档 / 博客系统 应用层
   依赖：parser.js (LuoguParser)、KaTeX、Prism（均通过 index.html 注入）
   ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------- 常量与工具 ----------------------------- */
  const KEY_ARTICLES = 'arkdocs.articles.v1';
  const KEY_THEME = 'arkdocs.theme';
  const KEY_DRAFT = 'arkdocs.editor.draft.v1';

  // 分类体系（可在代码内扩展；未知分类自动归入「其他」）
  // 注：原先每个分类还有一个单字徽标 short（解/文/教/题/记），用于文章封面方块，
  // 该封面已按需求整体移除，示例中不再保留该字段。
  const CATEGORIES = [
    { id: 'solution', name: '题解', color: '#3498db' },
    { id: 'article', name: '文章', color: '#9b59b6' },
    { id: 'tutorial', name: '教程', color: '#2ecc71' },
    { id: 'problem', name: '题面', color: '#e67e22' },
    { id: 'notes', name: '杂记', color: '#e74c3c' }
  ];
  const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function debounce(fn, ms) {
    let t; return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  /* ----------------------------- 存储层 ----------------------------- */
  function loadArticles() {
    try { return JSON.parse(localStorage.getItem(KEY_ARTICLES)) || null; }
    catch (e) { return null; }
  }
  function saveArticles(list) { localStorage.setItem(KEY_ARTICLES, JSON.stringify(list)); }

  function getArticles() {
    let list = loadArticles();
    if (!list) { list = SEED(); saveArticles(list); }
    return list;
  }
  function getArticle(id) { return getArticles().find(a => a.id === id) || null; }
  function upsertArticle(article) {
    const list = getArticles();
    const i = list.findIndex(a => a.id === article.id);
    if (i >= 0) list[i] = article; else list.unshift(article);
    saveArticles(list);
    return article;
  }
  function deleteArticle(id) {
    const list = getArticles().filter(a => a.id !== id);
    saveArticles(list);
  }

  function allTags() {
    const map = new Map();
    getArticles().forEach(a => (a.tags || []).forEach(t => map.set(t, (map.get(t) || 0) + 1)));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }
  function published() { return getArticles().filter(a => a.status !== 'draft'); }

  /* ----------------------------- Markdown 渲染 ----------------------------- */
  let _parser = null;
  function getParser() {
    if (!_parser) {
      _parser = new LuoguParser({
        katex: window.katex || null,
        prism: window.Prism || null,
        enableInteractiveTasks: true
      });
    }
    return _parser;
  }
  function renderMarkdown(md) {
    try { return getParser().render(md || ''); }
    catch (e) { return '<p class="luogu-p luogu-render-error">渲染出错：' + esc(e.message) + '</p>'; }
  }
  function plainText(md) {
    return (md || '')
      .replace(/```[\s\S]*?```/g, ' ')        // 代码块
      .replace(/`[^`]*`/g, ' ')               // 行内代码
      .replace(/\$\$[\s\S]*?\$\$/g, ' ')      // 块公式
      .replace(/\$[^$]*\$/g, ' ')             // 行内公式
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // 图片
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')// 链接文本
      .replace(/[#>*_~|-]/g, ' ')            // markdown 符号
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ----------------------------- 全局交互函数（供 parser 输出调用） ----------------------------- */
  window.copyCodeBlock = function (btn) {
    const wrap = btn.closest('.luogu-code-block-wrapper');
    const code = wrap ? wrap.querySelector('.luogu-code-pre code') : null;
    if (!code) return;
    const text = code.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('已复制代码'));
    else toast('已复制代码');
  };
  window.toggleTaskCheckbox = function (cb) { /* 阅读态仅视觉切换，无需持久化 */ };
  window.loadBilibiliPlayer = function (btn) {
    const src = btn.getAttribute('data-src');
    if (src) btn.outerHTML = '<iframe src="' + src + '" style="width:100%;aspect-ratio:16/9;border:0;border-radius:10px;" allowfullscreen></iframe>';
  };

  /* ----------------------------- 路由 ----------------------------- */
  function parseHash() {
    let h = location.hash.replace(/^#\/?/, '');
    const [route, ...rest] = h.split('/');
    return { route: route || 'home', param: decodeURIComponent(rest.join('/')) };
  }

  const ROUTES = {
    home: viewHome,
    archive: viewArchive,
    category: viewCategory,
    tag: viewTag,
    search: viewSearch,
    post: viewPost,
    manage: viewManage,
    editor: viewEditor,
    settings: viewSettings          // #/settings 外观设置；#/settings/detail 详细设置
  };

  function navigate() {
    const { route, param } = parseHash();
    const fn = ROUTES[route] || viewHome;
    const view = document.getElementById('view');
    view.innerHTML = fn(param);
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    document.body.setAttribute('data-view', route); // 供 CSS 针对编辑器路由做全屏布局
    bindViewEvents(route);
    renderSidebar();               // 重建抽屉导航（nav-link 在抽屉内，需先渲染再高亮）
    updateActiveNav(route, param); // 必须在 renderSidebar 之后，否则高亮会被重建覆盖
    closeMobileSidebar();
  }

  function updateActiveNav(route, param) {
    const key = param ? route + '/' + param : route;
    document.querySelectorAll('[data-route]').forEach(a => {
      const full = a.getAttribute('data-nav'); // 需要精确到参数时使用（分类 / 标签）
      a.classList.toggle('active', full ? full === key : a.getAttribute('data-route') === route);
    });
  }

  /* ----------------------------- 左侧抽屉导航（默认收起） ----------------------------- */
  function renderSidebar() {
    const sb = document.getElementById('sidebar');

    const ICON = {
      tune: SVG_TUNE,
      home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-8 9 8"/><path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10"/></svg>',
      archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg>',
      manage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    };

    // 抽屉头仅窄屏 off-canvas 需要（顶部栏已有「Ark Docs」品牌，此处不重复）
    sb.innerHTML = `
      <div class="drawer-head">
        <span class="drawer-eyebrow">导航</span>
        <button class="drawer-close" id="drawerClose" aria-label="收起导航" title="收起导航">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
      </div>
      <nav class="drawer-nav">
        <a class="nav-link" data-route="home" href="#/" title="首页">${ICON.home}<span>首页</span></a>
        <a class="nav-link" data-route="archive" href="#/archive" title="归档">${ICON.archive}<span>归档</span></a>
        <a class="nav-link" data-route="manage" href="#/manage" title="管理">${ICON.manage}<span>管理</span></a>
        <a class="nav-link nav-new" data-route="editor" href="#/editor/new" title="新建文章">${ICON.plus}<span>新建文章</span></a>
      </nav>
      <div class="drawer-spacer"></div>
      <!-- 外观设置入口：固定在导航栏左下角，跳转独立设置页面 -->
      <div class="drawer-bottom">
        <a class="nav-link nav-settings" data-route="settings" href="#/settings" title="外观设置">${ICON.tune}<span>外观设置</span></a>
      </div>`;

    const dc = document.getElementById('drawerClose');
    if (dc) dc.addEventListener('click', closeMobileSidebar);
  }

  /* ----------------------------- 视图：首页 ----------------------------- */
  function viewHome() {
    const arts = published().slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt));
    const pinned = arts.filter(a => a.pinned);
    const recent = arts.filter(a => !a.pinned).slice(0, 6);
    const featured = pinned[0] || arts[0];

    const stats = {
      total: getArticles().length,
      pub: arts.length,
      tags: allTags().length,
      cats: CATEGORIES.filter(c => arts.some(a => a.category === c.id)).length
    };

    return `
      <section class="hero">
        <h1>Ark Docs · 文档与博客系统</h1>
        <p>基于洛谷 Markdown / KaTeX 编辑器内核构建：支持数学公式、代码高亮、标注框与分类标签体系，提供清晰的阅读与检索体验。</p>
        <div class="hero-stats">
          <div><div class="stat-num">${stats.pub}</div><div class="stat-label">已发布</div></div>
          <div><div class="stat-num">${stats.cats}</div><div class="stat-label">分类</div></div>
          <div><div class="stat-num">${stats.tags}</div><div class="stat-label">标签</div></div>
          <div><div class="stat-num">${stats.total}</div><div class="stat-label">总计</div></div>
        </div>
      </section>

      ${featured ? `<div class="section-title"><span class="bar"></span>精选推荐</div>
        ${postCard(featured, true)}` : ''}

      <div class="section-title"><span class="bar"></span>最近更新</div>
      <div class="card-grid">
        ${recent.map(a => postCard(a)).join('') || emptyHint('还没有发布文章，去「管理」新建一篇吧。')}
      </div>`;
  }

  function postCard(a, big) {
    const c = CAT_MAP[a.category] || { name: '其他', color: '#888' };
    const tags = (a.tags || []).slice(0, 3).map(t => `<span class="tag-badge">${esc(t)}</span>`).join('');
    return `
      <a class="post-card" href="#/post/${a.id}">
        <div class="pc-title">${esc(a.title)}</div>
        <div class="pc-summary">${esc(a.summary || stripSummary(a.content))}</div>
        <div class="pc-meta">
          <span class="cat-badge">${esc(c.name)}</span>
          <span>·</span><span>${fmtDate(a.updatedAt)}</span>
          ${tags ? `<span style="margin-left:auto">${tags}</span>` : ''}
        </div>
      </a>`;
  }
  function stripSummary(md) { return plainText(md).slice(0, 90); }
  function emptyHint(msg) { return `<div class="empty-state"><div class="es-icon">∅</div><div class="es-title">${esc(msg)}</div></div>`; }

  /* ----------------------------- 视图：归档 ----------------------------- */
  function viewArchive() {
    const arts = published().slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const catPills = CATEGORIES.map(c =>
      `<a class="filter-pill" href="#/category/${c.id}">${esc(c.name)}</a>`).join('');
    const tagPills = allTags().slice(0, 12).map(([t]) =>
      `<a class="filter-pill" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('');

    return `
      <div class="page-head">
        <div class="page-title">归档</div>
        <div class="page-sub">共 ${arts.length} 篇已发布内容</div>
      </div>
      <div class="list-controls">
        <a class="filter-pill" href="#/archive">全部</a>${catPills}
      </div>
      <div class="list-controls">${tagPills}</div>
      <div style="margin-top:8px">
        ${arts.map(postRow).join('') || emptyHint('暂无内容。')}
      </div>`;
  }

  function postRow(a) {
    const c = CAT_MAP[a.category] || { name: '其他', color: '#888' };
    const tags = (a.tags || []).slice(0, 3).map(t => `<span>${esc(t)}</span>`).join(' ');
    return `
      <a class="post-row" href="#/post/${a.id}">
        <div class="pr-main">
          <div class="pr-title">${esc(a.title)}</div>
          <div class="pr-sub"><span class="cat-badge">${esc(c.name)}</span><span>${fmtDate(a.updatedAt)}</span>${tags ? `<span>${tags}</span>` : ''}</div>
        </div>
        <div class="pr-date">${a.pinned ? '置顶' : ''}</div>
      </a>`;
  }

  /* ----------------------------- 视图：分类 / 标签 ----------------------------- */
  function viewCategory(id) {
    const c = CAT_MAP[id] || { name: '其他', color: '#888' };
    const arts = published().filter(a => a.category === id).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return `
      <div class="breadcrumb"><a href="#/">首页</a> / 分类</div>
      <div class="page-head">
        <div class="page-title">${esc(c.name)}</div>
        <div class="page-sub">该分类下共 ${arts.length} 篇</div>
      </div>
      ${arts.length ? `<div class="card-grid">${arts.map(a => postCard(a)).join('')}</div>` : emptyHint('该分类暂无内容。')}`;
  }
  function viewTag(tag) {
    const arts = published().filter(a => (a.tags || []).includes(tag)).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return `
      <div class="breadcrumb"><a href="#/">首页</a> / 标签</div>
      <div class="page-head">
        <div class="page-title">${esc(tag)}</div>
        <div class="page-sub">带有该标签的内容共 ${arts.length} 篇</div>
      </div>
      ${arts.length ? `<div class="card-grid">${arts.map(a => postCard(a)).join('')}</div>` : emptyHint('该标签暂无内容。')}`;
  }

  /* ----------------------------- 视图：搜索 ----------------------------- */
  function viewSearch(q) {
    q = (q || '').trim();
    if (!q) {
      return `<div class="page-head"><div class="page-title">搜索</div></div>
        <div class="search-box" style="max-width:560px"><input id="bigSearch" class="search-box-input" placeholder="输入关键词…" style="width:100%;height:44px;padding:0 16px;border:1px solid var(--border);border-radius:999px;font-size:15px;outline:none" autofocus></div>`;
    }
    const ql = q.toLowerCase();
    const results = published().map(a => {
      const text = plainText(a.content);
      const hay = (a.title + ' ' + (a.summary || '') + ' ' + (a.tags || []).join(' ') + ' ' + (CAT_MAP[a.category] || {}).name + ' ' + text).toLowerCase();
      const idx = hay.indexOf(ql);
      if (idx < 0) return null;
      const excerpt = makeExcerpt(text, ql);
      return { a, excerpt, titleHit: a.title.toLowerCase().includes(ql) };
    }).filter(Boolean).sort((x, y) => new Date(y.a.updatedAt) - new Date(x.a.updatedAt));

    return `
      <div class="breadcrumb"><a href="#/">首页</a> / 搜索</div>
      <div class="page-head"><div class="page-title">搜索：“${esc(q)}”</div>
        <div class="page-sub">找到 ${results.length} 条结果</div></div>
      <div class="search-meta">共检索 ${published().length} 篇已发布内容</div>
      ${results.map(r => `
        <div class="result-item" data-post="${r.a.id}">
          <div class="ri-title">${highlight(r.a.title, q)}</div>
          <div class="ri-sub">
            <span class="cat-badge">${(CAT_MAP[r.a.category] || {}).name || '其他'}</span>
            <span>${fmtDate(r.a.updatedAt)}</span>
            ${(r.a.tags || []).slice(0, 4).map(t => `<span>${esc(t)}</span>`).join(' ')}
          </div>
          <div class="ri-excerpt">${highlight(r.excerpt, q)}</div>
        </div>`).join('') || emptyHint('没有匹配的结果，换个关键词试试。')}`;
  }
  function makeExcerpt(text, ql) {
    const i = text.toLowerCase().indexOf(ql);
    const s = Math.max(0, i - 40);
    const e = Math.min(text.length, i + ql.length + 80);
    return (s > 0 ? '…' : '') + text.slice(s, e) + (e < text.length ? '…' : '');
  }
  function highlight(text, q) {
    const safe = esc(text);
    try {
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return safe.replace(re, '<mark class="hl">$1</mark>');
    } catch (e) { return safe; }
  }

  /* ----------------------------- 视图：阅读页 ----------------------------- */
  function viewPost(id) {
    const a = getArticle(id);
    if (!a) return `<div class="empty-state"><div class="es-icon">∅</div><div class="es-title">未找到该文章</div><a class="btn" href="#/archive" style="margin-top:14px">返回归档</a></div>`;

    const c = CAT_MAP[a.category] || { name: '其他', color: '#888' };
    const html = renderMarkdown(a.content);
    const tags = (a.tags || []).map(t => `<a class="tag-badge" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('');

    // 相关文章
    const related = published()
      .filter(x => x.id !== a.id && (x.category === a.category || (x.tags || []).some(t => (a.tags || []).includes(t))))
      .slice(0, 3);

    // 上一篇/下一篇（按更新时间排序）
    const sorted = published().sort((x, y) => new Date(y.updatedAt) - new Date(x.updatedAt));
    const idx = sorted.findIndex(x => x.id === a.id);
    const prev = idx < sorted.length - 1 ? sorted[idx + 1] : null;
    const next = idx > 0 ? sorted[idx - 1] : null;

    // 文章头部：标题独占一行；元信息行左右分栏（左=作者/发布时间，右=分类）
    // 注意：这里不提供点赞 / 收藏 / 不喜欢等互动栏
    const pubDate = fmtDate(a.createdAt);
    const upDate = fmtDate(a.updatedAt);

    // 这些开关来自「详细设置 → 文章设置项」，逐段拼接以免隐藏后留下多余的分隔符
    const metaParts = [];
    if (asetFlag('showAuthor', true)) metaParts.push(`<span class="m">作者：${esc(a.author || '佚名')}</span>`);
    if (asetFlag('showDate', true)) metaParts.push(`<span class="m">发布于 ${pubDate}</span>`);
    if (upDate !== pubDate) metaParts.push(`<span class="m">更新于 ${upDate}</span>`);
    metaParts.push(`<span class="m">${a.views || 0} 次浏览</span>`);
    const metaLeft = metaParts.join('<span class="am-sep">·</span>');

    const withToc = asetFlag('showToc', true);
    const withTags = !!tags && asetFlag('showTags', true);

    const body = `
      <div class="reading-wrap${withToc ? '' : ' no-toc'}">
        <article class="article">
          <header class="article-header">
            <h1 class="article-title">${esc(a.title)}</h1>
            <div class="article-meta">
              <div class="am-left">${metaLeft}</div>
              <div class="am-right">
                <span class="am-label">分类</span>
                <span class="cat-badge">${esc(c.name)}</span>
                ${a.pinned ? '<span class="tag-badge">置顶</span>' : ''}
                ${a.status === 'draft' ? '<span class="tag-badge">草稿</span>' : ''}
              </div>
            </div>
          </header>
          <div class="preview-content">${html}</div>
          ${withTags ? `<div class="article-tags"><span class="at-label">标签</span>${tags}</div>` : ''}
          ${(prev || next) ? `<div class="post-nav">
            ${prev ? `<a class="prev" href="#/post/${prev.id}"><div class="pn-label">← 上一篇</div><div class="pn-title">${esc(prev.title)}</div></a>` : '<span></span>'}
            ${next ? `<a class="next" href="#/post/${next.id}"><div class="pn-label">下一篇 →</div><div class="pn-title">${esc(next.title)}</div></a>` : '<span></span>'}
          </div>` : ''}
          ${related.length ? `<div class="section-title" style="margin-top:34px"><span class="bar"></span>相关推荐</div>
            <div class="card-grid">${related.map(r => postCard(r)).join('')}</div>` : ''}
        </article>
        ${withToc ? '<nav class="toc" id="toc" aria-label="目录"></nav>' : ''}
      </div>`;

    // 浏览量 +1
    a.views = (a.views || 0) + 1; upsertArticle(a);
    return body;
  }

  function bindPostView() {
    const content = document.querySelector('#view .preview-content');
    const toc = document.getElementById('toc');
    if (!content || !toc) return;
    // 右侧小标题导航：收录 h1~h4，但剔除「与文章标题完全重复」的那个 h1
    // （不少文章正文第一行会再写一遍标题，重复进目录没有意义）
    const artTitle = (document.querySelector('#view .article-title') || { textContent: '' }).textContent.trim();
    let heads = [...content.querySelectorAll('h1, h2, h3, h4')]
      .filter(h => !(h.tagName === 'H1' && h.textContent.trim() === artTitle));
    if (!heads.length) heads = [...content.querySelectorAll('h1, h2, h3')];
    if (!heads.length) { toc.innerHTML = ''; return; }
    let html = '<div class="toc-title">本文目录</div>';
    heads.forEach(h => {
      const lvl = h.tagName.toLowerCase();   // h1 / h2 顶格，h3 / h4 逐级缩进
      html += `<a class="${lvl}" href="#${h.id}" data-toc="${h.id}">${esc(h.textContent)}</a>`;
    });
    toc.innerHTML = html;

    // TOC 点击平滑滚动
    toc.querySelectorAll('a').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      const el = document.getElementById(a.getAttribute('data-toc'));
      if (el) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    }));

    // 滚动高亮（scroll-spy）
    const links = [...toc.querySelectorAll('a')];
    const obs = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          links.forEach(l => l.classList.toggle('active', l.getAttribute('data-toc') === en.target.id));
        }
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    heads.forEach(h => obs.observe(h));
  }

  /* ----------------------------- 视图：管理台 ----------------------------- */
  function viewManage() {
    const list = getArticles().slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const rows = list.map(a => {
      const c = CAT_MAP[a.category] || { name: '其他', color: '#888' };
      const st = a.status === 'draft' ? '<span class="status-dot status-draft"></span>草稿' : '<span class="status-dot status-published"></span>已发布';
      return `
        <tr>
          <td class="mt-title">${esc(a.title)} ${a.pinned ? '置顶' : ''}</td>
          <td><span class="cat-badge">${esc(c.name)}</span></td>
          <td>${(a.tags || []).map(t => esc(t)).join(' ') || '—'}</td>
          <td>${st}</td>
          <td>${fmtDate(a.updatedAt)}</td>
          <td>
            <div class="row-actions">
              <a class="btn btn-sm" href="#/editor/${a.id}">编辑</a>
              <a class="btn btn-sm" href="#/post/${a.id}">查看</a>
              <button class="btn btn-sm btn-danger" data-del="${a.id}">删除</button>
            </div>
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="page-head" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div><div class="page-title">内容管理</div><div class="page-sub">共 ${list.length} 篇（含草稿）</div></div>
        <a class="btn btn-primary" href="#/editor/new">＋ 新建文章</a>
      </div>
      <table class="manage-table">
        <thead><tr><th>标题</th><th>分类</th><th>标签</th><th>状态</th><th>更新</th><th>操作</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:30px">暂无内容，点击右上角「新建文章」开始。</td></tr>`}</tbody>
      </table>`;
  }

  /* ----------------------------- 视图：编辑器 ----------------------------- */
  function viewEditor(id) {
    const isNew = id === 'new';
    const a = isNew ? null : getArticle(id);
    let draft = null;
    if (isNew) { try { draft = JSON.parse(localStorage.getItem(KEY_DRAFT)); } catch (e) {} }
    const art = a || draft || { title: '', category: 'article', tags: [], summary: '', content: '', status: 'published', author: '', pinned: false };

    const title = art.title || '';
    const category = art.category || 'article';
    const tags = art.tags || [];
    const summary = art.summary || '';
    const author = art.author || '';
    const status = art.status || 'published';

    const catOpts = CATEGORIES.map(c => `<option value="${c.id}" ${c.id === category ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

    return `
      <div class="editor-shell" id="editorShell">
        <div class="editor-head">
          <input class="title-input" id="edTitle" placeholder="请输入文章标题…" value="${esc(title)}" />
          <select id="edCat" class="ed-cat">${catOpts}</select>
          <button class="btn btn-primary" id="edSave">保存到文章库</button>
          <button class="btn btn-ghost" id="edFull" title="全屏编辑（Esc 退出）">全屏</button>
          <a class="btn btn-ghost" href="#/manage" id="edCancel">取消</a>
          ${isNew && draft ? '<span class="draft-restored">已自动恢复上次未发布的草稿</span>' : ''}
        </div>

        <details class="ed-adv">
          <summary>更多设置（标签 / 作者 / 状态 / 置顶 / 摘要）</summary>
          <div class="ed-adv-body">
            <div class="meta-grid">
              <div class="meta-field"><label>标签（逗号分隔）</label><input id="edTags" value="${esc(tags.join(', '))}" placeholder="算法, C++, 动态规划" /></div>
              <div class="meta-field"><label>作者</label><input id="edAuthor" value="${esc(author)}" placeholder="佚名" /></div>
              <div class="meta-field"><label>状态</label><select id="edStatus">
                <option value="published" ${status === 'published' ? 'selected' : ''}>已发布</option>
                <option value="draft" ${status === 'draft' ? 'selected' : ''}>草稿</option>
              </select></div>
              <div class="meta-field"><label>置顶</label><select id="edPin">
                <option value="no" ${!art.pinned ? 'selected' : ''}>否</option>
                <option value="yes" ${art.pinned ? 'selected' : ''}>是</option>
              </select></div>
            </div>
            <div class="meta-field" style="margin:0"><label>摘要（留空则自动截取）</label>
              <textarea id="edSummary" placeholder="一句话概括文章内容…">${esc(summary)}</textarea></div>
            <p class="editor-hint">编辑器为洛谷官方内核（KaTeX + Prism + 标注框 / 题面 / 表格等扩展语法），内置 4 种编辑模式：双栏实时预览、纯编辑、纯预览、Typora 所见即所得（在编辑器工具栏切换）。编辑器内「保存」可下载 .md；本页「保存到文章库」将内容录入 Ark Docs 文章库。新建文章的草稿会自动恢复。</p>
          </div>
        </details>

        <iframe id="luoguFrame" class="editor-frame" src="editor/luogu-editor.html" title="洛谷 Markdown 编辑器"></iframe>
      </div>`;
  }

  function bindEditor(id) {
    const frame = document.getElementById('luoguFrame');
    if (!frame) return;

    let frameReady = false;
    const contentResolvers = [];
    const requestContent = (cb) => { contentResolvers.push(cb); frame.contentWindow.postMessage({ type: 'ark-get' }, '*'); };

    window.addEventListener('message', (e) => {
      if (e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'ark-ready') { frameReady = true; loadIntoEditor(); }
      else if (d.type === 'ark-content') { const r = contentResolvers.shift(); if (r) r(d.markdown); }
      else if (d.type === 'ark-mode') {
        // iframe 内 Typora 模式切换：同步外层 editor-shell 的 mode class，
        // 让 CSS 能隐藏外层 editor-head（文章标题 + 保存到文章库等）
        const shell = document.getElementById('editorShell');
        if (shell && typeof d.mode === 'string') {
          const MODES = ['mode-split', 'mode-editor-only', 'mode-preview-only', 'mode-typora'];
          shell.classList.remove(...MODES);
          shell.classList.add('mode-' + d.mode);
        }
      }
    });

    function loadIntoEditor() {
      const a = id === 'new' ? null : getArticle(id);
      let md = '', title = '';
      if (a) { md = a.content || ''; title = a.title || ''; }
      else if (id === 'new') { try { const dr = JSON.parse(localStorage.getItem(KEY_DRAFT)); if (dr) { md = dr.content || ''; title = dr.title || ''; } } catch (e) {} }
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      frame.contentWindow.postMessage({ type: 'ark-load', markdown: md, title: title, theme: theme }, '*');
    }

    const saveDraft = () => {
      if (id !== 'new') return;
      requestContent((md) => {
        localStorage.setItem(KEY_DRAFT, JSON.stringify({
          title: document.getElementById('edTitle').value.trim(),
          category: document.getElementById('edCat').value,
          tags: document.getElementById('edTags').value.split(',').map(s => s.trim()).filter(Boolean),
          summary: document.getElementById('edSummary').value.trim(),
          author: document.getElementById('edAuthor').value.trim(),
          content: md
        }));
      });
    };

    document.getElementById('edSave').addEventListener('click', () => {
      if (!frameReady) { toast('编辑器尚未就绪，请稍候…'); return; }
      requestContent((md) => {
        const art = collectEditor(id, md);
        if (id === 'new') localStorage.removeItem(KEY_DRAFT);
        upsertArticle(art);
        toast('已保存到文章库：' + art.title);
        location.hash = '#/post/' + art.id;
      });
    });

    ['edTitle', 'edCat', 'edTags', 'edAuthor', 'edStatus', 'edPin', 'edSummary'].forEach(fid => {
      const el = document.getElementById(fid);
      if (el) el.addEventListener('input', debounce(saveDraft, 1000));
    });

    // 全屏切换（Fullscreen API，兼容 webkit 前缀）；编辑器占满整个屏幕
    const fsBtn = document.getElementById('edFull');
    const shell = document.getElementById('editorShell');
    if (fsBtn && shell) {
      const reqFS = shell.requestFullscreen || shell.webkitRequestFullscreen || shell.mozRequestFullScreen || shell.msRequestFullscreen;
      const exitFS = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
      fsBtn.addEventListener('click', () => {
        if (!isFs()) { if (reqFS) { const p = reqFS.call(shell); if (p && p.catch) p.catch(() => {}); } }
        else { if (exitFS) exitFS.call(document); }
      });
      const syncFs = () => { fsBtn.textContent = isFs() ? '退出全屏' : '全屏'; };
      document.addEventListener('fullscreenchange', syncFs);
      document.addEventListener('webkitfullscreenchange', syncFs);
    }
  }

  function collectEditor(id, md) {
    return {
      id: id === 'new' ? uid() : id,
      title: document.getElementById('edTitle').value.trim() || '未命名文章',
      category: document.getElementById('edCat').value,
      tags: document.getElementById('edTags').value.split(',').map(s => s.trim()).filter(Boolean),
      author: document.getElementById('edAuthor').value.trim(),
      status: document.getElementById('edStatus').value,
      pinned: document.getElementById('edPin').value === 'yes',
      summary: document.getElementById('edSummary').value.trim(),
      content: md,
      createdAt: (getArticle(id) || {}).createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  /* ----------------------------- 视图事件绑定 ----------------------------- */
  function bindViewEvents(route) {
    if (route === 'post') bindPostView();
    if (route === 'editor') bindEditor(parseHash().param);
    if (route === 'settings') {
      // #/settings → 外观设置页；#/settings/detail → 详细设置页
      if (parseHash().param === 'detail') bindSettingsDetail(); else bindSettingsPage();
    }
    if (route === 'search' && !parseHash().param) {
      const bs = document.getElementById('bigSearch');
      if (bs) bs.addEventListener('keydown', e => { if (e.key === 'Enter') location.hash = '#/search/' + encodeURIComponent(bs.value.trim()); });
    }
    if (route === 'manage') {
      document.querySelectorAll('#view [data-del]').forEach(b => b.addEventListener('click', () => {
        confirmModal('删除文章', '确定要删除《' + (getArticle(b.getAttribute('data-del')) || {}).title + '》吗？此操作不可撤销。', () => {
          deleteArticle(b.getAttribute('data-del'));
          toast('已删除'); navigate();
        });
      }));
    }
    // 搜索结果点击跳转
    document.querySelectorAll('#view .result-item').forEach(it => it.addEventListener('click', () => { location.hash = '#/post/' + it.getAttribute('data-post'); }));

    // 封面徽标（.pc-cover / .pr-cover）已按需求移除，原先挂在它上面的「点击封面跳分类」委托监听
    // 一并删掉，避免留下指向不存在节点的死代码。分类入口改由列表上方的分类筛选条 + 侧栏承担。
  }

  /* ----------------------------- 弹窗 / Toast ----------------------------- */
  function confirmModal(title, msg, onOk) {
    let mask = document.querySelector('.modal-mask');
    if (!mask) { mask = document.createElement('div'); mask.className = 'modal-mask hidden'; document.body.appendChild(mask); }
    mask.innerHTML = `<div class="modal"><h3>${esc(title)}</h3><p>${esc(msg)}</p>
      <div class="modal-actions"><button class="btn" id="mCancel">取消</button><button class="btn btn-danger" id="mOk">删除</button></div></div>`;
    mask.classList.remove('hidden');
    document.getElementById('mCancel').onclick = () => mask.classList.add('hidden');
    document.getElementById('mOk').onclick = () => { mask.classList.add('hidden'); onOk(); };
  }
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  function closeMobileSidebar() {
    const d = document.getElementById('drawer');
    const b = document.getElementById('drawerBackdrop');
    const mt = document.getElementById('menuToggle');
    if (d) d.classList.remove('open');
    if (b) b.classList.remove('show');
    if (mt) mt.setAttribute('aria-expanded', 'false');
  }

  /* ----------------------------- 主题 ----------------------------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.textContent = theme === 'dark' ? '深色' : '浅色';
    localStorage.setItem(KEY_THEME, theme);
  }

  /* ----------------------------- 种子数据 ----------------------------- */
  function SEED() {
    const now = Date.now();
    const mk = (title, category, tags, summary, content, extra) => Object.assign({
      id: uid(), title, category, tags, summary, content,
      author: 'Ark', status: 'published', pinned: false,
      createdAt: new Date(now - Math.floor(Math.random() * 9) * 86400000).toISOString(),
      updatedAt: new Date(now - Math.floor(Math.random() * 5) * 86400000).toISOString(),
      views: Math.floor(Math.random() * 200)
    }, extra || {});

    const a1 = mk('题解 P1001 A+B Problem', 'solution', ['入门', 'C++', '洛谷'],
      '最基础的求和题，演示代码高亮、行内与块级数学公式、以及标注框的使用。',
      [
        '# P1001 A+B Problem',
        '',
        '> 题目描述：输入两个整数 $a$ 与 $b$，输出它们的和 $c=a+b$。',
        '',
        '## 思路',
        '',
        '这是入门第一题，核心在于**读取两个数并求和**。复杂度 $O(1)$。',
        '',
        ':::info[输入输出格式]',
        '输入：`a b`（空格分隔）  ',
        '输出：`a+b` 的结果',
        ':::',
        '',
        '## 代码实现',
        '',
        '```cpp',
        '#include <iostream>',
        'using namespace std;',
        'int main() {',
        '    int a, b;',
        '    cin >> a >> b;',
        '    cout << a + b << endl;',
        '    return 0;',
        '}',
        '```',
        '',
        '## 复杂度分析',
        '',
        '时间复杂度 $T(n)=\\mathcal{O}(1)$，空间复杂度 $S(n)=\\mathcal{O}(1)$。',
        '',
        ':::success[提交建议]',
        '注意使用 `long long` 以防溢出（本题数据范围较小，int 即可）。',
        ':::'
      ].join('\n'),
      { pinned: true });

    const a2 = mk('算法笔记：动态规划入门', 'tutorial', ['动态规划', '算法', '教程'],
      '用表格与任务清单讲解 DP 的核心思想，含状态转移方程与示例。',
      [
        '# 动态规划（DP）入门',
        '',
        '动态规划用于求解**具有重叠子问题与最优子结构**的问题。',
        '',
        '## 三大要素',
        '',
        '- [x] 定义状态 `dp[i]` 表示什么',
        '- [x] 写出状态转移方程',
        '- [ ] 确定边界与遍历顺序',
        '',
        '## 经典例子：斐波那契',
        '',
        '状态转移：',
        '',
        '$$F_n = F_{n-1} + F_{n-2},\\quad F_0=0,\\;F_1=1$$',
        '',
        '| 方法 | 时间复杂度 | 空间复杂度 |',
        '| :--- | :---: | :---: |',
        '| 暴力递归 | $O(2^n)$ | $O(n)$ |',
        '| 记忆化 / DP | $O(n)$ | $O(n)$ |',
        '',
        ':::warning[常见错误]',
        '忘记初始化 `dp[0]` 与 `dp[1]`，导致数组越界或结果错误。',
        ':::'
      ].join('\n'));

    const a3 = mk('洛谷题目题面模板说明', 'problem', ['题面', '模板', '洛谷'],
      '展示题面类内容的写法：数据范围、输入输出样例与数学约束。',
      [
        '# 题目描述',
        '',
        '给定一个长度为 $n$ 的序列 $a_1,a_2,\\dots,a_n$，求区间和的最大值。',
        '',
        '## 输入格式',
        '',
        '第一行一个整数 $n\\ (1\\le n\\le 10^5)$。',
        '第二行 $n$ 个整数 $a_i\\ (-10^9\\le a_i\\le 10^9)$。',
        '',
        '## 数据范围',
        '',
        '| 测试点 | $n$ 范围 | 特殊性质 |',
        '| :--- | :---: | :---: |',
        '| 1~4 | $\\le 10$ | 无 |',
        '| 5~8 | $\\le 10^3$ | 无 |',
        '| 9~10 | $\\le 10^5$ | 无 |',
        '',
        ':::error[注意]',
        '答案可能超过 `int` 范围，请使用 `long long`。',
        ':::'
      ].join('\n'));

    const a4 = mk('读书随笔：关于专注与写作', 'notes', ['随笔', '写作'],
      '用引用诗（epigraph）与对齐排版，演示叙事类文章的呈现方式。',
      [
        '# 关于专注',
        '',
        ':::epigraph[写作是一场与自己的长谈。]',
        '好的文章不是写出来的，是改出来的。',
        ':::',
        '',
        '我们常常高估一天能做的事，却低估一年能做的事。',
        '',
        ':::align{center}',
        '**慢就是快。**',
        ':::',
        '',
        '## 我的写作清单',
        '',
        '- [x] 确定主题',
        '- [ ] 列出大纲',
        '- [ ] 完成初稿',
        '- [ ] 修订三遍',
        '',
        '> 写作是思考的延伸，也是思考的整理。'
      ].join('\n'));

    const a5 = mk('KaTeX 数学公式速查', 'article', ['数学', 'KaTeX', '公式'],
      '汇总常用数学公式写法，配合行内与独立成行公式示例。',
      [
        '# KaTeX 公式速查',
        '',
        '行内公式用 `$...$`，独立公式用 `$$...$$`。',
        '',
        '## 常用符号',
        '',
        '- 分数：$\\frac{a}{b}$',
        '- 上下标：$x^2,\\ x_1$',
        '- 根号：$\\sqrt{x},\\ \\sqrt[n]{x}$',
        '- 求和：$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$',
        '',
        '## 独立公式示例',
        '',
        '$$\\int_{0}^{1} x^2\\,dx = \\left[\\frac{x^3}{3}\\right]_{0}^{1} = \\frac{1}{3}$$',
        '',
        ':::info[提示]',
        '公式渲染依赖 KaTeX（与源编辑器同版本 0.18.4）。',
        ':::'
      ].join('\n'));

    return [a1, a2, a3, a4, a5];
  }

  /* ==========================================================================
     外观偏好 / 详细设置（独立页面）
     ---------------------------------------------------------------------------
     三层数据结构，全部落盘 localStorage：
       1) PREFS          快速外观：字体 / 字号 / 行高 / 内容宽度 / 动效 / 导航时长
       2) PREFS.comps    分组件字体：勾选「启用自定义」后该组件独立覆盖 font-family
       3) ASET           文章设置项：按类别组织，支持新增类别 / 设置项与逐项恢复默认
     ========================================================================== */
  const KEY_PREFS = 'arkdocs.prefs.v1';
  const KEY_ASET = 'arkdocs.articleset.v1';

  /* ---------- 字体栈（快速外观与详细设置共用同一份） ---------- */
  const FONT_STACKS = {
    /* === 系统字体（无 woff2，永远不下载；这是 ArkDocs 默认与极简优先的基线） === */
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif',
    sans: '"Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", "Songti SC", "SimSun", "Noto Serif SC", serif',
    mono: '"Cascadia Code", "Fira Code", "Consolas", "Courier New", monospace',
    song: '"SimSun", "Songti SC", "宋体", "Noto Serif SC", serif',
    kai: '"KaiTi", "STKaiti", "楷体", "Kaiti SC", serif',
    hei: '"Microsoft YaHei", "PingFang SC", "Heiti SC", "黑体", sans-serif',
    fangsong: '"FangSong", "STFangsong", "仿宋", "FangSong_GB2312", serif',
    round: '"YouYuan", "Yuanti SC", "幼圆", "Microsoft YaHei", sans-serif',
    /* === 简素字体（来自简素·文档系统 / wwwroot/assets/fonts/fonts.json，woff2 按需加载）
       默认不进入 --font-sans，因此默认页面不会下载任何 woff2；
       用户在「详细设置 → 组件字体」里选中某简素字体后，对应字重的 woff2 才被浏览器拉取。 === */
    'noto-sans-sc':          '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Heiti SC", sans-serif',
    'noto-serif-sc':         '"Noto Serif SC", "Songti SC", "SimSun", serif',
    'sarasa-sc':              '"Sarasa SC", "Microsoft YaHei", "PingFang SC", sans-serif',
    'ziyou-wenhua-hei':       '"Ziyou Wenhua Hei", "Microsoft YaHei", "PingFang SC", sans-serif',
    'zcool-qingke-huangyou':  '"ZCOOL QingKe HuangYou", "Microsoft YaHei", sans-serif',
    'ma-shan-zheng':          '"Ma Shan Zheng", "KaiTi", "STKaiti", cursive',
    'inter':                  '"Inter", "Segoe UI", system-ui, sans-serif',
    'baloo-2':                '"Baloo 2", "Segoe UI", system-ui, sans-serif',
    'lora':                   '"Lora", Georgia, "Times New Roman", serif',
    'jetbrains-mono':         '"JetBrains Mono", "Cascadia Code", "Fira Code", "Consolas", monospace',
    'cascadia-code':          '"Cascadia Code", "Fira Code", "Consolas", monospace',
    'fira-code':              '"Fira Code", "JetBrains Mono", "Consolas", monospace',
    'ubuntu-sans-mono':       '"Ubuntu Sans Mono", "Cascadia Code", "Consolas", monospace'
  };
  const FONT_OPTS = [['system', '系统默认'], ['sans', '无衬线'], ['serif', '衬线'], ['mono', '等宽']];
  /* FONT_CHOICES 结构：每组 { label, options }，渲染成 <optgroup>。
     系统字体走系统栈、不下载任何 woff2（极简默认）；简素字体在用户选中后才会下载对应 woff2。 */
  const FONT_CHOICES = [
    { label: '系统字体（无需联网，按系统已装回退）', options: [
      ['system', '系统默认'], ['sans', '无衬线（黑体）'], ['serif', '衬线（宋 / Georgia）'],
      ['mono', '等宽（代码）'], ['song', '宋体'], ['kai', '楷体'], ['hei', '微软雅黑'],
      ['fangsong', '仿宋'], ['round', '圆体']
    ]},
    { label: '简素·中文（自带 woff2，选中后才下载）', options: [
      ['noto-sans-sc',         '思源黑体 Noto Sans SC'],
      ['noto-serif-sc',        '思源宋体 Noto Serif SC'],
      ['sarasa-sc',            '更纱黑体 Sarasa SC'],
      ['ziyou-wenhua-hei',     '字由文艺黑 Ziyou Wenhua Hei'],
      ['zcool-qingke-huangyou','站酷庆科黄油体 ZCOOL QingKe'],
      ['ma-shan-zheng',        '马善政毛笔 Ma Shan Zheng']
    ]},
    { label: '简素·拉丁', options: [
      ['inter',   'Inter'],
      ['lora',    'Lora'],
      ['baloo-2', 'Baloo 2']
    ]},
    { label: '简素·等宽', options: [
      ['jetbrains-mono',   'JetBrains Mono'],
      ['cascadia-code',    'Cascadia Code'],
      ['fira-code',        'Fira Code'],
      ['ubuntu-sans-mono', 'Ubuntu Sans Mono']
    ]}
  ];
  const WIDTH_OPTS = [['narrow', '窄'], ['normal', '标准'], ['wide', '宽'], ['full', '全宽']];
  const MOTION_OPTS = [['full', '完整'], ['reduced', '减弱'], ['off', '关闭']];
  const WIDTH_PX = { narrow: 900, normal: 1180, wide: 1400, full: 0 };

  /* ---------- 可单独自定义字体的组件：key 与 CSS 变量 --font-<key> 一一对应 ---------- */
  const COMPONENTS = [
    { key: 'ui',      name: '界面文字', def: 'system', note: '顶栏、按钮、列表等全部界面元素' },
    { key: 'body',    name: '正文',     def: 'system', note: '文章正文段落' },
    { key: 'heading', name: '标题',     def: 'system', note: '文章标题与各级小标题' },
    { key: 'code',    name: '代码',     def: 'mono',   note: '行内代码与代码块' },
    { key: 'nav',     name: '导航',     def: 'system', note: '左侧导航栏与右侧目录' },
    { key: 'meta',    name: '元信息',   def: 'system', note: '作者 / 时间 / 分类徽标等' }
  ];
  const COMP_MAP = Object.fromEntries(COMPONENTS.map(c => [c.key, c]));
  const COMP_DEF = Object.fromEntries(COMPONENTS.map(c => [c.key, { on: false, font: c.def }]));

  /* ---------- 快速外观选项定义（页面渲染与「恢复默认」共用同一份元数据） ---------- */
  const fmtSize = v => Math.round(Number(v) * 10) / 10 + 'px';
  const fmtLead = v => String(Math.round(Number(v) * 100) / 100);
  const fmtSec = v => Number(v).toFixed(2) + 's';
  const PREF_ROWS = [
    { key: 'font', label: '字体', type: 'seg', opts: FONT_OPTS,
      note: '作用于界面文字与正文；在「详细设置」中可为各组件单独指定字体。' },
    { key: 'size', label: '正文字号', type: 'range', min: 13, max: 20, step: 0.5, fmt: fmtSize },
    { key: 'leading', label: '正文行高', type: 'range', min: 1.5, max: 2.2, step: 0.05, fmt: fmtLead },
    { key: 'width', label: '内容宽度', type: 'seg', opts: WIDTH_OPTS,
      note: '宽屏下「窄」更适合长文阅读。' },
    { key: 'motion', label: '界面动效', type: 'seg', opts: MOTION_OPTS,
      note: '「关闭」让所有过渡瞬时就位，适合低配设备。' },
    { key: 'rail', label: '导航展开时长', type: 'range', min: 0.15, max: 0.6, step: 0.05, fmt: fmtSec }
  ];
  const PREF_LABEL = Object.fromEntries(PREF_ROWS.map(r => [r.key, r.label]));

  /* ---------- 样式预设（来自简素·文档系统 / wwwroot/assets/styles/styles.json）
     极简优先：默认选 minimal，与 ArkDocs 既有极简风格最贴近；其余 11 种供个性化选择。
     通过 applyStylePreset 把 params 写入 --art-preset-* CSS 变量，css/style.css 文章正文里用 var() 引用。 */
  const STYLE_PRESETS = [
    { id: 'classic', name: '经典', desc: '沉稳对称，标题下划线', params: {
      color: '#1f2430', accent: '#4f6bff', headingWeight: 700, lineHeight: 1.8,
      headingSpacing: 0.5, decoration: 'rule', ruleColor: '#d7dce6', ruleWidth: 2,
      letterSpacing: 0, bg: 'transparent', radius: 0, padding: 0, border: 'none', shadow: 'none' }},
    { id: 'elegant', name: '雅宋', desc: '衬线气质，金线分隔', params: {
      color: '#2b2b2b', accent: '#9c6b3f', headingWeight: 700, lineHeight: 1.95,
      headingSpacing: 0.4, decoration: 'rule', ruleColor: '#c9a36a', ruleWidth: 1,
      letterSpacing: 0.01, bg: 'transparent', radius: 0, padding: 0, border: 'none', shadow: 'none' }},
    { id: 'modern', name: '现代', desc: '紧凑无装饰，强对比', params: {
      color: '#15181f', accent: '#3b5bff', headingWeight: 800, lineHeight: 1.6,
      headingSpacing: 0.3, decoration: 'none', ruleColor: '#e8ebf0', ruleWidth: 2,
      letterSpacing: -0.01, bg: 'transparent', radius: 0, padding: 0, border: 'none', shadow: 'none' }},
    { id: 'soft', name: '柔和', desc: '淡蓝底、圆角、轻投影', params: {
      color: '#3a4256', accent: '#6b8aff', headingWeight: 700, lineHeight: 1.8,
      headingSpacing: 0.4, decoration: 'none', ruleColor: '#e6ebf7', ruleWidth: 2,
      letterSpacing: 0, bg: '#f7f9ff', radius: 14, padding: 14, border: '1px solid #e6ebf7', shadow: '0 6px 20px rgba(80,110,255,.08)' }},
    { id: 'ink', name: '墨夜', desc: '深色块，适合代码块/引用', params: {
      color: '#e8ebf0', accent: '#8aa2ff', headingWeight: 700, lineHeight: 1.75,
      headingSpacing: 0.4, decoration: 'leftbar', ruleColor: '#333a4a', ruleWidth: 3,
      letterSpacing: 0, bg: '#1f2430', radius: 10, padding: 14, border: '1px solid #333a4a', shadow: 'none' }},
    { id: 'paper', name: '纸感', desc: '米色纸底，棕色描边', params: {
      color: '#4a4034', accent: '#b5651d', headingWeight: 700, lineHeight: 1.9,
      headingSpacing: 0.4, decoration: 'rule', ruleColor: '#d8c4a0', ruleWidth: 1,
      letterSpacing: 0.01, bg: '#fdfaf3', radius: 8, padding: 14, border: '1px solid #ece0c8', shadow: 'none' }},
    { id: 'tech', name: '科技', desc: '青绿强调，等宽感', params: {
      color: '#0f2540', accent: '#00b894', headingWeight: 700, lineHeight: 1.7,
      headingSpacing: 0.35, decoration: 'leftbar', ruleColor: '#00b894', ruleWidth: 3,
      letterSpacing: 0.02, bg: '#f3fbf9', radius: 8, padding: 14, border: '1px solid #d6f0ea', shadow: 'none' }},
    { id: 'minimal', name: '极简', desc: '只保留颜色与字重，大量留白（默认）', params: {
      color: '#1f2430', accent: '#4f6bff', headingWeight: 700, lineHeight: 1.85,
      headingSpacing: 0, decoration: 'none', ruleColor: '#d7dce6', ruleWidth: 2,
      letterSpacing: 0, bg: 'transparent', radius: 0, padding: 0, border: 'none', shadow: 'none' }},
    { id: 'card', name: '卡片', desc: '白底大圆角、柔和投影', params: {
      color: '#2b3240', accent: '#4f6bff', headingWeight: 700, lineHeight: 1.6,
      headingSpacing: 0.3, decoration: 'none', ruleColor: '#eef0f4', ruleWidth: 1,
      letterSpacing: 0, bg: '#ffffff', radius: 16, padding: 14, border: '1px solid #eef0f4', shadow: '0 8px 24px rgba(20,30,55,.08)' }},
    { id: 'hand', name: '手写感', desc: '暖色、手写气质', params: {
      color: '#4a4040', accent: '#e07a5f', headingWeight: 700, lineHeight: 1.9,
      headingSpacing: 0.4, decoration: 'none', ruleColor: '#f0d9d0', ruleWidth: 2,
      letterSpacing: 0.01, bg: '#fff8f5', radius: 10, padding: 12, border: '1px solid #f3ded6', shadow: 'none' }},
    { id: 'neon', name: '霓虹', desc: '深蓝底、青绿描边', params: {
      color: '#e8f0ff', accent: '#19e3c2', headingWeight: 700, lineHeight: 1.7,
      headingSpacing: 0.4, decoration: 'leftbar', ruleColor: '#1e3a5f', ruleWidth: 3,
      letterSpacing: 0.02, bg: '#0b1020', radius: 10, padding: 14, border: '1px solid #1e3a5f', shadow: '0 0 0 1px rgba(25,227,194,.15)' }},
    { id: 'rounded', name: '圆润', desc: '粉色胶囊、圆体感', params: {
      color: '#7a3a55', accent: '#ff7eb6', headingWeight: 700, lineHeight: 1.5,
      headingSpacing: 0.3, decoration: 'none', ruleColor: '#ffd6e7', ruleWidth: 1,
      letterSpacing: 0.01, bg: '#fff0f6', radius: 999, padding: 10, border: '1px solid #ffd6e7', shadow: 'none' }}
  ];
  const PRESET_VARS = [
    '--art-preset-color', '--art-preset-accent', '--art-preset-heading-weight',
    '--art-preset-line-height', '--art-preset-letter-spacing', '--art-preset-heading-spacing',
    '--art-preset-decoration', '--art-preset-rule-color', '--art-preset-rule-width',
    '--art-preset-bg', '--art-preset-radius', '--art-preset-padding',
    '--art-preset-border', '--art-preset-shadow'
  ];
  function applyStylePreset(st) {
    PRESET_VARS.forEach(v => st.removeProperty(v));
    const layout = ASET.find(c => c.id === 'layout');
    if (!layout) return;
    const presetItem = layout.items.find(i => i.id === 'preset');
    if (!presetItem) return;
    const preset = STYLE_PRESETS.find(p => p.id === presetItem.val);
    if (!preset) return;
    const p = preset.params;
    if (p.color)         st.setProperty('--art-preset-color',         p.color);
    if (p.accent)        st.setProperty('--art-preset-accent',        p.accent);
    if (p.headingWeight) st.setProperty('--art-preset-heading-weight', p.headingWeight);
    if (p.lineHeight)    st.setProperty('--art-preset-line-height',   p.lineHeight);
    if (p.letterSpacing !== undefined)   st.setProperty('--art-preset-letter-spacing',   p.letterSpacing + 'em');
    if (p.headingSpacing !== undefined)  st.setProperty('--art-preset-heading-spacing',  p.headingSpacing + 'em');
    if (p.decoration)    st.setProperty('--art-preset-decoration',    p.decoration);
    if (p.ruleColor)     st.setProperty('--art-preset-rule-color',    p.ruleColor);
    if (p.ruleWidth !== undefined)       st.setProperty('--art-preset-rule-width',       p.ruleWidth + 'px');
    if (p.bg)            st.setProperty('--art-preset-bg',            p.bg);
    if (p.radius !== undefined)          st.setProperty('--art-preset-radius',          p.radius + 'px');
    if (p.padding !== undefined)         st.setProperty('--art-preset-padding',         p.padding + 'px');
    if (p.border)        st.setProperty('--art-preset-border',        p.border);
    if (p.shadow)        st.setProperty('--art-preset-shadow',        p.shadow);
  }

  /* ---------- 内置文章设置项：带 css 字段的会映射到文章渲染的 CSS 变量 ---------- */
  const ASET_DEF = [
    { id: 'layout', name: '排版', items: [
      { id: 'preset',    name: '样式预设', type: 'select', def: 'minimal', val: 'minimal',
        options: STYLE_PRESETS.map(p => ({ v: p.id, label: p.name })) },
      { id: 'paraGap',   name: '段落间距', type: 'range', min: 0, max: 40, step: 2,   unit: 'px', def: 16, val: 16, css: '--art-para-gap' },
      { id: 'indent',    name: '首行缩进', type: 'range', min: 0, max: 4,  step: 0.5, unit: 'em', def: 0,  val: 0,  css: '--art-indent' },
      { id: 'imgRadius', name: '图片圆角', type: 'range', min: 0, max: 28, step: 2,   unit: 'px', def: 10, val: 10, css: '--art-img-radius' },
      { id: 'justify',   name: '两端对齐', type: 'toggle', def: false, val: false,
        css: '--art-align', cssOn: 'justify', cssOff: 'left' }
    ] },
    { id: 'display', name: '显示', items: [
      { id: 'showToc',  name: '显示右侧目录', type: 'toggle', def: true, val: true },
      { id: 'showTags', name: '显示标签行',   type: 'toggle', def: true, val: true }
    ] },
    { id: 'meta', name: '元信息', items: [
      { id: 'showAuthor', name: '显示作者',     type: 'toggle', def: true, val: true },
      { id: 'showDate',   name: '显示发布时间', type: 'toggle', def: true, val: true }
    ] }
  ];

  /* ---------- 通用小图标 ---------- */
  const SVG_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="21 4 21 10 15 10"/><path d="M20.6 14a8.6 8.6 0 1 1-2.1-9l2.5 3"/></svg>';
  const SVG_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>';
  // 外观设置专用图标：滑杆（与「管理」的齿轮区分开，折叠成图标栏时也不会混淆）
  const SVG_TUNE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';
  // 「详细设置」入口图标：扳手（进阶 / 深度配置的通用隐喻）。
  // 用内联 SVG 取代原先的 emoji「⬛」——emoji 是彩色位图，既不吃 currentColor 也不吃主题色，
  // 换主题时不跟随变色，视觉上也会比同排的按钮文字重。
  const SVG_TOOLS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
  // 卡片标题图标（详细设置页分区）：组件字体 / 文章设置项 / 分区锚点
  const SVG_FONT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';
  const SVG_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
  const SVG_CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

  const PREFS_DEF = {
    font: 'system', size: 15.5, leading: 1.85, width: 'normal', motion: 'full', rail: 0.3,
    comps: COMP_DEF
  };

  let PREFS = readPrefs();

  function readPrefs() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(KEY_PREFS) || '{}') || {}; } catch (e) { raw = {}; }
    const p = Object.assign({}, PREFS_DEF, raw);
    if (!FONT_STACKS[p.font]) p.font = PREFS_DEF.font;
    if (!(p.width in WIDTH_PX)) p.width = PREFS_DEF.width;
    if (!MOTION_OPTS.some(o => o[0] === p.motion)) p.motion = PREFS_DEF.motion;
    const clamp = (v, lo, hi, dft) => { const n = Number(v); return isNaN(n) ? dft : Math.min(hi, Math.max(lo, n)); };
    p.size = clamp(p.size, 13, 20, PREFS_DEF.size);
    p.leading = clamp(p.leading, 1.5, 2.2, PREFS_DEF.leading);
    p.rail = clamp(p.rail, 0.15, 0.6, PREFS_DEF.rail);
    // 组件字体：逐项校验，缺字段或非法字体一律回落该组件默认
    const comps = {};
    COMPONENTS.forEach(c => {
      const src = (raw.comps && raw.comps[c.key]) || {};
      comps[c.key] = { on: !!src.on, font: FONT_STACKS[src.font] ? src.font : c.def };
    });
    p.comps = comps;
    return p;
  }
  function savePrefs() { try { localStorage.setItem(KEY_PREFS, JSON.stringify(PREFS)); } catch (e) {} }

  // 全部落到 CSS 变量：--font-sans / --reading-* / --rail-dur / --content-max / --font-<组件>
  function applyPrefs() {
    const st = document.documentElement.style;
    st.setProperty('--font-sans', FONT_STACKS[PREFS.font]);
    st.setProperty('--reading-size', PREFS.size + 'px');
    st.setProperty('--reading-leading', String(PREFS.leading));
    st.setProperty('--rail-dur', PREFS.rail + 's');
    st.setProperty('--content-max', PREFS.width === 'full' ? '100%' : WIDTH_PX[PREFS.width] + 'px');
    // 动效档位走属性选择器（css 里 [data-motion="reduced"|"off"]）
    document.documentElement.setAttribute('data-motion', PREFS.motion);
    // 组件字体：启用才写变量；未启用直接移除 → CSS 里的 var(--font-x, 继承值) 自动回落
    COMPONENTS.forEach(c => {
      const v = '--font-' + c.key;
      const cfg = (PREFS.comps || {})[c.key];
      if (cfg && cfg.on && FONT_STACKS[cfg.font]) st.setProperty(v, FONT_STACKS[cfg.font]);
      else st.removeProperty(v);
    });
  }
  // 动效「减弱 / 关闭」时，锚点跳转不再用平滑滚动
  function scrollBehavior() { return PREFS.motion === 'full' ? 'smooth' : 'auto'; }

  /* ----------------------------- 文章设置项（按类别管理） ----------------------------- */
  function loadASet() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY_ASET) || 'null'); } catch (e) { raw = null; }
    if (!Array.isArray(raw)) return JSON.parse(JSON.stringify(ASET_DEF));
    // 内置项的 css 映射以代码为准（代码升级后仍能生效），值以用户保存为准
    const builtin = {};
    ASET_DEF.forEach(c => c.items.forEach(i => { builtin[i.id] = i; }));
    return raw.map(cat => ({
      id: cat.id || uid(),
      name: cat.name || '未命名类别',
      items: (cat.items || []).map(it => {
        const b = builtin[it.id];
        const base = b ? Object.assign({}, b) : {
          id: it.id || uid(), name: it.name || '未命名', type: it.type || 'text',
          def: it.def, min: it.min, max: it.max, step: it.step,
          unit: it.unit, options: it.options, custom: true
        };
        const out = Object.assign({}, base);
        if (!b && it.name) out.name = it.name;
        out.val = it.val !== undefined ? it.val : base.def;
        return out;
      })
    }));
  }
  let ASET = loadASet();
  function saveASet() { try { localStorage.setItem(KEY_ASET, JSON.stringify(ASET)); } catch (e) {} }

  function findASetItem(cid, iid) {
    const cat = ASET.find(c => c.id === cid);
    return cat ? (cat.items.find(i => i.id === iid) || null) : null;
  }
  // 读取某个内置开关型设置项；不存在时返回兜底值
  function asetFlag(id, dft) {
    for (const cat of ASET) {
      const it = cat.items.find(i => i.id === id);
      if (it) return it.type === 'toggle' ? !!it.val : it.val;
    }
    return dft;
  }
  function isSameVal(a, b) {
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b;
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    return String(a) === String(b);
  }

  // 文章设置项 → CSS 变量（仅内置项带 css 映射；自定义项只持久化值）
  function applyArticleSet() {
    const st = document.documentElement.style;
    ASET.forEach(cat => cat.items.forEach(it => {
      if (!it.css) return;
      const v = it.type === 'toggle' ? (it.val ? (it.cssOn || '') : (it.cssOff || '')) : it.val + (it.unit || '');
      if (v === '') st.removeProperty(it.css); else st.setProperty(it.css, String(v));
    }));
    // 样式预设（layout.preset）一个值写多个 CSS 变量，独立处理
    applyStylePreset(st);
  }

  /* ----------------------------- 视图：外观设置（独立页面 #/settings） ----------------------------- */
  // 带转圈样式的「恢复默认」按钮：项目右侧统一使用
  function rstBtn(attr) { return `<button type="button" class="rst-btn" ${attr} title="恢复该项默认值" aria-label="恢复该项默认值">${SVG_REFRESH}</button>`; }

  function rowControlHtml(row) {
    if (row.type === 'seg') {
      const isFont = row.key === 'font';
      return `<div class="seg" data-seg="${row.key}">${row.opts.map(([v, label]) =>
        `<button type="button" data-key="${row.key}" data-val="${v}" class="${String(PREFS[row.key]) === v ? 'on' : ''}"${isFont ? ` style='font-family:${FONT_STACKS[v]}'` : ''}>${label}</button>`).join('')}</div>`;
    }
    return `<div class="rangewrap">
        <input class="set-range" type="range" data-range="${row.key}" min="${row.min}" max="${row.max}" step="${row.step}" value="${PREFS[row.key]}" aria-label="${row.label}" />
        <span class="set-val" data-val-out="${row.key}">${row.fmt(PREFS[row.key])}</span>
      </div>`;
  }

  function viewSettings(param) {
    if (param === 'detail') return viewSettingsDetail();

    const rows = PREF_ROWS.map(row => `
      <div class="set-row" data-pref-row="${row.key}">
        <div class="sr-head">
          <div class="set-label">${row.label}</div>
          ${rstBtn(`data-reset-pref="${row.key}"`)}
        </div>
        ${rowControlHtml(row)}
        ${row.note ? `<div class="set-note">${row.note}</div>` : ''}
      </div>`).join('');

    return `
      <div class="set-page" id="setPage">
        <div class="set-page-head">
          <div>
            <h1 class="set-page-title">外观设置</h1>
            <div class="set-page-sub">字体、字号、行高、内容宽度与界面动效。设置保存在本机浏览器。</div>
          </div>
        </div>
        <div class="set-card">
          <div class="set-card-head">
            <div class="set-title">基础外观</div>
            <!-- 「详细设置」入口位于外观设置选项右侧，点击跳转到独立的详细设置页面 -->
            <a class="btn btn-sm detail-entry" id="detailEntry" href="#/settings/detail" title="打开详细设置页面">${SVG_TOOLS}<span>详细设置</span></a>
          </div>
          <div class="set-card-body">${rows}</div>
          <div class="set-foot">
            <button type="button" class="btn btn-ghost btn-sm" data-reset-pref="__all__">全部恢复默认</button>
            <div class="set-note">每一项右侧的 ⟳ 可单独把该项恢复为默认值</div>
          </div>
        </div>
      </div>`;
  }

  /* ----------------------------- 视图：详细设置（独立页面 #/settings/detail） ----------------------------- */
  // 类别折叠态只存内存（不落盘）：这是纯浏览偏好，刷新后默认全展开更符合直觉
  const catCollapsed = new Set();

  function viewSettingsDetail() {
    return `
      <div class="set-page" id="setDetail">
        <div class="set-page-head">
          <div>
            <h1 class="set-page-title">详细设置</h1>
            <div class="set-page-sub">按组件分别自定义字体，管理文章设置项；每一项右侧的 ⟳ 只恢复该项。</div>
          </div>
          <a class="btn btn-sm" href="#/settings">← 返回外观设置</a>
        </div>

        <!-- 分区锚点：这里必须用 <button> + JS 滚动，不能写 href="#compCard" ——
             本项目是 hash 路由，改 hash 会被解析成未知路由而跳走 -->
        <nav class="set-anchors" aria-label="详细设置分区">
          <button type="button" class="set-anchor" data-anchor="compCard">
            <span class="sa-ic">${SVG_FONT}</span>
            <span class="sa-text"><span class="sa-name">组件字体</span><span class="sa-note">为界面各部位单独指定字体</span></span>
            <span class="sa-count" id="anchorCompN">${compOnCount()}/${COMPONENTS.length}</span>
          </button>
          <button type="button" class="set-anchor" data-anchor="asetCard">
            <span class="sa-ic">${SVG_LIST}</span>
            <span class="sa-text"><span class="sa-name">文章设置项</span><span class="sa-note">排版 / 显示 / 元信息等渲染细节</span></span>
            <span class="sa-count" id="anchorAsetN">${asetCountText()}</span>
          </button>
        </nav>

        <div class="set-card" id="compCard">
          <div class="set-card-head">
            <div class="set-card-title">
              <span class="card-ic">${SVG_FONT}</span>
              <div>
                <div class="set-title">组件字体</div>
                <div class="set-note">勾选左侧开关即启用自定义；未启用的组件继承「基础外观 → 字体」。</div>
              </div>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" data-reset-comp="__all__">全部恢复默认</button>
          </div>
          <div class="set-card-body" id="compBody">${compRowsHtml()}</div>
        </div>

        <div class="set-card" id="asetCard">
          <div class="set-card-head">
            <div class="set-card-title">
              <span class="card-ic">${SVG_LIST}</span>
              <div>
                <div class="set-title">文章设置项</div>
                <div class="set-note">按类别管理文章渲染相关的设置项，可新增类别与设置项。</div>
              </div>
            </div>
            <button type="button" class="btn btn-sm" data-aset-addcat="1">＋ 新增类别</button>
          </div>
          <div class="set-card-body" id="asetBody">${asetBodyHtml()}</div>
        </div>
      </div>`;
  }

  // 锚点条右侧的计数（会随勾选 / 增删实时刷新）
  function compOnCount() {
    return COMPONENTS.filter(c => PREFS.comps && PREFS.comps[c.key] && PREFS.comps[c.key].on).length;
  }
  function asetCountText() {
    return ASET.length + ' 类 · ' + ASET.reduce((n, c) => n + c.items.length, 0) + ' 项';
  }
  function syncAnchorCounts() {
    const cn = document.getElementById('anchorCompN');
    if (cn) cn.textContent = compOnCount() + '/' + COMPONENTS.length;
    const an = document.getElementById('anchorAsetN');
    if (an) an.textContent = asetCountText();
  }

  // 折叠 / 展开某个类别；只切 class 不重建 DOM，避免打断内部控件的状态
  function toggleCat(id) {
    const el = document.querySelector(`.aset-cat[data-cat="${id}"]`);
    if (!el) return;
    const next = !catCollapsed.has(id);
    if (next) catCollapsed.add(id); else catCollapsed.delete(id);
    el.classList.toggle('collapsed', next);
    el.querySelectorAll('[data-aset-collapse]').forEach(b => b.setAttribute('aria-expanded', next ? 'false' : 'true'));
  }

  // 滚动到指定卡片：顶栏是 sticky 的，必须扣掉它的高度，否则卡片头会被压在顶栏下面
  function scrollToCard(id, smooth) {
    const el = document.getElementById(id);
    if (!el) return;
    const bar = document.querySelector('.topbar');
    const off = (bar ? bar.getBoundingClientRect().height : 0) + 18;
    const y = el.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0) - off;
    window.scrollTo({ top: Math.max(0, y), behavior: smooth === false ? 'auto' : scrollBehavior() });
  }

  // 列头：让「开关 / 名称 / 字体 / 操作」四列一眼可读（纯装饰，读屏软件跳过）
  const COMP_HEAD = `<div class="tbl-head comp-head" aria-hidden="true">
      <span>启用</span><span>组件</span><span>字体</span><span class="th-r">操作</span>
    </div>`;

  function compRowsHtml() {
    return COMP_HEAD + COMPONENTS.map(c => {
      const cfg = (PREFS.comps && PREFS.comps[c.key]) || { on: false, font: c.def };
      return `<div class="comp-row" data-comp="${c.key}">
        <label class="ck" title="启用自定义">
          <input type="checkbox" data-comp-on="${c.key}" ${cfg.on ? 'checked' : ''} />
          <span class="ck-track"><span class="ck-dot"></span></span>
        </label>
        <div class="comp-info">
          <div class="comp-name">${c.name}<span class="st-badge${cfg.on ? ' on' : ''}" data-comp-badge="${c.key}">${cfg.on ? '自定义' : '继承全局'}</span></div>
          <div class="set-note">${c.note}</div>
        </div>
        <select class="sel" data-comp-font="${c.key}" ${cfg.on ? '' : 'disabled'} aria-label="${c.name}字体">
          ${FONT_CHOICES.map(g => `<optgroup label="${g.label}">${g.options.map(([v, l]) => `<option value="${v}" ${v === cfg.font ? 'selected' : ''} style='font-family:${FONT_STACKS[v]}'>${l}</option>`).join('')}</optgroup>`).join('')}
        </select>
        ${rstBtn(`data-reset-comp="${c.key}"`)}
      </div>`;
    }).join('');
  }

  function asetItemHtml(cat, it) {
    const id = cat.id + '|' + it.id;
    let ctrl;
    if (it.type === 'toggle') {
      ctrl = `<label class="ck small"><input type="checkbox" data-aset-val="${id}" ${it.val ? 'checked' : ''}><span class="ck-track"><span class="ck-dot"></span></span></label>`;
    } else if (it.type === 'range') {
      ctrl = `<span class="aset-range"><input class="set-range" type="range" data-aset-range="${id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${it.val}" aria-label="${esc(it.name)}"><span class="set-val" data-aset-out="${id}">${it.val}${it.unit || ''}</span></span>`;
    } else if (it.type === 'select') {
      ctrl = `<select class="sel" data-aset-val="${id}" aria-label="${esc(it.name)}">${(it.options || []).map(o =>
        `<option value="${esc(o.v)}" ${o.v === it.val ? 'selected' : ''}>${esc(o.label || o.v)}</option>`).join('')}</select>`;
    } else {
      ctrl = `<input class="txt" type="text" data-aset-val="${id}" value="${esc(it.val)}" aria-label="${esc(it.name)}">`;
    }
    return `<div class="aset-item" data-item="${it.id}">
      <div class="aset-item-name">${esc(it.name)}${it.custom ? '<span class="aset-tag">自定义</span>' : ''}</div>
      <div class="aset-item-ctrl">${ctrl}</div>
      ${rstBtn(`data-reset-aset="${id}"`)}
      <button type="button" class="rst-btn danger" data-del-aset="${id}" title="删除该项" aria-label="删除该项">${SVG_TRASH}</button>
    </div>`;
  }

  // 列头：让「设置项 / 取值 / 操作」三列一眼可读（后两列合并成「操作」）
  const ASET_HEAD = `<div class="tbl-head aset-head" aria-hidden="true">
      <span>设置项</span><span>取值</span><span class="th-r">操作</span>
    </div>`;

  function asetBodyHtml() {
    if (!ASET.length) return '<div class="aset-empty">还没有任何类别，点击右上角「＋ 新增类别」开始。</div>';
    return ASET.map(cat => {
      const collapsed = catCollapsed.has(cat.id);
      return `
      <div class="aset-cat${collapsed ? ' collapsed' : ''}" data-cat="${cat.id}">
        <div class="aset-cat-head">
          <button type="button" class="cat-toggle" data-aset-collapse="${cat.id}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="折叠或展开该类别">${SVG_CHEV}</button>
          <span class="aset-cat-name">${esc(cat.name)}</span>
          <span class="aset-cat-count">${cat.items.length} 项</span>
          <div class="aset-cat-ops">
            <button type="button" class="btn btn-ghost btn-sm" data-aset-additem="${cat.id}">新增设置项</button>
            <button type="button" class="btn btn-ghost btn-sm" data-aset-rename="${cat.id}">重命名</button>
            <button type="button" class="btn btn-ghost btn-sm btn-del" data-aset-delcat="${cat.id}">删除</button>
          </div>
        </div>
        <div class="aset-items">
          ${cat.items.length ? ASET_HEAD + cat.items.map(it => asetItemHtml(cat, it)).join('') : '<div class="aset-empty">该类别暂无设置项</div>'}
        </div>
      </div>`;
    }).join('');
  }
  function renderASetCard() {
    const body = document.getElementById('asetBody');
    if (body) body.innerHTML = asetBodyHtml();
    syncAnchorCounts();
  }

  /* ----------------------------- 设置页交互 ----------------------------- */
  // 转圈动效：先移除再强制重排，保证连点也能重新播放
  function spin(el) {
    if (!el) return;
    el.classList.remove('spin');
    void el.offsetWidth;
    el.classList.add('spin');
    setTimeout(() => el.classList.remove('spin'), 700);
  }

  // 把 PREFS 回写到页面控件：分段选中态 / 滑块值 / 数值标签 / 恢复按钮可用态
  function syncPrefsUI() {
    PREF_ROWS.forEach(row => {
      document.querySelectorAll(`.seg[data-seg="${row.key}"] button`).forEach(b =>
        b.classList.toggle('on', b.getAttribute('data-val') === String(PREFS[row.key])));
      const r = document.querySelector(`input[data-range="${row.key}"]`);
      if (r && String(r.value) !== String(PREFS[row.key])) r.value = PREFS[row.key];
      const out = document.querySelector(`[data-val-out="${row.key}"]`);
      if (out && row.fmt) out.textContent = row.fmt(PREFS[row.key]);
      const btn = document.querySelector(`[data-reset-pref="${row.key}"]`);
      if (btn) btn.classList.toggle('is-default', isSameVal(PREFS[row.key], PREFS_DEF[row.key]));
    });
  }

  // 详细设置页各「恢复默认」按钮的可用态（已是默认值时淡显）
  function syncDetailResetBtns() {
    document.querySelectorAll('[data-reset-comp]').forEach(b => {
      const k = b.getAttribute('data-reset-comp');
      if (k === '__all__') return;
      const c = COMP_MAP[k]; const cfg = PREFS.comps && PREFS.comps[k];
      b.classList.toggle('is-default', !!cfg && !cfg.on && cfg.font === (c ? c.def : 'system'));
    });
    document.querySelectorAll('[data-reset-aset]').forEach(b => {
      const p = b.getAttribute('data-reset-aset').split('|');
      const it = findASetItem(p[0], p[1]);
      b.classList.toggle('is-default', !!it && isSameVal(it.val, it.def));
    });
  }

  function setPrefValue(key, val, live) {
    if (!(key in PREFS_DEF) || key === 'comps') return;
    if (typeof PREFS_DEF[key] === 'number') val = Number(val);
    PREFS[key] = val;
    applyPrefs();
    if (!live) savePrefs();
    syncPrefsUI();
  }

  // 局部恢复默认：只把点击的那一项写回默认值
  function resetPref(key, btn) {
    spin(btn);
    if (key === '__all__') {
      PREF_ROWS.forEach(r => { PREFS[r.key] = PREFS_DEF[r.key]; });
      applyPrefs(); savePrefs(); syncPrefsUI();
      return toast('已恢复全部外观默认值');
    }
    PREFS[key] = PREFS_DEF[key];
    applyPrefs(); savePrefs(); syncPrefsUI();
    toast('已恢复默认：' + (PREF_LABEL[key] || key));
  }

  function resetComp(k, btn) {
    if (k !== '__all__') {
      const c = COMP_MAP[k];
      PREFS.comps[k] = { on: false, font: c ? c.def : 'system' };
      applyPrefs(); savePrefs();
      // 就地回写控件：重建 DOM 会打断按钮的转圈动画
      const row = document.querySelector(`.comp-row[data-comp="${k}"]`);
      if (row) {
        const cb = row.querySelector('[data-comp-on]'); if (cb) cb.checked = false;
        const sel = row.querySelector('[data-comp-font]');
        if (sel) { sel.value = PREFS.comps[k].font; sel.disabled = true; }
        const badge = row.querySelector(`[data-comp-badge="${k}"]`);
        if (badge) { badge.textContent = '继承全局'; badge.classList.remove('on'); }
      }
      spin(btn);
      syncDetailResetBtns(); syncAnchorCounts();
      return toast('已恢复默认：' + (c ? c.name : k));
    }
    spin(btn);
    COMPONENTS.forEach(c => { PREFS.comps[c.key] = { on: false, font: c.def }; });
    applyPrefs(); savePrefs();
    const body = document.getElementById('compBody');
    if (body) body.innerHTML = compRowsHtml();   // 按钮在卡片头，重建列表不影响动画
    syncDetailResetBtns(); syncAnchorCounts();
    toast('已恢复全部组件字体默认值');
  }

  function resetASetItem(cid, iid, btn) {
    const it = findASetItem(cid, iid);
    if (!it) return;
    it.val = it.def;
    saveASet(); applyArticleSet();
    const row = btn ? btn.closest('.aset-item') : null;
    if (row) {
      const ctrl = row.querySelector('[data-aset-val]');
      const rg = row.querySelector('[data-aset-range]');
      const out = row.querySelector('[data-aset-out]');
      if (it.type === 'toggle' && ctrl) ctrl.checked = !!it.def;
      if (it.type === 'range' && rg) { rg.value = it.def; if (out) out.textContent = it.def + (it.unit || ''); }
      if ((it.type === 'select' || it.type === 'text') && ctrl) ctrl.value = it.def;
    }
    spin(btn);
    syncDetailResetBtns();
    toast('已恢复默认：' + it.name);
  }

  /* ---------- 新增 / 管理文章设置项 ---------- */
  function formModal(title, fields, onSubmit) {
    let mask = document.querySelector('.modal-mask');
    if (!mask) { mask = document.createElement('div'); mask.className = 'modal-mask hidden'; document.body.appendChild(mask); }
    mask.innerHTML = `<div class="modal modal-form"><h3>${esc(title)}</h3>
      <div class="mf-fields">${fields.map(f => f.type === 'select'
        ? `<label class="mf"><span>${esc(f.label)}</span><select data-f="${f.name}">${f.options.map(o =>
            `<option value="${esc(o.v)}" ${o.v === f.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`
        : `<label class="mf"><span>${esc(f.label)}</span><input data-f="${f.name}" type="text" value="${esc(f.value == null ? '' : f.value)}" placeholder="${esc(f.ph || '')}"></label>`
      ).join('')}</div>
      <div class="modal-actions"><button type="button" class="btn" id="mfCancel">取消</button><button type="button" class="btn btn-primary" id="mfOk">确定</button></div></div>`;
    mask.classList.remove('hidden');
    const close = () => mask.classList.add('hidden');
    document.getElementById('mfCancel').onclick = close;
    document.getElementById('mfOk').onclick = () => {
      const d = {};
      mask.querySelectorAll('[data-f]').forEach(el => { d[el.getAttribute('data-f')] = el.value; });
      close();
      onSubmit(d);
    };
    const first = mask.querySelector('input[data-f]');
    if (first) { first.focus(); first.select(); }
  }

  function askAddCategory() {
    formModal('新增文章设置类别', [{ name: 'name', label: '类别名称', value: '自定义类别' }], d => {
      const name = String(d.name || '').trim();
      if (!name) return toast('类别名称不能为空');
      ASET.push({ id: uid(), name, items: [] });
      saveASet(); renderASetCard();
      toast('已新增类别：' + name);
    });
  }

  function askRenameCategory(cid) {
    const cat = ASET.find(c => c.id === cid); if (!cat) return;
    formModal('重命名类别', [{ name: 'name', label: '类别名称', value: cat.name }], d => {
      const name = String(d.name || '').trim();
      if (!name) return toast('类别名称不能为空');
      cat.name = name; saveASet(); renderASetCard();
      toast('已重命名');
    });
  }

  function askAddItem(cid) {
    const cat = ASET.find(c => c.id === cid); if (!cat) return;
    formModal('新增设置项 · ' + cat.name, [
      { name: 'name', label: '设置项名称', value: '新设置项' },
      { name: 'type', label: '控件类型', type: 'select', value: 'toggle', options: [
        { v: 'toggle', label: '开关（开 / 关）' },
        { v: 'range', label: '滑块（数值）' },
        { v: 'select', label: '下拉选择' },
        { v: 'text', label: '文本输入' }
      ] },
      { name: 'def', label: '默认值', value: '' },
      { name: 'min', label: '最小值（滑块）', value: '0' },
      { name: 'max', label: '最大值（滑块）', value: '100' },
      { name: 'step', label: '步长（滑块）', value: '1' },
      { name: 'unit', label: '单位（滑块，可留空）', value: '' },
      { name: 'options', label: '下拉选项（逗号分隔，可用 值:显示名）', value: '' }
    ], d => addASetItem(cid, d));
  }

  function addASetItem(cid, d) {
    const cat = ASET.find(c => c.id === cid); if (!cat) return;
    const name = String(d.name || '').trim() || '未命名';
    const type = ['toggle', 'range', 'select', 'text'].indexOf(d.type) >= 0 ? d.type : 'text';
    const item = { id: uid(), name, type, custom: true };
    if (type === 'toggle') {
      item.def = /^(true|1|on|是|开)$/i.test(String(d.def || '').trim());
      item.val = item.def;
    } else if (type === 'range') {
      item.min = Number(d.min) || 0;
      item.max = Number(d.max) || 100;
      item.step = Number(d.step) || 1;
      item.unit = String(d.unit || '').trim();
      item.def = Number(d.def) || 0;
      item.val = item.def;
    } else if (type === 'select') {
      const opts = String(d.options || '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const i = s.indexOf(':');
        return i > 0 ? { v: s.slice(0, i).trim(), label: s.slice(i + 1).trim() } : { v: s, label: s };
      });
      item.options = opts.length ? opts : [{ v: 'a', label: '选项 A' }, { v: 'b', label: '选项 B' }];
      item.def = String(d.def || '').trim() || item.options[0].v;
      item.val = item.def;
    } else {
      item.def = String(d.def || '');
      item.val = item.def;
    }
    cat.items.push(item);
    saveASet(); renderASetCard();
    toast('已新增设置项：' + name);
  }

  function removeASetItem(cid, iid) {
    const cat = ASET.find(c => c.id === cid); if (!cat) return;
    const it = cat.items.find(i => i.id === iid); if (!it) return;
    confirmModal('删除设置项', '确定删除「' + it.name + '」吗？', () => {
      cat.items = cat.items.filter(i => i.id !== iid);
      saveASet(); applyArticleSet(); renderASetCard();
      toast('已删除设置项');
    });
  }

  /* ---------- 绑定：外观设置页 ---------- */
  function bindSettingsPage() {
    const host = document.getElementById('setPage');
    if (!host) return;
    host.addEventListener('click', e => {
      const seg = e.target.closest('button[data-key]');
      if (seg) return setPrefValue(seg.getAttribute('data-key'), seg.getAttribute('data-val'));
      const rst = e.target.closest('[data-reset-pref]');
      if (rst) resetPref(rst.getAttribute('data-reset-pref'), rst);
    });
    host.addEventListener('input', e => {
      const r = e.target.closest('input[data-range]');
      if (r) setPrefValue(r.getAttribute('data-range'), Number(r.value), true);   // 拖动即时预览
    });
    host.addEventListener('change', e => { if (e.target.matches('input[data-range]')) savePrefs(); });
    syncPrefsUI();
  }

  /* ---------- 绑定：详细设置页 ---------- */
  function bindSettingsDetail() {
    const host = document.getElementById('setDetail');
    if (!host) return;

    host.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('[data-aset-addcat]')) return askAddCategory();
      const addItem = t.closest('[data-aset-additem]');
      if (addItem) return askAddItem(addItem.getAttribute('data-aset-additem'));
      const rename = t.closest('[data-aset-rename]');
      if (rename) return askRenameCategory(rename.getAttribute('data-aset-rename'));
      const delCat = t.closest('[data-aset-delcat]');
      if (delCat) {
        const id = delCat.getAttribute('data-aset-delcat');
        const cat = ASET.find(c => c.id === id);
        return confirmModal('删除类别', '确定删除类别「' + (cat ? cat.name : '') + '」及其下全部设置项吗？', () => {
          ASET = ASET.filter(c => c.id !== id);
          saveASet(); applyArticleSet(); renderASetCard();
          toast('已删除类别');
        });
      }
      const delItem = t.closest('[data-del-aset]');
      if (delItem) { const p = delItem.getAttribute('data-del-aset').split('|'); return removeASetItem(p[0], p[1]); }
      const rc = t.closest('[data-reset-comp]');
      if (rc) return resetComp(rc.getAttribute('data-reset-comp'), rc);
      const ra = t.closest('[data-reset-aset]');
      if (ra) { const p = ra.getAttribute('data-reset-aset').split('|'); return resetASetItem(p[0], p[1], ra); }

      // 分区锚点：平滑滚动到对应卡片（走 JS，不用 href="#id"，见 viewSettingsDetail 注释）
      const anc = t.closest('[data-anchor]');
      if (anc) return scrollToCard(anc.getAttribute('data-anchor'));

      // 类别折叠 / 展开：点左侧箭头，或点类别头的空白处（但不要抢走右侧操作按钮的点击）
      const col = t.closest('[data-aset-collapse]');
      if (col) return toggleCat(col.getAttribute('data-aset-collapse'));
      const chead = t.closest('.aset-cat-head');
      if (chead && !t.closest('button')) return toggleCat(chead.closest('.aset-cat').getAttribute('data-cat'));
    });

    host.addEventListener('input', e => {
      const t = e.target;
      if (t.matches('[data-aset-range]')) {
        const p = t.getAttribute('data-aset-range').split('|');
        const it = findASetItem(p[0], p[1]); if (!it) return;
        it.val = Number(t.value);
        applyArticleSet();
        const out = host.querySelector(`[data-aset-out="${p[0]}|${p[1]}"]`);
        if (out) out.textContent = it.val + (it.unit || '');
      }
    });

    host.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('[data-comp-on]')) {
        const k = t.getAttribute('data-comp-on');
        PREFS.comps[k].on = t.checked;
        const sel = host.querySelector(`[data-comp-font="${k}"]`);
        if (sel) sel.disabled = !t.checked;
        // 状态徽标即时翻转：让「自定义 / 继承全局」无需刷新即可见
        const badge = host.querySelector(`[data-comp-badge="${k}"]`);
        if (badge) { badge.textContent = t.checked ? '自定义' : '继承全局'; badge.classList.toggle('on', t.checked); }
        applyPrefs(); savePrefs(); syncDetailResetBtns(); syncAnchorCounts();
        const c = COMP_MAP[k];
        return toast((c ? c.name : k) + (t.checked ? '：已启用自定义字体' : '：已改为继承基础字体'));
      }
      if (t.matches('[data-comp-font]')) {
        const k = t.getAttribute('data-comp-font');
        PREFS.comps[k].font = t.value;
        applyPrefs(); savePrefs(); syncDetailResetBtns();
        return;
      }
      if (t.matches('[data-aset-range]')) {
        const p = t.getAttribute('data-aset-range').split('|');
        const it = findASetItem(p[0], p[1]); if (!it) return;
        it.val = Number(t.value);
        saveASet(); applyArticleSet(); syncDetailResetBtns();
        return;
      }
      if (t.matches('[data-aset-val]')) {
        const p = t.getAttribute('data-aset-val').split('|');
        const it = findASetItem(p[0], p[1]); if (!it) return;
        it.val = it.type === 'toggle' ? t.checked : t.value;
        saveASet(); applyArticleSet(); syncDetailResetBtns();
      }
    });

    syncDetailResetBtns();
    syncAnchorCounts();
  }

  /* ----------------------------- 启动 ----------------------------- */
  function init() {
    applyPrefs();                                             // 先落外观偏好，避免字体/字号闪一下
    applyArticleSet();                                        // 文章设置项 → CSS 变量
    applyTheme(localStorage.getItem(KEY_THEME) || 'light');
    renderSidebar();

    // 顶栏吸附阴影：滚动后加 .scrolled（只在状态翻转时改 DOM，比每帧跑 rAF 更省）
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const onScroll = () => {
        const down = (window.scrollY || document.documentElement.scrollTop || 0) > 4;
        if (topbar.classList.contains('scrolled') !== down) topbar.classList.toggle('scrolled', down);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }

    document.getElementById('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });

    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (q) location.hash = '#/search/' + encodeURIComponent(q);
      }
    });

    // 左侧抽屉导航：默认收起，点击汉堡按钮开合，点击遮罩 / ESC 关闭
    const drawer = document.getElementById('drawer');
    const backdrop = document.getElementById('drawerBackdrop');
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle && drawer) {
      menuToggle.addEventListener('click', () => {
        const open = drawer.classList.toggle('open');
        if (backdrop) backdrop.classList.toggle('show', open);
        menuToggle.setAttribute('aria-expanded', String(open));
      });
    }
    if (backdrop) backdrop.addEventListener('click', closeMobileSidebar);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      closeMobileSidebar();
    });

    window.addEventListener('hashchange', navigate);
    navigate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
