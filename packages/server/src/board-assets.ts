const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anbiq board</title>
<link rel="stylesheet" href="/board/app.css">
<script src="/board/app.js" defer></script>
</head>`;

export const LOGIN_HTML = `${HEAD}
<body class="login">
<main class="login-card">
  <h1>Anbiq</h1>
  <p class="muted">Sign in to watch the factory.</p>
  <form method="post" action="/board/login">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <p id="failed" class="error" hidden>That password is not right.</p>
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;

export const BOARD_HTML = `${HEAD}
<body>
<header class="top">
  <div class="brand"><span class="mark" aria-hidden="true"></span><h1>Anbiq</h1><span id="project" class="muted"></span></div>
  <div class="top-right">
    <span id="live" class="live" title="Live updates">connecting</span>
    <form method="post" action="/board/logout"><button class="ghost" type="submit">Sign out</button></form>
  </div>
</header>
<p id="disabled" class="banner" hidden>The factory is switched off. It only answers status until it is enabled again.</p>
<section class="stats" aria-label="Today">
  <div class="stat"><span class="label">Spend today</span><span id="spend" class="value"></span><span class="meter"><span id="spend-bar"></span></span></div>
  <div class="stat"><span class="label">Jobs today</span><span id="jobs" class="value"></span><span class="meter"><span id="jobs-bar"></span></span></div>
  <div class="stat"><span class="label">Crews running</span><span id="running" class="value"></span><span class="meter"><span id="running-bar"></span></span></div>
</section>
<main class="layout">
  <section aria-labelledby="pipeline-title">
    <h2 id="pipeline-title">Pipeline</h2>
    <div id="pipeline" class="pipeline"></div>
  </section>
  <aside class="side">
    <section aria-labelledby="crews-title">
      <h2 id="crews-title">Active crews</h2>
      <ul id="crews" class="list"></ul>
    </section>
    <section aria-labelledby="feed-title">
      <h2 id="feed-title">Live feed</h2>
      <ol id="feed" class="list feed"></ol>
    </section>
  </aside>
</main>
<dialog id="timeline">
  <header class="dialog-head"><h2 id="timeline-title"></h2><button id="timeline-close" class="ghost" type="button">Close</button></header>
  <div id="timeline-links" class="links"></div>
  <ol id="timeline-events" class="list timeline"></ol>
</dialog>
</body>
</html>`;

export const BOARD_CSS = `:root {
  --bg: #f3f1ee; --surface: #ffffff; --text: #1d1b19; --muted: #6b655e; --line: #e2ddd6;
  --accent: #b5532c; --accent-soft: #f4e3da; --ok: #2f7d4f; --warn: #a86a12; --bad: #b3261e;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151311; --surface: #1f1c19; --text: #ece7e1; --muted: #a39b91; --line: #34302b;
    --accent: #e07a4b; --accent-soft: #3a2519; --ok: #62c08a; --warn: #e0a84b; --bad: #f07a70; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
h1, h2 { margin: 0; font-weight: 650; }
h1 { font-size: 18px; letter-spacing: 0.02em; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 10px; }
a { color: var(--accent); }
.muted { color: var(--muted); }
button { font: inherit; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; padding: 8px 14px; cursor: pointer; }
button.ghost { background: transparent; color: var(--text); border-color: var(--line); padding: 6px 12px; }
.top { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--surface); }
.brand, .top-right { display: flex; align-items: center; gap: 12px; }
.top-right form { margin: 0; }
.mark { width: 14px; height: 14px; border-radius: 3px; background: linear-gradient(135deg, var(--accent), #6e2f16); }
.live { font-size: 12px; color: var(--muted); }
.live::before { content: ""; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--warn); margin-right: 6px; vertical-align: 1px; }
.live.on::before { background: var(--ok); }
.banner { margin: 16px 20px 0; padding: 10px 14px; border-radius: 8px; background: var(--accent-soft); }
.stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 16px 20px 0; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; display: grid; gap: 4px; }
.stat .label { font-size: 12px; color: var(--muted); }
.stat .value { font-size: 20px; font-weight: 650; font-variant-numeric: tabular-nums; }
.meter { height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.meter span { display: block; height: 100%; width: 0; background: var(--accent); }
.meter span.full { background: var(--bad); }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; padding: 20px; }
.pipeline { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(170px, 1fr); gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.column { background: color-mix(in srgb, var(--surface) 55%, transparent); border: 1px solid var(--line); border-radius: 10px; padding: 10px; min-height: 140px; }
.column h3 { margin: 0 0 8px; font-size: 12px; font-weight: 600; display: flex; justify-content: space-between; color: var(--muted); }
.card { display: block; width: 100%; text-align: left; background: var(--surface); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; cursor: pointer; }
.card:hover, .card:focus-visible { border-color: var(--accent); outline: none; }
.card .id { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
.card .title { display: block; margin: 2px 0 6px; font-weight: 550; overflow-wrap: anywhere; }
.card .meta { font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px; }
.pill { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.pill.blocked { color: var(--bad); }
.side { display: grid; gap: 20px; align-content: start; }
.list { list-style: none; margin: 0; padding: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; }
.list li { padding: 9px 12px; border-top: 1px solid var(--line); overflow-wrap: anywhere; }
.list li:first-child { border-top: 0; }
.list .empty { color: var(--muted); }
.feed { max-height: 60vh; overflow-y: auto; }
.event-head { display: flex; gap: 8px; align-items: baseline; font-size: 12px; color: var(--muted); }
.event-head .kind { color: var(--text); font-weight: 600; }
.time { font-variant-numeric: tabular-nums; }
dialog { width: min(640px, calc(100vw - 32px)); border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text); padding: 0; }
dialog::backdrop { background: rgb(0 0 0 / 0.4); }
.dialog-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.dialog-head h2 { margin: 0; text-transform: none; letter-spacing: 0; font-size: 15px; color: var(--text); }
.links { display: flex; gap: 14px; padding: 10px 16px 0; font-size: 13px; }
.timeline { border: 0; margin: 8px 0; max-height: 60vh; overflow-y: auto; }
.login { display: grid; place-items: center; min-height: 100vh; padding: 16px; }
.login-card { width: min(360px, 100%); background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 24px; }
.login-card form { display: grid; gap: 10px; margin-top: 16px; }
.login-card input { font: inherit; padding: 9px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
.error { color: var(--bad); margin: 0; }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; padding: 16px; }
  .stats { grid-template-columns: 1fr; padding: 16px 16px 0; }
  .top { padding: 12px 16px; }
}`;

