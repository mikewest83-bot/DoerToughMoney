import { useState, useEffect, useCallback } from "react";
import {
  Plus, X, Users, ArrowLeft, Check, Repeat, Trash2, UserPlus, Wallet,
} from "lucide-react";
import { api } from "./api.js";

// Shared visual language with App.jsx. Kept local rather than imported so this
// screen can be reasoned about on its own.
const C = {
  ink: "#16151A", canvas: "#F1F1F5", surface: "#FFFFFF",
  brand: "#5B4DF5", brandSoft: "#ECEAFE", green: "#12A150",
  greenSoft: "#E4F5EC", amber: "#E8A33D", muted: "#7A7A86", line: "#E6E6EC",
  red: "#E5556E",
};
const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AV = ["#5B4DF5", "#12A150", "#E8A33D", "#E5556E", "#2AA6C4", "#8B5CF6", "#EC6C3E"];
const initials = (n = "") => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const colorFor = (n = "") => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % AV.length; return AV[h]; };

const GROUP_TYPES = [
  { key: "HOUSEHOLD", label: "Household" },
  { key: "TRIP", label: "Trip" },
  { key: "TEAM", label: "Team" },
  { key: "OTHER", label: "Other" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const sheetInput = { width: "100%", border: "none", outline: "none", background: C.canvas, borderRadius: 14, padding: "12px 14px", fontSize: 15, marginTop: 8 };
const primaryBtn = { width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5 };
const iconBtn = { background: "none", border: "none", padding: 4, cursor: "pointer", color: C.ink };

function Avatar({ name, size = 36, dim = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 3,
      background: dim ? C.line : colorFor(name),
      color: dim ? C.muted : "#fff",
      fontSize: size * 0.34, fontWeight: 600,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

// Bottom sheet, matching the pattern used across the app.
function Sheet({ title, onClose, children }) {
  return (
    <div onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
      <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
        style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={iconBtn}><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A member's position, phrased from the viewer's perspective.
function netLabel(net) {
  if (net > 0.004) return { text: `owed $${money(net)}`, color: C.green };
  if (net < -0.004) return { text: `owes $${money(-net)}`, color: C.red };
  return { text: "settled up", color: C.muted };
}

// ── group list ───────────────────────────────────────────
export function GroupsList({ onOpen }) {
  const [groups, setGroups] = useState([]);
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", type: "HOUSEHOLD" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { setGroups((await api.groups()).groups); } catch {} finally { setReady(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const { group } = await api.createGroup(form);
      setCreating(false); setForm({ name: "", type: "HOUSEHOLD" });
      await load();
      onOpen(group.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // Implicit pair groups are one-off splits with a person, not real groups.
  const named = groups.filter((g) => !g.implicit);
  const pairs = groups.filter((g) => g.implicit && Math.abs(g.myNet) > 0.004);

  return (
    <section style={{ padding: "8px 20px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>Shared expenses</h2>
        <button onClick={() => { setErr(""); setCreating(true); }}
          style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: C.brandSoft, color: C.brand, borderRadius: 999, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          <Plus size={14} /> New
        </button>
      </div>

      {ready && named.length === 0 && pairs.length === 0 && (
        <div style={{ textAlign: "center", padding: "28px 8px", color: C.muted }}>
          <Users size={26} style={{ opacity: 0.5 }} />
          <p style={{ fontSize: 14, margin: "10px 0 0" }}>Track rent, utilities, and trips with roommates or friends.</p>
          <p style={{ fontSize: 12.5, margin: "6px 0 0" }}>Nobody needs a verified bank to start — that's only for settling up.</p>
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {named.map((g) => {
          const l = netLabel(g.myNet);
          return (
            <button key={g.id} onClick={() => onOpen(g.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, textAlign: "left", cursor: "pointer" }}>
              <div style={{ width: 38, height: 38, borderRadius: 12, background: C.brandSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Users size={18} color={C.brand} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{g.name}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
                  {g.members.length} {g.members.length === 1 ? "person" : "people"}
                  {g.recurring.length ? ` · ${g.recurring.length} recurring` : ""}
                </p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: l.color }}>{l.text}</span>
            </button>
          );
        })}

        {pairs.length > 0 && (
          <p style={{ fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginTop: 20, marginBottom: 4 }}>One-off splits</p>
        )}
        {pairs.map((g) => {
          const l = netLabel(g.myNet);
          const other = g.members.find((m) => !m.isMe);
          return (
            <button key={g.id} onClick={() => onOpen(g.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, textAlign: "left", cursor: "pointer" }}>
              <Avatar name={other?.name || g.name} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{other?.name || g.name}</p>
                <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>{g.expenses.length} shared {g.expenses.length === 1 ? "item" : "items"}</p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: l.color }}>{l.text}</span>
            </button>
          );
        })}
      </div>

      {creating && (
        <Sheet title="New shared group" onClose={() => setCreating(false)}>
          <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name (e.g. Oak St apartment)" style={sheetInput} />
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {GROUP_TYPES.map((t) => (
              <button key={t.key} onClick={() => setForm((f) => ({ ...f, type: t.key }))}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  border: `1.5px solid ${form.type === t.key ? C.brand : C.line}`,
                  background: form.type === t.key ? C.brandSoft : C.surface,
                  color: form.type === t.key ? C.brand : C.ink,
                }}>{t.label}</button>
            ))}
          </div>
          {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
          <button onClick={create} disabled={busy || form.name.trim().length < 2} style={{ ...primaryBtn, opacity: busy || form.name.trim().length < 2 ? 0.5 : 1 }}>
            {busy ? "…" : "Create group"}
          </button>
        </Sheet>
      )}
    </section>
  );
}

// ── group detail ─────────────────────────────────────────
export function GroupDetail({ groupId, onBack, onUserChanged }) {
  const [group, setGroup] = useState(null);
  const [err, setErr] = useState("");
  const [sheet, setSheet] = useState(null); // "expense" | "member" | "recurring" | "settle"
  const [settleTarget, setSettleTarget] = useState(null);

  const load = useCallback(async () => {
    try { setGroup((await api.group(groupId)).group); }
    catch (e) { setErr(e.message); }
  }, [groupId]);
  useEffect(() => { load(); }, [load]);

  if (err) return (
    <section style={{ padding: 20 }}>
      <button onClick={onBack} style={{ ...iconBtn, marginBottom: 12 }}><ArrowLeft size={20} /></button>
      <p style={{ color: C.muted, fontSize: 14 }}>{err}</p>
    </section>
  );
  if (!group) return <section style={{ padding: 20, color: C.muted, fontSize: 14 }}>Loading…</section>;

  const mine = netLabel(group.myNet);

  return (
    <section style={{ padding: "8px 20px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={iconBtn}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{group.name}</p>
          <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>{group.members.length} {group.members.length === 1 ? "person" : "people"}</p>
        </div>
        {!group.implicit && (
          <button onClick={() => setSheet("member")} title="Add someone"
            style={{ ...iconBtn, background: C.brandSoft, borderRadius: 999, padding: 8, color: C.brand }}>
            <UserPlus size={17} />
          </button>
        )}
      </div>

      {/* Your position, then exactly who to pay. */}
      <div style={{ marginTop: 14, borderRadius: 20, padding: 18, background: C.ink, color: "#fff" }}>
        <span style={{ color: "#B9B9C6", fontSize: 12.5, fontWeight: 500 }}>Your balance</span>
        <p style={{ margin: "6px 0 0", fontFamily: "'Space Mono',monospace", fontSize: 30, fontWeight: 700 }}>
          {group.myNet > 0.004 ? "+" : group.myNet < -0.004 ? "−" : ""}${money(Math.abs(group.myNet))}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: group.myNet > 0.004 ? "#7BE0A8" : group.myNet < -0.004 ? "#FFA8B6" : "#B9B9C6" }}>
          {group.myNet > 0.004 ? "you're owed" : group.myNet < -0.004 ? "you owe" : "all settled up"}
        </p>
      </div>

      {group.iOwe.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>You should pay</p>
          {group.iOwe.map((t) => (
            <div key={t.toMemberId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <Avatar name={t.toName} size={32} />
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{t.toName}</span>
              <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14 }}>${money(t.amount)}</span>
              <button onClick={() => { setSettleTarget(t); setSheet("settle"); }}
                style={{ border: "none", background: C.brand, color: "#fff", borderRadius: 10, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                Settle
              </button>
            </div>
          ))}
        </div>
      )}

      {group.owedToMe.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>Owed to you</p>
          {group.owedToMe.map((t) => (
            <div key={t.fromMemberId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.line}` }}>
              <Avatar name={t.fromName} size={32} />
              <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{t.fromName}</span>
              <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14, color: C.green }}>${money(t.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Recurring items surfaced so rent and subscriptions are visible without re-entry. */}
      {group.recurring.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <p style={{ fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>Recurring</p>
          {group.recurring.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.line}` }}>
              <Repeat size={15} color={C.muted} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{r.description}</p>
                <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                  {r.interval === "MONTHLY" ? `Monthly on the ${r.dayOfMonth}` : `Every ${DAYS[r.dayOfWeek] || "week"}`} · {r.paidByName} pays
                </p>
              </div>
              <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 13.5 }}>${money(r.amount)}</span>
              <button onClick={async () => { await api.deleteRecurring(group.id, r.id); load(); }} title="Stop this recurring expense" style={iconBtn}>
                <Trash2 size={15} color={C.muted} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
        <button onClick={() => setSheet("expense")}
          style={{ flex: 1, borderRadius: 14, padding: "13px 0", border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
          <Plus size={16} /> Add expense
        </button>
        {!group.implicit && (
          <button onClick={() => setSheet("recurring")}
            style={{ borderRadius: 14, padding: "13px 16px", border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", gap: 7, cursor: "pointer" }}>
            <Repeat size={16} /> Recurring
          </button>
        )}
      </div>

      <div style={{ marginTop: 22 }}>
        <p style={{ fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>Expenses</p>
        {group.expenses.length === 0 && <p style={{ color: C.muted, fontSize: 13.5, padding: "14px 0" }}>Nothing yet.</p>}
        {group.expenses.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>
                {e.description}{e.recurring ? " ↻" : ""}
              </p>
              <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
                {e.paidByName} paid · your share ${money(e.myShare)}
              </p>
            </div>
            <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 14 }}>${money(e.amount)}</span>
          </div>
        ))}
      </div>

      {/* Members, with pending invites marked so it's clear who hasn't joined. */}
      {!group.implicit && (
        <div style={{ marginTop: 22 }}>
          <p style={{ fontSize: 11.5, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 6 }}>People</p>
          {group.members.map((m) => {
            const l = netLabel(m.net);
            return (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0" }}>
                <Avatar name={m.name} size={30} dim={m.pending} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
                    {m.name}{m.isMe ? " (you)" : ""}
                  </p>
                  {m.pending && <p style={{ margin: 0, fontSize: 12, color: C.amber }}>Invited — hasn't joined yet</p>}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: l.color }}>{l.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {sheet === "expense" && (
        <AddExpenseSheet group={group} onClose={() => setSheet(null)} onSaved={(g) => { setGroup(g); setSheet(null); }} />
      )}
      {sheet === "member" && (
        <AddMemberSheet group={group} onClose={() => setSheet(null)} onSaved={(g) => { setGroup(g); setSheet(null); }} />
      )}
      {sheet === "recurring" && (
        <AddRecurringSheet group={group} onClose={() => setSheet(null)} onSaved={(g) => { setGroup(g); setSheet(null); }} />
      )}
      {sheet === "settle" && settleTarget && (
        <SettleSheet group={group} target={settleTarget} onClose={() => setSheet(null)}
          onSettled={(g) => { setGroup(g); setSheet(null); onUserChanged?.(); }} />
      )}
    </section>
  );
}

// ── add expense ──────────────────────────────────────────
function AddExpenseSheet({ group, onClose, onSaved }) {
  const [form, setForm] = useState({ amount: "", description: "", paidByMemberId: group.myMemberId });
  const [mode, setMode] = useState("EQUAL");
  const [included, setIncluded] = useState(() => group.members.map((m) => m.id));
  const [exact, setExact] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const total = parseFloat(form.amount) || 0;
  const exactSum = Object.values(exact).reduce((t, v) => t + (parseFloat(v) || 0), 0);
  const exactOff = mode === "EXACT" && total > 0 && Math.abs(exactSum - total) > 0.004;

  const toggle = (id) => setIncluded((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = {
        amount: form.amount, description: form.description,
        paidByMemberId: form.paidByMemberId, splitMode: mode,
      };
      if (mode === "EQUAL") body.splitMemberIds = included;
      else body.shares = Object.entries(exact).filter(([, v]) => v !== "").map(([memberId, v]) => ({ memberId, amount: v }));
      onSaved((await api.addExpense(group.id, body)).group);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const canSave = total > 0 && form.description.trim() && !exactOff && (mode === "EXACT" || included.length > 0);

  return (
    <Sheet title="Add an expense" onClose={onClose}>
      <input autoFocus value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        placeholder="Amount" inputMode="decimal" style={sheetInput} />
      <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="What was it for?" style={sheetInput} />

      <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 14 }}>Who paid</label>
      <select value={form.paidByMemberId} onChange={(e) => setForm((f) => ({ ...f, paidByMemberId: e.target.value }))}
        style={{ ...sheetInput, appearance: "auto" }}>
        {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isMe ? " (you)" : ""}</option>)}
      </select>

      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {[{ k: "EQUAL", l: "Split equally" }, { k: "EXACT", l: "Exact amounts" }].map((o) => (
          <button key={o.k} onClick={() => setMode(o.k)}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              border: `1.5px solid ${mode === o.k ? C.brand : C.line}`,
              background: mode === o.k ? C.brandSoft : C.surface, color: mode === o.k ? C.brand : C.ink,
            }}>{o.l}</button>
        ))}
      </div>

      {mode === "EQUAL" ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 12.5, color: C.muted, margin: "0 0 4px" }}>
            Split between {included.length} {included.length === 1 ? "person" : "people"}
            {total > 0 && included.length > 0 ? ` · $${money(total / included.length)} each` : ""}
          </p>
          {group.members.map((m) => (
            <button key={m.id} onClick={() => toggle(m.id)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 0", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <div style={{
                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                border: `1.5px solid ${included.includes(m.id) ? C.brand : C.line}`,
                background: included.includes(m.id) ? C.brand : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {included.includes(m.id) && <Check size={13} color="#fff" strokeWidth={3} />}
              </div>
              <span style={{ fontSize: 14 }}>{m.name}{m.isMe ? " (you)" : ""}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {group.members.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{m.name}{m.isMe ? " (you)" : ""}</span>
              <input value={exact[m.id] ?? ""} onChange={(e) => setExact((x) => ({ ...x, [m.id]: e.target.value }))}
                placeholder="0.00" inputMode="decimal"
                style={{ ...sheetInput, width: 100, marginTop: 0, textAlign: "right" }} />
            </div>
          ))}
          <p style={{ fontSize: 12.5, marginTop: 8, color: exactOff ? C.red : C.muted }}>
            {exactOff
              ? `Shares total $${money(exactSum)} — needs to be $${money(total)}`
              : `Shares total $${money(exactSum)}`}
          </p>
        </div>
      )}

      {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
      <button onClick={save} disabled={busy || !canSave} style={{ ...primaryBtn, opacity: busy || !canSave ? 0.5 : 1 }}>
        {busy ? "…" : "Add expense"}
      </button>
    </Sheet>
  );
}

// ── add member ───────────────────────────────────────────
function AddMemberSheet({ group, onClose, onSaved }) {
  const [by, setBy] = useState("handle");
  const [form, setForm] = useState({ handle: "", email: "", name: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = by === "handle" ? { handle: form.handle } : { email: form.email, name: form.name };
      onSaved((await api.addGroupMember(group.id, body)).group);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet title="Add someone" onClose={onClose}>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {[{ k: "handle", l: "On even" }, { k: "email", l: "By email" }].map((o) => (
          <button key={o.k} onClick={() => { setBy(o.k); setErr(""); }}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              border: `1.5px solid ${by === o.k ? C.brand : C.line}`,
              background: by === o.k ? C.brandSoft : C.surface, color: by === o.k ? C.brand : C.ink,
            }}>{o.l}</button>
        ))}
      </div>

      {by === "handle" ? (
        <input autoFocus value={form.handle} onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
          placeholder="@handle" style={sheetInput} />
      ) : (
        <>
          <input autoFocus value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Email address" type="email" style={sheetInput} />
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Their name (optional)" style={sheetInput} />
          <p style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
            You can start splitting with them right away. When they join even with this email, they'll see the group and what they owe.
          </p>
        </>
      )}

      {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
      <button onClick={save} disabled={busy || (by === "handle" ? !form.handle.trim() : !form.email.trim())}
        style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
        {busy ? "…" : "Add to group"}
      </button>
    </Sheet>
  );
}

// ── recurring ────────────────────────────────────────────
function AddRecurringSheet({ group, onClose, onSaved }) {
  const [form, setForm] = useState({
    amount: "", description: "", paidByMemberId: group.myMemberId,
    interval: "MONTHLY", dayOfMonth: 1, dayOfWeek: 1,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try { onSaved((await api.addRecurring(group.id, form)).group); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet title="Recurring expense" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
        Rent, utilities, subscriptions — added automatically each period and split equally.
      </p>
      <input autoFocus value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
        placeholder="Amount" inputMode="decimal" style={sheetInput} />
      <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="What is it? (e.g. Rent)" style={sheetInput} />

      <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 14 }}>Who pays it</label>
      <select value={form.paidByMemberId} onChange={(e) => setForm((f) => ({ ...f, paidByMemberId: e.target.value }))}
        style={{ ...sheetInput, appearance: "auto" }}>
        {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.isMe ? " (you)" : ""}</option>)}
      </select>

      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {[{ k: "MONTHLY", l: "Monthly" }, { k: "WEEKLY", l: "Weekly" }].map((o) => (
          <button key={o.k} onClick={() => setForm((f) => ({ ...f, interval: o.k }))}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 12, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              border: `1.5px solid ${form.interval === o.k ? C.brand : C.line}`,
              background: form.interval === o.k ? C.brandSoft : C.surface, color: form.interval === o.k ? C.brand : C.ink,
            }}>{o.l}</button>
        ))}
      </div>

      {form.interval === "MONTHLY" ? (
        <>
          <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 12 }}>Day of the month</label>
          <select value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))}
            style={{ ...sheetInput, appearance: "auto" }}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <p style={{ fontSize: 11.5, color: C.muted, marginTop: 6 }}>Up to the 28th, so it never skips February.</p>
        </>
      ) : (
        <>
          <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 12 }}>Day of the week</label>
          <select value={form.dayOfWeek} onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
            style={{ ...sheetInput, appearance: "auto" }}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </>
      )}

      {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
      <button onClick={save} disabled={busy || !(parseFloat(form.amount) > 0) || !form.description.trim()}
        style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
        {busy ? "…" : "Save recurring expense"}
      </button>
    </Sheet>
  );
}

// ── settle up ────────────────────────────────────────────
function SettleSheet({ group, target, onClose, onSettled }) {
  const [amount, setAmount] = useState(String(target.amount.toFixed(2)));
  const [speed, setSpeed] = useState("STANDARD");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const go = async (method) => {
    setBusy(true); setErr("");
    try { onSettled((await api.settle(group.id, { toMemberId: target.toMemberId, amount, method, speed })).group); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet title={`Settle with ${target.toName}`} onClose={onClose}>
      <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>
        Netted across everything in {group.name}. No fee — you're moving money you already owe.
      </p>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" style={sheetInput} />

      {target.canTransfer ? (
        <>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            {[{ k: "STANDARD", l: "Standard", s: "1–3 business days" }, { k: "EXPRESS", l: "Express", s: "Same business day" }].map((o) => (
              <button key={o.k} onClick={() => setSpeed(o.k)}
                style={{
                  flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                  border: `1.5px solid ${speed === o.k ? C.brand : C.line}`,
                  background: speed === o.k ? C.brandSoft : C.surface,
                }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: speed === o.k ? C.brand : C.ink }}>{o.l}</div>
                <div style={{ fontSize: 11.5, color: C.muted }}>{o.s}</div>
              </button>
            ))}
          </div>
          {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
          <button onClick={() => go("transfer")} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
            {busy ? "…" : `Send $${money(parseFloat(amount) || 0)}`}
          </button>
        </>
      ) : (
        <div style={{ marginTop: 12, background: "#FFF6E5", border: "1px solid #F0DDB0", borderRadius: 12, padding: "11px 13px" }}>
          <p style={{ margin: 0, fontSize: 12.5, color: "#8A6416" }}>
            A bank transfer needs you both verified with a linked bank. You can still record that you settled up another way.
          </p>
        </div>
      )}

      {err && !target.canTransfer && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
      <button onClick={() => go("cash")} disabled={busy}
        style={{ width: "100%", marginTop: 10, padding: 13, borderRadius: 14, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer", opacity: busy ? 0.5 : 1 }}>
        <Wallet size={15} /> We settled outside even
      </button>
    </Sheet>
  );
}
