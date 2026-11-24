const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anbiq · Factory Live</title>
<link rel="stylesheet" href="/board/app.css">
<script src="/board/app.js" defer></script>
</head>`;

const MARK = `<span class="mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l6 4V9l6 4V5l6 4v12z"></path><path d="M7 17h2M12 17h2M17 17h1"></path></svg></span>`;

export const LOGIN_HTML = `${HEAD}
<body class="login">
<main class="card login-card">
  <div class="brand">${MARK}<div><p class="eyebrow">Anbiq</p><h1>Factory Live</h1></div></div>
  <p class="muted">Sign in to watch the factory.</p>
  <form method="post" action="/board/login">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <p id="failed" class="error" hidden>That password is not right.</p>
    <button class="primary" type="submit">Sign in</button>
  </form>
</main>
</body>
</html>`;

export const BOARD_HTML = `${HEAD}
<body>
<div class="page">
  <header class="top">
    <div class="brand">
      ${MARK}
      <div><p class="eyebrow" id="project">Anbiq</p><h1>Factory Live</h1></div>
      <span id="demo-badge" class="badge warn" hidden>Demo data</span>
      <span id="disabled-badge" class="badge danger" hidden>Switched off</span>
    </div>
    <div class="top-right">
      <span id="clock" class="clock"></span>
      <button id="live" class="pill" type="button" aria-pressed="false"><span class="dot"></span><span id="live-label">Connecting</span></button>
      <form id="logout" method="post" action="/board/logout"><button class="pill" type="submit">Sign out</button></form>
    </div>
  </header>

  <section class="stats" aria-label="Today">
    <div class="card stat"><p class="eyebrow">Crews working</p><p class="big" id="stat-crews">0</p><p class="sub" id="stat-crews-sub"></p></div>
    <div class="card stat"><p class="eyebrow">Waiting for you</p><p class="big danger-text" id="stat-waiting">0</p><p class="sub">reply in the thread: merge · revise · deploy</p></div>
    <div class="card stat"><p class="eyebrow">Spend today</p><p class="big-row"><span class="big" id="stat-spend">$0.00</span><span class="sub" id="stat-budget"></span></p><span class="meter"><span id="spend-bar"></span></span></div>
    <div class="card stat"><p class="eyebrow">Merged this week</p><p class="big ok-text" id="stat-merged">0</p><p class="sub" id="stat-jobs"></p></div>
  </section>

  <div class="layout">
    <div class="main-col">
      <section class="card panel" aria-labelledby="pipeline-title">
        <div class="panel-head"><h2 id="pipeline-title">Pipeline</h2><span class="sub">Select a job for its details</span></div>
        <div id="pipeline" class="pipeline"></div>
      </section>
      <section id="detail" class="card panel detail" aria-label="Job details" hidden></section>
    </div>
    <div class="side-col">
      <section class="card list-panel" aria-labelledby="crews-title">
        <div class="panel-head padded"><h2 id="crews-title">Crews right now</h2><span class="sub" id="crews-count"></span></div>
        <div id="crews"></div>
      </section>
      <section class="card list-panel" aria-labelledby="feed-title">
        <div class="panel-head padded"><h2 id="feed-title">Live events</h2><span class="sub">newest first</span></div>
        <ul id="feed" class="feed" aria-live="polite"></ul>
      </section>
    </div>
  </div>