export const BOARD_JS = `"use strict";
(() => {
  if (document.body.classList.contains("login")) {
    if (new URLSearchParams(location.search).has("failed")) document.getElementById("failed").hidden = false;
    return;
  }

  const COLUMNS = [
    { title: "Spec", stages: ["intake", "spec"] },
    { title: "Build", stages: ["build"] },
    { title: "QA", stages: ["qa"] },
    { title: "Review", stages: ["review"] },
    { title: "Awaiting approval", stages: ["awaiting-approval"] },
    { title: "Blocked", stages: ["blocked"] },
    { title: "Shipped", stages: ["merged", "deployed"], limit: 10 },
  ];
  const $ = (id) => document.getElementById(id);
  let state = null;
  let reload = null;
  let openJob = null;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("data-")) el.setAttribute(key, value);
      else if (key === "onclick") el.addEventListener("click", value);
      else el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const safeUrl = (url) => (typeof url === "string" && /^https?:\\/\\//.test(url) ? url : undefined);
  const link = (url, text) => (safeUrl(url) ? h("a", { href: safeUrl(url), target: "_blank", rel: "noopener noreferrer" }, text) : null);
  const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(2);
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  function elapsed(iso) {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
    return h ? h + "h " + m + "m" : m ? m + "m " + s + "s" : s + "s";
  }

  function meter(bar, used, limit) {
    const share = limit > 0 ? Math.min(1, used / limit) : 0;
    bar.style.width = (share * 100).toFixed(1) + "%";
    bar.classList.toggle("full", share >= 1);
  }

  function renderStats() {
    const { usage, budgets } = state;
    $("spend").textContent = money(usage.usdToday) + " of " + money(budgets.usd_per_day);
    $("jobs").textContent = usage.jobsToday + " of " + budgets.jobs_per_day;
    $("running").textContent = usage.runningJobs + " of " + budgets.concurrent_jobs;
    meter($("spend-bar"), usage.usdToday, budgets.usd_per_day);
    meter($("jobs-bar"), usage.jobsToday, budgets.jobs_per_day);
    meter($("running-bar"), usage.runningJobs, budgets.concurrent_jobs);
  }

  function card(job) {
    const status = job.activeRun
      ? h("span", { class: "pill" }, job.activeRun.stage + " crew working")
      : job.queued
        ? h("span", { class: "pill" }, "queued for " + job.queued)
        : job.stage === "blocked"
          ? h("span", { class: "pill blocked" }, "waiting for a person")
          : null;
    return h("button", { class: "card", type: "button", onclick: () => openTimeline(job) },
      h("span", { class: "id" }, job.id),
      h("span", { class: "title" }, job.title),
      h("span", { class: "meta" },
        h("span", {}, job.requestedBy),
        h("span", { "data-since": job.updatedAt }, elapsed(job.updatedAt)),
        job.revisions ? h("span", {}, job.revisions + " revision" + (job.revisions === 1 ? "" : "s")) : null,
        status));
  }

  function renderPipeline() {
    const pipeline = $("pipeline");
    pipeline.replaceChildren(...COLUMNS.map((column) => {
      let jobs = state.jobs.filter((job) => column.stages.includes(job.stage));
      const total = jobs.length;
      if (column.limit) jobs = jobs.slice(0, column.limit);
      return h("div", { class: "column" },
        h("h3", {}, h("span", {}, column.title), h("span", {}, String(total))),
        jobs.map(card));
    }));
  }

  function renderCrews() {
    const active = state.jobs.filter((job) => job.activeRun);
    $("crews").replaceChildren(...(active.length
      ? active.map((job) => h("li", {},
          h("div", { class: "event-head" }, h("span", { class: "kind" }, job.activeRun.stage + " crew"), h("span", {}, job.id)),
          h("div", {}, "Running for ", h("span", { "data-since": job.updatedAt }, elapsed(job.updatedAt)), " ", link(job.activeRun.url, "run"))))
      : [h("li", { class: "empty" }, "No crew is working right now.")]));
  }

  function eventItem(event, withJob) {
    const who = event.actor.type === "person" ? event.actor.name : event.actor.type === "crew" ? event.actor.role + " crew" : "factory";
    return h("li", {},
      h("div", { class: "event-head" },
        h("span", { class: "time" }, time(event.at)),
        h("span", { class: "kind" }, event.kind),
        withJob && event.job ? h("span", {}, event.job) : null,
        h("span", {}, who),
        event.costUsd ? h("span", {}, money(event.costUsd)) : null),
      h("div", {}, event.summary));
  }

  function renderFeed() {
    $("feed").replaceChildren(...(state.events.length
      ? state.events.slice(0, 100).map((event) => eventItem(event, true))
      : [h("li", { class: "empty" }, "Nothing has happened yet.")]));
  }

  function render() {
    $("project").textContent = state.project;
    $("disabled").hidden = state.enabled;
    renderStats();
    renderPipeline();
    renderCrews();
    renderFeed();
  }

  async function load() {
    const response = await fetch("/board/api/state", { credentials: "same-origin" });
    if (response.status === 401) return location.reload();
    state = await response.json();
    render();
  }

  async function openTimeline(job) {
    openJob = job.id;
    $("timeline-title").textContent = job.id + " · " + job.title;
    $("timeline-links").replaceChildren(...[link(job.issue, "Issue"), link(job.pullRequest, "Pull request")].filter(Boolean));
    $("timeline-events").replaceChildren(h("li", { class: "empty" }, "Loading…"));
    if (!$("timeline").open) $("timeline").showModal();
    await loadTimeline();
  }

  async function loadTimeline() {
    if (!openJob) return;
    const response = await fetch("/board/api/jobs/" + encodeURIComponent(openJob) + "/events", { credentials: "same-origin" });
    const events = response.ok ? await response.json() : [];
    $("timeline-events").replaceChildren(...(events.length ? events.map((event) => eventItem(event, false)) : [h("li", { class: "empty" }, "No events yet.")]));
  }

  $("timeline-close").addEventListener("click", () => $("timeline").close());
  $("timeline").addEventListener("close", () => { openJob = null; });

  setInterval(() => {
    for (const el of document.querySelectorAll("[data-since]")) el.textContent = elapsed(el.getAttribute("data-since"));
  }, 1000);

  const source = new EventSource("/board/api/stream");
  source.addEventListener("open", () => { $("live").classList.add("on"); $("live").textContent = "live"; load(); });
  source.addEventListener("error", () => { $("live").classList.remove("on"); $("live").textContent = "reconnecting"; });
  source.addEventListener("factory", (message) => {
    const event = JSON.parse(message.data);
    if (!state) return;
    state.events.unshift(event);
    state.events.length = Math.min(state.events.length, 200);
    renderFeed();
    if (openJob && event.job === openJob) loadTimeline();
    clearTimeout(reload);
    reload = setTimeout(load, 400);
  });

  load();
})();`;
