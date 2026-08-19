import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search, ArrowLeft, Delete, Check, ArrowUpRight,
  ArrowDownLeft, Clock, X, LogOut, Buildiimport { useState, useEffect, useCallback, useRef } from "react";
import {
  X, LogOut, Building2, Share2,
  Fingerprint, Plus, Trash2, RefreshCw, ChevronRight, Pencil, Wallet as WalletIcon,
  Receipt, PieChart, Target, TrendingUp, Tag, Users, FileText, Landmark, ArrowUp, ArrowDown,
} from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, setToken, hasToken } from "./api.js";
import { GroupsList, GroupDetail, ReminderBanners } from "./Groups.jsx";

const C = {
  ink: "#16151A", canvas: "#F1F1F5", surface: "#FFFFFF",
  brand: "#5B4DF5", brandSoft: "#ECEAFE", green: "#12A150",
  greenSoft: "#E4F5EC", amber: "#E8A33D", muted: "#7A7A86", line: "#E6E6EC", red: "#E5556E",
};
// Soft brand-tinted blobs over the base canvas color, used on full-page wrappers.
const pageBg = `radial-gradient(900px circle at 12% -8%, ${C.brandSoft} 0%, transparent 55%), `
  + `radial-gradient(700px circle at 108% 105%, ${C.brandSoft} 0%, transparent 50%), ${C.canvas}`;
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CADENCE_LABEL = { WEEKLY: "Weekly", MONTHLY: "Monthly", YEARLY: "Yearly", UNKNOWN: "One-off" };

