import { useState, useEffect, useCallback } from "react";
import {
  Plus, X, Users, ArrowLeft, Check, Repeat, Trash2, UserPlus, ArrowRight,
  Bell, Send,
} from "lucide-react";
import { api } from "./api.js";

// Shared visual language with App.jsx. Kept local so this screen can be
// reasoned about on its own.
const C = {
  ink: "#16151A", canvas: "#F1F1F5", surface: "#FFFFFF",
  brand: "#5B4DF5", brandSoft: "#ECEAFE", green: "#12A150",
  greenSoft: "#E4F5EC", amber: "#E8A33D", muted: "#7A7A86", line: "#E6E6EC",
  red: "#E5556E", redSoft: "#FDECEF",
};
const display = "'Bricolage Grotesque', sans-serif"; // character — used for names and figures
const mono = "'Space Mono', monospace";              // precision — used for money

const money = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AV = ["#5B4DF5", "#12A150", "#E8A33D", "#E5556E", "#2AA6C4", "#8B5CF6", "#EC6C3E"];
const initials = (n = "") => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const colorFor = (n = "") => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % AV.length; return AV[h]; };

// "Monthly on the 1" read as unfinished; ordinals fix it.
const ordinal = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  const s = ["th", "st", "nd", "rd"];
  return v + (s[(v % 100 - 20) % 10] || s[v % 100] || s[0]);
};

const GROUP_TYPES = [
  { key: "HOUSEHOLD", label: "Household" },
  { key: "TRIP", label: "Trip" },
  { key: "TEAM", label: "Team" },
  { key: "OTHER", label: "Other" },
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const sheetInput = { width: "100%", border: "none", outline: "none", background: C.canvas, borderRadius: 14, padding: "12px 14px", fontSize: 15, marginTop: 8 };
const primaryBtn = { width: "100%", marginTop: 14, padding: 14, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15.5, cursor: "pointer" };
const iconBtn = { background: "none", border: "none", padding: 4, cursor: "pointer", color: C.ink };
const sectionLabel = { fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: "0.07em", margin: 0 };

// Carried by this module rather than relying on App.jsx's global block, so the
// group screens style correctly wherever they're mounted. Horizontal card
// strips scroll by touch/drag; the desktop track read as a stray gray bar.
const groupStyles = (
  <style>{`
    .no-scrollbar{scrollbar-width:none;-ms-overflow-style:none}
    .no-scrollbar::-webkit-scrollbar{display:none}
  `}</style>
);

function Avatar({ name, size = 36, dim = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size / 3,
      background: dim ? C.line : colorFor(name),
      color: dim ? C.muted : "#fff",
      fontSize: size * 0.34, fontWeight: 600, letterSpacing: "-0.02em",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}>{initials(name)}</div>
  );
}

// Overlapping avatars — communicates "who's in this" without a fourth list.
function AvatarStack({ members, size = 24, max = 4 }) {
  const shown = members.slice(0, max);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {shown.map((m, i) => (
        // Light overlap only — enough to read as a group, not so much that the
        // initials turn into mush.
        <div key={m.id} style={{ marginLeft: i ? -size / 5 : 0, borderRadius: size / 3, boxShadow: `0 0 0 2px ${C.surface}` }}>
          <Avatar name={m.name} size={size} dim={m.pending} />
        </div>
      ))}
      {members.length > max && (
        <span style={{ marginLeft: 6, fontSize: 11.5, color: C.muted, fontWeight: 600 }}>+{members.length - max}</span>
      )}
    </div>
  );
}

