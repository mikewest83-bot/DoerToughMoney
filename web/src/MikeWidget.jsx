import React, { useState } from "react";
import { MessageCircle, X } from "lucide-react";

// Floating "Talk to Mike" launcher, embedded on every screen (landing + app).
//
// This intentionally does NOT duplicate Mike AI's code or credentials into
// DoerToughMoney. It iframes the live, standalone Mike AI app
// (https://doertoughmikeai.com) so there is exactly one Mike AI running
// anywhere — this widget is just a window onto it. Nothing here talks to
// DoerToughMoney's API, database, or auth.
const MIKE_AI_URL = "https://doertoughmikeai.com";

export default function MikeWidget() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  const toggle = () => {
    setOpen((v) => !v);
    if (!everOpened) setEverOpened(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "Close Mike AI" : "Talk to Mike"}
        aria-expanded={open}
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: 0,
          background: "#12A150",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(18,161,80,.35)",
          cursor: "pointer",
          zIndex: 999998,
        }}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Mike AI"
          style={{
            position: "fixed",
            right: 20,
            bottom: 88,
            width: "min(380px, calc(100vw - 40px))",
            height: "min(620px, calc(100vh - 120px))",
            borderRadius: 20,
            overflow: "hidden",
            background: "#0B0B0C",
            boxShadow: "0 24px 64px rgba(0,0,0,.35)",
            zIndex: 999999,
          }}
        >
          {everOpened && (
            <iframe
              title="Mike AI"
              src={MIKE_AI_URL}
              allow="microphone; autoplay"
              style={{ width: "100%", height: "100%", border: 0, display: "block" }}
            />
          )}
        </div>
      )}
    </>
  );
}
