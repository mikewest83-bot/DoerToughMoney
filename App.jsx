import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search, ArrowLeft, Delete, Check, Plus, ArrowUpRight,
  ArrowDownLeft, Clock, X, LogOut, Building2, Banknote,
  Link2, Copy, QrCode,
} from "lucide-react";
import QRCode from "qrcode";
import { api, setToken, hasToken } from "./api.js";

const C = {
  ink: "#16151A", canvas: "#F1F1F5", surface: "#FFFFFF",
  brand: "#5B4DF5", brandSoft: "#ECEAFE", green: "#12A150",
  greenSoft: "#E4F5EC", amber: "#E8A33D", muted: "#7A7A86", line: "#E6E6EC",
};
const AV = ["#5B4DF5", "#12A150", "#E8A33D", "#E5556E", "#2AA6C4", "#8B5CF6", "#EC6C3E"];
const initials = (n = "") => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const colorFor = (n = "") => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % AV.length; return AV[h]; };
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
function Auth({ onDone }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", handle: "", email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const res = mode === "login"
        ? await api.login({ email: form.email, password: form.password })
        : await api.register(form);
      setToken(res.token);
      onDone(res.user);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const field = (ph, k, type = "text") => (
    <input value={form[k]} onChange={set(k)} placeholder={ph} type={type}
      style={{ width: "100%", padding: "13px 15px", borderRadius: 14, border: `1px solid ${C.line}`,
        background: C.surface, fontSize: 15, marginTop: 10 }} />
  );

  return (
    <div style={{ minHeight: "100vh", background: C.canvas, display: "flex", flexDirection: "column",
      justifyContent: "center", padding: 24, fontFamily: "Inter, sans-serif", color: C.ink }}>
      {fontStyle}
      <div style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 40, letterSpacing: "-0.03em" }}>
          even<span style={{ color: C.brand }}>.</span>
        </div>
        <p style={{ color: C.muted, fontSize: 15, marginTop: 4 }}>Settle up with anyone.</p>

        <div style={{ marginTop: 26 }}>
          {mode === "register" && (<>{field("Full name", "name")}{field("Handle (e.g. @you)", "handle")}</>)}
          {field("Email", "email", "email")}
          {field("Password", "password", "password")}
          {err && <p style={{ color: "#E5556E", fontSize: 13, marginTop: 10 }}>{err}</p>}
          <button onClick={submit} disabled={busy}
            style={{ width: "100%", marginTop: 16, padding: 15, borderRadius: 14, border: "none",
              background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </div>

        <button onClick={() => { setErr(""); setMode(mode === "login" ? "register" : "login"); }}
          style={{ marginTop: 18, background: "none", border: "none", color: C.muted, fontSize: 14 }}>
          {mode === "login" ? "New here? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}

// ── Wallet ───────────────────────────────────────────────

// ── shared QR ────────────────────────────────────────────
function QR({ text, size = 220 }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: "#16151A", light: "#ffffff" } })
      .then((d) => live && setSrc(d)).catch(() => {});
    return () => { live = false; };
  }, [text, size]);
  return src ? <img src={src} alt="QR code" width={size} height={size} style={{ borderRadius: 12 }} /> : null;
}