// Tinted balance chip. Money reads faster as a chip than as gray text.
function BalanceChip({ net, size = 12.5 }) {
  const owed = net > 0.004, owes = net < -0.004;
  const bg = owed ? C.greenSoft : owes ? C.redSoft : C.canvas;
  const fg = owed ? C.green : owes ? C.red : C.muted;
  const text = owed ? `+$${money(net)}` : owes ? `−$${money(-net)}` : "settled";
  return (
    <span style={{ background: bg, color: fg, borderRadius: 999, padding: "4px 10px", fontSize: size, fontWeight: 700, fontFamily: net === 0 ? "inherit" : mono, whiteSpace: "nowrap" }}>
      {text}
    </span>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 30, display: "flex", flexDirection: "column", justifyContent: "flex-end", background: "rgba(20,19,26,.4)" }}>
      <div className="sheet-enter" onClick={(e) => e.stopPropagation()}
        style={{ background: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: "16px 20px 28px", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: display, fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>{title}</span>
          <button onClick={onClose} style={iconBtn}><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── incoming nudges ──────────────────────────────────────
// Shown at the top of the app, because a reminder nobody sees is not a feature.
// Tapping it goes straight to the group so settling is one step away.
export function ReminderBanners({ onOpenGroup }) {
  const [reminders, setReminders] = useState([]);

  const load = useCallback(async () => {
    try { setReminders((await api.reminders()).reminders); } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const dismiss = async (id) => {
    setReminders((rs) => rs.filter((r) => r.id !== id)); // optimistic
    try { await api.dismissReminder(id); } catch { load(); }
  };

  if (reminders.length === 0) return null;

  // Cap what's shown: several tall banners buried the whole app behind them.
  const MAX = 3;
  const shown = reminders.slice(0, MAX);
  const extra = reminders.length - shown.length;

  return (
    <div style={{ padding: "12px 20px 0", display: "flex", flexDirection: "column", gap: 7 }}>
      {shown.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 15, background: C.brandSoft, border: "1px solid #D9D4FB" }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Bell size={14} color="#fff" />
          </div>
          {/* Single line so a stack of nudges stays compact. */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.fromName.split(" ")[0]} wants <span style={{ fontFamily: mono, fontWeight: 700 }}>${money(r.amount)}</span>
            </p>
            <p style={{ margin: 0, fontSize: 11.5, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {r.note ? `${r.note} · ${r.groupName}` : r.groupName}
            </p>
          </div>
          <button onClick={() => { dismiss(r.id); onOpenGroup(r.groupId); }}
            style={{ border: "none", background: C.brand, color: "#fff", borderRadius: 10, padding: "6px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
            Settle
          </button>
          <button onClick={() => dismiss(r.id)} aria-label="Dismiss" style={{ ...iconBtn, color: C.muted, flexShrink: 0, padding: 2 }}>
            <X size={15} />
          </button>
        </div>
      ))}
      {extra > 0 && (
        <p style={{ margin: "2px 0 0", fontSize: 12, color: C.muted, textAlign: "center" }}>
          +{extra} more {extra === 1 ? "request" : "requests"} in your groups
        </p>
      )}
    </div>
  );
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

  const named = groups.filter((g) => !g.implicit);
  const pairs = groups.filter((g) => g.implicit && Math.abs(g.myNet) > 0.004);
  // One number that answers "where do I stand overall".
  const overall = groups.reduce((t, g) => t + g.myNet, 0);

  return (
    <section style={{ padding: "8px 20px 32px" }}>
      {groupStyles}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={sectionLabel}>Shared</p>
          {ready && groups.length > 0 && (
            <p style={{ margin: "6px 0 0", fontFamily: display, fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: overall > 0.004 ? C.green : overall < -0.004 ? C.red : C.ink }}>
              {overall > 0.004 ? "+" : overall < -0.004 ? "−" : ""}${money(Math.abs(overall))}
            </p>
          )}
          {ready && groups.length > 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>
              {overall > 0.004 ? "owed to you overall" : overall < -0.004 ? "you owe overall" : "all settled up"}
            </p>
          )}
        </div>
        <button onClick={() => { setErr(""); setCreating(true); }}
          style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: C.ink, color: "#fff", borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          <Plus size={14} /> New
        </button>
      </div>

      {ready && named.length === 0 && pairs.length === 0 && (
        <div style={{ textAlign: "center", padding: "34px 12px", marginTop: 16, borderRadius: 20, border: `1px dashed ${C.line}` }}>
          <Users size={26} color={C.brand} style={{ opacity: 0.6 }} />
          <p style={{ fontFamily: display, fontSize: 17, fontWeight: 700, margin: "12px 0 0", letterSpacing: "-0.02em" }}>Split rent, trips, dinners</p>
          <p style={{ fontSize: 13, color: C.muted, margin: "6px 0 0", lineHeight: 1.5 }}>
            Track what everyone owes, then settle in one transfer.<br />No bank needed to start.
          </p>
        </div>
      )}

      {/* Groups as cards — distinct from the flat rows used elsewhere. */}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {named.map((g) => (
          <button key={g.id} onClick={() => onOpen(g.id)}
            style={{ display: "flex", alignItems: "center", gap: 13, padding: "14px 15px", borderRadius: 18, background: C.surface, border: `1px solid ${C.line}`, textAlign: "left", cursor: "pointer", width: "100%" }}>
            <div style={{ width: 40, height: 40, borderRadius: 13, background: C.brandSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Users size={18} color={C.brand} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontFamily: display, fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
                <AvatarStack members={g.members} size={22} />
                {g.recurring.length > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11.5, color: C.muted }}>
                    <Repeat size={11} /> {g.recurring.length}
                  </span>
                )}
              </div>
            </div>
            <BalanceChip net={g.myNet} />
          </button>
        ))}
      </div>

      {pairs.length > 0 && (
        <>
          <p style={{ ...sectionLabel, marginTop: 24 }}>One-off splits</p>
          <div style={{ marginTop: 8 }}>
            {pairs.map((g) => {
              const other = g.members.find((m) => !m.isMe);
              return (
                <button key={g.id} onClick={() => onOpen(g.id)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "11px 0", background: "none", border: "none", borderBottom: `1px solid ${C.line}`, textAlign: "left", cursor: "pointer" }}>
                  <Avatar name={other?.name || g.name} size={34} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{other?.name || g.name}</p>
                    <p style={{ margin: 0, fontSize: 12.5, color: C.muted }}>{g.expenses.length} shared {g.expenses.length === 1 ? "item" : "items"}</p>
                  </div>
                  <BalanceChip net={g.myNet} />
                </button>
              );
            })}
          </div>
        </>
      )}

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
  const [sheet, setSheet] = useState(null);
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

  const owes = group.myNet < -0.004;
  const owed = group.myNet > 0.004;
  // When you're in debt, settling is the point of the screen — so it becomes
  // the primary action instead of hiding beside a list row.
  const topDebt = group.iOwe[0];

  const openSettle = (t) => { setSettleTarget(t); setSheet("settle"); };

  return (
    <section style={{ padding: "8px 20px 32px" }}>
      {groupStyles}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button onClick={onBack} style={iconBtn}><ArrowLeft size={20} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontFamily: display, fontSize: 19, fontWeight: 800, letterSpacing: "-0.03em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {group.name}
          </p>
        </div>
        {!group.implicit && (
          <button onClick={() => setSheet("member")} title="Add someone"
            style={{ ...iconBtn, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 999, padding: 8, display: "flex" }}>
            <UserPlus size={16} />
          </button>
        )}
      </div>

      {/* Hero: your position, and the action that follows from it. */}
      <div style={{ marginTop: 12, borderRadius: 22, padding: 20, background: C.ink, color: "#fff" }}>
        <span style={{ color: "#B9B9C6", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          {owed ? "You're owed" : owes ? "You owe" : "Your balance"}
        </span>
        <p style={{ margin: "8px 0 0", fontFamily: mono, fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>
          ${money(Math.abs(group.myNet))}
        </p>
        {group.myNet === 0 && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#B9B9C6" }}>All settled up</p>}

        {topDebt && (
          <button onClick={() => openSettle(topDebt)}
            style={{ width: "100%", marginTop: 16, padding: 13, borderRadius: 14, border: "none", background: C.brand, color: "#fff", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
            Settle ${money(topDebt.amount)} with {topDebt.toName.split(" ")[0]} <ArrowRight size={16} />
          </button>
        )}
      </div>

      {/* Any remaining debts beyond the one promoted into the hero. */}
      {group.iOwe.length > 1 && (
        <div style={{ marginTop: 18 }}>
          <p style={sectionLabel}>Also owed by you</p>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {group.iOwe.slice(1).map((t) => (
              <div key={t.toMemberId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 16, background: C.surface, border: `1px solid ${C.line}` }}>
                <Avatar name={t.toName} size={32} />
                <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600 }}>{t.toName}</span>
                <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14 }}>${money(t.amount)}</span>
                <button onClick={() => openSettle(t)}
                  style={{ border: "none", background: C.brandSoft, color: C.brand, borderRadius: 10, padding: "7px 11px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                  Settle
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* People who owe you, with a nudge for each. This is the half of the
          product that turns "tracked" into "actually paid". */}
      {group.owedToMe.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={sectionLabel}>Owed to you</p>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            {group.owedToMe.map((t) => (
              <OwedRow key={t.fromMemberId} group={group} t={t} onUpdated={setGroup} />
            ))}
          </div>
        </div>
      )}

      {/* Everyone's position, once — horizontally, so it doesn't read as another
          copy of the list above it. */}
      {!group.implicit && (
        <div style={{ marginTop: 20 }}>
          <p style={sectionLabel}>Everyone</p>
          {/* noScrollbar hides the desktop scrollbar track; touch devices never
              showed one and it read as a stray gray bar. */}
          <div className="no-scrollbar" style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto", paddingBottom: 2 }}>
            {group.members.map((m) => (
              <div key={m.id} style={{
                flexShrink: 0, width: 108, padding: "13px 11px", borderRadius: 16,
                background: C.surface, border: `1px solid ${m.isMe ? C.brand : C.line}`,
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8,
              }}>
                <Avatar name={m.name} size={30} dim={m.pending} />
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 86 }}>
                    {m.isMe ? "You" : m.name.split(" ")[0]}
                  </p>
                  {m.pending && <p style={{ margin: 0, fontSize: 10.5, color: C.amber, fontWeight: 600 }}>Invited</p>}
                </div>
                <BalanceChip net={m.net} size={11.5} />
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => setSheet("expense")}
        style={{ width: "100%", marginTop: 20, borderRadius: 16, padding: "13px 0", border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontWeight: 700, fontSize: 14.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
        <Plus size={16} /> Add an expense
      </button>

      {/* Single activity list. Recurring items are badged here rather than
          duplicated into their own section — seeing rent twice in a money app
          makes people think they were charged twice. */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={sectionLabel}>Expenses</p>
          {!group.implicit && (
            <button onClick={() => setSheet("recurring")}
              style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", color: C.brand, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              <Repeat size={13} /> Recurring{group.recurring.length ? ` · ${group.recurring.length}` : ""}
            </button>
          )}
        </div>

        {group.expenses.length === 0 && (
          <p style={{ color: C.muted, fontSize: 13.5, padding: "16px 0" }}>Nothing yet — add the first expense above.</p>
        )}
        <div style={{ marginTop: 6 }}>
          {group.expenses.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.description}</p>
                  {e.recurring && (
                    <span title="Added automatically" style={{ display: "flex", alignItems: "center", gap: 3, background: C.canvas, color: C.muted, borderRadius: 999, padding: "2px 7px", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                      <Repeat size={9} /> AUTO
                    </span>
                  )}
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 12.5, color: C.muted }}>
                  {/* Second person when it's the viewer — "Jane Merchant paid"
                      reads oddly to Jane. */}
                  {e.paidByMemberId === group.myMemberId ? "You" : e.paidByName.split(" ")[0]} paid · your share ${money(e.myShare)}
                </p>
              </div>
              <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14 }}>${money(e.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      {sheet === "expense" && (
        <AddExpenseSheet group={group} onClose={() => setSheet(null)} onSaved={(g) => { setGroup(g); setSheet(null); }} />
      )}
      {sheet === "member" && (
        <AddMemberSheet group={group} onClose={() => setSheet(null)} onSaved={(g) => { setGroup(g); setSheet(null); }} />
      )}
      {sheet === "recurring" && (
        <RecurringSheet group={group} onClose={() => setSheet(null)} onSaved={setGroup} />
      )}
      {sheet === "settle" && settleTarget && (
        <SettleSheet group={group} target={settleTarget} onClose={() => setSheet(null)}
          onSettled={(g) => { setGroup(g); setSheet(null); onUserChanged?.(); }} />
      )}
    </section>
  );
}

// One person who owes you, plus the nudge. Three states: send a nudge, already
// nudged (cooldown), or share a message because they haven't joined yet.
function OwedRow({ group, t, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(false);

  const remind = async () => {
    setBusy(true); setErr("");
    try {
      onUpdated((await api.remind(group.id, { toMemberId: t.fromMemberId })).group);
      setSent(true);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // They aren't on even, so there's no in-app inbox to nudge. Hand the user
  // text to send themselves rather than emailing on their behalf.
  const share = async () => {
    const text = `Hey ${t.fromName.split(" ")[0]} — you owe me $${money(t.amount)} for ${group.name}. You can settle up on even: ${location.origin}/signup`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); setSent(true); }
    } catch { /* user dismissed the share sheet */ }
  };

  const reminded = !t.canRemind && t.joined && t.remindHoursLeft > 0;

  return (
    <div style={{ padding: "11px 13px", borderRadius: 16, background: C.surface, border: `1px solid ${C.line}` }}>
      {/* One line regardless of name length: the name truncates, and the amount
          and action never shrink. Long names used to wrap and make rows
          uneven heights. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Avatar name={t.fromName} size={32} dim={!t.joined} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {t.fromName}
          </p>
          <p style={{ margin: 0, fontSize: 11.5, color: !t.joined ? C.amber : C.muted, fontWeight: !t.joined ? 600 : 400, whiteSpace: "nowrap" }}>
            {!t.joined ? "Hasn't joined yet" : reminded ? `Nudged · again in ${t.remindHoursLeft}h` : " "}
          </p>
        </div>
        <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 14, color: C.green, flexShrink: 0 }}>${money(t.amount)}</span>

        {!t.joined ? (
          <button onClick={share}
            style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: C.canvas, color: C.ink, borderRadius: 10, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
            <Send size={12} /> {sent ? "Copied" : "Ask"}
          </button>
        ) : reminded || sent ? (
          <span style={{ display: "flex", alignItems: "center", gap: 4, color: C.muted, fontSize: 12, fontWeight: 600, padding: "7px 2px", flexShrink: 0 }}>
            <Check size={13} /> Sent
          </span>
        ) : (
          <button onClick={remind} disabled={busy}
            style={{ display: "flex", alignItems: "center", gap: 5, border: "none", background: C.brandSoft, color: C.brand, borderRadius: 10, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.5 : 1, flexShrink: 0 }}>
            <Bell size={12} /> Nudge
          </button>
        )}
      </div>
      {err && <p style={{ margin: "8px 0 0", fontSize: 12, color: C.red }}>{err}</p>}
    </div>
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
      const body = { amount: form.amount, description: form.description, paidByMemberId: form.paidByMemberId, splitMode: mode };
      if (mode === "EQUAL") body.splitMemberIds = included;
      else body.shares = Object.entries(exact).filter(([, v]) => v !== "").map(([memberId, v]) => ({ memberId, amount: v }));
      onSaved((await api.addExpense(group.id, body)).group);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const canSave = total > 0 && form.description.trim() && !exactOff && (mode === "EXACT" || included.length > 0);

  return (
    <Sheet title="Add an expense" onClose={onClose}>
      {/* Amount gets the display treatment — it's the thing being entered. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, background: C.canvas, borderRadius: 16, padding: "14px 16px" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: total ? C.ink : C.muted }}>$</span>
        <input autoFocus value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          placeholder="0.00" inputMode="decimal"
          style={{ border: "none", outline: "none", background: "transparent", fontFamily: mono, fontSize: 26, fontWeight: 700, width: "100%" }} />
      </div>
      <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        placeholder="What was it for?" style={sheetInput} />

      <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 14 }}>Who paid</label>
      <select value={form.paidByMemberId} onChange={(e) => setForm((f) => ({ ...f, paidByMemberId: e.target.value }))}
        style={{ ...sheetInput, appearance: "auto" }}>
        {group.members.map((m) => <option key={m.id} value={m.id}>{m.isMe ? "You" : m.name}</option>)}
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
            {included.length} {included.length === 1 ? "person" : "people"}
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
              <span style={{ fontSize: 14 }}>{m.isMe ? "You" : m.name}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          {group.members.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ flex: 1, fontSize: 14 }}>{m.isMe ? "You" : m.name}</span>
              <input value={exact[m.id] ?? ""} onChange={(e) => setExact((x) => ({ ...x, [m.id]: e.target.value }))}
                placeholder="0.00" inputMode="decimal"
                style={{ ...sheetInput, width: 100, marginTop: 0, textAlign: "right", fontFamily: mono }} />
            </div>
          ))}
          <p style={{ fontSize: 12.5, marginTop: 8, color: exactOff ? C.red : C.muted }}>
            {exactOff ? `Totals $${money(exactSum)} — needs to be $${money(total)}` : `Totals $${money(exactSum)}`}
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
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
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
          <p style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
            Start splitting with them right away. When they join even with this email, they'll see the group and what they owe.
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

// ── recurring (manage + add in one place) ────────────────
function RecurringSheet({ group, onClose, onSaved }) {
  const [adding, setAdding] = useState(group.recurring.length === 0);
  const [form, setForm] = useState({
    amount: "", description: "", paidByMemberId: group.myMemberId,
    interval: "MONTHLY", dayOfMonth: 1, dayOfWeek: 1,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      onSaved((await api.addRecurring(group.id, form)).group);
      setForm((f) => ({ ...f, amount: "", description: "" }));
      setAdding(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async (id) => {
    try { onSaved((await api.deleteRecurring(group.id, id)).group); } catch (e) { setErr(e.message); }
  };

  const cadence = (r) => r.interval === "MONTHLY" ? `Monthly on the ${ordinal(r.dayOfMonth)}` : `Every ${DAYS[r.dayOfWeek] ?? "week"}`;
  // First name only — full names wrapped this line onto two.
  const payer = (r) => (r.paidByName === group.members.find((m) => m.isMe)?.name ? "you" : r.paidByName.split(" ")[0]);

  return (
    <Sheet title="Recurring expenses" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 1.5 }}>
        Rent, utilities, subscriptions — added automatically each period and split equally.
      </p>

      {group.recurring.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {group.recurring.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: C.canvas, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Repeat size={14} color={C.muted} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{r.description}</p>
                <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{cadence(r)} · {payer(r)} pays</p>
              </div>
              <span style={{ fontFamily: mono, fontWeight: 700, fontSize: 13.5 }}>${money(r.amount)}</span>
              <button onClick={() => remove(r.id)} title="Stop this recurring expense" style={iconBtn}>
                <Trash2 size={15} color={C.muted} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <button onClick={() => setAdding(true)}
          style={{ width: "100%", marginTop: 14, padding: 13, borderRadius: 14, border: `1px dashed ${C.line}`, background: "transparent", color: C.brand, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, cursor: "pointer" }}>
          <Plus size={15} /> Add a recurring expense
        </button>
      ) : (
        <>
          <input autoFocus value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            placeholder="Amount" inputMode="decimal" style={{ ...sheetInput, marginTop: 14, fontFamily: mono }} />
          <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What is it? (e.g. Rent)" style={sheetInput} />

          <label style={{ fontSize: 12.5, color: C.muted, display: "block", marginTop: 14 }}>Who pays it</label>
          <select value={form.paidByMemberId} onChange={(e) => setForm((f) => ({ ...f, paidByMemberId: e.target.value }))}
            style={{ ...sheetInput, appearance: "auto" }}>
            {group.members.map((m) => <option key={m.id} value={m.id}>{m.isMe ? "You" : m.name}</option>)}
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
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{ordinal(d)}</option>)}
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
            style={{ ...primaryBtn, opacity: busy || !(parseFloat(form.amount) > 0) || !form.description.trim() ? 0.5 : 1 }}>
            {busy ? "…" : "Save recurring expense"}
          </button>
        </>
      )}
      {err && !adding && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
    </Sheet>
  );
}

// ── settle up ────────────────────────────────────────────
function SettleSheet({ group, target, onClose, onSettled }) {
  const [amount, setAmount] = useState(String(target.amount.toFixed(2)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Cash-only: DoerToughMoney doesn't move money between users, so settling
  // up just records that a payoff happened outside the app.
  const go = async () => {
    setBusy(true); setErr("");
    try { onSettled((await api.settle(group.id, { toMemberId: target.toMemberId, amount })).group); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Sheet title={`Settle with ${target.toName.split(" ")[0]}`} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 12 }}>
        <Avatar name={target.toName} size={38} />
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>{target.toName}</p>
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>Netted across all of {group.name}</p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, background: C.canvas, borderRadius: 16, padding: "14px 16px" }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>$</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
          style={{ border: "none", outline: "none", background: "transparent", fontFamily: mono, fontSize: 26, fontWeight: 700, width: "100%" }} />
      </div>
      <p style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
        This just records that you settled up — DoerToughMoney doesn't move money between accounts.
      </p>

      {err && <p style={{ color: C.red, fontSize: 13, marginTop: 10 }}>{err}</p>}
      <button onClick={go} disabled={busy} style={{ ...primaryBtn, opacity: busy ? 0.5 : 1 }}>
        {busy ? "…" : `Mark $${money(parseFloat(amount) || 0)} as settled`}
      </button>
    </Sheet>
  );
}
