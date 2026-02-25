import {randomUUID, timingSafeEqual} from "node:crypto";

import {FastifyInstance, FastifyReply, FastifyRequest} from "fastify";
import {z} from "zod";

import {AppContext} from "../context.js";
import {SessionRecord} from "../types.js";
import {issueHumanPortalSessionToken, verifyHumanPortalSessionToken} from "../utils/humanPortalSession.js";
import {chooseRuntimeTarget, evaluateCapabilities, evaluateRuntimePolicy} from "../utils/policy.js";

const loginBodySchema = z.object({
  player_name: z.string().trim().min(2).max(32),
  access_code: z.string().trim().min(4).max(128),
  workspace_id: z.string().trim().min(1).max(128).optional()
});

const startSessionBodySchema = z.object({
  runtime_target: z.enum(["auto", "e2b", "internal-worker"]).default("auto"),
  purpose: z.string().trim().max(200).optional()
});

const sessionStatusQuerySchema = z.object({
  session_id: z.string().uuid()
});

const endSessionBodySchema = z.object({
  session_id: z.string().uuid(),
  reason: z.string().trim().max(200).optional()
});

function secureStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSchema<T>(schema: z.ZodSchema<T>, input: unknown): {ok: true; data: T} | {ok: false; details: unknown} {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      details: parsed.error.flatten()
    };
  }

  return {
    ok: true,
    data: parsed.data
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseCookieHeader(rawCookieHeader: string | undefined): Record<string, string> {
  if (!rawCookieHeader) return {};

  return Object.fromEntries(
    rawCookieHeader
      .split(";")
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(cookiePart => {
        const separatorIndex = cookiePart.indexOf("=");

        if (separatorIndex <= 0) return [cookiePart, ""];

        const key = cookiePart.slice(0, separatorIndex).trim();
        const value = cookiePart.slice(separatorIndex + 1).trim();
        try {
          return [key, decodeURIComponent(value)];
        } catch {
          return [key, value];
        }
      })
  );
}

function buildSetCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Priority=High",
    `Max-Age=${maxAgeSeconds}`
  ];

  if (secure) parts.push("Secure");

  return parts.join("; ");
}

function buildClearCookie(name: string, secure: boolean): string {
  const parts = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Priority=High", "Max-Age=0"];

  if (secure) parts.push("Secure");

  return parts.join("; ");
}

function portalSessionFromRequest(ctx: AppContext, request: FastifyRequest) {
  const cookies = parseCookieHeader(request.headers.cookie);
  const token = cookies[ctx.config.humanPortal.cookieName];

  if (!token) return null;

  return verifyHumanPortalSessionToken(token, ctx.config.humanPortal.sessionSecret);
}

function accessCodeAllowed(ctx: AppContext, accessCode: string): boolean {
  let matched = false;

  for (const configuredCode of ctx.config.humanPortal.accessCodes) {
    if (secureStringEquals(configuredCode, accessCode)) {
      matched = true;
    }
  }

  return matched;
}

function ensureWorkspaceAllowed(ctx: AppContext, workspaceId: string): boolean {
  return ctx.config.humanPortal.allowedWorkspaceIds.includes(workspaceId);
}