const fontStyle = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@700&display=swap');
    *{-webkit-tap-highlight-color:transparent;box-sizing:border-box}
    body{margin:0}
    .sheet-enter{animation:slideUp .28s cubic-bezier(.2,.8,.2,1)}
    @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    .pop{animation:pop .3s cubic-bezier(.2,.9,.3,1.3)}
    @keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
    @media (prefers-reduced-motion:reduce){.sheet-enter,.pop{animation:none}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    button:focus-visible,input:focus-visible{outline:2px solid ${C.brand};outline-offset:2px}
    input,select,textarea{font-family:inherit}
    .tabrow::-webkit-scrollbar{display:none}
  `}</style>
);

// ── iOS "Add to Home Screen" banner ──────────────────────
// iOS Safari has no install prompt API, so PWAs have to tell users
// to do it manually via the Share sheet.
function useIosInstallPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!crios|fxios|edgios|opios).)*safari/i.test(ua);
    const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    const dismissed = localStorage.getItem("even_ios_install_dismissed") === "1";
    setShow(isIos && isSafari && !isStandalone && !dismissed);
  }, []);
  const dismiss = () => { localStorage.setItem("even_ios_install_dismissed", "1"); setShow(false); };
  return [show, dismiss];
}

function IosInstallBanner() {
  const [show, dismiss] = useIosInstallPrompt();
  if (!show) return null;
  return (
    <div style={{
      position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 50, maxWidth: 420, margin: "0 auto",
      background: C.ink, color: "#fff", borderRadius: 16, padding: "14px 16px",
      display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 24px rgba(0,0,0,.25)",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <Share2 size={20} style={{ flexShrink: 0, color: C.brand }} />
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, flex: 1 }}>
        Install DoerToughMoney: tap <strong>Share</strong> below, then <strong>Add to Home Screen</strong>.
      </p>
      <button onClick={dismiss} aria-label="Dismiss"
        style={{ background: "transparent", border: "none", color: "#B9B9C6", cursor: "pointer", flexShrink: 0, padding: 4 }}>
        <X size={18} />
      </button>
    </div>
  );
}

// Opens Plaid Link as soon as a link token is ready. Mounted only after the
// token has been fetched, so the user's tap flows straight into their bank
// instead of stalling on a spinner. Success hands us a public token, which
// the server exchanges for a real access token server-side — the client
// never sees or stores Plaid credentials.
function BankLoginLauncher({ linkToken, onLinked, onError, onExit }) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken) => {
      try {
        const result = await api.plaidExchange(publicToken);
        onLinked(result);
      } catch (e) { onError(e.message); }
    },
    onExit: (err) => onExit(err ? err.display_message || err.error_message : null),
  });

  useEffect(() => { if (ready) open(); }, [ready, open]);
  return null;
}

// ── Auth screen ──────────────────────────────────────────
function Auth({ onDone, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({ name: "", handle: "", email: "", password: "" });
  const [err, setErr] = useState("");
  // Which action is in flight, so the three sign-in paths (password, Google,
  // passkey) don't show each other's spinners.
  const [busy, setBusy] = useState(null); // null | "password" | "google" | "passkey"
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setErr(""); setBusy("password");
    try {
      const res = mode === "login"
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form);
      setToken(res.token);
      onDone(res.user);
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  // ── Sign in with Google ──────────────────────────────────
  // Additive: existing password accounts are untouched. A brand-new Google
  // user only needs a handle to finish — Google already proved who they are.
  const [googleCfg, setGoogleCfg] = useState({ enabled: false, clientId: null });
  const [pendingGoogle, setPendingGoogle] = useState(null); // { idToken, name, email }
  const googleBtnRef = useRef(null);

  useEffect(() => {
    api.config().then((c) => setGoogleCfg({ enabled: !!c.googleEnabled, clientId: c.googleClientId })).catch(() => {});
  }, []);

  const handleGoogleCredential = useCallback(async (response) => {
    setErr(""); setBusy("google");
    try {
      const res = await api.googleAuth(response.credential);
      if (res.status === "ok") { setToken(res.token); onDone(res.user); }
      else setPendingGoogle({ idToken: response.credential, name: res.name, email: res.email });
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }, [onDone]);

  useEffect(() => {
    if (!googleCfg.enabled || !googleCfg.clientId || pendingGoogle) return;
    const render = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({ client_id: googleCfg.clientId, callback: handleGoogleCredential });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline", size: "large", width: 336, text: mode === "login" ? "signin_with" : "signup_with",
      });
    };
    if (window.google?.accounts?.id) { render(); return; }
    // Loaded on demand, only once Google is actually configured, so the login
    // screen never fetches third-party JS it won't use.
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [googleCfg, mode, pendingGoogle, handleGoogleCredential]);

  const submitGoogleRegistration = async () => {
    setErr(""); setBusy("google");
    try {
      const res = await api.registerWithGoogle({ idToken: pendingGoogle.idToken, handle: form.handle });
      setToken(res.token);
      onDone(res.user);
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  // ── Face ID / Touch ID ────────────────────────────────────
  // Sign-in only — enrolling a passkey happens from inside the app once
  // already authenticated (see the prompt on the home screen), so this
  // button only ever appears on the login side, never registration.
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setCanPasskey).catch(() => {});
  }, []);

  const passkeySignIn = async () => {
    setErr(""); setBusy("passkey");
    try {
      const { attemptId, options } = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      const res = await api.passkeyLoginVerify({ attemptId, response });
      setToken(res.token);
      onDone(res.user);
    } catch (e) {
      // The user cancelling the native picker throws NotAllowedError — that's
      // not a failure worth a red error message, just let them try something else.
      if (e?.name !== "NotAllowedError") setErr(e.message || "Couldn't sign in with that passkey.");
    } finally { setBusy(null); }
  };

  const inputStyle = {
    width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${C.line}`,
    background: C.surface, fontSize: 15, marginTop: 10,
  };

  const field = (ph, k, type = "text", opts = {}) => {
    const { autoComplete } = opts;
    return (
      <input
        id={`f-${k}`} value={form[k]} onChange={set(k)} placeholder={ph} type={type}
        aria-label={ph} autoComplete={autoComplete} style={inputStyle}
      />
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: pageBg, display: "flex", flexDirection: "column",
      justifyContent: "center", padding: 24, fontFamily: "Inter, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 34, letterSpacing: "-0.03em" }}>
          DoerTough<span style={{ color: C.brand }}>Money</span>
        </div>
        <p style={{ color: C.muted, fontSize: 15, marginTop: 4 }}>Your money. Your decisions. Your advantage.</p>

        {pendingGoogle ? (
          // A brand-new Google account: name/email are already proven by
          // Google (shown, not editable) — only a handle is needed to finish.
          <div style={{ marginTop: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: C.brandSoft, marginBottom: 14 }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, background: C.brand, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {pendingGoogle.name?.[0]?.toUpperCase() || "G"}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pendingGoogle.name}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pendingGoogle.email}</p>
              </div>
            </div>

            {field("Handle (e.g. @you)", "handle", "text", { autoComplete: "username" })}

            {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
            <button onClick={submitGoogleRegistration} disabled={busy === "google"}
              style={{ width: "100%", marginTop: 16, padding: 15, borderRadius: 14, border: "none",
                background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy === "google" ? 0.6 : 1 }}>
              {busy === "google" ? "…" : "Finish creating account"}
            </button>
            <button onClick={() => { setErr(""); setPendingGoogle(null); }}
              style={{ marginTop: 12, width: "100%", background: "none", border: "none", color: C.muted, fontSize: 14 }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 26 }}>
            {/* Faster paths back in. Passkeys are sign-in only — enrolling one
                happens from inside the app once already authenticated. */}
            {mode === "login" && canPasskey && (
              <button onClick={passkeySignIn} disabled={busy === "passkey"}
                style={{ width: "100%", padding: 13, borderRadius: 14, border: `1px solid ${C.line}`, background: C.surface,
                  color: C.ink, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  cursor: "pointer", opacity: busy === "passkey" ? 0.6 : 1 }}>
                <Fingerprint size={18} /> {busy === "passkey" ? "…" : "Sign in with Face ID / Touch ID"}
              </button>
            )}
            {googleCfg.enabled && (
              <div ref={googleBtnRef} style={{ display: "flex", justifyContent: "center", marginTop: mode === "login" && canPasskey ? 10 : 0 }} />
            )}
            {(canPasskey && mode === "login" || googleCfg.enabled) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
                <div style={{ flex: 1, height: 1, background: C.line }} />
                <span style={{ fontSize: 12, color: C.muted }}>or</span>
                <div style={{ flex: 1, height: 1, background: C.line }} />
              </div>
            )}

            {mode === "register" && (<>
              {field("Full name", "name", "text", { autoComplete: "name" })}
              <div style={{ marginTop: 10 }}>{field("Handle (e.g. @you)", "handle", "text", { autoComplete: "username" })}</div>
            </>)}
            <div style={{ marginTop: 10 }}>{field("Email", "email", "email", { autoComplete: "email" })}</div>
            <div style={{ marginTop: 10 }}>{field("Password", "password", "password", { autoComplete: mode === "register" ? "new-password" : "current-password" })}</div>

            {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
            <button onClick={submit} disabled={!!busy}
              style={{ width: "100%", marginTop: 16, padding: 15, borderRadius: 14, border: "none",
                background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy ? 0.6 : 1 }}>
              {busy === "password" ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </div>
        )}

        {!pendingGoogle && (
          <button onClick={() => { setErr(""); setMode(mode === "login" ? "register" : "login"); }}
            style={{ marginTop: 18, background: "none", border: "none", color: C.muted, fontSize: 14 }}>
            {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        )}

        <p style={{ marginTop: 28, fontSize: 12, color: C.muted, textAlign: "center" }}>
          By continuing you agree to our{" "}
          <a href="/terms" style={{ color: C.muted, textDecoration: "underline" }}>Terms</a>{" "}
          and{" "}
          <a href="/privacy" style={{ color: C.muted, textDecoration: "underline" }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

// ── shared style objects ─────────────────────────────────
const pill = { display: "flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "7px 12px", border: "none",
  background: "rgba(255,255,255,.12)", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const lightPill = { display: "flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "7px 12px",
  border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const bigBtn = { borderRadius: 16, padding: "14px 0", border: "none", fontWeight: 700, fontSize: 15.5,
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" };
const iconBtn = { background: "none", border: "none", padding: 4, cursor: "pointer", color: C.ink };
const sheetInput = { width: "100%", border: "none", outline: "none", background: C.canvas, borderRadius: 14, padding: "12px 14px", fontSize: 15, marginTop: 8 };
const card = { borderRadius: 20, padding: 16, background: C.surface, border: `1px solid ${C.line}` };
const sectionLabel = { fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 };

// A bottom sheet used for every add/edit form across the finance tabs.
function SimpleSheet({ title, onClose, children }) {
  return (
    <div onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 25, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
      <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
        style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px", maxHeight: "88%", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={iconBtn}><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const TABS = [
  { k: "home", l: "Home", Icon: WalletIcon },
  { k: "accounts", l: "Accounts", Icon: Landmark },
  { k: "transactions", l: "Transactions", Icon: Receipt },
  { k: "bills", l: "Bills", Icon: FileText },
  { k: "budgets", l: "Budgets", Icon: PieChart },
  { k: "goals", l: "Goals", Icon: Target },
  { k: "insights", l: "Insights", Icon: TrendingUp },
  { k: "deals", l: "DealTough", Icon: Tag },
  { k: "shared", l: "Shared", Icon: Users },
];

// ── Home ─────────────────────────────────────────────────
function HomeTab({ accounts, totalAvailable, totalDebt, insights, topNegotiable, onGoTab }) {
  const top3 = (insights?.byCategory || []).slice(0, 3);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: C.ink, color: "#fff", border: "none" }}>
        <span style={{ color: "#B9B9C6", fontSize: 13, fontWeight: 500 }}>Available to spend</span>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 34, fontWeight: 700, marginTop: 6 }}>${money(totalAvailable)}</div>
        {totalDebt > 0 && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#D8D8E2" }}>${money(totalDebt)} owed on credit accounts</p>}
        <button onClick={() => onGoTab("accounts")} style={{ ...pill, marginTop: 14 }}>
          <Landmark size={14} /> {accounts.length === 0 ? "Connect a bank" : `${accounts.length} account${accounts.length === 1 ? "" : "s"} linked`}
        </button>
      </div>

      {insights?.thisMonth && (
        <div style={card}>
          <p style={sectionLabel}>This month</p>
          <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Spent</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>${money(insights.thisMonth.spend)}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Income</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.green }}>${money(insights.thisMonth.income)}</p>
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Net</p>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: insights.thisMonth.net >= 0 ? C.green : C.red }}>
                {insights.thisMonth.net >= 0 ? "+" : "−"}${money(Math.abs(insights.thisMonth.net))}
              </p>
            </div>
          </div>
          {top3.length > 0 && (
            <div style={{ marginTop: 14 }}>
              {top3.map((c) => (
                <div key={c.category} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13.5 }}>
                  <span style={{ color: C.ink }}>{c.category}</span>
                  <span style={{ fontWeight: 600 }}>${money(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => onGoTab("insights")} style={{ ...lightPill, marginTop: 10 }}>
            See full insights <ChevronRight size={14} />
          </button>
        </div>
      )}

      {topNegotiable?.length > 0 && (
        <div style={card}>
          <p style={sectionLabel}>Biggest opportunities</p>
          <p style={{ fontSize: 13, color: C.muted, margin: "6px 0 10px" }}>
            Your largest recurring bills — the best candidates to try to lower.
          </p>
          {topNegotiable.map((b) => (
            <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 14 }}>
              <span>{b.name}</span>
              <span style={{ fontWeight: 600 }}>${money(b.amount)}/mo</span>
            </div>
          ))}
          <button onClick={() => onGoTab("bills")} style={{ ...lightPill, marginTop: 8 }}>
            Manage bills <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Accounts (Plaid) ─────────────────────────────────────
function AccountsTab({ onChanged }) {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [linkToken, setLinkToken] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [i, a] = await Promise.all([api.plaidItems(), api.accounts()]);
      setItems(i.items || []);
      setAccounts(a.accounts || []);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setErr(""); setConnecting(true);
    try { setLinkToken((await api.plaidLinkToken()).linkToken); }
    catch (e) { setErr(e.message); setConnecting(false); }
  };

  const removeItem = async (id) => {
    try { await api.plaidRemoveItem(id); await load(); onChanged?.(); }
    catch (e) { setErr(e.message); }
  };

  const syncAll = async () => {
    setSyncing(true);
    try { await api.plaidSync(); await load(); onChanged?.(); }
    catch (e) { setErr(e.message); } finally { setSyncing(false); }
  };

  if (loading) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {linkToken && (
        <BankLoginLauncher
          linkToken={linkToken}
          onLinked={async () => { setLinkToken(null); setConnecting(false); await load(); onChanged?.(); }}
          onError={(m) => { setLinkToken(null); setConnecting(false); setErr(m); }}
          onExit={(m) => { setLinkToken(null); setConnecting(false); if (m) setErr(m); }}
        />
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={connect} disabled={connecting}
          style={{ ...bigBtn, flex: 1, background: C.brand, color: "#fff", opacity: connecting ? 0.6 : 1 }}>
          <Building2 size={17} /> {connecting ? "Opening…" : "Connect a bank"}
        </button>
        {items.length > 0 && (
          <button onClick={syncAll} disabled={syncing} title="Sync now"
            style={{ ...iconBtn, border: `1px solid ${C.line}`, borderRadius: 14, width: 48 }}>
            <RefreshCw size={17} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
          </button>
        )}
      </div>
      {err && <p style={{ color: C.red, fontSize: 13 }}>{err}</p>}

      {items.length === 0 && (
        <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "24px 0" }}>
          No banks linked yet. Connect one to see balances and transactions.
        </p>
      )}

      {items.map((it) => (
        <div key={it.id} style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: C.brandSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Landmark size={17} color={C.brand} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{it.institutionName || "Bank"}</p>
            <p style={{ margin: 0, fontSize: 12.5, color: it.status === "ACTIVE" ? C.green : C.amber }}>
              {it.status === "ACTIVE" ? "Connected" : it.status === "REAUTH_REQUIRED" ? "Needs reconnecting" : "Connection issue"}
            </p>
          </div>
          <button onClick={() => removeItem(it.id)} style={iconBtn} title="Remove"><Trash2 size={16} color={C.muted} /></button>
        </div>
      ))}

      {accounts.length > 0 && (
        <div>
          <p style={sectionLabel}>Accounts</p>
          <div style={{ marginTop: 8 }}>
            {accounts.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{a.name}{a.mask ? ` ····${a.mask}` : ""}</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: C.muted, textTransform: "capitalize" }}>{a.subtype || a.type}</p>
                </div>
                <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14.5 }}>
                  ${money(a.currentBalance)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Transactions ──────────────────────────────────────────
function TransactionsTab() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [category, setCategory] = useState("");
  const [editing, setEditing] = useState(null);
  const [bills, setBills] = useState([]);
  const [form, setForm] = useState({ category: "", billId: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTransactions((await api.transactions({ category: category || undefined, limit: 100 })).transactions || []); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [category]);

  useEffect(() => { load(); }, [load]);

  const openEdit = async (t) => {
    setEditing(t);
    setForm({ category: t.category || "", billId: t.billId || "" });
    try { setBills((await api.bills()).bills || []); } catch {}
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateTransaction(editing.id, { category: form.category || undefined, billId: form.billId || null });
      setEditing(null);
      await load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Filter by category…"
        style={{ ...sheetInput, marginTop: 0 }} />
      {err && <p style={{ color: C.red, fontSize: 13 }}>{err}</p>}
      {loading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : transactions.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "24px 0" }}>No transactions yet — connect a bank to sync them in.</p>
      ) : (
        <div>
          {transactions.map((t) => {
            const inflow = Number(t.amount) < 0;
            return (
              <button key={t.id} onClick={() => openEdit(t)}
                style={{ width: "100%", textAlign: "left", background: "none", border: "none", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: inflow ? C.greenSoft : C.canvas, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {inflow ? <ArrowDown size={16} color={C.green} /> : <ArrowUp size={16} color={C.muted} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.merchantName || t.name}
                  </p>
                  <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
                    {new Date(t.date).toLocaleDateString()}{t.category ? ` · ${t.category}` : ""}{t.pending ? " · pending" : ""}
                  </p>
                </div>
                <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14.5, color: inflow ? C.green : C.ink }}>
                  {inflow ? "+" : "−"}${money(Math.abs(t.amount))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {editing && (
        <SimpleSheet title="Edit transaction" onClose={() => setEditing(null)}>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>{editing.merchantName || editing.name}</p>
          <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category" style={sheetInput} />
          <select value={form.billId} onChange={(e) => setForm((f) => ({ ...f, billId: e.target.value }))} style={{ ...sheetInput, appearance: "auto" }}>
            <option value="">Not linked to a bill</option>
            {bills.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button onClick={save} disabled={saving}
            style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: saving ? 0.6 : 1 }}>
            {saving ? "…" : "Save"}
          </button>
        </SimpleSheet>
      )}
    </div>
  );
}

// ── Bills ──────────────────────────────────────────────────
function BillsTab({ onGoTab }) {
  const [bills, setBills] = useState([]);
  const [topNegotiable, setTopNegotiable] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null); // {} for new, {...bill} for edit
  const [form, setForm] = useState({ name: "", category: "", amount: "", cadence: "MONTHLY", nextDueOn: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.bills();
      setBills(r.bills || []);
      setTopNegotiable(r.topNegotiable || []);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm({ name: "", category: "", amount: "", cadence: "MONTHLY", nextDueOn: "" }); setEditing({}); };
  const openEdit = (b) => { setForm({ name: b.name, category: b.category || "", amount: String(b.amount), cadence: b.cadence, nextDueOn: b.nextDueOn ? b.nextDueOn.slice(0, 10) : "" }); setEditing(b); };

  const save = async () => {
    setSaving(true); setErr("");
    const body = { name: form.name.trim(), category: form.category.trim() || undefined, amount: parseFloat(form.amount) || 0, cadence: form.cadence, nextDueOn: form.nextDueOn || undefined };
    try {
      if (editing?.id) await api.updateBill(editing.id, body);
      else await api.createBill(body);
      setEditing(null);
      await load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  const remove = async (id) => {
    try { await api.deleteBill(id); await load(); } catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={openNew} style={{ ...bigBtn, background: C.brand, color: "#fff" }}><Plus size={17} /> Add a bill</button>
      {err && <p style={{ color: C.red, fontSize: 13 }}>{err}</p>}

      {topNegotiable.length > 0 && (
        <div style={card}>
          <p style={sectionLabel}>Biggest opportunities</p>
          <p style={{ fontSize: 12.5, color: C.muted, margin: "6px 0 10px" }}>
            DealTough bill negotiation is coming soon. In the meantime, try DealTough on a one-time purchase in the Deals tab.
          </p>
          {topNegotiable.map((b) => (
            <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
              <span>{b.name}</span><span style={{ fontWeight: 600 }}>${money(b.amount)}</span>
            </div>
          ))}
          <button onClick={() => onGoTab("deals")} style={{ ...lightPill, marginTop: 8 }}>Open DealTough <ChevronRight size={14} /></button>
        </div>
      )}

      {loading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : bills.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "24px 0" }}>No bills tracked yet.</p>
      ) : bills.map((b) => (
        <div key={b.id} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{b.name}</p>
            <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
              {b.category ? `${b.category} · ` : ""}{CADENCE_LABEL[b.cadence] || b.cadence}
              {b.nextDueOn ? ` · due ${new Date(b.nextDueOn).toLocaleDateString()}` : ""}
            </p>
          </div>
          <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 15 }}>${money(b.amount)}</span>
          <button onClick={() => openEdit(b)} style={iconBtn}><Pencil size={15} color={C.muted} /></button>
          <button onClick={() => remove(b.id)} style={iconBtn}><Trash2 size={15} color={C.muted} /></button>
        </div>
      ))}

      {editing && (
        <SimpleSheet title={editing.id ? "Edit bill" : "Add a bill"} onClose={() => setEditing(null)}>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name (e.g. Car insurance)" style={sheetInput} />
          <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category (e.g. Insurance)" style={sheetInput} />
          <input value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="Amount" inputMode="decimal" style={sheetInput} />
          <select value={form.cadence} onChange={(e) => setForm((f) => ({ ...f, cadence: e.target.value }))} style={{ ...sheetInput, appearance: "auto" }}>
            {Object.entries(CADENCE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input value={form.nextDueOn} onChange={(e) => setForm((f) => ({ ...f, nextDueOn: e.target.value }))} type="date" style={sheetInput} />
          <button onClick={save} disabled={saving || !form.name.trim()}
            style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: (saving || !form.name.trim()) ? 0.6 : 1 }}>
            {saving ? "…" : "Save"}
          </button>
        </SimpleSheet>
      )}
    </div>
  );
}

// ── Budgets ──────────────────────────────────────────────
function BudgetsTab() {
  const [budgets, setBudgets] = useState([]);
  const [byCategory, setByCategory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ category: "", monthlyLimit: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, i] = await Promise.all([api.budgets(), api.insights()]);
      setBudgets(b.budgets || []);
      setByCategory(i.byCategory || []);
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const spentFor = (category) => byCategory.find((c) => c.category === category)?.amount || 0;

  const openNew = () => { setForm({ category: "", monthlyLimit: "" }); setEditing({}); };
  const save = async () => {
    setSaving(true); setErr("");
    try {
      await api.upsertBudget({ category: form.category.trim(), monthlyLimit: parseFloat(form.monthlyLimit) || 0 });
      setEditing(null);
      await load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const remove = async (id) => { try { await api.deleteBudget(id); await load(); } catch (e) { setErr(e.message); } };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={openNew} style={{ ...bigBtn, background: C.brand, color: "#fff" }}><Plus size={17} /> Set a budget</button>
      {err && <p style={{ color: C.red, fontSize: 13 }}>{err}</p>}

      {loading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : budgets.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "24px 0" }}>No budgets set yet.</p>
      ) : budgets.map((b) => {
        const spent = spentFor(b.category);
        const pct = b.monthlyLimit > 0 ? Math.min(100, (spent / b.monthlyLimit) * 100) : 0;
        const over = spent > b.monthlyLimit;
        return (
          <div key={b.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{b.category}</p>
              <button onClick={() => remove(b.id)} style={iconBtn}><Trash2 size={15} color={C.muted} /></button>
            </div>
            <p style={{ margin: "4px 0 8px", fontSize: 13, color: C.muted }}>${money(spent)} of ${money(b.monthlyLimit)}</p>
            <div style={{ height: 8, borderRadius: 999, background: C.canvas, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: over ? C.red : pct > 80 ? C.amber : C.green, borderRadius: 999 }} />
            </div>
          </div>
        );
      })}

      {editing && (
        <SimpleSheet title="Set a budget" onClose={() => setEditing(null)}>
          <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category (e.g. Groceries)" style={sheetInput} />
          <input value={form.monthlyLimit} onChange={(e) => setForm((f) => ({ ...f, monthlyLimit: e.target.value }))} placeholder="Monthly limit" inputMode="decimal" style={sheetInput} />
          <button onClick={save} disabled={saving || !form.category.trim()}
            style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: (saving || !form.category.trim()) ? 0.6 : 1 }}>
            {saving ? "…" : "Save"}
          </button>
        </SimpleSheet>
      )}
    </div>
  );
}

// ── Goals ──────────────────────────────────────────────────
function GoalsTab() {
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: "", target: "", targetDate: "" });
  const [saving, setSaving] = useState(false);
  const [addFundsFor, setAddFundsFor] = useState(null);
  const [addAmount, setAddAmount] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setGoals((await api.goals()).goals || []); } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm({ name: "", target: "", targetDate: "" }); setEditing({}); };
  const save = async () => {
    setSaving(true); setErr("");
    try {
      await api.createGoal({ name: form.name.trim(), target: parseFloat(form.target) || 0, targetDate: form.targetDate || undefined });
      setEditing(null);
      await load();
    } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const remove = async (id) => { try { await api.deleteGoal(id); await load(); } catch (e) { setErr(e.message); } };
  const addFunds = async () => {
    const g = goals.find((x) => x.id === addFundsFor);
    const next = (g.current || 0) + (parseFloat(addAmount) || 0);
    try { await api.updateGoal(g.id, { current: next }); setAddFundsFor(null); setAddAmount(""); await load(); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <button onClick={openNew} style={{ ...bigBtn, background: C.brand, color: "#fff" }}><Plus size={17} /> Add a goal</button>
      {err && <p style={{ color: C.red, fontSize: 13 }}>{err}</p>}

      {loading ? <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p> : goals.length === 0 ? (
        <p style={{ color: C.muted, fontSize: 14, textAlign: "center", padding: "24px 0" }}>No goals yet.</p>
      ) : goals.map((g) => {
        const pct = g.target > 0 ? Math.min(100, ((g.current || 0) / g.target) * 100) : 0;
        return (
          <div key={g.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{g.name}</p>
              <button onClick={() => remove(g.id)} style={iconBtn}><Trash2 size={15} color={C.muted} /></button>
            </div>
            <p style={{ margin: "4px 0 8px", fontSize: 13, color: C.muted }}>
              ${money(g.current || 0)} of ${money(g.target)}{g.targetDate ? ` · by ${new Date(g.targetDate).toLocaleDateString()}` : ""}
            </p>
            <div style={{ height: 8, borderRadius: 999, background: C.canvas, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: C.brand, borderRadius: 999 }} />
            </div>
            {addFundsFor === g.id ? (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="Amount" inputMode="decimal" style={{ ...sheetInput, marginTop: 0, flex: 1 }} />
                <button onClick={addFunds} style={{ ...lightPill, background: C.brand, color: "#fff", border: "none" }}>Add</button>
              </div>
            ) : (
              <button onClick={() => { setAddFundsFor(g.id); setAddAmount(""); }} style={{ ...lightPill, marginTop: 10 }}>
                <Plus size={13} /> Add funds
              </button>
            )}
          </div>
        );
      })}

      {editing && (
        <SimpleSheet title="Add a goal" onClose={() => setEditing(null)}>
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Name (e.g. Emergency fund)" style={sheetInput} />
          <input value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} placeholder="Target amount" inputMode="decimal" style={sheetInput} />
          <input value={form.targetDate} onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))} type="date" style={sheetInput} />
          <button onClick={save} disabled={saving || !form.name.trim()}
            style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: (saving || !form.name.trim()) ? 0.6 : 1 }}>
            {saving ? "…" : "Save"}
          </button>
        </SimpleSheet>
      )}
    </div>
  );
}

