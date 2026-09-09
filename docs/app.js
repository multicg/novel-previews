(function () {
  "use strict";

  var OWNER = "multicg";
  var REPO = "novel-previews";
  var BRANCH = "main";
  var MAX_QUOTE_COMMENT_LEN = 1500;
  var NAME_STORAGE_KEY = "novel-previews:commenter-name";
  var THEME_STORAGE_KEY = "novel-previews:theme";
  var THEME_CYCLE = [null, "dark", "light"]; // null = 시스템 설정 따라감
  var THEME_LABEL = { "null": "🌓 자동", "dark": "🌙 다크", "light": "☀️ 라이트" };

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 원문은 화면폭 기준 줄바꿈(soft-wrap)이라, 빈 줄로만 문단을 나누고
  // 문단 내부 줄바꿈은 공백으로 합친다. *강조*만 <em>으로 치환.
  function parseMarkdown(text) {
    var lines = text.replace(/\r\n/g, "\n").split("\n");
    var title = (lines.shift() || "").trim();
    var raw = lines.join("\n").trim();
    var paragraphs = raw.split(/\n\s*\n/).map(function (block) {
      return block.split("\n").map(function (l) { return l.trim(); }).filter(Boolean).join(" ");
    }).filter(Boolean);

    var bodyHtml = paragraphs.map(function (p) {
      if (p === "/") return '<p class="scene-break" aria-hidden="true">•  •  •</p>';
      var escaped = escapeHtml(p);
      var withEm = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return "<p>" + withEm + "</p>";
    }).join("\n");

    return { title: title, bodyHtml: bodyHtml };
  }

  function rawUrl(work, episode, file) {
    return "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH +
      "/" + work + "/" + episode + "/" + file;
  }

  function blobUrl(work, episode, file) {
    return "https://github.com/" + OWNER + "/" + REPO + "/blob/" + BRANCH +
      "/" + work + "/" + episode + "/" + file;
  }

  function episodeViewerUrl(work, episodeId, versionId) {
    var p = new URLSearchParams();
    p.set("work", work);
    p.set("episode", episodeId);
    p.set("version", versionId);
    return "?" + p.toString();
  }

  async function fetchManifest() {
    var res = await fetch("manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("manifest.json 로드 실패: " + res.status);
    return res.json();
  }

  function renderPicker(root, manifest) {
    var html = ["<h1>novel-previews</h1>",
      '<p class="meta">작품을 골라 화·버전을 선택하세요. 문장을 드래그하면 코멘트를 달 수 있습니다.</p>',
      '<ul class="work-list">'];

    manifest.works.forEach(function (work) {
      html.push("<li><h2>" + escapeHtml(work.title) + '</h2><ul class="episode-list">');
      work.episodes.forEach(function (ep) {
        var versionLinks = ep.versions.map(function (v) {
          return '<a class="version-badge" href="' + episodeViewerUrl(work.slug, ep.id, v.id) + '">' +
            escapeHtml(v.label) + "</a>";
        }).join(" ");
        html.push('<li>' + escapeHtml(ep.label) + ' — <span class="version-list">' + versionLinks + "</span></li>");
      });
      html.push("</ul></li>");
    });

    html.push("</ul>");
    root.innerHTML = html.join("\n");
  }

  function findEntry(manifest, workSlug, episodeId, versionId) {
    var work = manifest.works.find(function (w) { return w.slug === workSlug; });
    if (!work) return null;
    var episode = work.episodes.find(function (e) { return e.id === episodeId; });
    if (!episode) return null;
    var version = episode.versions.find(function (v) { return v.id === versionId; });
    if (!version) return null;
    return { work: work, episode: episode, version: version };
  }

  async function renderEpisode(root, manifest, workSlug, episodeId, versionId) {
    var entry = findEntry(manifest, workSlug, episodeId, versionId);
    if (!entry) {
      root.innerHTML = "<p>해당 화·버전을 찾을 수 없습니다. <a href=\".\">목록으로</a></p>";
      return;
    }

    var res = await fetch(rawUrl(workSlug, episodeId, entry.version.file), { cache: "no-store" });
    if (!res.ok) {
      root.innerHTML = "<p>원문을 불러오지 못했습니다 (" + res.status + "). <a href=\".\">목록으로</a></p>";
      return;
    }
    var text = await res.text();
    var parsed = parseMarkdown(text);

    root.innerHTML = [
      '<p class="meta"><a href=".">← 목록으로</a></p>',
      "<h1>" + escapeHtml(entry.work.title) + " " + escapeHtml(entry.episode.label) +
        " · " + escapeHtml(entry.version.label) + "</h1>",
      '<div id="content">' + parsed.bodyHtml + "</div>",
      '<p class="hint">문장을 마우스로 드래그해서 선택하면 코멘트를 달 수 있어요. ' +
        '코멘트는 <a href="https://github.com/' + OWNER + "/" + REPO +
        '/labels/preview-feedback" target="_blank" rel="noopener">새 GitHub 이슈</a>로 등록됩니다. ' +
        '<a href="' + blobUrl(workSlug, episodeId, entry.version.file) +
        '" target="_blank" rel="noopener">원문 GitHub에서 보기</a></p>',
    ].join("\n");

    attachCommentUI(document.getElementById("content"), {
      workSlug: workSlug,
      workTitle: entry.work.title,
      episodeId: episodeId,
      episodeLabel: entry.episode.label,
      versionId: versionId,
      versionLabel: entry.version.label,
      file: entry.version.file,
    });
  }

  function buildIssueUrl(meta, quote, comment, name) {
    var title = "[" + meta.workSlug + " " + meta.episodeId + " " + meta.versionId + "] " +
      comment.slice(0, 40).replace(/\n/g, " ");

    var quotedLines = quote.split("\n").map(function (l) { return "> " + l; }).join("\n");
    var bodyLines = [
      "## 인용한 문장",
      quotedLines,
      "",
      "## 코멘트",
      comment,
      "",
      "## 위치",
      "- 작품: " + meta.workTitle + " (" + meta.workSlug + ")",
      "- 화: " + meta.episodeLabel + " (" + meta.episodeId + ")",
      "- 버전: " + meta.versionLabel,
      "- 원문: " + blobUrl(meta.workSlug, meta.episodeId, meta.file),
    ];
    if (name) bodyLines.push("- 남긴 사람: " + name);

    var params = new URLSearchParams();
    params.set("title", title);
    params.set("body", bodyLines.join("\n"));
    params.set("labels", "preview-feedback");
    return "https://github.com/" + OWNER + "/" + REPO + "/issues/new?" + params.toString();
  }

  function closePopover(state) {
    if (state.popoverEl) {
      state.popoverEl.remove();
      state.popoverEl = null;
    }
  }

  function showFab(state, containerEl, rect, quote) {
    removeFab(state);
    var fab = document.createElement("button");
    fab.className = "comment-fab";
    fab.type = "button";
    fab.textContent = "💬 코멘트 달기";

    var containerRect = containerEl.getBoundingClientRect();
    fab.style.left = (rect.left - containerRect.left + rect.width / 2) + "px";
    fab.style.top = (rect.top - containerRect.top) + "px";

    fab.addEventListener("mousedown", function (e) { e.preventDefault(); });
    fab.addEventListener("click", function () {
      showPopover(state, containerEl, rect, quote);
    });

    containerEl.style.position = containerEl.style.position || "relative";
    containerEl.appendChild(fab);
    state.fabEl = fab;
  }

  function removeFab(state) {
    if (state.fabEl) {
      state.fabEl.remove();
      state.fabEl = null;
    }
  }

  function showPopover(state, containerEl, rect, quote) {
    closePopover(state);
    removeFab(state);

    var pop = document.createElement("div");
    pop.className = "comment-popover";

    var savedName = "";
    try { savedName = window.localStorage.getItem(NAME_STORAGE_KEY) || ""; } catch (e) { /* ignore */ }

    pop.innerHTML =
      "<blockquote>" + escapeHtml(quote) + "</blockquote>" +
      '<textarea placeholder="이 문장에 대한 코멘트를 남겨주세요"></textarea>' +
      '<input type="text" placeholder="이름(선택)" value="' + escapeHtml(savedName) + '">' +
      '<div class="row"><span class="warn" style="display:none"></span>' +
      '<span><button type="button" class="cancel">취소</button> ' +
      '<button type="button" class="submit">GitHub 이슈로 제출</button></span></div>';

    var containerRect = containerEl.getBoundingClientRect();
    pop.style.left = Math.max(0, rect.left - containerRect.left) + "px";
    pop.style.top = (rect.top - containerRect.top + rect.height + 8) + "px";

    var textarea = pop.querySelector("textarea");
    var nameInput = pop.querySelector("input");
    var warnEl = pop.querySelector(".warn");
    var submitBtn = pop.querySelector(".submit");

    function updateWarn() {
      var total = quote.length + textarea.value.length;
      if (total > MAX_QUOTE_COMMENT_LEN) {
        warnEl.textContent = "너무 길어요 (" + total + "/" + MAX_QUOTE_COMMENT_LEN + "자) — 짧게 나눠서 남겨주세요";
        warnEl.style.display = "";
        submitBtn.disabled = true;
      } else {
        warnEl.style.display = "none";
        submitBtn.disabled = false;
      }
    }
    textarea.addEventListener("input", updateWarn);

    pop.querySelector(".cancel").addEventListener("click", function () {
      closePopover(state);
    });

    submitBtn.addEventListener("click", function () {
      var comment = textarea.value.trim();
      if (!comment) {
        textarea.focus();
        return;
      }
      var name = nameInput.value.trim();
      try {
        if (name) window.localStorage.setItem(NAME_STORAGE_KEY, name);
      } catch (e) { /* localStorage 사용 불가 환경 무시 */ }

      window.open(buildIssueUrl(state.meta, quote, comment, name), "_blank", "noopener");
      closePopover(state);
    });

    containerEl.appendChild(pop);
    state.popoverEl = pop;
    textarea.focus();
  }

  function attachCommentUI(contentEl, meta) {
    var state = { fabEl: null, popoverEl: null, meta: meta };

    function handleSelectionEnd() {
      var selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        removeFab(state);
        return;
      }
      var text = selection.toString().trim();
      if (!text) {
        removeFab(state);
        return;
      }
      var range = selection.getRangeAt(0);
      var anchorInside = contentEl.contains(range.startContainer);
      var focusInside = contentEl.contains(range.endContainer);
      if (!anchorInside || !focusInside) {
        removeFab(state);
        return;
      }

      var rect = range.getBoundingClientRect();
      showFab(state, contentEl, rect, text);
    }

    contentEl.addEventListener("mouseup", handleSelectionEnd);
    contentEl.addEventListener("touchend", handleSelectionEnd);
    document.addEventListener("mousedown", function (e) {
      if (state.popoverEl && !state.popoverEl.contains(e.target)) closePopover(state);
      if (state.fabEl && !state.fabEl.contains(e.target) && e.target !== state.fabEl) removeFab(state);
    });
  }

  function getSavedTheme() {
    try { return window.localStorage.getItem(THEME_STORAGE_KEY); } catch (e) { return null; }
  }

  function applyTheme(theme) {
    if (theme === "dark" || theme === "light") {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    try {
      if (theme) window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      else window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch (e) { /* localStorage 사용 불가 환경 무시 */ }
  }

  function initThemeToggle() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var current = getSavedTheme();
    btn.textContent = THEME_LABEL[String(current)];
    btn.addEventListener("click", function () {
      var idx = THEME_CYCLE.indexOf(current);
      current = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
      applyTheme(current);
      btn.textContent = THEME_LABEL[String(current)];
    });
  }

  async function main() {
    initThemeToggle();
    var root = document.getElementById("root");
    var manifest;
    try {
      manifest = await fetchManifest();
    } catch (err) {
      root.innerHTML = "<p>목록을 불러오지 못했습니다: " + escapeHtml(String(err.message || err)) + "</p>";
      return;
    }

    var work = qs("work");
    var episode = qs("episode");
    var version = qs("version");

    if (work && episode && version) {
      await renderEpisode(root, manifest, work, episode, version);
    } else {
      renderPicker(root, manifest);
    }
  }

  main();
})();