function sanitizePlayerName(raw: string): string {
  return raw
    .replace(/[^\w\-. ]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function buildPortalHtml(ctx: AppContext): string {
  const pageTitle = escapeHtml(ctx.config.humanPortal.title);
  const appName = escapeHtml(ctx.config.claboAppName);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${pageTitle}</title>
  <style>
    @import url("https://fonts.googleapis.com/css2?family=Syne:wght@500;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap");
    :root {
      --bg-deep: #0d1c2b;
      --bg-soft: #172f45;
      --accent: #f1b33e;
      --accent-2: #42d7c7;
      --ink: #edf2f5;
      --muted: #a8bdcc;
      --card: rgba(18, 36, 54, 0.84);
      --stroke: rgba(120, 159, 191, 0.35);
      --danger: #ee6b6e;
      --success: #49d18e;
      --radius: 18px;
      --shadow: 0 24px 70px rgba(4, 12, 20, 0.52);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "IBM Plex Sans", ui-sans-serif, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at 8% 12%, rgba(66, 215, 199, 0.17), transparent 42%),
        radial-gradient(circle at 86% 20%, rgba(241, 179, 62, 0.16), transparent 46%),
        linear-gradient(150deg, var(--bg-deep), #0a1420 58%, #121f2c 100%);
      min-height: 100vh;
      line-height: 1.45;
    }
    .shell {
      max-width: 1180px;
      margin: 0 auto;
      padding: clamp(18px, 3vw, 42px);
    }
    .hero {
      display: grid;
      gap: 14px;
      margin-bottom: 26px;
    }
    .brand {
      font-family: "Syne", ui-sans-serif, sans-serif;
      font-weight: 800;
      font-size: clamp(1.7rem, 3.8vw, 3.25rem);
      letter-spacing: 0.015em;
      margin: 0;
      color: #f6f8f9;
    }
    .subtitle {
      max-width: 820px;
      margin: 0;
      color: var(--muted);
      font-size: clamp(0.98rem, 1.55vw, 1.08rem);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: clamp(14px, 1.8vw, 22px);
    }
    .card {
      background: linear-gradient(180deg, rgba(26, 49, 71, 0.82), rgba(11, 27, 41, 0.86));
      border: 1px solid var(--stroke);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(12px);
      padding: clamp(14px, 1.8vw, 20px);
      position: relative;
      overflow: hidden;
    }
    .card::after {
      content: "";
      position: absolute;
      inset: auto -12% -70% auto;
      width: 220px;
      height: 220px;
      background: radial-gradient(circle, rgba(66, 215, 199, 0.1), transparent 65%);
      pointer-events: none;
    }
    .span-4 { grid-column: span 4; }
    .span-8 { grid-column: span 8; }
    .span-12 { grid-column: span 12; }
    h2 {
      font-family: "Syne", ui-sans-serif, sans-serif;
      margin: 0 0 10px;
      font-size: clamp(1.06rem, 1.9vw, 1.35rem);
      letter-spacing: 0.01em;
    }
    label {
      display: block;
      font-size: 0.82rem;
      color: var(--muted);
      margin: 10px 0 7px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    input, select, button, textarea {
      font: inherit;
      color: var(--ink);
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid rgba(140, 177, 207, 0.45);
      background: rgba(5, 16, 26, 0.65);
      border-radius: 12px;
      padding: 11px 12px;
      outline: none;
      transition: border-color 0.2s ease, transform 0.2s ease;
    }
    textarea { min-height: 100px; resize: vertical; }
    input:focus-visible, select:focus-visible, textarea:focus-visible {
      border-color: var(--accent-2);
      transform: translateY(-1px);
    }
    button {
      border: 0;
      border-radius: 12px;
      padding: 11px 14px;
      cursor: pointer;
      font-weight: 600;
      transition: transform 0.18s ease, filter 0.18s ease;
    }
    button:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }
    button:hover { transform: translateY(-1px); }
    .primary {
      background: linear-gradient(120deg, var(--accent), #ffd46a 50%, #f5b56a);
      color: #2a1805;
    }
    .secondary {
      background: rgba(66, 215, 199, 0.18);
      color: #dffdf9;
      border: 1px solid rgba(66, 215, 199, 0.45);
    }
    .danger {
      background: rgba(238, 107, 110, 0.18);
      color: #ffd7d8;
      border: 1px solid rgba(238, 107, 110, 0.45);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }
    .status {
      margin-top: 10px;
      border: 1px solid rgba(140, 177, 207, 0.35);
      border-radius: 12px;
      background: rgba(4, 13, 21, 0.68);
      padding: 10px 12px;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 0.8rem;
      white-space: pre-wrap;
      max-height: 220px;
      overflow: auto;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .chip {
      border: 1px solid rgba(140, 177, 207, 0.45);
      background: rgba(18, 37, 53, 0.78);
      border-radius: 999px;
      padding: 4px 10px;
      color: #d4e5ef;
      font-size: 0.77rem;
      letter-spacing: 0.01em;
    }
    .hint {
      color: var(--muted);
      font-size: 0.88rem;
      margin: 10px 0 0;
    }
    .ok { color: var(--success); }
    .bad { color: var(--danger); }
    iframe {
      margin-top: 12px;
      width: 100%;
      min-height: min(72vh, 780px);
      border: 1px solid rgba(140, 177, 207, 0.42);
      border-radius: 14px;
      background: rgba(2, 9, 16, 0.8);
    }
    .hide { display: none !important; }
    @media (max-width: 980px) {
      .span-4, .span-8 { grid-column: span 12; }
      .actions button { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <h1 class="brand">${pageTitle}</h1>
      <p class="subtitle">${appName} human portal for secure hotel access. Sign in with your access code, launch the game client, and manage your runtime session from one console.</p>
    </header>

    <section class="grid">
      <article class="card span-4" aria-labelledby="login-title">
        <h2 id="login-title">Portal Access</h2>
        <label for="player-name">Player Name</label>
        <input id="player-name" name="player-name" autocomplete="nickname" placeholder="PixelTraveler" />
        <label for="workspace-id">Workspace</label>
        <select id="workspace-id"></select>
        <label for="access-code">Access Code</label>
        <input id="access-code" name="access-code" type="password" autocomplete="current-password" placeholder="Portal invite code" />
        <div class="actions">
          <button id="login-btn" class="primary" type="button">Sign In</button>
          <button id="logout-btn" class="danger" type="button">Sign Out</button>
        </div>
        <p id="me-line" class="hint">Not signed in.</p>
        <div id="login-log" class="status" role="status" aria-live="polite">Awaiting login.</div>
      </article>

      <article class="card span-8" aria-labelledby="play-title">
        <h2 id="play-title">Play Hotel</h2>
        <p class="hint">Launch the configured game client in a dedicated tab. If embedded mode is enabled, you can also load it directly in this page.</p>
        <div class="actions">
          <a id="launch-link" class="primary" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:12px;padding:11px 14px;" target="_blank" rel="noopener noreferrer">Launch Hotel Client</a>
          <button id="embed-btn" class="secondary" type="button">Toggle Embedded Client</button>
        </div>
        <div id="play-meta" class="chip-row"></div>
        <iframe id="game-frame" title="Clabbo Game Client" class="hide"></iframe>
      </article>

      <article class="card span-12" aria-labelledby="session-title">
        <h2 id="session-title">Runtime Session Console</h2>
        <label for="runtime-target">Runtime Target</label>
        <select id="runtime-target">
          <option value="auto">auto</option>
          <option value="e2b">e2b</option>
          <option value="internal-worker">internal-worker</option>
        </select>
        <label for="session-purpose">Purpose</label>
        <textarea id="session-purpose" placeholder="Example: In-room moderation, social play, event hosting"></textarea>
        <div class="actions">
          <button id="start-session-btn" class="primary" type="button">Start Runtime Session</button>
          <button id="status-session-btn" class="secondary" type="button">Check Session Status</button>
          <button id="end-session-btn" class="danger" type="button">End Session</button>
        </div>
        <p class="hint">Workflow catalog and action catalog remain available through the existing API. This panel manages the human-authenticated runtime session lifecycle.</p>
        <div id="session-log" class="status" role="status" aria-live="polite">No runtime session started.</div>
      </article>
    </section>
  </main>
  <script>
    const els = {
      workspaceSelect: document.getElementById("workspace-id"),
      playerName: document.getElementById("player-name"),
      accessCode: document.getElementById("access-code"),
      loginBtn: document.getElementById("login-btn"),
      logoutBtn: document.getElementById("logout-btn"),
      meLine: document.getElementById("me-line"),
      loginLog: document.getElementById("login-log"),
      launchLink: document.getElementById("launch-link"),
      embedBtn: document.getElementById("embed-btn"),
      playMeta: document.getElementById("play-meta"),
      gameFrame: document.getElementById("game-frame"),
      runtimeTarget: document.getElementById("runtime-target"),
      sessionPurpose: document.getElementById("session-purpose"),
      startSessionBtn: document.getElementById("start-session-btn"),
      statusSessionBtn: document.getElementById("status-session-btn"),
      endSessionBtn: document.getElementById("end-session-btn"),
      sessionLog: document.getElementById("session-log")
    };

    const state = {
      config: null,
      me: null,
      currentSessionId: null,
      frameVisible: false
    };

    function prettyJson(value) {
      return JSON.stringify(value, null, 2);
    }

    function setLoginLog(value, isError = false) {
      els.loginLog.textContent = value;
      els.loginLog.classList.toggle("bad", isError);
      els.loginLog.classList.toggle("ok", !isError);
    }

    function setSessionLog(value, isError = false) {
      els.sessionLog.textContent = value;
      els.sessionLog.classList.toggle("bad", isError);
      els.sessionLog.classList.toggle("ok", !isError);
    }

    async function request(path, options = {}) {
      const response = await fetch(path, {
        credentials: "same-origin",
        headers: {"content-type": "application/json", ...(options.headers || {})},
        ...options
      });
      let data = {};
      try { data = await response.json(); } catch {}
      if (!response.ok) {
        const errorMessage = data.error || response.statusText || "request_failed";
        throw new Error(errorMessage);
      }
      return data;
    }

    function renderConfig() {
      if (!state.config) return;
      els.workspaceSelect.innerHTML = "";
      state.config.allowed_workspace_ids.forEach(workspaceId => {
        const option = document.createElement("option");
        option.value = workspaceId;
        option.textContent = workspaceId;
        if (workspaceId === state.config.default_workspace_id) option.selected = true;
        els.workspaceSelect.appendChild(option);
      });
      if (state.config.game_url) {
        els.launchLink.href = state.config.game_url;
        els.launchLink.textContent = "Launch Hotel Client";
      } else {
        els.launchLink.removeAttribute("href");
        els.launchLink.textContent = "No Game URL Configured";
      }
      els.embedBtn.classList.toggle("hide", !state.config.allow_embed || !state.config.game_url);

      const chips = [
        "Portal " + (state.config.enabled ? "Enabled" : "Disabled"),
        "Workspaces: " + state.config.allowed_workspace_ids.length,
        "Trust: " + state.config.issued_trust_tier
      ];
      els.playMeta.innerHTML = "";
      chips.forEach(value => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = value;
        els.playMeta.appendChild(chip);
      });
    }

    function renderMe() {
      if (!state.me) {
        els.meLine.textContent = "Not signed in.";
        return;
      }
      els.meLine.textContent = "Signed in as " + state.me.player_name + " on " + state.me.workspace_id;
      if (!els.playerName.value) {
        els.playerName.value = state.me.player_name;
      }
      els.workspaceSelect.value = state.me.workspace_id;
    }

    async function refreshMe() {
      try {
        const me = await request("/api/portal/v1/me", {method: "GET"});
        state.me = me;
        renderMe();
        setLoginLog(prettyJson(me));
      } catch {
        state.me = null;
        renderMe();
        setLoginLog("No active human portal session.");
      }
    }

    async function bootstrap() {
      try {
        state.config = await request("/api/portal/v1/config", {method: "GET"});
        renderConfig();
      } catch (error) {
        setLoginLog("Portal config unavailable: " + error.message, true);
      }
      await refreshMe();
    }

    els.loginBtn.addEventListener("click", async () => {
      try {
        const payload = {
          player_name: els.playerName.value,
          access_code: els.accessCode.value,
          workspace_id: els.workspaceSelect.value
        };
        const response = await request("/api/portal/v1/login", {method: "POST", body: JSON.stringify(payload)});
        state.me = response.user;
        renderMe();
        setLoginLog(prettyJson(response));
        els.accessCode.value = "";
      } catch (error) {
        setLoginLog("Login failed: " + error.message, true);
      }
    });

    els.logoutBtn.addEventListener("click", async () => {
      try {
        const response = await request("/api/portal/v1/logout", {method: "POST", body: "{}"});
        state.me = null;
        state.currentSessionId = null;
        renderMe();
        setLoginLog(prettyJson(response));
        setSessionLog("Runtime session cleared.");
      } catch (error) {
        setLoginLog("Logout failed: " + error.message, true);
      }
    });

    els.embedBtn.addEventListener("click", async () => {
      if (!state.config || !state.config.allow_embed || !state.config.game_url) return;

      state.frameVisible = !state.frameVisible;
      els.gameFrame.classList.toggle("hide", !state.frameVisible);
      if (state.frameVisible && !els.gameFrame.src) {
        els.gameFrame.src = state.config.game_url;
      }
    });

    els.startSessionBtn.addEventListener("click", async () => {
      try {
        const payload = {
          runtime_target: els.runtimeTarget.value,
          purpose: els.sessionPurpose.value
        };
        const response = await request("/api/portal/v1/session/start", {method: "POST", body: JSON.stringify(payload)});
        state.currentSessionId = response.session_id;
        setSessionLog(prettyJson(response));
      } catch (error) {
        setSessionLog("Start session failed: " + error.message, true);
      }
    });

    els.statusSessionBtn.addEventListener("click", async () => {
      try {
        if (!state.currentSessionId) throw new Error("No local session id. Start a session first.");
        const response = await request("/api/portal/v1/session/status?session_id=" + encodeURIComponent(state.currentSessionId), {method: "GET"});
        setSessionLog(prettyJson(response));
      } catch (error) {
        setSessionLog("Status check failed: " + error.message, true);
      }
    });

    els.endSessionBtn.addEventListener("click", async () => {
      try {
        if (!state.currentSessionId) throw new Error("No local session id. Start a session first.");
        const response = await request("/api/portal/v1/session/end", {
          method: "POST",
          body: JSON.stringify({session_id: state.currentSessionId, reason: "human_portal_end"})
        });
        state.currentSessionId = null;
        setSessionLog(prettyJson(response));
      } catch (error) {
        setSessionLog("End session failed: " + error.message, true);
      }
    });

    bootstrap();
  </script>
</body>
</html>`;
}

function rejectPortalDisabled(reply: FastifyReply) {
  return reply.code(404).send({error: "portal_disabled"});
}

export async function registerPortalRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/portal", async (_request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    reply.type("text/html; charset=utf-8");
    return reply.send(buildPortalHtml(ctx));
  });

  app.get("/api/portal/v1/config", async (_request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    return reply.send({
      enabled: ctx.config.humanPortal.enabled,
      title: ctx.config.humanPortal.title,
      game_url: ctx.config.humanPortal.gameUrl ?? null,
      allow_embed: ctx.config.humanPortal.allowEmbed,
      default_workspace_id: ctx.config.humanPortal.defaultWorkspaceId,
      allowed_workspace_ids: ctx.config.humanPortal.allowedWorkspaceIds,
      issued_trust_tier: ctx.config.humanPortal.issuedTrustTier,
      issued_capabilities: ctx.config.humanPortal.issuedCapabilities
    });
  });

  app.post("/api/portal/v1/login", async (request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    const body = parseSchema(loginBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});

    const playerName = sanitizePlayerName(body.data.player_name);
    if (playerName.length < 2) {
      return reply.code(400).send({error: "invalid_player_name", hint: "Use at least 2 visible characters"});
    }

    if (!accessCodeAllowed(ctx, body.data.access_code)) {
      return reply.code(403).send({error: "access_code_invalid"});
    }

    const workspaceId = body.data.workspace_id ?? ctx.config.humanPortal.defaultWorkspaceId;
    if (!ensureWorkspaceAllowed(ctx, workspaceId)) {
      return reply.code(403).send({error: "workspace_not_allowed"});
    }

    const issueResult = issueHumanPortalSessionToken(
      {
        sid: randomUUID(),
        playerName,
        workspaceId,
        trustTier: ctx.config.humanPortal.issuedTrustTier,
        capabilities: ctx.config.humanPortal.issuedCapabilities,
        ttlSeconds: ctx.config.humanPortal.sessionTtlSeconds
      },
      ctx.config.humanPortal.sessionSecret
    );

    reply.header(
      "set-cookie",
      buildSetCookie(
        ctx.config.humanPortal.cookieName,
        issueResult.token,
        ctx.config.humanPortal.sessionTtlSeconds,
        ctx.config.nodeEnv !== "development"
      )
    );

    return reply.send({
      success: true,
      user: {
        player_name: issueResult.claims.player_name,
        workspace_id: issueResult.claims.workspace_id,
        trust_tier: issueResult.claims.trust_tier,
        capabilities: issueResult.claims.capabilities,
        expires_at: new Date(issueResult.claims.exp * 1000).toISOString()
      }
    });
  });

  app.post("/api/portal/v1/logout", async (_request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    reply.header("set-cookie", buildClearCookie(ctx.config.humanPortal.cookieName, ctx.config.nodeEnv !== "development"));
    return reply.send({success: true});
  });

  app.get("/api/portal/v1/me", async (request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    const session = portalSessionFromRequest(ctx, request);
    if (!session) return reply.code(401).send({error: "portal_auth_required"});

    return reply.send({
      player_name: session.player_name,
      workspace_id: session.workspace_id,
      trust_tier: session.trust_tier,
      capabilities: session.capabilities,
      expires_at: new Date(session.exp * 1000).toISOString()
    });
  });

  app.post("/api/portal/v1/session/start", async (request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    const portalSession = portalSessionFromRequest(ctx, request);
    if (!portalSession) return reply.code(401).send({error: "portal_auth_required"});

    const body = parseSchema(startSessionBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});

    const capabilityDecision = evaluateCapabilities(portalSession.capabilities, ctx.config.allowedCapabilities);
    if (capabilityDecision.missing.length) {
      return reply.code(403).send({
        error: "capability_not_allowed",
        missing_capabilities: capabilityDecision.missing
      });
    }

    const runtimeTarget = chooseRuntimeTarget(
      ctx.config.runtimePolicy,
      body.data.runtime_target,
      portalSession.trust_tier,
      ctx.config.requireE2BForExternal
    );
    const runtimeAllowed = evaluateRuntimePolicy(
      ctx.config.runtimePolicy,
      runtimeTarget,
      portalSession.trust_tier,
      ctx.config.requireE2BForExternal
    );
    if (!runtimeAllowed.allowed) {
      return reply.code(403).send({error: runtimeAllowed.reason ?? "runtime_not_allowed"});
    }

    const now = new Date();
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const ttlSeconds = Math.max(60, Math.min(ctx.config.sessionTtlSeconds, portalSession.exp - nowSeconds));
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const sessionId = randomUUID();
    const sessionRecord: SessionRecord = {
      sessionId,
      workspaceId: portalSession.workspace_id,
      requestId: randomUUID(),
      runtimeTarget,
      trustTier: portalSession.trust_tier,
      capabilities: capabilityDecision.granted,
      purpose: body.data.purpose ?? "human_portal_play",
      metadata: {
        portal: "human",
        player_name: portalSession.player_name
      },
      startedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      endedAt: null,
      agent: {
        id: `human:${portalSession.sid}`,
        name: portalSession.player_name,
        description: "Authenticated human via Clabbo portal",
        owner: {
          display_name: portalSession.player_name,
          verified: true
        },
        metadata: {
          portal: "human",
          sid: portalSession.sid
        }
      }
    };

    await ctx.sessionStore.create(sessionRecord, ttlSeconds);

    ctx.audit.emit({
      event: "portal.session.start",
      at: now.toISOString(),
      requestId: sessionRecord.requestId,
      workspaceId: sessionRecord.workspaceId,
      sessionId: sessionId,
      agentId: sessionRecord.agent.id,
      agentName: sessionRecord.agent.name,
      runtimeTarget: sessionRecord.runtimeTarget,
      trustTier: sessionRecord.trustTier,
      allowed: true,
      details: {
        source: "human_portal",
        capabilities: capabilityDecision.granted
      }
    });

    return reply.code(201).send({
      success: true,
      session_id: sessionRecord.sessionId,
      workspace_id: sessionRecord.workspaceId,
      runtime_target: sessionRecord.runtimeTarget,
      trust_tier: sessionRecord.trustTier,
      capabilities: sessionRecord.capabilities,
      started_at: sessionRecord.startedAt,
      expires_at: sessionRecord.expiresAt,
      player_name: sessionRecord.agent.name
    });
  });

  app.get("/api/portal/v1/session/status", async (request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    const portalSession = portalSessionFromRequest(ctx, request);
    if (!portalSession) return reply.code(401).send({error: "portal_auth_required"});

    const query = parseSchema(sessionStatusQuerySchema, request.query);
    if (!query.ok) return reply.code(400).send({error: "invalid_query", details: query.details});

    const existing = await ctx.sessionStore.get(query.data.session_id);
    if (!existing) return reply.code(404).send({error: "session_not_found"});
    if (existing.workspaceId !== portalSession.workspace_id) return reply.code(403).send({error: "workspace_mismatch"});
    if (existing.agent.id !== `human:${portalSession.sid}`) return reply.code(403).send({error: "session_owner_mismatch"});

    return reply.send({
      success: true,
      session_id: existing.sessionId,
      workspace_id: existing.workspaceId,
      started_at: existing.startedAt,
      ended_at: existing.endedAt,
      expires_at: existing.expiresAt,
      runtime_target: existing.runtimeTarget,
      trust_tier: existing.trustTier,
      capabilities: existing.capabilities,
      player_name: existing.agent.name
    });
  });

  app.post("/api/portal/v1/session/end", async (request, reply) => {
    if (!ctx.config.humanPortal.enabled) return rejectPortalDisabled(reply);

    const portalSession = portalSessionFromRequest(ctx, request);
    if (!portalSession) return reply.code(401).send({error: "portal_auth_required"});

    const body = parseSchema(endSessionBodySchema, request.body);
    if (!body.ok) return reply.code(400).send({error: "invalid_payload", details: body.details});

    const existing = await ctx.sessionStore.get(body.data.session_id);
    if (!existing) return reply.code(404).send({error: "session_not_found"});
    if (existing.workspaceId !== portalSession.workspace_id) return reply.code(403).send({error: "workspace_mismatch"});
    if (existing.agent.id !== `human:${portalSession.sid}`) return reply.code(403).send({error: "session_owner_mismatch"});

    const endedAt = new Date().toISOString();
    const ended = await ctx.sessionStore.end(body.data.session_id, endedAt);

    ctx.audit.emit({
      event: "portal.session.end",
      at: endedAt,
      requestId: randomUUID(),
      workspaceId: existing.workspaceId,
      sessionId: existing.sessionId,
      agentId: existing.agent.id,
      agentName: existing.agent.name,
      runtimeTarget: existing.runtimeTarget,
      trustTier: existing.trustTier,
      allowed: true,
      details: {
        source: "human_portal",
        reason: body.data.reason ?? "manual_end"
      }
    });

    if (!ended) return reply.code(500).send({error: "session_end_failed"});

    return reply.send({
      success: true,
      session_id: ended.sessionId,
      ended_at: ended.endedAt
    });
  });
}