// ── Insights ─────────────────────────────────────────────
function InsightsTab({ onGoTab }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.insights().then(setData).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  if (err) return <p style={{ color: C.red, fontSize: 13 }}>{err}</p>;
  if (!data) return null;

  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.amount));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <p style={sectionLabel}>This month</p>
        <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
          <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Spent</p><p style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>${money(data.thisMonth.spend)}</p></div>
          <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Income</p><p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.green }}>${money(data.thisMonth.income)}</p></div>
          <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Net</p><p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: data.thisMonth.net >= 0 ? C.green : C.red }}>{data.thisMonth.net >= 0 ? "+" : "−"}${money(Math.abs(data.thisMonth.net))}</p></div>
        </div>
      </div>

      <div style={card}>
        <p style={sectionLabel}>Spending by category</p>
        {data.byCategory.length === 0 && <p style={{ fontSize: 13, color: C.muted, marginTop: 8 }}>Nothing yet this month.</p>}
        {data.byCategory.map((c) => (
          <div key={c.category} style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
              <span>{c.category}</span><span style={{ fontWeight: 600 }}>${money(c.amount)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: C.canvas, marginTop: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(c.amount / maxCat) * 100}%`, background: C.brand, borderRadius: 999 }} />
            </div>
          </div>
        ))}
      </div>

      {data.monthOverMonth.length > 0 && (
        <div style={card}>
          <p style={sectionLabel}>Vs. last month</p>
          {data.monthOverMonth.map((c) => (
            <div key={c.category} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13.5 }}>
              <span>{c.category}</span>
              <span style={{ fontWeight: 600, color: c.delta > 0 ? C.red : c.delta < 0 ? C.green : C.muted }}>
                {c.delta > 0 ? "+" : ""}{money(c.delta)}
              </span>
            </div>
          ))}
        </div>
      )}

      {data.topNegotiableBills.length > 0 && (
        <div style={card}>
          <p style={sectionLabel}>Biggest opportunities</p>
          <p style={{ fontSize: 12.5, color: C.muted, margin: "6px 0 10px" }}>
            DealTough bill negotiation is coming soon.
          </p>
          {data.topNegotiableBills.map((b) => (
            <div key={b.id} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
              <span>{b.name}</span><span style={{ fontWeight: 600 }}>${money(b.amount)}</span>
            </div>
          ))}
          <button onClick={() => onGoTab("bills")} style={{ ...lightPill, marginTop: 8 }}>Manage bills <ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ── DealTough (savings / negotiation AI) ─────────────────
const DEAL_CATEGORIES = ["vehicle", "electronics", "tools", "furniture", "outdoor_equipment"];
const DEAL_CONDITIONS = ["New", "Like New", "Good", "Fair", "Poor"];
function DealsTab({ enabled }) {
  const [form, setForm] = useState({ category: "vehicle", title: "", askingPrice: "", condition: "Good" });
  const [comparables, setComparables] = useState([""]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  if (!enabled) {
    return (
      <div style={card}>
        <p style={{ margin: 0, fontSize: 14.5, color: C.muted }}>
          DealTough isn't connected on this deployment yet. Set <code>DEALTOUGH_API_URL</code> to enable "Can I get this cheaper?" purchase checks.
        </p>
      </div>
    );
  }

  const submit = async () => {
    setLoading(true); setErr(""); setResult(null);
    const payload = {
      category: form.category,
      title: form.title.trim(),
      askingPrice: parseFloat(form.askingPrice) || 0,
      condition: form.condition,
      comparables: comparables.map((c) => parseFloat(c)).filter((n) => !Number.isNaN(n)),
    };
    try { setResult(await api.dealtoughAnalyze(payload)); }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  };

  const knownKeys = ["verdict", "dealScore", "fairMarketValue"];
  const extraEntries = result ? Object.entries(result).filter(([k]) => !knownKeys.includes(k)) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <p style={sectionLabel}>Can I get this cheaper?</p>
        <p style={{ fontSize: 12.5, color: C.muted, margin: "6px 0 12px" }}>
          Checks a one-time purchase against DealTough's market comparables. Bill negotiation isn't available yet — see the Bills tab.
        </p>
        <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={{ ...sheetInput, marginTop: 0, appearance: "auto" }}>
          {DEAL_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
        </select>
        <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="What is it? (e.g. 2019 Honda CR-V)" style={sheetInput} />
        <input value={form.askingPrice} onChange={(e) => setForm((f) => ({ ...f, askingPrice: e.target.value }))} placeholder="Asking price" inputMode="decimal" style={sheetInput} />
        <select value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))} style={{ ...sheetInput, appearance: "auto" }}>
          {DEAL_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <p style={{ fontSize: 12.5, color: C.muted, marginTop: 12, marginBottom: 2 }}>Comparable listings you've seen (optional)</p>
        {comparables.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <input value={c} onChange={(e) => setComparables((arr) => arr.map((v, idx) => idx === i ? e.target.value : v))}
              placeholder="Price" inputMode="decimal" style={{ ...sheetInput, flex: 1 }} />
            {comparables.length > 1 && (
              <button onClick={() => setComparables((arr) => arr.filter((_, idx) => idx !== i))} style={{ ...iconBtn, marginTop: 8 }}>
                <Trash2 size={16} color={C.muted} />
              </button>
            )}
          </div>
        ))}
        <button onClick={() => setComparables((arr) => [...arr, ""])} style={{ ...lightPill, marginTop: 8 }}><Plus size={13} /> Add comparable</button>

        {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
        <button onClick={submit} disabled={loading || !form.title.trim()}
          style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: (loading || !form.title.trim()) ? 0.6 : 1 }}>
          {loading ? "Analyzing…" : "Analyze this deal"}
        </button>
      </div>

      {result && (
        <div style={card}>
          <p style={sectionLabel}>Result</p>
          {result.verdict && <p style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{result.verdict}</p>}
          <div style={{ display: "flex", gap: 18, marginTop: 6 }}>
            {result.dealScore != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Deal score</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{result.dealScore}</p></div>}
            {result.fairMarketValue != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Fair market value</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>${money(result.fairMarketValue)}</p></div>}
          </div>
          {extraEntries.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12.5, color: C.muted, cursor: "pointer" }}>Full response</summary>
              <pre style={{ fontSize: 11.5, background: C.canvas, borderRadius: 10, padding: 10, overflowX: "auto", marginTop: 8 }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main authenticated shell ─────────────────────────────
function Home({ initialAuthMode = "login" }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [cfg, setCfg] = useState({ plaidEnabled: false, dealtoughEnabled: false });
  const [tab, setTab] = useState("home");
  const [openGroupId, setOpenGroupId] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [totalDebt, setTotalDebt] = useState(0);
  const [insights, setInsights] = useState(null);
  const [topNegotiable, setTopNegotiable] = useState([]);

  // ── passkey enrollment prompt ─────────────────────────────
  // Shown once per account, on a device that supports it, until the user
  // either enables it or dismisses it — same dismissal-flag pattern as the
  // iOS install banner (useIosInstallPrompt above).
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(true); // default true so it never flashes before the real check lands
  const [enrollDismissed, setEnrollDismissed] = useState(localStorage.getItem("even_passkey_prompt_dismissed") === "1");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollErr, setEnrollErr] = useState("");

  useEffect(() => {
    window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setPasskeySupported).catch(() => {});
  }, []);

  const enrollPasskey = async () => {
    setEnrollBusy(true); setEnrollErr("");
    try {
      const { attemptId, options } = await api.passkeyRegOptions();
      const response = await startRegistration({ optionsJSON: options });
      await api.passkeyRegVerify({ attemptId, response, deviceLabel: navigator.platform || "This device" });
      setHasPasskey(true);
    } catch (e) {
      if (e?.name !== "NotAllowedError") setEnrollErr(e.message || "Couldn't turn that on. Please try again.");
    } finally { setEnrollBusy(false); }
  };
  const dismissEnroll = () => { localStorage.setItem("even_passkey_prompt_dismissed", "1"); setEnrollDismissed(true); };

  const loadOverview = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([api.accounts(), api.insights()]);
      setAccounts(a.accounts || []);
      setTotalAvailable(a.totalAvailable || 0);
      setTotalDebt(a.totalDebt || 0);
      setInsights({ thisMonth: i.thisMonth, byCategory: i.byCategory });
      setTopNegotiable(i.topNegotiableBills || []);
    } catch { /* accounts/insights are best-effort on the home screen */ }
  }, []);

  const refresh = useCallback(async () => {
    const { user } = await api.me();
    setUser(user);
    try { setHasPasskey((await api.passkeyCredentials()).credentials.length > 0); } catch {}
    await loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    (async () => {
      if (hasToken()) { try { await refresh(); } catch { setToken(null); } }
      try { setCfg(await api.config()); } catch {}
      setReady(true);
    })();
  }, [refresh]);

  const signOut = () => { setToken(null); setUser(null); };

  if (!ready) return <div style={{ minHeight: "100vh", background: pageBg }}>{fontStyle}</div>;
  if (!user) return <Auth onDone={(u) => { setUser(u); refresh(); }} initialMode={initialAuthMode} />;

  return (
    <div style={{ minHeight: "100vh", background: pageBg, display: "flex", justifyContent: "center",
      fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ width: "100%", maxWidth: 448, position: "relative", minHeight: "100vh" }}>

        <header style={{ padding: "24px 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: "-0.03em" }}>
            DoerTough<span style={{ color: C.brand }}>Money</span>
          </span>
          <button onClick={signOut} title="Sign out"
            style={{ width: 38, height: 38, borderRadius: 999, background: C.surface, border: `1px solid ${C.line}`,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LogOut size={16} />
          </button>
        </header>

        {/* Someone asking to be paid back outranks everything else on the screen. */}
        <ReminderBanners onOpenGroup={(id) => { setTab("shared"); setOpenGroupId(id); }} />

        {passkeySupported && !hasPasskey && !enrollDismissed && (
          <div style={{ margin: "12px 20px 0", padding: "12px 14px", borderRadius: 16, background: C.brandSoft, border: "1px solid #D9D4FB", display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 30, height: 30, borderRadius: 10, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Fingerprint size={16} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Turn on Face ID / Touch ID?</p>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{enrollErr || "Skip typing your password next time."}</p>
            </div>
            <button onClick={enrollPasskey} disabled={enrollBusy}
              style={{ border: "none", background: C.brand, color: "#fff", borderRadius: 10, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0, opacity: enrollBusy ? 0.6 : 1 }}>
              {enrollBusy ? "…" : "Enable"}
            </button>
            <button onClick={dismissEnroll} aria-label="Not now" style={{ ...iconBtn, color: C.muted, flexShrink: 0, padding: 2 }}>
              <X size={15} />
            </button>
          </div>
        )}

        <div className="tabrow" style={{ display: "flex", gap: 6, padding: "18px 20px 0", overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.k} onClick={() => { setTab(t.k); if (t.k !== "shared") setOpenGroupId(null); }}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
                border: `1.5px solid ${tab === t.k ? C.brand : C.line}`,
                background: tab === t.k ? C.brandSoft : C.surface,
                color: tab === t.k ? C.brand : C.ink,
              }}>
              <t.Icon size={14} /> {t.l}
            </button>
          ))}
        </div>

        <section style={{ padding: "18px 20px 40px" }}>
          {tab === "home" && (
            <HomeTab accounts={accounts} totalAvailable={totalAvailable} totalDebt={totalDebt}
              insights={insights} topNegotiable={topNegotiable} onGoTab={setTab} />
          )}
          {tab === "accounts" && <AccountsTab onChanged={loadOverview} />}
          {tab === "transactions" && <TransactionsTab />}
          {tab === "bills" && <BillsTab onGoTab={setTab} />}
          {tab === "budgets" && <BudgetsTab />}
          {tab === "goals" && <GoalsTab />}
          {tab === "insights" && <InsightsTab onGoTab={setTab} />}
          {tab === "deals" && <DealsTab enabled={!!cfg.dealtoughEnabled} />}
          {tab === "shared" && (
            openGroupId
              ? <GroupDetail groupId={openGroupId} onBack={() => setOpenGroupId(null)} onUserChanged={refresh} />
              : <GroupsList onOpen={setOpenGroupId} />
          )}
        </section>
      </div>
    </div>
  );
}

// ── Legal pages ───────────────────────────────────────────
// Placeholder copy — NOT reviewed by a lawyer.
function LegalPage({ title, updated, sections }) {
  return (
    <div style={{ minHeight: "100vh", background: pageBg, fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 60px" }}>
        <a href="/" style={{ color: C.brand, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>← Back to DoerToughMoney</a>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 30, fontWeight: 800, marginTop: 16, marginBottom: 4 }}>{title}</h1>
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>Last updated {updated}</p>
        <div style={{ background: "#FFF6E5", border: "1px solid #F0DDB0", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#8A6416", marginBottom: 24 }}>
          Template placeholder — this has not been reviewed by a lawyer. Replace with counsel-drafted terms before relying on it.
        </div>
        {sections.map(({ heading, body }) => (
          <section key={heading} style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{heading}</h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#3A3A44", margin: 0, whiteSpace: "pre-line" }}>{body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="August 2026" sections={[
      { heading: "1. What DoerToughMoney is", body: "DoerToughMoney is a personal finance app. You can link your bank accounts (via our provider, Plaid) to see balances and transactions, track bills, set budgets and goals, and use DealTough — our savings and negotiation feature — to check whether a purchase is a good deal. DoerToughMoney does not send, hold, or transmit money on your behalf and is not a money transmitter." },
      { heading: "2. Shared expenses", body: "You can track shared expenses with a group and record who owes whom. \"Settling up\" in DoerToughMoney simply records that a cash payment happened outside the app — DoerToughMoney does not move any money between users." },
      { heading: "3. Your account", body: "You must be at least 18 years old and provide accurate information when registering. You're responsible for keeping your password secure and for all activity on your account." },
      { heading: "4. Linked accounts", body: "When you connect a bank account, DoerToughMoney receives read-only account and transaction data through Plaid. We don't store your bank login credentials." },
      { heading: "5. DealTough", body: "DealTough purchase analysis is provided by a separate DealTough service and reflects its own market data and methodology. It's informational only, not financial advice, and we don't guarantee its accuracy." },
      { heading: "6. Prohibited use", body: "You agree not to use DoerToughMoney for illegal activity or fraud, or to try to circumvent these terms. We may suspend or close accounts that violate this." },
      { heading: "7. Limitation of liability", body: "DoerToughMoney is provided \"as is.\" To the extent permitted by law, we are not liable for indirect or consequential damages arising from your use of the service." },
      { heading: "8. Changes", body: "We may update these terms from time to time. Continued use of DoerToughMoney after changes take effect means you accept the updated terms." },
      { heading: "9. Contact", body: "Questions about these terms? Reach out via the contact details on our website." },
    ]} />
  );
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="August 2026" sections={[
      { heading: "1. What we collect", body: "Account info you give us (name, handle, email, password — stored as a salted hash, never in plain text). Bank account and transaction data from Plaid, if you choose to connect a bank. Bills, budgets, and goals you enter. Shared-expense data (who owes whom in a group). Technical data (IP address, device/browser info) for security and fraud prevention." },
      { heading: "2. How we use it", body: "To operate your account, show your balances/transactions/insights, run DealTough purchase checks you request, communicate with you about your account, detect and prevent fraud, and comply with legal obligations." },
      { heading: "3. Sharing", body: "We share what's necessary with Plaid to link and sync your bank accounts, and with DealTough to analyze a purchase you ask about. We don't sell your personal data to third parties." },
      { heading: "4. Your choices", body: "You can disconnect a linked bank account at any time from the Accounts tab. You can request a copy of your data or ask us to delete your account." },
      { heading: "5. Security", body: "Passwords are hashed with bcrypt. We don't store your bank login credentials — Plaid handles that connection directly. We use industry-standard practices to protect your data, but no system is 100% secure." },
      { heading: "6. Changes", body: "We may update this policy from time to time; continued use of DoerToughMoney after changes take effect means you accept the updated policy." },
      { heading: "7. Contact", body: "Questions about your data? Reach out via the contact details on our website." },
    ]} />
  );
}

export default function App() {
  const path = window.location.pathname;
  if (path === "/terms") return <TermsPage />;
  if (path === "/privacy") return <PrivacyPage />;
  const isSignup = path === "/signup" || new URLSearchParams(window.location.search).get("signup") === "1";
  return <>{<Home initialAuthMode={isSignup ? "register" : "login"} />}<IosInstallBanner /></>;
}
ng2, ShieldCheck, Share2, AlertCircle,
  Fingerprint,
} from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, setToken, hasToken } from "./api.js";
import { GroupsList, GroupDetail, ReminderBanners } from "./Groups.jsx";

const C = {
  ink: "#16151A", canvas: "#F1F1F5", surface: "#FFFFFF",
  brand: "#5B4DF5", brandSoft: "#ECEAFE", green: "#12A150",
  greenSoft: "#E4F5EC", amber: "#E8A33D", muted: "#7A7A86", line: "#E6E6EC",
};
// Soft brand-tinted blobs over the base canvas color, used on full-page wrappers.
const pageBg = `radial-gradient(900px circle at 12% -8%, ${C.brandSoft} 0%, transparent 55%), `
  + `radial-gradient(700px circle at 108% 105%, ${C.brandSoft} 0%, transparent 50%), ${C.canvas}`;
const AV = ["#5B4DF5", "#12A150", "#E8A33D", "#E5556E", "#2AA6C4", "#8B5CF6", "#EC6C3E"];
const initials = (n = "") => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const colorFor = (n = "") => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % AV.length; return AV[h]; };
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const KYC_LABEL = {
  PENDING: "Verification pending", VERIFIED: "Identity verified", RETRY: "Needs updated info",
  DOCUMENT: "ID document needed", SUSPENDED: "Account suspended",
};

const DISPUTE_LABEL = {
  FILED: "Dispute filed", INVESTIGATING: "Under investigation",
  PROVISIONAL_CREDIT_ISSUED: "Provisional credit issued",
  RESOLVED_UPHELD: "Dispute resolved in your favor", RESOLVED_DENIED: "Dispute denied",
};

const fontStyle = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700&family=Space+Mono:wght@700&display=swap');
    *{-webkit-tap-highlight-color:transparent;box-sizing:border-box}
    body{margin:0}
    .sheet-enter{animation:slideUp .28s cubic-bezier(.2,.8,.2,1)}
    @keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
    .pop{animation:pop .3s cubic-bezier(.2,.9,.3,1.3)}
    @keyframes pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
    @media (prefers-reduced-motion:reduce){.sheet-enter,.pop{animation:none}}
    button:focus-visible,input:focus-visible{outline:2px solid ${C.brand};outline-offset:2px}
    input{font-family:inherit}
  `}</style>
);

// ── iOS "Add to Home Screen" banner ──────────────────────
// iOS Safari has no install prompt API, so PWAs have to tell users
// to do it manually via the Share sheet.
function useIosInstallPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!crios|fxios|edgios|opios).)*safari/i.test(ua);
    const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    const dismissed = localStorage.getItem("even_ios_install_dismissed") === "1";
    setShow(isIos && isSafari && !isStandalone && !dismissed);
  }, []);
  const dismiss = () => { localStorage.setItem("even_ios_install_dismissed", "1"); setShow(false); };
  return [show, dismiss];
}