</div>
</body>
</html>`;

export const BOARD_CSS = `:root {
  --bg: #F4F5F9; --surface: #FFFFFF; --sunken: #F4F5F9; --text: #0F1020; --text-2: #3A3B52; --muted: #5E5F78;
  --line: #E9EAF2; --accent: #5B47FB; --accent-2: #7C66FF; --accent-ink: #2D1B9E; --idle: #A7A8BD;
  --shadow: 0 1px 2px rgba(15,16,32,.04), 0 8px 24px -12px rgba(15,16,32,.10);
  --c-intake-bg: #F4F5F9; --c-intake-fg: #3A3B52; --c-intake-bar: #A7A8BD;
  --c-spec-bg: #E3F6F0; --c-spec-fg: #0B7A60; --c-spec-bar: #10A37F;
  --c-build-bg: #EEEBFF; --c-build-fg: #2D1B9E; --c-build-bar: #5B47FB;
  --c-qa-bg: #E8F1FD; --c-qa-fg: #1F5BB8; --c-qa-bar: #2A6FDB;
  --c-review-bg: #FDF1E0; --c-review-fg: #8A4F05; --c-review-bar: #E8890C;
  --c-you-bg: #FDEAF0; --c-you-fg: #B0244A; --c-you-bar: #E7416B;
  --c-done-bg: #E3F6F0; --c-done-fg: #0B7A60; --c-done-bar: #10A37F;
  --c-off-bg: #EEEFF4; --c-off-fg: #5E5F78; --c-off-bar: #A7A8BD;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0E0F17; --surface: #171826; --sunken: #10111B; --text: #EEEEF6; --text-2: #C9CADB; --muted: #9A9BB4;
    --line: #262838; --accent: #8E7DFF; --accent-2: #A898FF; --accent-ink: #D8D1FF; --idle: #5A5C74;
    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 8px 24px -12px rgba(0,0,0,.6);
    --c-intake-bg: #232536; --c-intake-fg: #C9CADB;
    --c-spec-bg: #0F3229; --c-spec-fg: #6FE0BF; --c-build-bg: #262058; --c-build-fg: #CFC6FF;
    --c-qa-bg: #12294A; --c-qa-fg: #9CC2FF; --c-review-bg: #3A2608; --c-review-fg: #F7C27A;
    --c-you-bg: #431626; --c-you-fg: #FF9DB7; --c-done-bg: #0F3229; --c-done-fg: #6FE0BF;
    --c-off-bg: #232536; --c-off-fg: #9A9BB4;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--text); font: 500 14px/1.45 Inter, "Segoe UI", -apple-system, system-ui, sans-serif; }
h1, h2, .big, .clock, .detail-title, .avatar { font-family: "Plus Jakarta Sans", Inter, "Segoe UI", system-ui, sans-serif; }
h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.03em; }
h2 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -0.02em; }
p { margin: 0; }
a { color: var(--accent); font-weight: 600; text-decoration: none; }
a:hover { text-decoration: underline; }
button { font: inherit; color: inherit; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.page { min-height: 100vh; padding: 24px clamp(16px, 3vw, 40px) 40px; display: flex; flex-direction: column; gap: 20px; }
.card { background: var(--surface); border-radius: 20px; box-shadow: var(--shadow); }
.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.brand .eyebrow { font-size: 13px; letter-spacing: 0; text-transform: none; font-weight: 500; }
.sub, .muted { font-size: 12px; color: var(--muted); }
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.brand { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.mark { width: 42px; height: 42px; flex: 0 0 42px; border-radius: 14px; color: #fff; background: linear-gradient(135deg, #5B47FB, #7C66FF); display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 12px 32px -8px rgba(91,71,251,.45); }
.badge { font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; }
.badge.warn { background: var(--c-review-bg); color: var(--c-review-fg); }
.badge.danger { background: var(--c-you-bg); color: var(--c-you-fg); }
.top-right { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.top-right form { margin: 0; }
.clock { font-size: 15px; font-weight: 700; letter-spacing: -0.02em; color: var(--text-2); font-variant-numeric: tabular-nums; }
.pill { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); font-weight: 600; font-size: 13px; cursor: pointer; }
.dot { width: 10px; height: 10px; border-radius: 999px; background: var(--idle); }
.pill.on .dot { background: #10A37F; animation: pulse 1.8s infinite; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(16,163,127,.5); } 70% { box-shadow: 0 0 0 8px rgba(16,163,127,0); } 100% { box-shadow: 0 0 0 0 rgba(16,163,127,0); } }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
.stat { padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; }
.big { font-size: 32px; font-weight: 800; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; line-height: 1.15; }
.big-row { display: flex; align-items: baseline; gap: 8px; }
.danger-text { color: var(--c-you-fg); }
.ok-text { color: var(--c-done-fg); }
.meter { display: block; height: 6px; border-radius: 999px; background: var(--line); overflow: hidden; margin-top: 2px; }
.meter > span { display: block; height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, var(--accent), var(--accent-2)); transition: width .9s ease; }
.meter > span.full { background: var(--c-you-bar); }
.working { display: block; height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; position: relative; }
.working::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 35%; border-radius: 999px; background: var(--bar, var(--accent)); animation: slide 1.6s ease-in-out infinite; }
@keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(290%); } }
@media (prefers-reduced-motion: reduce) { .working::after, .pill.on .dot, .feed li.new { animation: none; } .working::after { width: 100%; opacity: .5; } }
.layout { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.main-col { flex: 999 1 640px; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.side-col { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 20px; }
.panel { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.panel-head.padded { padding: 18px 20px 10px; }
.pipeline { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
.column { flex: 0 0 200px; background: var(--sunken); border-radius: 16px; padding: 12px; display: flex; flex-direction: column; gap: 10px; min-height: 260px; }
.column-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; color: var(--text-2); }
.count { font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--surface); }
.empty { font-size: 12px; color: var(--muted); padding: 4px 2px; }
.job { display: flex; flex-direction: column; gap: 8px; width: 100%; text-align: left; padding: 12px; border-radius: 14px; background: var(--surface); cursor: pointer; border: 2px solid transparent; box-shadow: 0 1px 2px rgba(15,16,32,.05), 0 6px 16px -10px rgba(15,16,32,.18); transition: box-shadow .2s ease, border-color .2s ease; }
.job:hover { box-shadow: 0 1px 2px rgba(15,16,32,.06), 0 10px 24px -12px rgba(91,71,251,.35); }
.job.selected { border-color: var(--accent); }
.job-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.job-id { font-size: 11.5px; font-weight: 700; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.job-title { font-size: 13.5px; font-weight: 600; line-height: 1.35; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.job-note { font-size: 11.5px; font-weight: 600; color: var(--muted); display: flex; justify-content: space-between; gap: 6px; }
.job-note.you { color: var(--c-you-fg); }
.chip { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; white-space: nowrap; flex: 0 0 auto; background: var(--chip-bg); color: var(--chip-fg); }
.r-intake { --chip-bg: var(--c-intake-bg); --chip-fg: var(--c-intake-fg); --bar: var(--c-intake-bar); }
.r-spec { --chip-bg: var(--c-spec-bg); --chip-fg: var(--c-spec-fg); --bar: var(--c-spec-bar); }
.r-build { --chip-bg: var(--c-build-bg); --chip-fg: var(--c-build-fg); --bar: var(--c-build-bar); }
.r-qa { --chip-bg: var(--c-qa-bg); --chip-fg: var(--c-qa-fg); --bar: var(--c-qa-bar); }
.r-review { --chip-bg: var(--c-review-bg); --chip-fg: var(--c-review-fg); --bar: var(--c-review-bar); }
.r-you { --chip-bg: var(--c-you-bg); --chip-fg: var(--c-you-fg); --bar: var(--c-you-bar); }
.r-done { --chip-bg: var(--c-done-bg); --chip-fg: var(--c-done-fg); --bar: var(--c-done-bar); }
.r-off { --chip-bg: var(--c-off-bg); --chip-fg: var(--c-off-fg); --bar: var(--c-off-bar); }
.list-panel { display: flex; flex-direction: column; }
.crew { display: flex; gap: 12px; align-items: flex-start; padding: 14px 20px; border-top: 1px solid var(--line); }
.avatar { width: 40px; height: 40px; flex: 0 0 40px; border-radius: 13px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 800; background: var(--chip-bg); color: var(--chip-fg); }
.crew-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.crew-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.crew-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
.crew-time { font-size: 11.5px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.crew-job { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.crew-doing { font-size: 13px; color: var(--text-2); }
.nobody { padding: 14px 20px 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
.feed { list-style: none; margin: 0; padding: 0 0 8px; max-height: 62vh; overflow-y: auto; }
.feed li { display: flex; gap: 10px; align-items: flex-start; padding: 10px 20px; border-top: 1px solid var(--line); }
.feed li.new { animation: enter .35s ease-out; }
@keyframes enter { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.feed .time { font-size: 11.5px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; flex: 0 0 auto; padding-top: 2px; }
.feed .text { font-size: 13px; color: var(--text-2); line-height: 1.4; min-width: 0; overflow-wrap: anywhere; }
.detail { gap: 18px; padding: 22px; }
.detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.detail-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 12px; font-weight: 700; color: var(--muted); }
.detail-title { margin: 6px 0 4px; font-size: 20px; font-weight: 800; letter-spacing: -0.03em; overflow-wrap: anywhere; }
.detail-links { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; }
.icon-button { width: 40px; height: 40px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.fact { background: var(--sunken); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }
.fact .value { font-family: "Plus Jakarta Sans", Inter, system-ui, sans-serif; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hint { background: var(--c-you-bg); color: var(--c-you-fg); border-radius: 14px; padding: 12px 14px; font-size: 13px; font-weight: 600; }
.steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.steps li { display: flex; gap: 14px; align-items: flex-start; padding: 8px 0; }
.step-dot { width: 12px; height: 12px; flex: 0 0 12px; margin-top: 4px; border-radius: 999px; background: var(--line); }
.steps li.done .step-dot { background: #10A37F; }
.steps li.current .step-dot { background: var(--bar); box-shadow: 0 0 0 4px var(--chip-bg); }
.step-label { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; color: var(--muted); }
.steps li.done .step-label, .steps li.current .step-label { color: var(--text); }
.steps li.current .step-label { font-weight: 700; }
.step-meta { font-size: 12px; color: var(--muted); }
.timeline-title { font-size: 13px; font-weight: 700; color: var(--text-2); }
.timeline { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.timeline li { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--text-2); }
.login { min-height: 100vh; display: grid; place-items: center; padding: 16px; }
.login-card { width: min(380px, 100%); padding: 28px; display: flex; flex-direction: column; gap: 14px; }
.login-card form { display: grid; gap: 10px; }
.login-card label { font-size: 13px; font-weight: 600; }
.login-card input { font: inherit; min-height: 44px; padding: 0 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--sunken); color: var(--text); }
.primary { min-height: 44px; border: 0; border-radius: 14px; color: #fff; font-weight: 700; cursor: pointer; background: linear-gradient(135deg, #5B47FB, #7C66FF); }
.error { color: var(--c-you-fg); font-size: 13px; }
@media (max-width: 640px) { .page { padding: 16px; } .column { flex-basis: 180px; } .big { font-size: 28px; } }`;

export const BOARD_JS = `"use strict";
(() => {
  if (document.body.classList.contains("login")) {
    if (new URLSearchParams(location.search).has("failed")) document.getElementById("failed").hidden = false;
    return;
  }

  const COLUMNS = [
    { title: "Incoming", stages: ["intake"], role: "intake" },
    { title: "Spec", stages: ["spec"], role: "spec" },
    { title: "Build", stages: ["build"], role: "build" },
    { title: "QA", stages: ["qa"], role: "qa" },
    { title: "Review", stages: ["review"], role: "review" },
    { title: "Waiting for you", stages: ["awaiting-approval", "blocked"], role: "you" },
    { title: "Merged", stages: ["merged"], role: "done", limit: 8 },
    { title: "Deployed", stages: ["deployed"], role: "done", limit: 8 },
  ];
  const ROLE = {
    intake: { chip: "New", crew: null }, spec: { chip: "Spec", crew: "Spec crew", initials: "SP", doing: "Writing acceptance criteria" },
    build: { chip: "Build", crew: "Build crew", initials: "BU", doing: "Building the change, tests first" },
    qa: { chip: "QA", crew: "QA crew", initials: "QA", doing: "Testing every acceptance criterion" },
    review: { chip: "Review", crew: "Review crew", initials: "RE", doing: "Trying to break the change" },
    "awaiting-approval": { chip: "You" }, blocked: { chip: "Question" }, merged: { chip: "Merged" },
    deployed: { chip: "Live" }, cancelled: { chip: "Cancelled" },
  };
  const ROLE_CLASS = { intake: "r-intake", spec: "r-spec", build: "r-build", qa: "r-qa", review: "r-review", "awaiting-approval": "r-you", blocked: "r-you", merged: "r-done", deployed: "r-done", cancelled: "r-off" };
  const STEPS = [
    { label: "Request received", meta: "From the chat thread" },
    { label: "Job tracked as an issue", meta: "Tracker" },
    { label: "Acceptance criteria written", meta: "Spec crew" },
    { label: "Built with tests, pull request opened", meta: "Build crew" },
    { label: "QA passed", meta: "QA crew · tests per criterion and a security pass" },
    { label: "Review passed", meta: "Review crew · counterexamples and project rules" },
    { label: "Waiting for your merge", meta: "Reply merge or revise: … in the thread" },
    { label: "Merged", meta: "Only the reviewed commit, with checks green" },
    { label: "Deployed", meta: "After you reply deploy <environment>" },
  ];
  const STEP_OF = { intake: 1, spec: 2, build: 3, qa: 4, review: 5, "awaiting-approval": 6, merged: 7, deployed: 9 };
  const KIND_LABEL = {
    "request.received": "Request", "request.rejected": "Refused", "job.created": "New job", "stage.entered": "Stage",
    "run.started": "Started", "run.finished": "Finished", "pr.opened": "Pull request", "approval.requested": "Your turn",
    "approval.given": "Approved", "approval.rejected": "Not allowed", merged: "Merged", deployed: "Deployed", "budget.exceeded": "Limit",
  };

  const $ = (id) => document.getElementById(id);
  let state = null;
  let selected = null;
  let selectedEvents = [];
  let paused = false;
  let missed = 0;
  let reloadTimer = null;
  const seen = new Set();

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "onclick") el.addEventListener("click", value);
      else el.setAttribute(key, value === true ? "" : String(value));
    }
    for (const child of children.flat()) {
      if (child === undefined || child === null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }
  const safeUrl = (url) => (typeof url === "string" && /^https?:\\/\\//.test(url) ? url : undefined);
  const link = (url, text) => (safeUrl(url) ? h("a", { href: safeUrl(url), target: "_blank", rel: "noopener noreferrer" }, text) : null);
  const money = (n) => "$" + (Math.round((n || 0) * 100) / 100).toFixed(2);
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  function elapsed(iso) {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = seconds % 60;
    return hours ? hours + "h " + minutes + "m" : minutes ? minutes + "m " + rest + "s" : rest + "s";
  }
  const since = (iso) => h("span", { "data-since": iso }, elapsed(iso));
  const chip = (stage, text) => h("span", { class: "chip " + (ROLE_CLASS[stage] || "r-off") }, text || (ROLE[stage] && ROLE[stage].chip) || stage);
  function meter(el, used, limit) {
    const share = limit > 0 ? Math.min(1, used / limit) : 0;
    el.style.width = (share * 100).toFixed(1) + "%";
    el.classList.toggle("full", share >= 1);
  }

  function renderHeader() {
    $("project").textContent = "Anbiq · " + state.project;
    $("demo-badge").hidden = !state.demo;
    $("disabled-badge").hidden = state.enabled;
    $("logout").hidden = state.demo;
  }

  function renderStats() {
    const { usage, budgets, jobs } = state;
    const crews = jobs.filter((job) => job.activeRun);
    const building = crews.filter((job) => job.activeRun.stage === "build").length;
    const checking = crews.filter((job) => job.activeRun.stage === "qa" || job.activeRun.stage === "review").length;
    $("stat-crews").textContent = String(crews.length);
    $("stat-crews-sub").textContent = building + " building · " + checking + " checking · limit " + budgets.concurrent_jobs;
    $("stat-waiting").textContent = String(jobs.filter((job) => job.stage === "awaiting-approval" || job.stage === "blocked").length);
    $("stat-spend").textContent = money(usage.usdToday);
    const limited = typeof budgets.usd_per_day === "number";
    $("stat-budget").textContent = limited ? "of " + money(budgets.usd_per_day) : "no daily limit";
    meter($("spend-bar"), limited ? usage.usdToday : 0, limited ? budgets.usd_per_day : 1);
    $("stat-merged").textContent = String(state.mergedThisWeek);
    $("stat-jobs").textContent = usage.jobsToday + " of " + budgets.jobs_per_day + " jobs today";
  }

  function jobCard(job) {
    const working = job.activeRun ? ROLE[job.activeRun.stage] : null;
    const you = job.stage === "awaiting-approval" || job.stage === "blocked";
    return h("button", { class: "job" + (selected === job.id ? " selected" : ""), type: "button", "aria-pressed": selected === job.id ? "true" : "false", onclick: () => select(job.id) },
      h("span", { class: "job-top" }, h("span", { class: "job-id" }, job.id), chip(job.stage)),
      h("span", { class: "job-title" }, job.title),
      working ? h("span", { class: "job-note" }, h("span", {}, working.doing), since(job.updatedAt)) : null,
      working ? h("span", { class: "working " + ROLE_CLASS[job.activeRun.stage] }) : null,
      job.queued ? h("span", { class: "job-note" }, "Queued for " + job.queued) : null,
      you ? h("span", { class: "job-note you" }, job.stage === "blocked" ? "A crew asked a question" : "Ready: reply merge or revise") : null);
  }

  function renderPipeline() {
    $("pipeline").replaceChildren(...COLUMNS.map((column) => {
      let jobs = state.jobs.filter((job) => column.stages.includes(job.stage));
      const total = jobs.length;
      if (column.limit) jobs = jobs.slice(0, column.limit);
      return h("div", { class: "column" },
        h("div", { class: "column-head" }, h("span", {}, column.title), h("span", { class: "count" }, String(total))),
        jobs.length ? jobs.map(jobCard) : h("p", { class: "empty" }, "Nothing here"));
    }));
  }

  function renderCrews() {
    const crews = state.jobs.filter((job) => job.activeRun);
    $("crews-count").textContent = crews.length + " working";
    $("crews").replaceChildren(...(crews.length ? crews.map((job) => {
      const role = ROLE[job.activeRun.stage];
      const cls = ROLE_CLASS[job.activeRun.stage];
      return h("div", { class: "crew " + cls },
        h("div", { class: "avatar", "aria-hidden": "true" }, role.initials),
        h("div", { class: "crew-body" },
          h("div", { class: "crew-head" }, h("span", { class: "crew-name" }, role.crew), h("span", { class: "crew-time" }, since(job.updatedAt))),
          h("span", { class: "crew-job" }, job.id + " · " + job.title),
          h("span", { class: "crew-doing" }, role.doing, " ", link(job.activeRun.url, "run")),
          h("span", { class: "working" })));
    }) : [h("p", { class: "nobody" }, "No crew is working right now.")]));
  }

  function who(event) {
    if (event.actor.type === "person") return { text: event.actor.name, cls: "r-you" };
    if (event.actor.type === "crew") return { text: ROLE[event.actor.role].chip, cls: ROLE_CLASS[event.actor.role] };
    return { text: KIND_LABEL[event.kind] || "Factory", cls: event.kind === "merged" || event.kind === "deployed" ? "r-done" : "r-intake" };
  }

  function eventRow(event, withJob) {
    const actor = who(event);
    const isNew = !seen.has(event.id);
    seen.add(event.id);
    return h("li", { class: isNew && state.loaded ? "new" : "" },
      h("span", { class: "time" }, clock(event.at)),
      h("span", { class: "chip " + actor.cls }, actor.text),
      h("span", { class: "text" }, withJob && event.job ? event.job + ": " : "", event.summary, event.costUsd ? " · " + money(event.costUsd) : ""));
  }

  function renderFeed() {
    const events = state.events.slice(0, 60);
    $("feed").replaceChildren(...(events.length ? events.map((event) => eventRow(event, true)) : [h("li", {}, h("span", { class: "text" }, "Nothing has happened yet. Send the factory a request in chat."))]));
  }

  function renderDetail() {
    const panel = $("detail");
    const job = selected && state.jobs.find((candidate) => candidate.id === selected);
    if (!job) { panel.hidden = true; panel.replaceChildren(); return; }
    const reached = STEP_OF[job.stage];
    const cls = ROLE_CLASS[job.stage] || "r-off";
    const working = job.activeRun ? ROLE[job.activeRun.stage] : null;
    const cost = selectedEvents.reduce((sum, event) => sum + (event.costUsd || 0), 0);
    const steps = STEPS.map((step, index) => {
      const done = reached !== undefined && (index < reached || (job.stage === "deployed"));
      const current = reached !== undefined && index === reached && job.stage !== "deployed";
      return h("li", { class: (done ? "done" : current ? "current" : "") + " " + cls },
        h("span", { class: "step-dot", "aria-hidden": "true" }),
        h("div", {}, h("p", { class: "step-label" }, step.label), h("p", { class: "step-meta" }, current && working ? "Now: " + working.doing : step.meta)));
    });
    panel.hidden = false;
    panel.replaceChildren(...[
      h("div", { class: "detail-head" },
        h("div", {},
          h("div", { class: "detail-meta" }, h("span", {}, job.id + " · requested by " + job.requestedBy), chip(job.stage)),
          h("h2", { class: "detail-title" }, job.title),
          h("div", { class: "detail-links" }, link(job.issue, "Issue"), link(job.pullRequest, "Pull request"), job.activeRun ? link(job.activeRun.url, "Crew run") : null)),
        h("button", { class: "icon-button", type: "button", "aria-label": "Close job details", onclick: () => select(null) }, "✕")),
      h("div", { class: "facts" },
        h("div", { class: "fact" }, h("span", { class: "eyebrow" }, "Since request"), h("span", { class: "value" }, since(job.createdAt))),
        h("div", { class: "fact" }, h("span", { class: "eyebrow" }, "Cost"), h("span", { class: "value" }, money(cost))),
        h("div", { class: "fact" }, h("span", { class: "eyebrow" }, "Revisions"), h("span", { class: "value" }, String(job.revisions))),
        h("div", { class: "fact" }, h("span", { class: "eyebrow" }, "Sent back"), h("span", { class: "value" }, String(job.bounces || 0)))),
      job.stage === "awaiting-approval" ? h("p", { class: "hint" }, "Ready for you. Reply merge to ship it, or revise: <what to change> in the job's thread.") : null,
      job.stage === "blocked" ? h("p", { class: "hint" }, "A crew needs an answer. Reply to its question in the job's thread.") : null,
      reached !== undefined ? h("ol", { class: "steps" }, steps) : null,
      h("p", { class: "timeline-title" }, "Everything that happened"),
      h("ol", { class: "timeline" }, selectedEvents.length ? selectedEvents.map((event) => eventRow(event, false)) : h("li", {}, "No events yet.")),
    ].filter(Boolean));
  }

  function render() {
    renderHeader();
    renderStats();
    renderPipeline();
    renderCrews();
    renderFeed();
    renderDetail();
    state.loaded = true;
  }

  async function loadDetail() {
    if (!selected) { selectedEvents = []; return; }
    const response = await fetch("/board/api/jobs/" + encodeURIComponent(selected) + "/events", { credentials: "same-origin" });
    selectedEvents = response.ok ? await response.json() : [];
  }

  async function select(id) {
    selected = id;
    await loadDetail();
    render();
    if (id) $("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function load() {
    const response = await fetch("/board/api/state", { credentials: "same-origin" });
    if (response.status === 401) return location.reload();
    const loaded = state && state.loaded;
    state = await response.json();
    state.loaded = loaded;
    if (!loaded) for (const event of state.events) seen.add(event.id);
    await loadDetail();
    render();
  }

  function setLive(text, on) {
    $("live-label").textContent = text;
    $("live").classList.toggle("on", on);
  }

  $("live").addEventListener("click", () => {
    paused = !paused;
    $("live").setAttribute("aria-pressed", String(paused));
    if (paused) setLive("Paused · resume", false);
    else { setLive("Live · pause", true); missed = 0; load(); }
  });

  setInterval(() => {
    $("clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    for (const el of document.querySelectorAll("[data-since]")) el.textContent = elapsed(el.getAttribute("data-since"));
  }, 1000);

  const source = new EventSource("/board/api/stream");
  source.addEventListener("open", () => { if (!paused) setLive("Live · pause", true); load(); });
  source.addEventListener("error", () => { if (!paused) setLive("Reconnecting", false); });
  source.addEventListener("factory", () => {
    if (paused) { missed++; setLive("Paused · " + missed + " new", false); return; }
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 250);
  });

  load();
})();`;