// ── public pay page (no account needed) ──────────────────
function PayPage({ slug }) {
  const [link, setLink] = useState(null);
  const [err, setErr] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const done = new URLSearchParams(window.location.search).get("done") === "1";

  useEffect(() => {
    api.getLink(slug).then(({ link }) => setLink(link)).catch((e) => setErr(e.message));
  }, [slug]);

  const pay = async () => {
    setBusy(true); setErr("");
    try {
      const body = link.amountCents == null ? { amount } : {};
      const { url } = await api.linkCheckout(slug, body);
      window.location.href = url;
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const wrap = { minHeight: "100vh", background: C.canvas, display: "flex", flexDirection: "column",
    justifyContent: "center", alignItems: "center", padding: 24, fontFamily: "Inter, sans-serif", color: C.ink };

  if (done) return (
    <div style={wrap}>{fontStyle}
      <div className="pop" style={{ width: 76, height: 76, borderRadius: 999, background: C.greenSoft, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Check size={40} color={C.green} strokeWidth={2.5} />
      </div>
      <h2 style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, marginTop: 18, marginBottom: 4 }}>Payment sent</h2>
      <p style={{ color: C.muted, fontSize: 14.5 }}>Thanks — you're all set.</p>
    </div>
  );

  if (err) return <div style={wrap}>{fontStyle}<p style={{ color: C.muted }}>{err}</p></div>;
  if (!link) return <div style={wrap}>{fontStyle}<p style={{ color: C.muted }}>Loading…</p></div>;

  const fixed = link.amountCents != null;
  return (
    <div style={wrap}>{fontStyle}
      <div style={{ width: "100%", maxWidth: 380, background: C.surface, borderRadius: 24, padding: 24, textAlign: "center", border: `1px solid ${C.line}` }}>
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em" }}>
          even<span style={{ color: C.brand }}>.</span>
        </div>
        <Avatar name={link.payee?.name || "even"} size={56} />
        <p style={{ fontSize: 16, fontWeight: 600, marginTop: 12 }}>Pay {link.payee?.name}</p>
        <p style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{link.payee?.handle}{link.note ? ` · ${link.note}` : ""}</p>

        {fixed ? (
          <div style={{ fontFamily: "'Space Mono',monospace", fontSize: 44, fontWeight: 700, marginTop: 16 }}>
            ${money(link.amountCents / 100)}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 16 }}>
            <span style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, color: C.muted }}>$</span>
            <input autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0"
              style={{ fontFamily: "'Space Mono',monospace", fontSize: 40, fontWeight: 700, width: 160, textAlign: "center", border: "none", outline: "none", background: "transparent" }} />
          </div>
        )}

        <button onClick={pay} disabled={busy}
          style={{ width: "100%", marginTop: 20, padding: 15, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: busy ? 0.6 : 1 }}>
          {busy ? "…" : "Pay with card"}
        </button>
        <p style={{ fontSize: 11.5, color: C.muted, marginTop: 12 }}>Secured by Stripe · no account needed</p>
      </div>
    </div>
  );
}