function IosInstallBanner() {
  const [show, dismiss] = useIosInstallPrompt();
  if (!show) return null;
  return (
    <div style={{
      position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 50, maxWidth: 420, margin: "0 auto",
      background: C.ink, color: "#fff", borderRadius: 16, padding: "14px 16px",
      display: "flex", alignItems: "center", gap: 12, boxShadow: "0 8px 24px rgba(0,0,0,.25)",
      fontFamily: "Inter, system-ui, sans-serif",
    }}>
      <Share2 size={20} style={{ flexShrink: 0, color: C.brand }} />
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.4, flex: 1 }}>
        Install even: tap <strong>Share</strong> below, then <strong>Add to Home Screen</strong>.
      </p>
      <button onClick={dismiss} aria-label="Dismiss"
        style={{ background: "transparent", border: "none", color: "#B9B9C6", cursor: "pointer", flexShrink: 0, padding: 4 }}>
        <X size={18} />
      </button>
    </div>
  );
}

// Opens the bank login as soon as it's ready. Mounted only after a link token
// has been fetched, so the user's click flows straight into their bank instead
// of stalling on a spinner. The token comes from Dwolla's Open Banking session,
// and success yields a funding source that's already verified — no
// micro-deposits, no waiting.
function BankLoginLauncher({ linkToken, onLinked, onError, onExit }) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      const account = metadata.accounts?.[0];
      try {
        const label = [metadata.institution?.name, account?.subtype].filter(Boolean).join(" ") || account?.name || "Bank";
        const { user } = await api.bankLinkComplete({
          publicToken,
          bankAccountType: account?.subtype === "savings" ? "savings" : "checking",
          name: label,
        });
        onLinked(user);
      } catch (e) { onError(e.message); }
    },
    onExit: (err) => onExit(err ? err.display_message || err.error_message : null),
  });

  useEffect(() => { if (ready) open(); }, [ready, open]);
  return null;
}

