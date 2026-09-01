import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, LogOut, Building2, Share2,
  Fingerprint, Plus, Trash2, RefreshCw, ChevronRight, Pencil, Wallet as WalletIcon,
  Receipt, PieChart, Target, TrendingUp, Tag, Users, FileText, Landmark, ArrowUp, ArrowDown, CreditCard,
  Bot, AlertTriangle, MessageSquare, Copy, Check, HelpCircle, Lock, ShieldCheck,
} from "lucide-react";
import { usePlaidLink } from "react-plaid-link";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api, setToken, hasToken } from "./api.js";
import { GroupsList, GroupDetail, ReminderBanners } from "./Groups.jsx";

const C = {
  ink: "#16151A", canvas: "#F1F1F5", surface: "#FFFFFF",
  brand: "#12A150", brandSoft: "#ECEAFE", green: "#12A150",
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
    .tabrow{flex-wrap:wrap;overflow:visible}
    .tabrow::-webkit-scrollbar{display:none}
    @media (max-width:600px){.tabrow{flex-wrap:nowrap;overflow-x:auto}}
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
function Auth({ onDone, initialMode = "login", onBack }) {
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
        {/* The wordmark doubles as the way out. Someone who taps "create an
            account" and changes their mind would otherwise be stranded on a
            form with no back button — the page isn't routed, so the
            browser's own back button can't rescue them either. */}
        <div onClick={onBack} role={onBack ? "button" : undefined}
          style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 34,
            letterSpacing: "-0.03em", cursor: onBack ? "pointer" : "default", display: "inline-block" }}>
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

// Shown in place of a tab's contents when the API answered 402. The server
// is the only thing that decides this — we render it in response to a real
// refusal rather than guessing from a locally-held tier, so the screen can
// never claim access the API would deny (or deny access it would allow).
function ProLock({ title, blurb, onGoTab }) {
  return (
    <div style={{ ...card, textAlign: "center", padding: "30px 22px" }}>
      <div style={{ width: 46, height: 46, borderRadius: 14, background: C.greenSoft, display: "flex",
        alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
        <Lock size={20} color={C.brand} />
      </div>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 16.5 }}>{title}</p>
      <p style={{ margin: "8px auto 0", fontSize: 13.5, color: C.muted, lineHeight: 1.5, maxWidth: 330 }}>{blurb}</p>
      <button onClick={() => onGoTab?.("billing")}
        style={{ marginTop: 18, padding: "12px 22px", borderRadius: 14, border: "none",
          background: C.brand, color: "#fff", fontWeight: 700, fontSize: 14.5, cursor: "pointer" }}>
        See DoerToughMoney Pro — $9.99/mo
      </button>
    </div>
  );
}

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
  { k: "billing", l: "Billing", Icon: CreditCard },
];