function Wallet() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feeCfg, setFeeCfg] = useState({ feeBps: 0, feeFlatCents: 0, feeCapCents: null });

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

  const refresh = useCallback(async () => {
    const [{ user }, { feed }] = await Promise.all([api.me(), api.feed()]);
    setUser(user); setFeed(feed);
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
  const feePreview = (() => {
    if (mode !== "pay") return 0;
    const cents = Math.round(amountNum * 100);
    if (cents <= 0) return 0;
    let fee = Math.round((cents * (feeCfg.feeBps || 0)) / 10000) + (feeCfg.feeFlatCents || 0);
    if (feeCfg.feeCapCents != null) fee = Math.min(fee, feeCfg.feeCapCents);
    return Math.max(0, fee) / 100;
  })();
  const start = (m) => { setMode(m); setStep("who"); setTarget(null); setAmount("0"); setNote(""); setQuery(""); setError(""); setOpen(true); };
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
      if (mode === "pay") { const r = await api.pay(body); setUser(r.user); paidFee = (r.feeCents || 0) / 100; }
      else await api.request(body);
      setLast({ mode, who: target.name, amount: amountNum, fee: paidFee, note: note.trim() || (mode === "pay" ? "payment" : "request") });
      await api.feed().then(({ feed }) => setFeed(feed));
      setStep("done");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const addFunds = async () => {
    const raw = window.prompt("Add how much? (USD)");
    if (!raw) return;
    try { const { url } = await api.topup({ amount: raw }); window.location.href = url; }
    catch (e) { alert(e.message); }
  };
  const connectBank = async () => {
    try { const { url } = await api.bankLink(); window.location.href = url; }
    catch (e) { alert(e.message); }
  };
  const cashOut = async () => {
    const raw = window.prompt("Cash out how much to your bank? (USD)");
    if (!raw) return;
    try { const { user } = await api.cashout({ amount: raw }); setUser(user); await api.feed().then(({ feed }) => setFeed(feed)); }
    catch (e) { alert(e.message); }
  };
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkAmount, setLinkAmount] = useState("");
  const [linkNote, setLinkNote] = useState("");
  const [createdLink, setCreatedLink] = useState(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const openLink = () => { setLinkAmount(""); setLinkNote(""); setCreatedLink(null); setCopied(false); setLinkOpen(true); };
  const makeLink = async () => {
    setLinkBusy(true);
    try {
      const body = {};
      if (linkAmount) body.amount = linkAmount;
      if (linkNote.trim()) body.note = linkNote.trim();
      const { url } = await api.createLink(body);
      setCreatedLink(url);
    } catch (e) { alert(e.message); } finally { setLinkBusy(false); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(createdLink); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const signOut = () => { setToken(null); setUser(null); setFeed([]); };

  if (!ready) return <div style={{ minHeight: "100vh", background: C.canvas }}>{fontStyle}</div>;
  if (!user) return <Auth onDone={(u) => { setUser(u); refresh(); }} />;

  const balance = (user.balanceCents || 0) / 100;

  return (
    <div style={{ minHeight: "100vh", background: C.canvas, display: "flex", justifyContent: "center",
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
              <span style={{ color: "#B9B9C6", fontSize: 13, fontWeight: 500 }}>Available balance</span>
              <span style={{ color: "#B9B9C6", fontSize: 12.5 }}>{user.handle}</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", alignItems: "flex-end", gap: 3 }}>
              <span style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>$</span>
              <span style={{ fontFamily: "'Space Mono',monospace", fontSize: 44, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em" }}>
                {money(balance)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={addFunds} style={pill}><Plus size={14} /> Add funds</button>
              <button onClick={cashOut} style={pill}><Banknote size={14} /> Cash out</button>
              <button onClick={connectBank} style={pill}><Building2 size={14} /> {user.hasBank ? "Bank ✓" : "Add bank"}</button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <button onClick={() => start("pay")} style={{ ...bigBtn, background: C.brand, color: "#fff" }}>
              <ArrowUpRight size={19} /> Pay
            </button>
            <button onClick={() => start("request")} style={{ ...bigBtn, background: C.surface, color: C.ink, border: `1px solid ${C.line}` }}>
              <ArrowDownLeft size={19} /> Request
            </button>
          </div>

          <button onClick={openLink} style={{ width: "100%", marginTop: 12, padding: "13px 0", borderRadius: 16, border: `1px dashed ${C.line}`, background: "transparent", color: C.brand, fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
            <Link2 size={17} /> Create a pay-me link
          </button>
        </section>

        <section style={{ padding: "24px 20px 32px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Activity</h2>
          <div style={{ marginTop: 8 }}>
            {feed.length === 0 && <p style={{ color: C.muted, fontSize: 14, padding: "24px 0" }}>Nothing yet. Pay someone to get started.</p>}
            {feed.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
                <Avatar name={t.who} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.kind === "topup" ? "Added funds" : t.dir === "in" ? t.who
                      : t.dir === "requested" ? `You requested ${t.who}` : t.dir === "request_due" ? `${t.who} requested you` : t.kind === "payout" ? "Cash out" : `You paid ${t.who}`}
                  </p>
                  <p style={{ margin: 0, fontSize: 13, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {t.note}{t.status === "pending" ? " · pending" : ""}
                  </p>
                </div>
                <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14.5,
                  color: t.dir === "in" ? C.green : (t.dir === "requested" || t.dir === "request_due") ? C.amber : C.ink }}>
                  {t.dir === "in" ? "+" : (t.dir === "requested" || t.dir === "request_due") ? "" : "−"}${money(t.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {linkOpen && (
          <div onClick={() => setLinkOpen(false)}
            style={{ position: "absolute", inset: 0, zIndex: 25, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
            <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
              style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{createdLink ? "Your pay-me link" : "Create a pay-me link"}</span>
                <button onClick={() => setLinkOpen(false)} style={iconBtn}><X size={22} /></button>
              </div>

              {!createdLink ? (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12.5, color: C.muted }}>Amount (optional — leave blank to let them choose)</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 14, padding: "10px 14px", background: C.canvas, marginTop: 6 }}>
                    <span style={{ fontWeight: 700, color: C.muted }}>$</span>
                    <input value={linkAmount} onChange={(e) => setLinkAmount(e.target.value)} inputMode="decimal" placeholder="0.00"
                      style={{ border: "none", outline: "none", background: "transparent", fontSize: 16, width: "100%" }} />
                  </div>
                  <input value={linkNote} onChange={(e) => setLinkNote(e.target.value)} placeholder="What's it for? (optional)"
                    style={{ width: "100%", border: "none", outline: "none", background: C.canvas, borderRadius: 14, padding: "10px 14px", fontSize: 14, marginTop: 10 }} />
                  <button onClick={makeLink} disabled={linkBusy}
                    style={{ width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, opacity: linkBusy ? 0.6 : 1 }}>
                    {linkBusy ? "…" : "Create link"}
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <QR text={createdLink} size={200} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 16, background: C.canvas, borderRadius: 12, padding: "10px 12px" }}>
                    <span style={{ fontSize: 12.5, color: C.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{createdLink}</span>
                    <button onClick={copyLink} style={{ display: "flex", alignItems: "center", gap: 4, border: "none", background: C.brand, color: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <p style={{ fontSize: 12, color: C.muted, marginTop: 12, textAlign: "center" }}>Share it anywhere. Anyone can pay by card — the money lands in your balance.</p>
                </div>
              )}
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

              {step === "amount" && (
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
                  {last.mode === "pay" && last.fee > 0 && (
                    <p style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>includes ${money(last.fee)} fee</p>
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

export default function App() {
  const path = window.location.pathname;
  if (path.startsWith("/pay/")) return <PayPage slug={decodeURIComponent(path.slice(5))} />;
  return <Wallet />;
}