function Avatar({ name, size = 44 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 3, background: colorFor(name),
      fontSize: size * 0.34, color: "#fff", fontWeight: 600, letterSpacing: "-0.02em",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

// ── Auth screen ──────────────────────────────────────────
function Auth({ onDone, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  const [form, setForm] = useState({
    name: "", handle: "", email: "", password: "",
    address1: "", city: "", state: "", postalCode: "", dateOfBirth: "", ssn: "",
  });
  const [err, setErr] = useState("");
  // Which action is in flight, so the three sign-in paths (password, Google,
  // passkey) don't show each other's spinners.
  const [busy, setBusy] = useState(null); // null | "password" | "google" | "passkey"
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setErr(""); setBusy("password");
    try {
      const res = mode === "login"
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form);
      setToken(res.token);
      onDone(res.user);
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  // ── Sign in with Google ──────────────────────────────────
  // Additive: existing password accounts are untouched. A brand-new Google
  // user still has to complete identity verification — Google proves who
  // they are, not that they've passed KYC — so a first-time sign-in lands in
  // `pendingGoogle` and the form below switches to a short completion step
  // (handle + the same KYC fields registration already asks for).
  const [googleCfg, setGoogleCfg] = useState({ enabled: false, clientId: null });
  const [pendingGoogle, setPendingGoogle] = useState(null); // { idToken, name, email }
  const googleBtnRef = useRef(null);

  useEffect(() => {
    api.config().then((c) => setGoogleCfg({ enabled: !!c.googleEnabled, clientId: c.googleClientId })).catch(() => {});
  }, []);

  const handleGoogleCredential = useCallback(async (response) => {
    setErr(""); setBusy("google");
    try {
      const res = await api.googleAuth(response.credential);
      if (res.status === "ok") { setToken(res.token); onDone(res.user); }
      else setPendingGoogle({ idToken: response.credential, name: res.name, email: res.email });
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }, [onDone]);

  useEffect(() => {
    if (!googleCfg.enabled || !googleCfg.clientId || pendingGoogle) return;
    const render = () => {
      if (!window.google?.accounts?.id || !googleBtnRef.current) return;
      window.google.accounts.id.initialize({ client_id: googleCfg.clientId, callback: handleGoogleCredential });
      window.google.accounts.id.renderButton(googleBtnRef.current, {
        theme: "outline", size: "large", width: 336, text: mode === "login" ? "signin_with" : "signup_with",
      });
    };
    if (window.google?.accounts?.id) { render(); return; }
    // Loaded on demand, only once Google is actually configured, so the login
    // screen never fetches third-party JS it won't use.
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [googleCfg, mode, pendingGoogle, handleGoogleCredential]);

  const submitGoogleRegistration = async () => {
    setErr(""); setBusy("google");
    try {
      const res = await api.registerWithGoogle({
        idToken: pendingGoogle.idToken, handle: form.handle,
        address1: form.address1, city: form.city, state: form.state,
        postalCode: form.postalCode, dateOfBirth: form.dateOfBirth, ssn: form.ssn,
      });
      setToken(res.token);
      onDone(res.user);
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  // ── Face ID / Touch ID ────────────────────────────────────
  // Sign-in only — enrolling a passkey happens from inside the app once
  // already authenticated (see the prompt on the account card), so this
  // button only ever appears on the login side, never registration.
  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => {
    window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setCanPasskey).catch(() => {});
  }, []);

  const passkeySignIn = async () => {
    setErr(""); setBusy("passkey");
    try {
      const { attemptId, options } = await api.passkeyLoginOptions();
      const response = await startAuthentication({ optionsJSON: options });
      const res = await api.passkeyLoginVerify({ attemptId, response });
      setToken(res.token);
      onDone(res.user);
    } catch (e) {
      // The user cancelling the native picker throws NotAllowedError — that's
      // not a failure worth a red error message, just let them try something else.
      if (e?.name !== "NotAllowedError") setErr(e.message || "Couldn't sign in with that passkey.");
    } finally { setBusy(null); }
  };

  const inputStyle = {
    width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${C.line}`,
    background: C.surface, fontSize: 15, marginTop: 10,
  };

  /**
   * @param ph    placeholder — also the accessible label
   * @param opts  autoComplete lets password managers and browser autofill do the
   *              work on what is otherwise a ten-field form. `label` renders
   *              visible text above the input, which date fields need: type=date
   *              ignores placeholder entirely, so without it the user just sees
   *              mm/dd/yyyy with no idea which date is being asked for.
   */
  const field = (ph, k, type = "text", opts = {}) => {
    const { autoComplete, inputMode, label } = opts;
    return (
      <div style={{ marginTop: label ? 12 : 0 }}>
        {label && <label htmlFor={`f-${k}`} style={{ display: "block", fontSize: 12.5, color: C.muted, marginBottom: -2 }}>{label}</label>}
        <input
          id={`f-${k}`} value={form[k]} onChange={set(k)} placeholder={ph} type={type}
          aria-label={label || ph} autoComplete={autoComplete} inputMode={inputMode}
          style={inputStyle}
        />
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: pageBg, display: "flex", flexDirection: "column",
      justifyContent: "center", padding: 24, fontFamily: "Inter, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-0.03em" }}>
          even<span style={{ color: C.brand }}>.</span>
        </div>
        <p style={{ color: C.muted, fontSize: 15, marginTop: 4 }}>Settle up with anyone.</p>

        {pendingGoogle ? (
          // A brand-new Google account: name/email are already proven by
          // Google (shown, not editable), so this only asks for what Google
          // couldn't provide — a handle and the identity-verification fields
          // registration already collects.
          <div style={{ marginTop: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 14, background: C.brandSoft, marginBottom: 14 }}>
              <div style={{ width: 34, height: 34, borderRadius: 999, background: C.brand, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
                {pendingGoogle.name?.[0]?.toUpperCase() || "G"}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pendingGoogle.name}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pendingGoogle.email}</p>
              </div>
            </div>

            {field("Handle (e.g. @you)", "handle", "text", { autoComplete: "username" })}

            <p style={{ fontSize: 12, color: C.muted, marginTop: 22, marginBottom: -2, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Identity verification
            </p>
            <p style={{ fontSize: 12.5, color: C.muted, margin: "4px 0 0" }}>
              Required to send and receive money — even's payment partner runs a one-time identity check.
            </p>
            {field("Street address", "address1", "text", { autoComplete: "street-address" })}
            {field("City", "city", "text", { autoComplete: "address-level2" })}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>{field("State (e.g. CA)", "state", "text", { autoComplete: "address-level1" })}</div>
              <div style={{ flex: 1 }}>{field("ZIP", "postalCode", "text", { autoComplete: "postal-code", inputMode: "numeric" })}</div>
            </div>
            {field("", "dateOfBirth", "date", { autoComplete: "bday", label: "Date of birth" })}
            {field("000-00-0000", "ssn", "text", { inputMode: "numeric", label: "Social Security Number" })}
            <p style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Used once to verify your identity — never stored by even.</p>

            {err && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 10 }}>{err}</p>}
            <button onClick={submitGoogleRegistration} disabled={busy === "google"}
              style={{ width: "100%", marginTop: 16, padding: 15, borderRadius: 14, border: "none",
                background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy === "google" ? 0.6 : 1 }}>
              {busy === "google" ? "…" : "Finish creating account"}
            </button>
            <button onClick={() => { setErr(""); setPendingGoogle(null); }}
              style={{ marginTop: 12, width: "100%", background: "none", border: "none", color: C.muted, fontSize: 14 }}>
              Cancel
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 26 }}>
            {/* Faster paths back in. Passkeys are sign-in only — enrolling one
                happens from inside the app once already authenticated. */}
            {mode === "login" && canPasskey && (
              <button onClick={passkeySignIn} disabled={busy === "passkey"}
                style={{ width: "100%", padding: 13, borderRadius: 14, border: `1px solid ${C.line}`, background: C.surface,
                  color: C.ink, fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  cursor: "pointer", opacity: busy === "passkey" ? 0.6 : 1 }}>
                <Fingerprint size={18} /> {busy === "passkey" ? "…" : "Sign in with Face ID / Touch ID"}
              </button>
            )}
            {googleCfg.enabled && (
              <div ref={googleBtnRef} style={{ display: "flex", justifyContent: "center", marginTop: mode === "login" && canPasskey ? 10 : 0 }} />
            )}
            {(canPasskey && mode === "login" || googleCfg.enabled) && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
                <div style={{ flex: 1, height: 1, background: C.line }} />
                <span style={{ fontSize: 12, color: C.muted }}>or</span>
                <div style={{ flex: 1, height: 1, background: C.line }} />
              </div>
            )}

            {mode === "register" && (<>
              {field("Full name", "name", "text", { autoComplete: "name" })}
              {field("Handle (e.g. @you)", "handle", "text", { autoComplete: "username" })}
            </>)}
            {field("Email", "email", "email", { autoComplete: "email" })}
            {field("Password", "password", "password", { autoComplete: mode === "register" ? "new-password" : "current-password" })}

            {mode === "register" && (<>
              <p style={{ fontSize: 12, color: C.muted, marginTop: 22, marginBottom: -2, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Identity verification
              </p>
              <p style={{ fontSize: 12.5, color: C.muted, margin: "4px 0 0" }}>
                Required to send and receive money — even's payment partner runs a one-time identity check.
              </p>
              {field("Street address", "address1", "text", { autoComplete: "street-address" })}
              {field("City", "city", "text", { autoComplete: "address-level2" })}
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>{field("State (e.g. CA)", "state", "text", { autoComplete: "address-level1" })}</div>
                <div style={{ flex: 1 }}>{field("ZIP", "postalCode", "text", { autoComplete: "postal-code", inputMode: "numeric" })}</div>
              </div>
              {/* Needs a visible label — date inputs ignore placeholder, so this
                  would otherwise read as a bare mm/dd/yyyy. */}
              {field("", "dateOfBirth", "date", { autoComplete: "bday", label: "Date of birth" })}
              {field("000-00-0000", "ssn", "text", { inputMode: "numeric", label: "Social Security Number" })}
              <p style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Used once to verify your identity — never stored by even.</p>
            </>)}

            {err && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 10 }}>{err}</p>}
            <button onClick={submit} disabled={!!busy}
              style={{ width: "100%", marginTop: 16, padding: 15, borderRadius: 14, border: "none",
                background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy ? 0.6 : 1 }}>
              {busy === "password" ? "…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </div>
        )}

        {!pendingGoogle && (
          <button onClick={() => { setErr(""); setMode(mode === "login" ? "register" : "login"); }}
            style={{ marginTop: 18, background: "none", border: "none", color: C.muted, fontSize: 14 }}>
            {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
          </button>
        )}

        <p style={{ marginTop: 28, fontSize: 12, color: C.muted, textAlign: "center" }}>
          By continuing you agree to our{" "}
          <a href="/terms" style={{ color: C.muted, textDecoration: "underline" }}>Terms</a>{" "}
          and{" "}
          <a href="/privacy" style={{ color: C.muted, textDecoration: "underline" }}>Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

// ── Wallet ───────────────────────────────────────────────
function Wallet({ initialAuthMode = "login" }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feeCfg, setFeeCfg] = useState({
    feeBps: 0, feeFlatCents: 0, feeCapCents: null,
    expediteOffered: false, expediteFeeBps: 0, expediteFeeFlatCents: 0, expediteFeeCapCents: null,
    instantLinkEnabled: false,
  });
  const [speed, setSpeed] = useState("STANDARD");
  const [tab, setTab] = useState("activity");
  const [openGroupId, setOpenGroupId] = useState(null);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("who");
  const [mode, setMode] = useState("pay");
  const [target, setTarget] = useState(null);
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);

  const [disputes, setDisputes] = useState([]);

  // ── passkey enrollment prompt ─────────────────────────────
  // Shown once per account, on a device that supports it, until the user
  // either enables it or dismisses it — same dismissal-flag pattern as the
  // iOS install banner (useIosInstallPrompt above).
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(true); // default true so it never flashes before the real check lands
  const [enrollDismissed, setEnrollDismissed] = useState(localStorage.getItem("even_passkey_prompt_dismissed") === "1");
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [enrollErr, setEnrollErr] = useState("");

  useEffect(() => {
    window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()
      .then(setPasskeySupported).catch(() => {});
  }, []);

  const enrollPasskey = async () => {
    setEnrollBusy(true); setEnrollErr("");
    try {
      const { attemptId, options } = await api.passkeyRegOptions();
      const response = await startRegistration({ optionsJSON: options });
      await api.passkeyRegVerify({ attemptId, response, deviceLabel: navigator.platform || "This device" });
      setHasPasskey(true);
    } catch (e) {
      if (e?.name !== "NotAllowedError") setEnrollErr(e.message || "Couldn't turn that on. Please try again.");
    } finally { setEnrollBusy(false); }
  };
  const dismissEnroll = () => { localStorage.setItem("even_passkey_prompt_dismissed", "1"); setEnrollDismissed(true); };

  const refresh = useCallback(async () => {
    const [{ user }, { feed }] = await Promise.all([api.me(), api.feed()]);
    setUser(user); setFeed(feed);
    try { setDisputes((await api.disputes()).disputes); } catch {}
    try { setHasPasskey((await api.passkeyCredentials()).credentials.length > 0); } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      if (hasToken()) { try { await refresh(); } catch { setToken(null); } }
      try { setFeeCfg(await api.config()); } catch {}
      setReady(true);
    })();
  }, [refresh]);

  // load contacts when the picker opens / query changes
  useEffect(() => {
    if (!open || step !== "who") return;
    let live = true;
    api.users(query).then(({ users }) => live && setPeople(users)).catch(() => {});
    return () => { live = false; };
  }, [open, step, query]);

  const amountNum = parseFloat(amount) || 0;
  // Mirrors computeFee on the server so the sender sees the real number first.
  const previewFee = (bps, flat, cap) => {
    const cents = Math.round(amountNum * 100);
    if (cents <= 0) return 0;
    let fee = Math.round((cents * (bps || 0)) / 10000) + (flat || 0);
    if (cap != null) fee = Math.min(fee, cap);
    return Math.max(0, fee) / 100;
  };
  const baseFeePreview = mode === "pay" ? previewFee(feeCfg.feeBps, feeCfg.feeFlatCents, feeCfg.feeCapCents) : 0;
  const expediteFeePreview = mode === "pay"
    ? previewFee(feeCfg.expediteFeeBps, feeCfg.expediteFeeFlatCents, feeCfg.expediteFeeCapCents) : 0;
  const feePreview = baseFeePreview + (speed === "EXPRESS" ? expediteFeePreview : 0);
  const showSpeedPicker = mode === "pay" && feeCfg.expediteOffered && target?.canReceive;
  const payEligible = user?.kycStatus === "VERIFIED" && user?.bankVerified;
  const start = (m) => { setMode(m); setStep("who"); setTarget(null); setAmount("0"); setNote(""); setQuery(""); setError(""); setSpeed("STANDARD"); setOpen(true); };
  const press = (k) => {
    setError("");
    setAmount((p) => {
      if (k === "del") { const n = p.slice(0, -1); return n === "" ? "0" : n; }
      if (k === ".") return p.includes(".") ? p : p + ".";
      if (p.includes(".") && p.split(".")[1].length >= 2) return p;
      if (p === "0" && k !== ".") return k;
      return p + k;
    });
  };

  const submit = async () => {
    if (amountNum <= 0) return setError("Enter an amount above $0.");
    setBusy(true); setError("");
    try {
      const body = { handle: target.handle, amount: amountNum, note: note.trim() };
      let paidFee = 0;
      let usedInstant = false;
      if (mode === "pay") {
        const r = await api.pay({ ...body, speed });
        paidFee = (r.feeCents || 0) / 100;
        usedInstant = !!r.usedInstant;
      } else await api.request(body);
      setLast({ mode, who: target.name, amount: amountNum, fee: paidFee, speed, usedInstant, note: note.trim() || (mode === "pay" ? "payment" : "request") });
      await refresh();
      setStep("done");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  // ── disputes ────────────────────────────────────────────
  const disputeFor = (transferId) => disputes.find((d) => d.transferId === transferId);
  const [txnSheet, setTxnSheet] = useState(null); // the feed row being viewed
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeBusy, setDisputeBusy] = useState(false);
  const [disputeErr, setDisputeErr] = useState("");
  const [disputeFiling, setDisputeFiling] = useState(false);

  const openTxn = (t) => { setTxnSheet(t); setDisputeReason(""); setDisputeErr(""); setDisputeFiling(false); };
  const submitDispute = async () => {
    setDisputeBusy(true); setDisputeErr("");
    try {
      await api.fileDispute({ transferId: txnSheet.id, reason: disputeReason });
      setDisputes((await api.disputes()).disputes);
      setTxnSheet(null);
    } catch (e) { setDisputeErr(e.message); } finally { setDisputeBusy(false); }
  };

  // ── identity verification for pre-migration accounts ──
  const [idOpen, setIdOpen] = useState(false);
  const [idForm, setIdForm] = useState({ address1: "", city: "", state: "", postalCode: "", dateOfBirth: "", ssn: "" });
  const [idBusy, setIdBusy] = useState(false);
  const [idErr, setIdErr] = useState("");

  const openIdentity = () => { setIdForm({ address1: "", city: "", state: "", postalCode: "", dateOfBirth: "", ssn: "" }); setIdErr(""); setIdOpen(true); };
  const submitIdentity = async () => {
    setIdBusy(true); setIdErr("");
    try { const { user } = await api.verifyIdentity(idForm); setUser(user); setIdOpen(false); }
    catch (e) { setIdErr(e.message); } finally { setIdBusy(false); }
  };

  // ── bank linking (manual routing/account + micro-deposits) ──
  const [bankOpen, setBankOpen] = useState(false);
  const [bankForm, setBankForm] = useState({ routingNumber: "", accountNumber: "", bankAccountType: "checking", name: "" });
  const [bankBusy, setBankBusy] = useState(false);
  const [bankErr, setBankErr] = useState("");

  // "choose" offers instant vs manual; "manual" is the routing/account form.
  const [bankMode, setBankMode] = useState("choose");
  const [bankLinkToken, setBankLinkToken] = useState(null);

  const openBankLink = () => {
    setBankForm({ routingNumber: "", accountNumber: "", bankAccountType: "checking", name: "" });
    setBankErr(""); setBankLinkToken(null);
    setBankMode(feeCfg.instantLinkEnabled ? "choose" : "manual");
    setBankOpen(true);
  };
  const startInstantLink = async () => {
    setBankBusy(true); setBankErr("");
    try { setBankLinkToken((await api.bankLinkStart()).linkToken); }
    catch (e) { setBankErr(e.message); } finally { setBankBusy(false); }
  };
  const submitBankLink = async () => {
    setBankBusy(true); setBankErr("");
    try { await api.bankLink(bankForm); await refresh(); setBankOpen(false); }
    catch (e) { setBankErr(e.message); } finally { setBankBusy(false); }
  };

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyForm, setVerifyForm] = useState({ amount1: "", amount2: "" });
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyErr, setVerifyErr] = useState("");

  const openVerify = () => { setVerifyForm({ amount1: "", amount2: "" }); setVerifyErr(""); setVerifyOpen(true); };
  const submitVerify = async () => {
    setVerifyBusy(true); setVerifyErr("");
    try { const { user } = await api.bankVerify(verifyForm); setUser(user); setVerifyOpen(false); }
    catch (e) { setVerifyErr(e.message); } finally { setVerifyBusy(false); }
  };

  const signOut = () => { setToken(null); setUser(null); setFeed([]); };

  if (!ready) return <div style={{ minHeight: "100vh", background: pageBg }}>{fontStyle}</div>;
  if (!user) return <Auth onDone={(u) => { setUser(u); refresh(); }} initialMode={initialAuthMode} />;

  const bankStatusLabel = !user.hasBank ? "No bank linked" : user.bankVerified ? "Bank linked ✓" : "Verify your bank";

  return (
    <div style={{ minHeight: "100vh", background: pageBg, display: "flex", justifyContent: "center",
      fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ width: "100%", maxWidth: 448, position: "relative", minHeight: "100vh" }}>

        <header style={{ padding: "24px 20px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: "-0.03em" }}>
            even<span style={{ color: C.brand }}>.</span>
          </span>
          <button onClick={signOut} title="Sign out"
            style={{ width: 38, height: 38, borderRadius: 999, background: C.surface, border: `1px solid ${C.line}`,
              display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LogOut size={16} />
          </button>
        </header>

        <section style={{ padding: "8px 20px 0" }}>
          <div style={{ borderRadius: 24, padding: 20, background: C.ink, color: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "#B9B9C6", fontSize: 13, fontWeight: 500 }}>Account status</span>
              <span style={{ color: "#B9B9C6", fontSize: 12.5 }}>{user.handle}</span>
            </div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={18} color={user.kycStatus === "VERIFIED" ? C.green : C.amber} />
              <span style={{ fontSize: 16, fontWeight: 700 }}>{KYC_LABEL[user.kycStatus] || user.kycStatus}</span>
            </div>
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
              <Building2 size={18} color={user.bankVerified ? C.green : C.amber} />
              <span style={{ fontSize: 14.5, color: "#D8D8E2" }}>{bankStatusLabel}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              {user.kycStatus !== "VERIFIED" && (
                <button onClick={openIdentity} style={pill}><ShieldCheck size={14} /> Verify identity</button>
              )}
              {user.kycStatus === "VERIFIED" && !user.hasBank && (
                <button onClick={openBankLink} style={pill}><Building2 size={14} /> Link bank</button>
              )}
              {user.hasBank && !user.bankVerified && (
                <button onClick={openVerify} style={pill}><Check size={14} /> Verify bank</button>
              )}
            </div>
          </div>

          {!payEligible && (
            <p style={{ fontSize: 12.5, color: C.muted, marginTop: 10, textAlign: "center" }}>
              {user.kycStatus !== "VERIFIED" ? "Finish identity verification" : "Link and verify a bank"} to send money.
            </p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            {/* De-emphasized until sending is actually possible, so the visual
                weight sits on the verification step rather than inviting a tap
                that dead-ends. */}
            <button onClick={() => start("pay")}
              style={payEligible
                ? { ...bigBtn, background: C.brand, color: "#fff" }
                : { ...bigBtn, background: C.surface, color: C.muted, border: `1px solid ${C.line}` }}>
              <ArrowUpRight size={19} /> Pay
            </button>
            <button onClick={() => start("request")} style={{ ...bigBtn, background: C.surface, color: C.ink, border: `1px solid ${C.line}` }}>
              <ArrowDownLeft size={19} /> Request
            </button>
          </div>
        </section>

        {/* Someone asking to be paid outranks everything else on the screen. */}
        <ReminderBanners onOpenGroup={(id) => { setTab("shared"); setOpenGroupId(id); }} />

        {passkeySupported && !hasPasskey && !enrollDismissed && (
          <div style={{ margin: "12px 20px 0", padding: "12px 14px", borderRadius: 16, background: C.brandSoft, border: "1px solid #D9D4FB", display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 30, height: 30, borderRadius: 10, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Fingerprint size={16} color="#fff" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>Turn on Face ID / Touch ID?</p>
              <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{enrollErr || "Skip typing your password next time."}</p>
            </div>
            <button onClick={enrollPasskey} disabled={enrollBusy}
              style={{ border: "none", background: C.brand, color: "#fff", borderRadius: 10, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0, opacity: enrollBusy ? 0.6 : 1 }}>
              {enrollBusy ? "…" : "Enable"}
            </button>
            <button onClick={dismissEnroll} aria-label="Not now" style={{ ...iconBtn, color: C.muted, flexShrink: 0, padding: 2 }}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* Activity vs shared expenses. Groups get equal billing with the
            payment feed because that's the reason to be here. */}
        <div style={{ display: "flex", gap: 6, padding: "18px 20px 0" }}>
          {[{ k: "activity", l: "Activity" }, { k: "shared", l: "Shared" }].map((t) => (
            <button key={t.k} onClick={() => { setTab(t.k); setOpenGroupId(null); }}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
                border: `1.5px solid ${tab === t.k ? C.brand : C.line}`,
                background: tab === t.k ? C.brandSoft : C.surface,
                color: tab === t.k ? C.brand : C.ink,
              }}>{t.l}</button>
          ))}
        </div>

        {tab === "shared" && (
          openGroupId
            ? <GroupDetail groupId={openGroupId} onBack={() => setOpenGroupId(null)} onUserChanged={refresh} />
            : <GroupsList onOpen={setOpenGroupId} />
        )}

        {tab === "activity" && (
        <section style={{ padding: "24px 20px 32px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Activity</h2>
          <div style={{ marginTop: 8 }}>
            {feed.length === 0 && <p style={{ color: C.muted, fontSize: 14, padding: "24px 0" }}>Nothing yet. Pay someone to get started.</p>}
            {feed.map((t) => {
              const d = t.kind === "pay" ? disputeFor(t.id) : null;
              const isPay = t.kind === "pay";
              return (
                <div key={t.id} onClick={isPay ? () => openTxn(t) : undefined}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}`, cursor: isPay ? "pointer" : "default" }}>
                  <Avatar name={t.who} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {t.dir === "in" ? t.who
                        : t.dir === "requested" ? `You requested ${t.who}` : t.dir === "request_due" ? `${t.who} requested you` : `You paid ${t.who}`}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: d ? C.amber : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d ? DISPUTE_LABEL[d.status] : <>{t.note}{t.status === "PENDING" ? " · pending" : t.status === "FAILED" ? " · failed" : t.status === "RETURNED" ? " · returned" : ""}</>}
                    </p>
                  </div>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14.5,
                    color: t.dir === "in" ? C.green : (t.dir === "requested" || t.dir === "request_due") ? C.amber : C.ink }}>
                    {t.dir === "in" ? "+" : (t.dir === "requested" || t.dir === "request_due") ? "" : "−"}${money(t.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {txnSheet && (() => {
          const d = disputeFor(txnSheet.id);
          return (
            <div onClick={() => setTxnSheet(null)}
              style={{ position: "absolute", inset: 0, zIndex: 25, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
              <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
                style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>Payment details</span>
                  <button onClick={() => setTxnSheet(null)} style={iconBtn}><X size={22} /></button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
                  <Avatar name={txnSheet.who} size={40} />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                      {txnSheet.dir === "in" ? `From ${txnSheet.who}` : `To ${txnSheet.who}`}
                    </p>
                    <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{txnSheet.handle} · {txnSheet.status.toLowerCase()}</p>
                  </div>
                  <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 17 }}>${money(txnSheet.amount)}</span>
                </div>
                {txnSheet.note && <p style={{ fontSize: 14, color: C.muted, marginTop: 10 }}>{txnSheet.note}</p>}

                {d ? (
                  <div style={{ marginTop: 16, background: "#FFF6E5", border: "1px solid #F0DDB0", borderRadius: 12, padding: "12px 14px" }}>
                    <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#8A6416" }}>{DISPUTE_LABEL[d.status]}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "#8A6416" }}>
                      Filed {new Date(d.filedAt).toLocaleDateString()}. {d.resolutionNote || "We'll follow up within 10 business days."}
                    </p>
                  </div>
                ) : !disputeFiling ? (
                  <button onClick={() => setDisputeFiling(true)}
                    style={{ width: "100%", marginTop: 18, padding: 13, borderRadius: 14, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontWeight: 600, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
                    <AlertCircle size={16} /> Report a problem
                  </button>
                ) : (
                  <div style={{ marginTop: 16 }}>
                    <label style={{ fontSize: 12.5, color: C.muted }}>What went wrong?</label>
                    <textarea value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)} rows={3}
                      placeholder="e.g. I didn't authorize this payment"
                      style={{ ...sheetInput, resize: "vertical", fontFamily: "inherit" }} />
                    <p style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>
                      We have 10 business days to investigate. You'll get a provisional credit if it takes longer.
                    </p>
                    {disputeErr && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 8 }}>{disputeErr}</p>}
                    <button onClick={submitDispute} disabled={disputeBusy || disputeReason.trim().length < 3}
                      style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 14, border: "none", background: C.ink, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: (disputeBusy || disputeReason.trim().length < 3) ? 0.5 : 1 }}>
                      {disputeBusy ? "…" : "Submit dispute"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {idOpen && (
          <div onClick={() => setIdOpen(false)}
            style={{ position: "absolute", inset: 0, zIndex: 25, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
            <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
              style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Verify your identity</span>
                <button onClick={() => setIdOpen(false)} style={iconBtn}><X size={22} /></button>
              </div>
              <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
                One-time check run by our payment partner. Your SSN is used only for verification — never stored by even.
              </p>
              <div style={{ marginTop: 10 }}>
                <input value={idForm.address1} onChange={(e) => setIdForm((f) => ({ ...f, address1: e.target.value }))} placeholder="Street address" style={sheetInput} />
                <input value={idForm.city} onChange={(e) => setIdForm((f) => ({ ...f, city: e.target.value }))} placeholder="City" style={sheetInput} />
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={idForm.state} onChange={(e) => setIdForm((f) => ({ ...f, state: e.target.value }))} placeholder="State (e.g. CA)" style={{ ...sheetInput, flex: 1 }} />
                  <input value={idForm.postalCode} onChange={(e) => setIdForm((f) => ({ ...f, postalCode: e.target.value }))} placeholder="ZIP" inputMode="numeric" style={{ ...sheetInput, flex: 1 }} />
                </div>
                <input value={idForm.dateOfBirth} onChange={(e) => setIdForm((f) => ({ ...f, dateOfBirth: e.target.value }))} placeholder="Date of birth" type="date" style={sheetInput} />
                <input value={idForm.ssn} onChange={(e) => setIdForm((f) => ({ ...f, ssn: e.target.value }))} placeholder="Social Security Number" inputMode="numeric" style={sheetInput} />
                {idErr && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 8 }}>{idErr}</p>}
                <button onClick={submitIdentity} disabled={idBusy}
                  style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: idBusy ? 0.6 : 1 }}>
                  {idBusy ? "…" : "Verify"}
                </button>
              </div>
            </div>
          </div>
        )}

        {bankOpen && (
          <div onClick={() => setBankOpen(false)}
            style={{ position: "absolute", inset: 0, zIndex: 25, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
            <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
              style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>
                  {bankMode === "choose" ? "Add your bank" : "Enter account details"}
                </span>
                <button onClick={() => setBankOpen(false)} style={iconBtn}><X size={22} /></button>
              </div>

              {bankLinkToken && (
                <BankLoginLauncher
                  linkToken={bankLinkToken}
                  onLinked={(u) => { setUser(u); setBankLinkToken(null); setBankOpen(false); refresh(); }}
                  onError={(m) => { setBankLinkToken(null); setBankErr(m); }}
                  onExit={(m) => { setBankLinkToken(null); if (m) setBankErr(m); }}
                />
              )}

              {bankMode === "choose" ? (
                <div style={{ marginTop: 6 }}>
                  <p style={{ fontSize: 12.5, color: C.muted, marginTop: 0 }}>
                    Sign in to your bank and you're ready to send money in about a minute.
                  </p>
                  {bankErr && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 8 }}>{bankErr}</p>}
                  <button onClick={startInstantLink} disabled={bankBusy}
                    style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: bankBusy ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                    <Building2 size={17} /> {bankBusy ? "Opening…" : "Connect your bank"}
                  </button>
                  <button onClick={() => { setBankErr(""); setBankMode("manual"); }}
                    style={{ width: "100%", marginTop: 10, padding: 10, background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
                    Can't find your bank? Enter account numbers instead
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 6 }}>
                  <p style={{ fontSize: 12.5, color: C.muted, marginTop: 0 }}>
                    We'll send two small deposits to confirm it's yours — that takes 1–2 business days.
                  </p>
                  <input value={bankForm.name} onChange={(e) => setBankForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nickname (e.g. Checking)"
                    style={sheetInput} />
                  <input value={bankForm.routingNumber} onChange={(e) => setBankForm((f) => ({ ...f, routingNumber: e.target.value }))} placeholder="Routing number" inputMode="numeric"
                    style={sheetInput} />
                  <input value={bankForm.accountNumber} onChange={(e) => setBankForm((f) => ({ ...f, accountNumber: e.target.value }))} placeholder="Account number" inputMode="numeric"
                    style={sheetInput} />
                  <select value={bankForm.bankAccountType} onChange={(e) => setBankForm((f) => ({ ...f, bankAccountType: e.target.value }))}
                    style={{ ...sheetInput, appearance: "auto" }}>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                  </select>
                  {bankErr && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 8 }}>{bankErr}</p>}
                  <button onClick={submitBankLink} disabled={bankBusy}
                    style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: bankBusy ? 0.6 : 1 }}>
                    {bankBusy ? "…" : "Link bank"}
                  </button>
                  {feeCfg.instantLinkEnabled && (
                    <button onClick={() => { setBankErr(""); setBankMode("choose"); }}
                      style={{ width: "100%", marginTop: 10, padding: 10, background: "none", border: "none", color: C.muted, fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>
                      Sign in to your bank instead (faster)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {verifyOpen && (
          <div onClick={() => setVerifyOpen(false)}
            style={{ position: "absolute", inset: 0, zIndex: 25, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
            <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
              style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Verify your bank</span>
                <button onClick={() => setVerifyOpen(false)} style={iconBtn}><X size={22} /></button>
              </div>
              <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
                Enter the two small deposit amounts from your bank statement (e.g. 0.03 and 0.09).
              </p>
              <div style={{ marginTop: 10 }}>
                <input value={verifyForm.amount1} onChange={(e) => setVerifyForm((f) => ({ ...f, amount1: e.target.value }))} placeholder="Amount 1 (e.g. 0.03)" inputMode="decimal"
                  style={sheetInput} />
                <input value={verifyForm.amount2} onChange={(e) => setVerifyForm((f) => ({ ...f, amount2: e.target.value }))} placeholder="Amount 2 (e.g. 0.09)" inputMode="decimal"
                  style={sheetInput} />
                {verifyErr && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 8 }}>{verifyErr}</p>}
                <button onClick={submitVerify} disabled={verifyBusy}
                  style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: verifyBusy ? 0.6 : 1 }}>
                  {verifyBusy ? "…" : "Verify"}
                </button>
              </div>
            </div>
          </div>
        )}

        {open && (
          <div onClick={() => setOpen(false)}
            style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", flexDirection: "column",
              justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
            <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
              style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "94%", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 8px" }}>
                {step === "amount"
                  ? <button onClick={() => setStep("who")} style={iconBtn}><ArrowLeft size={22} /></button>
                  : <span style={{ width: 24 }} />}
                <span style={{ fontWeight: 700, fontSize: 15 }}>{step === "done" ? "" : mode === "pay" ? "Pay someone" : "Request money"}</span>
                <button onClick={() => setOpen(false)} style={iconBtn}><X size={22} /></button>
              </div>

              {step === "who" && (
                <div style={{ padding: "4px 20px 24px", overflowY: "auto" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 16, padding: "12px 14px", background: C.canvas }}>
                    <Search size={18} color={C.muted} />
                    <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or @handle"
                      style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 15 }} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    {people.map((c) => (
                      <button key={c.id} onClick={() => { setTarget(c); setStep("amount"); }}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 0", background: "none", border: "none", textAlign: "left" }}>
                        <Avatar name={c.name} />
                        <div><p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{c.name}</p>
                          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>{c.handle}</p></div>
                      </button>
                    ))}
                    {people.length === 0 && <p style={{ textAlign: "center", padding: "32px 0", color: C.muted, fontSize: 14 }}>No one to show yet.</p>}
                  </div>
                </div>
              )}

              {step === "amount" && mode === "pay" && !payEligible && (
                <div style={{ padding: "24px 24px 40px", textAlign: "center" }}>
                  <p style={{ color: C.muted, fontSize: 14.5 }}>
                    {user.kycStatus !== "VERIFIED"
                      ? "Finish identity verification before sending money."
                      : "Link and verify a bank account before sending money."}
                  </p>
                  <button onClick={() => setOpen(false)} style={{ borderRadius: 16, padding: 14, marginTop: 16, width: "100%", border: "none", background: C.ink, color: "#fff", fontWeight: 700, fontSize: 15.5 }}>Got it</button>
                </div>
              )}

              {step === "amount" && (mode !== "pay" || payEligible) && (
                <div style={{ padding: "4px 20px 24px", display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginTop: 4 }}>
                    <Avatar name={target.name} size={30} />
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{mode === "pay" ? "To" : "From"} {target.name}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 24, marginBottom: 4 }}>
                    <span style={{ fontSize: 30, fontWeight: 700, marginBottom: 8, color: amountNum ? C.ink : C.muted }}>$</span>
                    <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 60, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1, color: amountNum ? C.ink : C.muted }}>{amount}</span>
                  </div>
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's it for? 🍕"
                    style={{ textAlign: "center", border: "none", outline: "none", margin: "4px auto 0", borderRadius: 999, padding: "8px 16px", fontSize: 14, background: C.canvas, width: "80%" }} />
                  {showSpeedPicker && (
                    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                      {[
                        { key: "STANDARD", title: "Standard", sub: "1–3 business days", cost: "Free" },
                        {
                          key: "EXPRESS",
                          title: target.instantEligible ? "Instant" : "Express",
                          sub: target.instantEligible ? "Arrives in minutes" : "Same business day",
                          cost: amountNum > 0 ? `$${money(expediteFeePreview)}` : "—",
                        },
                      ].map((o) => {
                        const on = speed === o.key;
                        return (
                          <button key={o.key} onClick={() => setSpeed(o.key)}
                            style={{
                              flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 14, cursor: "pointer",
                              border: `1.5px solid ${on ? C.brand : C.line}`,
                              background: on ? C.brandSoft : C.surface,
                            }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: on ? C.brand : C.ink }}>{o.title}</div>
                            <div style={{ fontSize: 11.5, color: C.muted, marginTop: 1 }}>{o.sub}</div>
                            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3, color: on ? C.brand : C.muted }}>{o.cost}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {mode === "pay" && feePreview > 0 && amountNum > 0 && (
                    <p style={{ textAlign: "center", marginTop: 8, fontSize: 12.5, color: C.muted }}>
                      They receive ${money(amountNum)} · ${money(feePreview)} fee · you pay ${money(amountNum + feePreview)}
                    </p>
                  )}
                  {error && <p style={{ textAlign: "center", marginTop: 12, color: "#E5556E", fontSize: 13, fontWeight: 500 }}>{error}</p>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, marginTop: 16 }}>
                    {["1","2","3","4","5","6","7","8","9",".","0","del"].map((k) => (
                      <button key={k} onClick={() => press(k)} style={{ height: 54, border: "none", background: "none", fontSize: 23, fontWeight: 600, fontFamily: "'Space Mono',monospace", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {k === "del" ? <Delete size={22} /> : k}
                      </button>
                    ))}
                  </div>
                  <button onClick={submit} disabled={busy}
                    style={{ borderRadius: 16, padding: 16, marginTop: 12, border: "none", color: "#fff", fontWeight: 700, fontSize: 16, opacity: busy ? 0.6 : 1, background: mode === "pay" ? C.brand : C.ink }}>
                    {busy ? "…" : `${mode === "pay" ? "Pay" : "Request"} $${money(amountNum)}`}
                  </button>
                </div>
              )}

              {step === "done" && last && (
                <div style={{ padding: "8px 24px 40px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
                  <div className="pop" style={{ width: 72, height: 72, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: last.mode === "pay" ? C.brandSoft : C.greenSoft }}>
                    {last.mode === "pay" ? <Check size={38} color={C.brand} strokeWidth={2.5} /> : <Clock size={36} color={C.green} strokeWidth={2.3} />}
                  </div>
                  <h3 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 22, marginTop: 18, marginBottom: 0 }}>
                    {last.mode === "pay" ? "Sent!" : "Requested!"}
                  </h3>
                  <p style={{ color: C.muted, fontSize: 14.5, marginTop: 4 }}>
                    {last.mode === "pay" ? `$${money(last.amount)} to ${last.who}` : `Asked ${last.who} for $${money(last.amount)}`}
                  </p>
                  {last.mode === "pay" && (
                    <p style={{ color: C.muted, fontSize: 13, marginTop: 4 }}>
                      {last.usedInstant ? "Arriving in minutes"
                        : last.speed === "EXPRESS" ? "Arriving same business day"
                        : "Arriving in 1–3 business days"}
                      {last.fee > 0 ? ` · includes $${money(last.fee)} fee` : ""}
                    </p>
                  )}
                  <p style={{ fontSize: 14, marginTop: 10 }}>{last.note}</p>
                  <button onClick={() => setOpen(false)} style={{ borderRadius: 16, padding: 14, marginTop: 32, width: "100%", border: "none", background: C.ink, color: "#fff", fontWeight: 700, fontSize: 15.5 }}>Done</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const pill = { display: "flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "7px 12px", border: "none",
  background: "rgba(255,255,255,.12)", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const bigBtn = { borderRadius: 16, padding: "14px 0", border: "none", fontWeight: 700, fontSize: 15.5,
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" };
const iconBtn = { background: "none", border: "none", padding: 4, cursor: "pointer", color: C.ink };
const sheetInput = { width: "100%", border: "none", outline: "none", background: C.canvas, borderRadius: 14, padding: "12px 14px", fontSize: 15, marginTop: 8 };

// ── Legal pages ───────────────────────────────────────────
// Placeholder copy — NOT reviewed by a lawyer. Swap in real counsel-drafted
// terms before relying on this for a real money-moving product.
function LegalPage({ title, updated, sections }) {
  return (
    <div style={{ minHeight: "100vh", background: pageBg, fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 20px 60px" }}>
        <a href="/" style={{ color: C.brand, fontWeight: 700, fontSize: 14, textDecoration: "none" }}>← Back to even</a>
        <h1 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontSize: 30, fontWeight: 800, marginTop: 16, marginBottom: 4 }}>{title}</h1>
        <p style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>Last updated {updated}</p>
        <div style={{ background: "#FFF6E5", border: "1px solid #F0DDB0", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#8A6416", marginBottom: 24 }}>
          Template placeholder — this has not been reviewed by a lawyer. Replace with counsel-drafted terms before relying on it.
        </div>
        {sections.map(({ heading, body }) => (
          <section key={heading} style={{ marginBottom: 22 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{heading}</h2>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#3A3A44", margin: 0, whiteSpace: "pre-line" }}>{body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 2026" sections={[
      { heading: "1. What even is", body: "even lets you verify your identity, link a bank account, and send or request money directly from other even users' bank accounts. Transfers move bank-to-bank through even's payment partner, Dwolla — even never holds your funds." },
      { heading: "2. Your account", body: "You must be at least 18 years old and provide accurate information when registering, including for identity verification. You're responsible for keeping your password secure and for all activity on your account." },
      { heading: "3. Sending and receiving money", body: "Transfers between even users are final once completed and move directly between linked bank accounts. Make sure you're paying the right person — even cannot reverse a completed transfer. Requests for money are not binding; the other person can decline." },
      { heading: "4. Fees", body: "even may charge a fee on payments, shown to you before you confirm a transfer. Fees, if any, are disclosed at the time of the transaction." },
      { heading: "5. Prohibited use", body: "You agree not to use even for illegal activity, fraud, money laundering, or to circumvent Dwolla's or even's terms. We may suspend or close accounts that violate this." },
      { heading: "6. Limitation of liability", body: "even is provided \"as is.\" To the extent permitted by law, even is not liable for indirect or consequential damages arising from your use of the service." },
      { heading: "7. Changes", body: "We may update these terms from time to time. Continued use of even after changes take effect means you accept the updated terms." },
      { heading: "8. Contact", body: "Questions about these terms? Reach out via the contact details on our website." },
    ]} />
  );
}

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 2026" sections={[
      { heading: "1. What we collect", body: "Account info you give us (name, handle, email, password — stored as a salted hash, never in plain text). Identity information needed for verification (address, date of birth, and SSN), which is sent directly to our payment partner Dwolla and not stored in our database. Transaction data (who you paid, amounts, notes). Technical data (IP address, device/browser info) for security and fraud prevention." },
      { heading: "2. How we use it", body: "To operate your account and process transfers, to verify your identity as required by law, to communicate with you about your account, to detect and prevent fraud, and to comply with legal obligations." },
      { heading: "3. Sharing", body: "We share what's necessary with Dwolla to verify your identity, link your bank account, and process transfers. We don't sell your personal data to third parties." },
      { heading: "4. Your choices", body: "You can request a copy of your data or ask us to delete your account. Deleting your account removes your personal profile info; transaction records involving other users are retained as needed for their accuracy and legal recordkeeping." },
      { heading: "5. Security", body: "Passwords are hashed with bcrypt. We use industry-standard practices to protect your data, but no system is 100% secure — please use a strong, unique password." },
      { heading: "6. Changes", body: "We may update this policy from time to time; continued use of even after changes take effect means you accept the updated policy." },
      { heading: "7. Contact", body: "Questions about your data? Reach out via the contact details on our website." },
    ]} />
  );
}

export default function App() {
  const path = window.location.pathname;
  if (path === "/terms") return <TermsPage />;
  if (path === "/privacy") return <PrivacyPage />;
  const isSignup = path === "/signup" || new URLSearchParams(window.location.search).get("signup") === "1";
  return <>{<Wallet initialAuthMode={isSignup ? "register" : "login"} />}<IosInstallBanner /></>;
}