// ── Home ─────────────────────────────────────────────────
function HomeTab({ accounts, totalAvailable, totalDebt, insights, topNegotiable, onGoTab, showProNudge }) {
  const top3 = (insights?.byCategory || []).slice(0, 3);
  // On a free account the "This month" card can't render, because insights
  // is gated. Leaving a hole there reads as a broken screen, so say what's
  // missing and what it costs instead.
  const proNudge = showProNudge && !insights?.thisMonth;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...card, background: "linear-gradient(135deg, #16151A 0%, #25232A 100%)", color: "#fff", border: "none", borderRadius: 24, padding: "24px 26px" }}>
        <span style={{ color: "#12A150", fontSize: 13, fontWeight: 500 }}>Available to spend</span>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 34, fontWeight: 700, marginTop: 6 }}>${money(totalAvailable)}</div>
        {totalDebt > 0 && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#D8D8E2" }}>${money(totalDebt)} owed on credit accounts</p>}
        <button onClick={() => onGoTab("accounts")} style={{ ...pill, marginTop: 14 }}>
          <Landmark size={14} /> {accounts.length === 0 ? "Connect a bank" : `${accounts.length} account${accounts.length === 1 ? "" : "s"} linked`}
        </button>
      </div>

      {proNudge && (
        <div style={{ ...card, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: C.greenSoft, display: "flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <TrendingUp size={16} color={C.brand} />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14.5 }}>See where the month went</p>
            <p style={{ margin: "5px 0 0", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
              Spending by category, bills worth renegotiating, and what's safe to spend — $9.99/mo.
            </p>
            <button onClick={() => onGoTab("billing")} style={{ ...lightPill, marginTop: 10 }}>
              See Pro <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

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
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState(null); // {} for new, {...bill} for edit
  const [form, setForm] = useState({ name: "", category: "", amount: "", cadence: "MONTHLY", nextDueOn: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.bills();
      setBills(r.bills || []);
      setTopNegotiable(r.topNegotiable || []);
    } catch (e) {
      if (e.code === "upgrade_required") setLocked(true); else setErr(e.message);
    } finally { setLoading(false); }
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

  if (loading) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  if (locked) return (
    <ProLock onGoTab={onGoTab} title="Bills is part of Pro"
      blurb="Track every recurring bill in one place, and see which ones are worth calling to renegotiate." />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    api.insights()
      .then(setData)
      .catch((e) => { if (e.code === "upgrade_required") setLocked(true); else setErr(e.message); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: C.muted, fontSize: 14 }}>Loading…</p>;
  if (locked) return (
    <ProLock onGoTab={onGoTab} title="Insights is part of Pro"
      blurb="See where the month actually went — spending broken down by category, and what changed since last month." />
  );
  if (err) return <p style={{ color: C.red, fontSize: 13 }}>{err}</p>;
  if (!data) return null;

  const maxCat = Math.max(1, ...data.byCategory.map((c) => c.amount));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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
const AFFORDABILITY_LABEL = {
  affordable: "You can afford this",
  tight: "Tight, but close",
  negotiate_to_afford: "Affordable if you negotiate the price down",
  out_of_reach: "Out of reach right now",
};
// DealTough's DealRecommendation (src/types.ts in the DealTough repo) has a
// riskLevel of "Low" | "Moderate" | "High" | "Critical" — map each to a soft
// background + a saturated text color, matching the brandSoft/greenSoft
// pattern already used elsewhere in this file rather than inventing new tokens.
const RISK_BADGE = {
  Low: { bg: C.greenSoft, fg: C.green },
  Moderate: { bg: "#FBEDD6", fg: C.amber },
  High: { bg: "#FBE1E6", fg: C.red },
  Critical: { bg: "#FBE1E6", fg: C.red },
};
// breakdown fields (out of /35, /20, /15, /10, /10, /10 — see ScoreBreakdown
// in DealTough's src/types.ts) shown as a labeled list rather than raw JSON.
const BREAKDOWN_MAX = { value: 35, risk: 20, trueCost: 15, negotiation: 10, market: 10, confidence: 10 };
const BREAKDOWN_LABEL = { value: "Value", risk: "Risk", trueCost: "True cost", negotiation: "Negotiation room", market: "Market", confidence: "Confidence" };

function DealsTab({ enabled, onGoTab }) {
  const [form, setForm] = useState({ category: "vehicle", title: "", askingPrice: "", condition: "Good" });
  const [comparables, setComparables] = useState([""]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

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
    setLoading(true); setErr(""); setResult(null); setCopied(false);
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

  // The API returns { deal, affordability } — DealTough's deal-quality
  // verdict and this app's own "can you actually pay for it" verdict, kept
  // separate on purpose (see server/affordability.js).
  const deal = result?.deal;
  const affordability = result?.affordability;
  // Server-set: the deal verdict came back fine, but joining it to real
  // balances is the paid half. Distinct from affordability === null, which
  // means "no linked bank" — two different fixes, so two different messages.
  const affordabilityLocked = result?.affordabilityLocked === true;
  // valuationBasis "unknown" means DealTough couldn't price it from the
  // comparables given — a $0 fairMarketValue in that case isn't a real
  // valuation, so don't display it (or anything derived from it) as one.
  const hasValuation = deal && deal.valuationBasis !== "unknown";
  const riskBadge = deal?.riskLevel ? RISK_BADGE[deal.riskLevel] : null;
  const breakdownEntries = deal?.breakdown ? Object.entries(deal.breakdown).filter(([k]) => k in BREAKDOWN_MAX) : [];

  const copyMessage = async () => {
    if (!deal?.negotiationMessage) return;
    try {
      await navigator.clipboard.writeText(deal.negotiationMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API unavailable/blocked (e.g. insecure context, permission
      // denied) — no-op. The message is still right there to select by hand.
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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

      {deal && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <p style={sectionLabel}>Is it a good deal?</p>
              {deal.verdict && <p style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{deal.verdict}</p>}
            </div>
            {riskBadge && (
              <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 11px", borderRadius: 999, background: riskBadge.bg, color: riskBadge.fg, whiteSpace: "nowrap" }}>
                {deal.riskLevel} risk
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
            {deal.dealScore != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Deal score</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{deal.dealScore}/100</p></div>}
            {hasValuation && deal.fairMarketValue != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Fair market value</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>${money(deal.fairMarketValue)}</p></div>}
            {deal.confidencePercent != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Confidence</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{deal.confidencePercent}%</p></div>}
          </div>
          {!hasValuation && (
            <p style={{ fontSize: 12.5, color: C.muted, marginTop: 8 }}>
              Not enough comparable listings to value this one — add a few more prices above for a real estimate.
            </p>
          )}
          {hasValuation && deal.estimatedSavings > 0 && (
            <p style={{ fontSize: 12.5, color: C.green, marginTop: 8, fontWeight: 600 }}>
              Up to ${money(deal.estimatedSavings)} in potential savings if you negotiate down to target.
            </p>
          )}
        </div>
      )}

      {deal && hasValuation && (deal.openingOffer != null || deal.targetPrice != null || deal.walkAwayPrice != null) && (
        <div style={card}>
          <p style={sectionLabel}>How to negotiate</p>
          <div style={{ display: "flex", gap: 18, marginTop: 10, flexWrap: "wrap" }}>
            {deal.openingOffer != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Open with</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>${money(deal.openingOffer)}</p></div>}
            {deal.targetPrice != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Target</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>${money(deal.targetPrice)}</p></div>}
            {deal.walkAwayPrice != null && <div><p style={{ margin: 0, fontSize: 12, color: C.muted }}>Walk away above</p><p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>${money(deal.walkAwayPrice)}</p></div>}
          </div>
          {deal.negotiationMessage && (
            <>
              <p style={{ fontSize: 12.5, color: C.muted, marginTop: 14, marginBottom: 6, display: "flex", alignItems: "center", gap: 5 }}>
                <MessageSquare size={13} /> Message to send the seller
              </p>
              <p style={{ fontSize: 14, lineHeight: 1.5, background: C.canvas, borderRadius: 12, padding: 12, margin: 0, whiteSpace: "pre-wrap" }}>
                {deal.negotiationMessage}
              </p>
              <button onClick={copyMessage} style={{ ...lightPill, marginTop: 10 }}>
                {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy message</>}
              </button>
            </>
          )}
        </div>
      )}

      {deal && Array.isArray(deal.topRisks) && deal.topRisks.length > 0 && (
        <div style={card}>
          <p style={sectionLabel}>Watch out for</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {deal.topRisks.map((risk, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={15} color={riskBadge?.fg || C.amber} style={{ marginTop: 1, flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: 13.5 }}>{risk}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {deal && Array.isArray(deal.sellerQuestions) && deal.sellerQuestions.length > 0 && (
        <div style={card}>
          <p style={sectionLabel}>Ask the seller</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {deal.sellerQuestions.map((q, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <HelpCircle size={15} color={C.muted} style={{ marginTop: 1, flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: 13.5 }}>{q}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {deal && ((Array.isArray(deal.reasons) && deal.reasons.length > 0) || breakdownEntries.length > 0) && (
        <div style={card}>
          <details>
            <summary style={{ fontSize: 12.5, color: C.muted, cursor: "pointer", fontWeight: 600 }}>Why this score</summary>
            {Array.isArray(deal.reasons) && deal.reasons.length > 0 && (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {deal.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
            {breakdownEntries.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {breakdownEntries.map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                    <span style={{ color: C.muted }}>{BREAKDOWN_LABEL[k] || k}</span>
                    <span style={{ fontWeight: 600 }}>{v}/{BREAKDOWN_MAX[k]}</span>
                  </div>
                ))}
              </div>
            )}
            {Array.isArray(deal.assumptions) && deal.assumptions.length > 0 && (
              <p style={{ fontSize: 11.5, color: C.muted, marginTop: 12, marginBottom: 0 }}>
                Assumptions: {deal.assumptions.join(" · ")}
              </p>
            )}
          </details>
        </div>
      )}

      {deal && (
        <div style={card}>
          <p style={sectionLabel}>Can you afford it?</p>
          {affordability ? (
            <>
              <p style={{ fontSize: 18, fontWeight: 700, marginTop: 8 }}>{AFFORDABILITY_LABEL[affordability.verdict] || affordability.verdict}</p>
              <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
                Safe to spend before your next bills: ${money(affordability.safeToSpendCents / 100)}
                {affordability.negotiateToCents != null && (
                  <> — fits if you talk it down to ${money(affordability.negotiateToCents / 100)}</>
                )}
              </p>
            </>
          ) : affordabilityLocked ? (
            <>
              <p style={{ margin: "8px 0 0", fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>
                The deal verdict above is free. Checking it against your actual balances —
                what's safe to spend before your next bills land — is part of Pro.
              </p>
              <button onClick={() => onGoTab?.("billing")}
                style={{ ...lightPill, marginTop: 12 }}>
                <Lock size={13} /> See Pro — $9.99/mo
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
              Link a bank account to see whether this fits your budget right now.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Read-only view of Mike's own DoerBot crypto trading bot — a separate
// service this app calls out to (see server/doerbot.js). No controls here on
// purpose: this can't start/stop/kill the bot, only show what it's doing.
// The tab itself only renders for the one account /api/me marks as the
// owner, but the route is also gated server-side, so this component never
// needs to re-check who's looking.
function DoerBotTab() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setSummary(await api.doerbotStatus()); }
    catch (e) { setErr(e.message || "Couldn't reach DoerBot."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !summary) {
    return <div style={card}><p style={{ margin: 0, fontSize: 14.5, color: C.muted }}>Loading…</p></div>;
  }

  if (err) {
    return (
      <div style={card}>
        <p style={sectionLabel}>DoerBot</p>
        <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.muted }}>{err}</p>
        <button onClick={load} style={{ ...lightPill, marginTop: 12 }}><RefreshCw size={13} /> Retry</button>
      </div>
    );
  }

  if (!summary) return null;

  const {
    paper, running, killed, unprotected, watchdogHealthy,
    openPositions, equity, cash, dayChange, dayChangePct,
  } = summary;

  const statusLabel = killed ? "Killed" : running ? "Running" : "Stopped";
  const statusColor = killed ? C.red : running ? C.green : C.amber;
  const dayIsUp = typeof dayChange === "number" && dayChange >= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ ...card, background: "linear-gradient(135deg, #16151A 0%, #25232A 100%)", color: "#fff", border: "none", borderRadius: 24, padding: "24px 26px" }}>
        <span style={{ color: "#12A150", fontSize: 13, fontWeight: 500 }}>DoerBot equity</span>
        <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 34, fontWeight: 700, marginTop: 6 }}>
          {equity != null ? `$${money(equity)}` : "—"}
        </div>
        {dayChange != null && (
          <p style={{ margin: "6px 0 0", fontSize: 13, color: dayIsUp ? "#8BE0AE" : "#F3A3B4", display: "flex", alignItems: "center", gap: 4 }}>
            {dayIsUp ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            ${money(Math.abs(dayChange))} today{dayChangePct != null ? ` (${(dayChangePct * 100).toFixed(2)}%)` : ""}
          </p>
        )}
        <button onClick={load} style={{ ...pill, marginTop: 14 }}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div style={card}>
        <p style={sectionLabel}>Status</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <span style={{ ...statusPill, borderColor: statusColor, color: statusColor }}>{statusLabel}</span>
          <span style={{ ...statusPill, borderColor: C.line, color: C.muted }}>{paper ? "Paper" : "Live"}</span>
          <span style={{ ...statusPill, borderColor: unprotected ? C.red : C.line, color: unprotected ? C.red : C.muted }}>
            {unprotected ? "Unprotected" : "Protected"}
          </span>
          {watchdogHealthy === false && (
            <span style={{ ...statusPill, borderColor: C.red, color: C.red }}>Watchdog alert</span>
          )}
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 13, color: C.muted }}>
          {openPositions} open position{openPositions === 1 ? "" : "s"}{cash != null ? ` · $${money(cash)} cash` : ""}
        </p>
      </div>

      <div style={card}>
        <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
          Read-only — this shows what DoerBot is doing, it can't start, stop, or trade it. RSI mean-reversion hasn't
          shown a real edge in testing yet, so treat any equity swing as experimental, not a track record.
        </p>
      </div>
    </div>
  );
}

const statusPill = {
  display: "inline-flex", alignItems: "center", padding: "5px 11px", borderRadius: 999,
  fontSize: 12.5, fontWeight: 700, border: "1.5px solid", background: "transparent",
};

function BillingTab({ enabled }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    (async () => {
      try { setStatus(await api.billingStatus()); } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [enabled]);

  const go = async (call) => {
    setBusy(true); setErr("");
    try { const { url } = await call(); window.location.href = url; }
    catch (e) { setErr(e.message); setBusy(false); }
  };

  if (!enabled) {
    return (
      <div style={card}>
        <p style={{ margin: 0, fontSize: 14.5, color: C.muted }}>
          Billing isn't connected on this deployment yet.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={card}>
        <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Loading…</p>
      </div>
    );
  }

  const isPro = status?.tier === "pro";
  const pastDue = status?.status === "PAST_DUE";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={card}>
        <p style={sectionLabel}>Plan</p>
        <p style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>
          {isPro ? "DoerToughMoney Pro" : "Free"}
        </p>
        {isPro && pastDue && (
          <p style={{ fontSize: 13, color: C.red, marginTop: 4, fontWeight: 600 }}>
            There's a problem with your payment method — update it to keep Pro active.
          </p>
        )}
        {isPro && !pastDue && status?.currentPeriodEnd && (
          <p style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            Renews {new Date(status.currentPeriodEnd).toLocaleDateString()}
          </p>
        )}
        {!isPro && (
          <>
            <p style={{ fontSize: 26, fontWeight: 800, marginTop: 10, letterSpacing: "-0.02em" }}>
              $9.99<span style={{ fontSize: 14, fontWeight: 600, color: C.muted }}> /month</span>
            </p>
            {/* Every line here names something the API actually gates. If a
                feature moves in or out of entitlements.js, this list moves
                with it — a plan card that overstates what it sells is how
                you earn a chargeback. */}
            <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
              {[
                "Connect as many banks as you want",
                "Insights — spending by category, and what changed since last month",
                "Bills in one place, and which are worth renegotiating",
                "Affordability — what's safe to spend before your next bills land",
              ].map((line) => (
                <li key={line} style={{ display: "flex", gap: 8, fontSize: 13.5, color: C.muted, lineHeight: 1.45 }}>
                  <Check size={15} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12.5, color: C.muted, marginTop: 10 }}>Cancel anytime.</p>
          </>
        )}
        {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
        <button onClick={() => go(isPro ? api.billingPortal : api.billingCheckout)} disabled={busy}
          style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy ? 0.6 : 1 }}>
          {busy ? "…" : isPro ? "Manage billing" : "Upgrade to Pro"}
        </button>
      </div>
    </div>
  );
}

// ── Main authenticated shell ─────────────────────────────
// ── Landing ──────────────────────────────────────────────
// What a stranger sees at doertoughmoney.com. Before this existed the root
// URL was a bare sign-in form, which asks people to create an account for a
// product they've been told nothing about. Everything claimed below is a
// feature that ships today — no forecasts, no "AI", no roadmap items
// written in the present tense.
function Landing({ onStart }) {
  const features = [
    { Icon: Landmark, t: "Your accounts in one place",
      d: "Connect your bank through Plaid and see balances and what you owe together, instead of four apps and a guess." },
    { Icon: Receipt, t: "Every transaction, sorted",
      d: "Spending lands categorized automatically, so you can see where the month actually went." },
    { Icon: Tag, t: "Know before you buy",
      d: "Paste any listing and DealTough tells you what it's worth, what to offer, and when to walk away." },
    { Icon: FileText, t: "Bills you can act on",
      d: "Track what's recurring and see which bills are big enough to be worth a phone call." },
    { Icon: Target, t: "Budgets and goals that use real numbers",
      d: "Built from the money actually moving through your accounts, not what you meant to spend." },
    { Icon: Users, t: "Shared costs, settled",
      d: "Split expenses with a group, track who owes what, and nudge people without the awkward text." },
  ];

  const H = ({ children, style }) => (
    <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800,
      letterSpacing: "-0.03em", margin: 0, ...style }}>{children}</h2>
  );

  return (
    <div style={{ minHeight: "100vh", background: pageBg, fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "22px 22px 60px" }}>

        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 21, letterSpacing: "-0.03em" }}>
            DoerTough<span style={{ color: C.brand }}>Money</span>
          </span>
          <button onClick={() => onStart("login")}
            style={{ background: "none", border: "none", color: C.ink, fontSize: 14.5, fontWeight: 600, cursor: "pointer", padding: "8px 4px" }}>
            Sign in
          </button>
        </header>

        <section style={{ marginTop: 46, textAlign: "center" }}>
          <H style={{ fontSize: "clamp(32px, 7vw, 46px)", lineHeight: 1.08 }}>
            Your money.<br />Your decisions.<br /><span style={{ color: C.brand }}>Your advantage.</span>
          </H>
          <p style={{ fontSize: 16.5, color: C.muted, lineHeight: 1.55, margin: "18px auto 0", maxWidth: 460 }}>
            Connect your bank and DoerToughMoney shows you what you actually have,
            where it's going, and whether you can afford the thing you're about to buy.
          </p>
          <button onClick={() => onStart("register")}
            style={{ marginTop: 26, padding: "15px 30px", borderRadius: 15, border: "none",
              background: C.brand, color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
            Create a free account
          </button>
          <p style={{ fontSize: 13, color: C.muted, marginTop: 12 }}>
            Free to start. One bank connection, no card required.
          </p>
        </section>

        <section style={{ marginTop: 54, display: "grid", gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(232px, 1fr))" }}>
          {features.map(({ Icon, t, d }) => (
            <div key={t} style={card}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: C.greenSoft,
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={17} color={C.brand} />
              </div>
              <p style={{ margin: "12px 0 0", fontWeight: 700, fontSize: 15 }}>{t}</p>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, color: C.muted, lineHeight: 1.5 }}>{d}</p>
            </div>
          ))}
        </section>

        {/* The pricing table has to agree with entitlements.js, or the first
            person who pays finds out we were wrong. */}
        <section style={{ marginTop: 54 }}>
          <H style={{ fontSize: 27, textAlign: "center" }}>Simple pricing</H>
          <div style={{ marginTop: 20, display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))" }}>

            <div style={card}>
              <p style={sectionLabel}>Free</p>
              <p style={{ fontSize: 27, fontWeight: 800, margin: "8px 0 0", letterSpacing: "-0.02em" }}>$0</p>
              <ul style={{ margin: "14px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {["One connected bank", "Accounts, balances and transactions",
                  "Budgets and goals", "DealTough deal check", "Shared expenses"].map((l) => (
                  <li key={l} style={{ display: "flex", gap: 8, fontSize: 13.5, color: C.muted, lineHeight: 1.45 }}>
                    <Check size={15} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} /><span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ ...card, border: `2px solid ${C.brand}` }}>
              <p style={{ ...sectionLabel, color: C.brand }}>Pro</p>
              <p style={{ fontSize: 27, fontWeight: 800, margin: "8px 0 0", letterSpacing: "-0.02em" }}>
                $9.99<span style={{ fontSize: 14, fontWeight: 600, color: C.muted }}> /month</span>
              </p>
              <ul style={{ margin: "14px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {["Everything in Free", "Unlimited bank connections",
                  "Insights — spending by category, month over month",
                  "Bills, and which are worth renegotiating",
                  "Affordability — what's safe to spend before your next bills"].map((l) => (
                  <li key={l} style={{ display: "flex", gap: 8, fontSize: 13.5, color: C.muted, lineHeight: 1.45 }}>
                    <Check size={15} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} /><span>{l}</span>
                  </li>
                ))}
              </ul>
              <p style={{ fontSize: 12.5, color: C.muted, marginTop: 12 }}>Cancel anytime.</p>
            </div>
          </div>
        </section>

        <section style={{ ...card, marginTop: 30, display: "flex", gap: 12, alignItems: "flex-start" }}>
          <ShieldCheck size={19} color={C.brand} style={{ flexShrink: 0, marginTop: 1 }} />
          <p style={{ margin: 0, fontSize: 13.5, color: C.muted, lineHeight: 1.55 }}>
            Bank connections run through <strong style={{ color: C.ink }}>Plaid</strong>, the same service
            your other finance apps use. We never see or store your bank login, and DoerToughMoney
            can't move money — it only reads.
          </p>
        </section>

        <section style={{ marginTop: 40, textAlign: "center" }}>
          <H style={{ fontSize: 23 }}>Start with one bank. See where you stand.</H>
          <button onClick={() => onStart("register")}
            style={{ marginTop: 18, padding: "15px 30px", borderRadius: 15, border: "none",
              background: C.brand, color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
            Create a free account
          </button>
          <p style={{ fontSize: 13.5, color: C.muted, marginTop: 14 }}>
            Already have one?{" "}
            <button onClick={() => onStart("login")}
              style={{ background: "none", border: "none", color: C.brand, fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
              Sign in
            </button>
          </p>
        </section>

        <footer style={{ marginTop: 46, paddingTop: 20, borderTop: `1px solid ${C.line}`,
          display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/terms" style={{ fontSize: 12.5, color: C.muted, textDecoration: "none" }}>Terms</a>
          <a href="/privacy" style={{ fontSize: 12.5, color: C.muted, textDecoration: "none" }}>Privacy</a>
          <a href="https://www.doertough.com" style={{ fontSize: 12.5, color: C.muted, textDecoration: "none" }}>Doer Tough</a>
        </footer>
      </div>
    </div>
  );
}

function Home({ initialAuthMode = "login", startOnAuth = false }) {
  const [user, setUser] = useState(null);
  // A signed-out visitor gets the landing page first; /login and /signup
  // still go straight to the form so a returning user's bookmark, and any
  // link we hand out, land exactly where they expect.
  const [showAuth, setShowAuth] = useState(startOnAuth);
  const [authMode, setAuthMode] = useState(initialAuthMode);
  const [isDoerBotOwner, setIsDoerBotOwner] = useState(false);
  // Comes straight from /api/me, which computes it with the same code the
  // routes gate on — never inferred client-side.
  const [entitlements, setEntitlements] = useState(null);
  const [ready, setReady] = useState(false);
  const [cfg, setCfg] = useState({ plaidEnabled: false, dealtoughEnabled: false, stripeEnabled: false });
  const [tab, setTab] = useState("home");
  const [openGroupId, setOpenGroupId] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [totalDebt, setTotalDebt] = useState(0);
  const [insights, setInsights] = useState(null);
  const [topNegotiable, setTopNegotiable] = useState([]);

  // Only Mike sees this tab — isDoerBotOwner comes from the server (/api/me),
  // never guessed client-side, so no other account can even see it exists.
  const visibleTabs = isDoerBotOwner ? [...TABS, { k: "doerbot", l: "DoerBot", Icon: Bot }] : TABS;

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
    // Settled, not all-or-nothing: insights is a paid feature, so for a free
    // account it answers 402 every time. Promise.all would let that refusal
    // throw away the accounts response too and leave Home looking empty for
    // everyone who hasn't paid.
    const [acc, ins] = await Promise.allSettled([api.accounts(), api.insights()]);
    if (acc.status === "fulfilled") {
      setAccounts(acc.value.accounts || []);
      setTotalAvailable(acc.value.totalAvailable || 0);
      setTotalDebt(acc.value.totalDebt || 0);
    }
    if (ins.status === "fulfilled") {
      setInsights({ thisMonth: ins.value.thisMonth, byCategory: ins.value.byCategory });
      setTopNegotiable(ins.value.topNegotiableBills || []);
    } else {
      setInsights(null);
      setTopNegotiable([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    const { user, isDoerBotOwner, entitlements } = await api.me();
    setUser(user);
    setIsDoerBotOwner(!!isDoerBotOwner);
    setEntitlements(entitlements || null);
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
  if (!user && !showAuth) {
    return <Landing onStart={(mode) => { setAuthMode(mode); setShowAuth(true); }} />;
  }
  if (!user) return (
    <Auth onDone={(u) => { setUser(u); refresh(); }} initialMode={authMode}
      onBack={startOnAuth ? undefined : () => setShowAuth(false)} />
  );

  return (
    <div style={{ minHeight: "100vh", background: pageBg, display: "flex", justifyContent: "center",
      fontFamily: "Inter, system-ui, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ width: "100%", maxWidth: 680, position: "relative", minHeight: "100vh" }}>

        <header style={{ padding: "28px 28px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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

        <div className="tabrow" style={{ display: "flex", gap: 8, padding: "16px 28px 0" }}>
          {visibleTabs.map((t) => (
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

        <section style={{ padding: "20px 28px 56px" }}>
          {tab === "home" && (
            <HomeTab accounts={accounts} totalAvailable={totalAvailable} totalDebt={totalDebt}
              insights={insights} topNegotiable={topNegotiable} onGoTab={setTab}
              showProNudge={entitlements ? !entitlements.paid : false} />
          )}
          {tab === "accounts" && <AccountsTab onChanged={loadOverview} />}
          {tab === "transactions" && <TransactionsTab />}
          {tab === "bills" && <BillsTab onGoTab={setTab} />}
          {tab === "budgets" && <BudgetsTab />}
          {tab === "goals" && <GoalsTab />}
          {tab === "insights" && <InsightsTab onGoTab={setTab} />}
          {tab === "deals" && <DealsTab enabled={!!cfg.dealtoughEnabled} onGoTab={setTab} />}
          {tab === "billing" && <BillingTab enabled={!!cfg.stripeEnabled} />}
          {tab === "doerbot" && isDoerBotOwner && <DoerBotTab />}
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
  const isLogin = path === "/login";
  return (
    <>
      <Home initialAuthMode={isSignup ? "register" : "login"} startOnAuth={isSignup || isLogin} />
      <IosInstallBanner />
    </>
  );
}
