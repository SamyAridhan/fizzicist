import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "./supabase.js";

// ─────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────
const PIN = "060426";
const RM = (n) => `RM ${parseFloat(n || 0).toFixed(2)}`;
const fmtDate = (iso) =>
  new Date(iso).toLocaleString("en-MY", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
const toDateInput = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const DISCOUNTS = [
  { label: "None", value: 0 },
  { label: "RM 0.10", value: 0.10 },
  { label: "RM 0.20", value: 0.20 },
  { label: "RM 0.50", value: 0.50 },
  { label: "RM 1.00", value: 1.00 },
];
const roundMoney = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const parseMoneyInput = (value) => {
  const n = parseFloat(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? roundMoney(Math.max(0, n)) : 0;
};
const countProductItems = (items = []) => items.reduce((s, i) => s + i.count, 0);

// ─────────────────────────────────────────────
// Supabase DB helpers
// ─────────────────────────────────────────────
const db = {
  async getProducts() {
    const { data, error } = await supabase.from("products").select("*").order("created_at");
    if (error) { console.error("getProducts:", error); return []; }
    return data.map((p) => ({ ...p, image: p.image_url || null }));
  },
  async upsertProduct(product) {
    const { error } = await supabase.from("products").upsert({
      id: product.id, name: product.name, price: product.price, image_url: product.image_url || null,
    });
    if (error) throw error;
  },
  async deleteProduct(id) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
  },
  async getTransactions() {
    const { data, error } = await supabase
      .from("transactions").select("*").order("timestamp", { ascending: false });
    if (error) { console.error("getTransactions:", error); return []; }
    return data.map((t) => ({
      ...t,
      user: t.user_name,
      receipt: t.receipt_url || null,
      discount: parseFloat(t.discount || 0),
      tip: parseFloat(t.tip || 0),
      delivery_fee: parseFloat(t.delivery_fee || 0),
      channel: t.channel || "walkin",
    }));
  },
  async insertTransaction(txn) {
    const { error } = await supabase.from("transactions").insert({
      id: txn.id, items: txn.items, total: txn.total,
      discount: parseFloat(txn.discount || 0),
      tip: parseFloat(txn.tip || 0),
      delivery_fee: 0,
      channel: "walkin",
      timestamp: txn.timestamp, user_name: txn.user, receipt_url: txn.receipt_url || null,
    });
    if (error) throw error;
  },
  async uploadImage(bucket, dataUrl, filename) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const { error } = await supabase.storage.from(bucket)
        .upload(filename, blob, { contentType: blob.type, upsert: true });
      if (error) { console.error("uploadImage:", error); return null; }
      const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
      return data.publicUrl;
    } catch (e) { console.error(e); return null; }
  },
};

async function syncToSheets(transactions, products) {
  const url = import.meta.env.VITE_SHEETS_WEBHOOK_URL;
  if (!url) throw new Error("VITE_SHEETS_WEBHOOK_URL not set");
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ transactions, products }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || "Apps Script error");
}

// ─────────────────────────────────────────────
// Colors & Styles
// ─────────────────────────────────────────────
const C = {
  green: "#0A6640", greenLight: "#E8F5EE", greenMid: "#D1FAE5",
  bg: "#F7F7F5", white: "#ffffff", border: "#E5E7EB",
  muted: "#6B7280", hint: "#9CA3AF", text: "#1A1A1A",
  danger: "#DC2626", dangerLight: "#FEF2F2",
  chartColors: ["#0A6640","#10B981","#3B82F6","#F59E0B","#EF4444","#8B5CF6","#EC4899","#06B6D4"],
};

// Safari-safe font stack, no hover side-effects
const BASE_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif";

const ss = {
  app: {
    minHeight: "100vh",
    // Safari fix: use min-height instead of height to avoid viewport bugs
    background: C.bg, maxWidth: 480, margin: "0 auto",
    display: "flex", flexDirection: "column",
    fontFamily: BASE_FONT, fontSize: 14, color: C.text,
    WebkitTextSizeAdjust: "100%", // prevent Safari auto font-size on rotate
  },
  label: {
    fontSize: 11, fontWeight: 700, color: C.muted, display: "block",
    marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase",
  },
  // Safari fix: font-size ≥ 16px prevents auto-zoom on focus
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: `1.5px solid ${C.border}`, fontSize: 16, background: C.white,
    boxSizing: "border-box", outline: "none", fontFamily: BASE_FONT, color: C.text,
    WebkitAppearance: "none", appearance: "none",
  },
  btnPrimary: {
    width: "100%", padding: "14px", background: C.green, color: C.white,
    border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700,
    cursor: "pointer", fontFamily: BASE_FONT,
    WebkitTapHighlightColor: "transparent",
    // Safari fix: explicit -webkit- border-radius
    WebkitBorderRadius: 12,
  },
  btnDanger: {
    padding: "10px 18px", background: C.danger, color: C.white,
    border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14,
    WebkitTapHighlightColor: "transparent",
  },
  btnGhost: {
    padding: "8px 16px", background: C.white, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 8, fontWeight: 600,
    cursor: "pointer", fontSize: 13, fontFamily: BASE_FONT,
    WebkitTapHighlightColor: "transparent",
  },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center",
    // Safari fix: prevent scroll bleed-through
    WebkitOverflowScrolling: "touch",
  },
  sheet: {
    background: C.white, borderRadius: "20px 20px 0 0", padding: "20px 20px 40px",
    width: "100%", maxWidth: 480, boxShadow: "0 -4px 30px rgba(0,0,0,0.12)",
    boxSizing: "border-box", maxHeight: "88vh", overflowY: "auto",
    // Safari fix: momentum scrolling inside sheet
    WebkitOverflowScrolling: "touch",
  },
  closeBtn: {
    background: "#F3F4F6", border: "none", borderRadius: 20, width: 32, height: 32,
    cursor: "pointer", fontSize: 14, color: C.muted,
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
    flexShrink: 0, WebkitTapHighlightColor: "transparent",
  },
  counterBtn: (sm) => ({
    width: sm ? 34 : 48, height: sm ? 34 : 48, borderRadius: sm ? 17 : 24,
    border: `2px solid ${C.greenMid}`, background: C.greenLight,
    color: C.green, fontSize: sm ? 18 : 22, fontWeight: 700,
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", lineHeight: 1, flexShrink: 0,
    WebkitTapHighlightColor: "transparent",
  }),
  card: {
    background: C.white, borderRadius: 12, border: `1px solid ${C.border}`, padding: "14px 16px",
  },
};

// ─────────────────────────────────────────────
// Compress image
// ─────────────────────────────────────────────
function compressImage(file, maxDim = 800, quality = 0.78) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * ratio; canvas.height = img.height * ratio;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// ─────────────────────────────────────────────
// ImagePicker
// ─────────────────────────────────────────────
function ImagePicker({ id, onPick, maxDim = 800 }) {
  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const compressed = await compressImage(file, maxDim, maxDim > 800 ? 0.82 : 0.75);
    onPick(compressed);
  };
  const btnStyle = {
    flex: 1, padding: "14px 0", border: `1.5px solid ${C.border}`, borderRadius: 10,
    background: C.white, cursor: "pointer", display: "flex", flexDirection: "column",
    alignItems: "center", gap: 5, fontSize: 12, color: C.muted, fontWeight: 600,
    fontFamily: BASE_FONT, WebkitTapHighlightColor: "transparent",
  };
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
      <label htmlFor={`${id}-cam`} style={btnStyle}>
        <span style={{ fontSize: 26 }}>📷</span>Camera
      </label>
      <input id={`${id}-cam`} type="file" accept="image/*" capture="environment"
        onChange={handleFile} style={{ display: "none" }} />
      <label htmlFor={`${id}-gal`} style={btnStyle}>
        <span style={{ fontSize: 26 }}>🖼️</span>Gallery
      </label>
      <input id={`${id}-gal`} type="file" accept="image/*"
        onChange={handleFile} style={{ display: "none" }} />
    </div>
  );
}

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
function Toast({ message, type = "success", onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{
      position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
      background: type === "success" ? C.green : C.danger, color: C.white,
      padding: "12px 22px", borderRadius: 24, fontWeight: 600, fontSize: 14,
      zIndex: 999, whiteSpace: "nowrap", boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
      animation: "fzFadeUp 0.2s ease", WebkitAnimation: "fzFadeUp 0.2s ease",
      pointerEvents: "none",
    }}>
      {type === "success" ? "✅ " : "❌ "}{message}
    </div>
  );
}

// ─────────────────────────────────────────────
// Modal (bottom sheet) — Safari scroll fix
// ─────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => {
    // Safari fix: prevent background scroll when modal open
    const prev = document.body.style.overflow;
    const prevPos = document.body.style.position;
    document.body.style.overflow = "hidden";
    document.body.style.position = "relative";
    return () => {
      document.body.style.overflow = prev;
      document.body.style.position = prevPos;
    };
  }, []);
  return (
    <div style={ss.overlay} onClick={onClose}>
      <div style={ss.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>{title}</span>
          <button onClick={onClose} style={ss.closeBtn}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LOGIN PAGE
// ─────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const tap = (d) => { if (pin.length < 6) { setPin((p) => p + d); setErr(""); } };
  const del = () => setPin((p) => p.slice(0, -1));
  const submit = () => {
    if (!name.trim()) { setErr("Please enter your name."); return; }
    if (pin !== PIN) { setErr("Incorrect PIN. Try again."); setPin(""); return; }
    onLogin(name.trim());
  };
  return (
    <div style={{
      minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: 24,
      fontFamily: BASE_FONT,
    }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🥤</div>
        <div style={{ fontSize: 30, fontWeight: 800, color: C.green, letterSpacing: "-0.03em" }}>Fizzicist</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>Sales Dashboard · Sign In</div>
      </div>
      <div style={{
        width: "100%", maxWidth: 340, background: C.white, borderRadius: 18,
        padding: 24, boxShadow: "0 2px 24px rgba(0,0,0,0.07)", border: `1px solid ${C.border}`,
      }}>
        <div style={{ marginBottom: 20 }}>
          <label style={ss.label}>Your Name</label>
          <input style={ss.input} placeholder="e.g. Ali, Siti, Wei..."
            value={name} onChange={(e) => { setName(e.target.value); setErr(""); }}
            autoCapitalize="words" autoCorrect="off" />
        </div>
        <label style={ss.label}>PIN</label>
        <div style={{ display: "flex", gap: 7, justifyContent: "center", margin: "10px 0 16px" }}>
          {Array(6).fill(0).map((_, i) => (
            <div key={i} style={{
              width: 38, height: 46, borderRadius: 8,
              border: `2px solid ${i < pin.length ? C.green : C.border}`,
              background: i < pin.length ? C.greenLight : "#F9FAFB",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: C.green, transition: "border-color 0.12s",
            }}>{i < pin.length ? "●" : ""}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k, i) =>
            k === "" ? <div key={i} /> : (
              <button key={i} onClick={() => k === "⌫" ? del() : tap(String(k))} style={{
                padding: "15px 0", borderRadius: 10, border: `1.5px solid ${C.border}`,
                background: k === "⌫" ? C.dangerLight : C.white,
                color: k === "⌫" ? C.danger : C.text,
                fontSize: 18, fontWeight: 600, cursor: "pointer", fontFamily: BASE_FONT,
                WebkitTapHighlightColor: "transparent",
              }}>{k}</button>
            )
          )}
        </div>
        {err && <div style={{ color: C.danger, fontSize: 13, textAlign: "center", marginBottom: 10, fontWeight: 500 }}>{err}</div>}
        <button onClick={submit} style={ss.btnPrimary}>Login →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PRODUCT CARD
// ─────────────────────────────────────────────
function ProductCard({ product, onSelect, onDelete }) {
  const holdTimer = useRef(null);
  const [held, setHeld] = useState(false);
  const startHold = () => { holdTimer.current = setTimeout(() => setHeld(true), 600); };
  const endHold = () => clearTimeout(holdTimer.current);
  const cancel = (e) => { e.stopPropagation(); setHeld(false); };
  return (
    <div style={{ position: "relative" }}>
      <div onClick={() => !held && onSelect()}
        onTouchStart={startHold} onTouchEnd={endHold}
        onMouseDown={startHold} onMouseUp={endHold}
        style={{
          background: C.white, borderRadius: 14, border: `1px solid ${C.border}`,
          overflow: "hidden", cursor: "pointer", userSelect: "none",
          WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent",
        }}>
        <div style={{ height: 100, background: C.greenLight, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {product.image
            ? <img src={product.image} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} loading="lazy" />
            : <span style={{ fontSize: 40 }}>🥤</span>}
        </div>
        <div style={{ padding: "10px 12px 12px" }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
            {product.name}
          </div>
          <div style={{ color: C.green, fontWeight: 700, fontSize: 15 }}>{RM(product.price)}</div>
        </div>
      </div>
      {held && (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", borderRadius: 14,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, zIndex: 10,
        }}>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); setHeld(false); }} style={ss.btnDanger}>🗑 Delete</button>
          <button onClick={cancel} style={ss.btnGhost}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ADD PRODUCT MODAL
// ─────────────────────────────────────────────
function AddProductModal({ onAdd, onClose }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    const trimmed = name.trim();
    const parsed = parseFloat(price);
    if (!trimmed) { setErr("Product name is required."); return; }
    if (!price || isNaN(parsed) || parsed <= 0) { setErr("Enter a valid price."); return; }
    setSaving(true);
    try {
      const id = String(Date.now());
      let image_url = null;
      if (preview) image_url = await db.uploadImage("product-images", preview, `product_${id}.jpg`);
      const product = { id, name: trimmed, price: parseFloat(parsed.toFixed(2)), image_url, image: image_url };
      await db.upsertProduct(product);
      onAdd(product);
    } catch (e) { console.error(e); setErr("Failed to save."); }
    finally { setSaving(false); }
  };
  return (
    <Modal title="Add Product" onClose={onClose}>
      {preview && <img src={preview} alt="preview" style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 10, marginBottom: 12 }} />}
      <label style={ss.label}>Product Image</label>
      <ImagePicker id="prod" onPick={setPreview} maxDim={600} />
      <div style={{ marginBottom: 14 }}>
        <label style={ss.label}>Product Name</label>
        <input style={ss.input} placeholder="e.g. Fizzy Lemon, Grape Soda..."
          value={name} onChange={(e) => { setName(e.target.value); setErr(""); }}
          autoCapitalize="words" autoCorrect="off" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={ss.label}>Price (RM)</label>
        <input style={ss.input} type="number" inputMode="decimal" placeholder="0.00"
          value={price} onChange={(e) => { setPrice(e.target.value); setErr(""); }} />
      </div>
      {err && <div style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{err}</div>}
      <button onClick={submit} disabled={saving} style={{ ...ss.btnPrimary, opacity: saving ? 0.7 : 1 }}>
        {saving ? "Saving..." : "Add Product"}
      </button>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// PRODUCT DETAIL MODAL
// ─────────────────────────────────────────────
function ProductModal({ product, cartItem, onAdd, onClose }) {
  const [count, setCount] = useState(1);
  return (
    <Modal title={product.name} onClose={onClose}>
      {product.image && <img src={product.image} alt={product.name}
        style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, marginBottom: 16 }} />}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.green }}>{RM(product.price)}</div>
        {cartItem && <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>In cart: <strong>{cartItem.count}</strong></div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 28, marginBottom: 18 }}>
        <button onClick={() => setCount((c) => Math.max(1, c - 1))} style={ss.counterBtn(false)}>−</button>
        <span style={{ fontSize: 32, fontWeight: 800, minWidth: 48, textAlign: "center" }}>{count}</span>
        <button onClick={() => setCount((c) => c + 1)} style={ss.counterBtn(false)}>+</button>
      </div>
      <div style={{ textAlign: "center", color: C.green, fontWeight: 700, fontSize: 16, marginBottom: 18 }}>
        Subtotal: {RM(product.price * count)}
      </div>
      <button onClick={() => onAdd(product, count)} style={ss.btnPrimary}>Add to Cart +</button>
    </Modal>
  );
}

// ─────────────────────────────────────────────
// CART SHEET — with discount section (#2)
// ─────────────────────────────────────────────
function CartSheet({ cart, onUpdate, onClose, onConfirm }) {
  const [discountIdx, setDiscountIdx] = useState(0); // index into DISCOUNTS
  const [tipText, setTipText] = useState("");
  const subtotal  = cart.reduce((s, i) => s + i.price * i.count, 0);
  const discount  = DISCOUNTS[discountIdx].value;
  const tip       = parseMoneyInput(tipText);
  const total     = roundMoney(Math.max(0, subtotal - discount) + tip);

  return (
    <div style={ss.overlay} onClick={onClose}>
      <div style={ss.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, fontSize: 17 }}>🛒 Cart</span>
          <button onClick={onClose} style={ss.closeBtn}>✕</button>
        </div>

        {cart.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: C.muted }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>🛒</div>
            <div style={{ fontWeight: 600 }}>Your cart is empty</div>
          </div>
        ) : (
          <>
            {/* Item rows */}
            {cart.map((item) => (
              <div key={item.productId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: `1px solid #F3F4F6` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{RM(item.price)} each</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => onUpdate(item.productId, -1)} style={ss.counterBtn(true)}>−</button>
                  <span style={{ fontWeight: 700, fontSize: 16, minWidth: 24, textAlign: "center" }}>{item.count}</span>
                  <button onClick={() => onUpdate(item.productId, +1)} style={ss.counterBtn(true)}>+</button>
                </div>
                <div style={{ minWidth: 64, textAlign: "right", fontWeight: 700, color: C.green, fontSize: 14 }}>
                  {RM(item.price * item.count)}
                </div>
              </div>
            ))}

            {/* Discount row (#2) */}
            <div style={{
              margin: "14px 0 0", padding: "12px 14px",
              background: discountIdx > 0 ? "#FFF7ED" : "#F9FAFB",
              borderRadius: 10,
              border: `1.5px solid ${discountIdx > 0 ? "#FED7AA" : C.border}`,
              transition: "background 0.2s, border-color 0.2s",
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 10, letterSpacing: "0.05em" }}>
                DISCOUNT
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DISCOUNTS.map((d, idx) => {
                  const active = discountIdx === idx;
                  return (
                    <button key={idx} onClick={() => setDiscountIdx(idx)} style={{
                      padding: "7px 12px", borderRadius: 20, border: "none", cursor: "pointer",
                      fontFamily: BASE_FONT, fontSize: 13, fontWeight: active ? 700 : 500,
                      background: active ? (idx === 0 ? C.green : "#F97316") : "#F3F4F6",
                      color: active ? C.white : C.muted,
                      WebkitTapHighlightColor: "transparent",
                      transition: "background 0.15s, color 0.15s",
                    }}>{d.label}</button>
                  );
                })}
              </div>
            </div>

            {/* Tip row */}
            <div style={{
              margin: "10px 0 0", padding: "10px 14px",
              background: tip > 0 ? C.greenLight : "#F9FAFB",
              borderRadius: 10,
              border: `1.5px solid ${tip > 0 ? C.greenMid : C.border}`,
              display: "flex", alignItems: "center", gap: 12,
              transition: "background 0.2s, border-color 0.2s",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.05em" }}>
                  TIP / KEEP CHANGE
                </div>
                <div style={{ fontSize: 12, color: tip > 0 ? C.green : C.hint, marginTop: 2 }}>
                  Optional
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 13, color: C.muted, fontWeight: 700 }}>RM</span>
                <input
                  value={tipText}
                  onChange={(e) => setTipText(e.target.value)}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  style={{
                    width: 86, padding: "8px 10px", borderRadius: 8,
                    border: `1.5px solid ${tip > 0 ? C.greenMid : C.border}`,
                    background: tip > 0 ? C.white : "#F3F4F6",
                    color: tip > 0 ? C.text : C.hint,
                    fontSize: 16, fontWeight: 700, textAlign: "right",
                    fontFamily: BASE_FONT, outline: "none",
                    WebkitAppearance: "none", appearance: "none",
                  }}
                />
              </div>
            </div>

            {/* Totals */}
            <div style={{ marginTop: 12 }}>
              {(discount > 0 || tip > 0) && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: C.muted }}>
                  <span>Subtotal</span>
                  <span>{RM(subtotal)}</span>
                </div>
              )}
              {discount > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#F97316", fontWeight: 600 }}>
                  <span>Discount</span>
                  <span>− {RM(discount)}</span>
                </div>
              )}
              {tip > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: C.green, fontWeight: 600 }}>
                  <span>Tip</span>
                  <span>+ {RM(tip)}</span>
                </div>
              )}
              <div style={{
                display: "flex", justifyContent: "space-between", padding: "12px 0",
                borderTop: `2px solid ${C.border}`, marginTop: discount > 0 || tip > 0 ? 4 : 0,
              }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
                <span style={{ fontWeight: 800, fontSize: 20, color: C.green }}>{RM(total)}</span>
              </div>
            </div>

            <button onClick={() => onConfirm({ total, discount, tip })} style={ss.btnPrimary}>
              Confirm Order →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RECEIPT MODAL
// ─────────────────────────────────────────────
function ReceiptModal({ total, discount, tip, itemCount, onConfirm, onClose }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const handleComplete = async () => {
    setLoading(true);
    try { await onConfirm(preview || null); }
    catch { alert("Error saving transaction. Please try again."); }
    finally { setLoading(false); }
  };
  return (
    <Modal title="Upload Receipt" onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>📸</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Proof of Payment</div>
        <div style={{ fontSize: 13, color: C.muted }}>Capture or upload the transfer receipt</div>
      </div>
      {preview ? (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <img src={preview} alt="receipt" style={{ width: "100%", borderRadius: 12, maxHeight: 240, objectFit: "contain", background: "#F9FAFB" }} />
          <button onClick={() => setPreview(null)} style={{
            position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)",
            color: C.white, border: "none", borderRadius: 20, padding: "4px 10px",
            cursor: "pointer", fontSize: 12, fontFamily: BASE_FONT,
            WebkitTapHighlightColor: "transparent",
          }}>Retake</button>
        </div>
      ) : (
        <ImagePicker id="receipt" onPick={setPreview} maxDim={1400} />
      )}
      <div style={{
        background: C.greenLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted }}>ORDER TOTAL</div>
          <div style={{ fontWeight: 800, color: C.green, fontSize: 20 }}>{RM(total)}</div>
          {discount > 0 && <div style={{ fontSize: 11, color: "#F97316", marginTop: 2 }}>Discount applied: − {RM(discount)}</div>}
          {tip > 0 && <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>Tip included: + {RM(tip)}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: C.muted }}>ITEMS</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{itemCount}</div>
        </div>
      </div>
      <button onClick={handleComplete} disabled={loading} style={{ ...ss.btnPrimary, opacity: loading ? 0.7 : 1 }}>
        {loading ? "Saving..." : preview ? "✅ Complete Transaction" : "⚡ Skip & Complete"}
      </button>
      {!preview && <div style={{ fontSize: 12, color: C.hint, textAlign: "center", marginTop: 8 }}>Receipt is optional</div>}
    </Modal>
  );
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
function Dashboard({ products, setProducts, cart, setCart, user, onTransaction, showToast }) {
  const [showAdd, setShowAdd] = useState(false);
  const [selProd, setSelProd] = useState(null);
  const [showCart, setShowCart] = useState(false);
  // { total, discount, tip } passed from CartSheet
  const [orderInfo, setOrderInfo] = useState(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const cartSubtotal = cart.reduce((s, i) => s + i.price * i.count, 0);
  const cartCount    = cart.reduce((s, i) => s + i.count, 0);

  const addToCart = (prod, count) => {
    setCart((prev) => {
      const ex = prev.find((i) => i.productId === prod.id);
      if (ex) return prev.map((i) => i.productId === prod.id ? { ...i, count: i.count + count } : i);
      return [...prev, { productId: prod.id, name: prod.name, price: prod.price, count }];
    });
    setSelProd(null);
    showToast(`${prod.name} added`);
  };

  const updateCart = (productId, delta) =>
    setCart((prev) =>
      prev.map((i) => i.productId === productId ? { ...i, count: i.count + delta } : i).filter((i) => i.count > 0)
    );

  const handleConfirm = useCallback(async (receiptDataUrl) => {
    const id = String(Date.now());
    let receipt_url = null;
    if (receiptDataUrl) receipt_url = await db.uploadImage("receipts", receiptDataUrl, `receipt_${id}.jpg`);
    const txn = {
      id, items: [...cart], total: orderInfo.total, discount: orderInfo.discount, tip: orderInfo.tip,
      timestamp: new Date().toISOString(), user, receipt_url, receipt: receipt_url,
    };
    await onTransaction(txn);
    setCart([]);
    setOrderInfo(null);
    setShowReceipt(false);
    showToast("Transaction saved!");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, orderInfo, user, onTransaction, showToast]);

  const handleDeleteProduct = async (id) => {
    try {
      await db.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      showToast("Product deleted");
    } catch { showToast("Delete failed", "error"); }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Products</span>
        <button onClick={() => setShowAdd(true)} style={{
          padding: "8px 16px", background: C.green, color: C.white,
          border: "none", borderRadius: 20, fontSize: 13, fontWeight: 600,
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}>+ Add Product</button>
      </div>

      {products.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: C.muted }}>
          <div style={{ fontSize: 52, marginBottom: 14 }}>📦</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No products yet</div>
          <div style={{ fontSize: 13 }}>Tap "+ Add Product" to get started</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p}
              onSelect={() => setSelProd(p)}
              onDelete={() => handleDeleteProduct(p.id)} />
          ))}
        </div>
      )}

      {cartCount > 0 && (
        <button onClick={() => setShowCart(true)} style={{
          position: "fixed", bottom: 96, right: 16, zIndex: 150,
          background: C.green, color: C.white, border: "none",
          borderRadius: 50, padding: "13px 18px", fontSize: 14, fontWeight: 700,
          cursor: "pointer", boxShadow: "0 4px 20px rgba(10,102,64,0.38)",
          display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
          maxWidth: "calc(100vw - 32px)", WebkitTapHighlightColor: "transparent",
        }}>
          🛒 {cartCount} item{cartCount > 1 ? "s" : ""} · {RM(cartSubtotal)}
        </button>
      )}

      {showAdd && (
        <AddProductModal
          onAdd={(p) => { setProducts((prev) => [...prev, p]); setShowAdd(false); showToast(`${p.name} added!`); }}
          onClose={() => setShowAdd(false)} />
      )}
      {selProd && (
        <ProductModal product={selProd}
          cartItem={cart.find((i) => i.productId === selProd.id)}
          onAdd={addToCart} onClose={() => setSelProd(null)} />
      )}
      {showCart && (
        <CartSheet cart={cart} onUpdate={updateCart}
          onClose={() => setShowCart(false)}
          onConfirm={(info) => { setOrderInfo(info); setShowCart(false); setShowReceipt(true); }} />
      )}
      {showReceipt && orderInfo && (
        <ReceiptModal
          total={orderInfo.total} discount={orderInfo.discount} tip={orderInfo.tip}
          itemCount={cartCount}
          onConfirm={handleConfirm}
          onClose={() => { setShowReceipt(false); setShowCart(true); }} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TRANSACTION DETAIL
// ─────────────────────────────────────────────
function TransactionDetail({ txn, onClose }) {
  const discount = parseFloat(txn.discount || 0);
  const tip = parseFloat(txn.tip || 0);
  return (
    <Modal title="Transaction Details" onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          ["DATE & TIME", fmtDate(txn.timestamp)],
          ["STAFF", txn.user || txn.user_name],
          ["TRANSACTION ID", `#${txn.id.slice(-6).toUpperCase()}`],
          ["ITEMS COUNT", countProductItems(txn.items)],
        ].map(([label, val]) => (
          <div key={label} style={{ background: "#F9FAFB", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 3, fontWeight: 700, letterSpacing: "0.04em" }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, wordBreak: "break-word" }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, letterSpacing: "0.05em" }}>ITEMS ORDERED</div>
        {txn.items.map((item, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid #F3F4F6` }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{RM(item.price)} × {item.count}</div>
            </div>
            <div style={{ fontWeight: 700, color: C.green, fontSize: 14 }}>{RM(item.price * item.count)}</div>
          </div>
        ))}
      </div>
      {discount > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, color: "#F97316", fontWeight: 600 }}>
          <span>Discount applied</span><span>− {RM(discount)}</span>
        </div>
      )}
      {tip > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, color: C.green, fontWeight: 600 }}>
          <span>Tip / keep change</span><span>+ {RM(tip)}</span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: `2px solid ${C.border}`, marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
        <span style={{ fontWeight: 800, fontSize: 22, color: C.green }}>{RM(txn.total)}</span>
      </div>
      {txn.receipt ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, letterSpacing: "0.05em" }}>RECEIPT</div>
          <img src={txn.receipt} alt="receipt" style={{ width: "100%", borderRadius: 10, maxHeight: 280, objectFit: "contain", background: "#F9FAFB" }} />
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "10px 0", color: C.hint, fontSize: 13 }}>No receipt uploaded.</div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────
// MINI BAR CHART (SVG, no deps)
// ─────────────────────────────────────────────
function BarChart({ data, height = 120, color = C.green, labelKey = "label", valueKey = "value", formatVal }) {
  const maxVal = Math.max(...data.map((d) => d[valueKey]), 1);
  const fmt = formatVal || ((v) => v);

  return (
    <div style={{ width: "100%", overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ minWidth: data.length * 44, padding: "0 4px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height }}>
          {data.map((d, i) => {
            const pct = d[valueKey] / maxVal;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 36 }}>
                <div style={{ fontSize: 10, color: C.muted, textAlign: "center", fontWeight: 600, lineHeight: 1.2 }}>
                  {d[valueKey] > 0 ? fmt(d[valueKey]) : ""}
                </div>
                <div style={{ width: "100%", background: C.greenLight, borderRadius: "4px 4px 0 0", position: "relative", height: height - 32, display: "flex", alignItems: "flex-end" }}>
                  <div style={{
                    width: "100%", background: color, borderRadius: "4px 4px 0 0",
                    height: `${Math.max(pct * 100, d[valueKey] > 0 ? 4 : 0)}%`,
                    transition: "height 0.3s ease",
                  }} />
                </div>
                <div style={{ fontSize: 9, color: C.muted, textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", padding: "0 2px" }}>
                  {d[labelKey]}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HORIZONTAL BAR (for rankings)
// ─────────────────────────────────────────────
function HBar({ label, value, max, color, formatVal, rank }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  const fmt = formatVal || ((v) => v);
  const rankColors = ["#F59E0B", "#9CA3AF", "#CD7F32"];
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {rank <= 3 && <span style={{ fontSize: 13, color: rankColors[rank - 1] }}>{"●"}</span>}
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{fmt(value)}</span>
      </div>
      <div style={{ height: 8, background: "#F3F4F6", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ANALYTICS TAB (#1)
// ─────────────────────────────────────────────
function Analytics({ transactions, products }) {
  const [range, setRange] = useState("week"); // "week" | "month" | "all"
  const [prodFilter, setProdFilter] = useState("all"); // "all" | product id

  const now = new Date();

  const rangeFiltered = useMemo(() => transactions.filter((t) => {
    const d = new Date(t.timestamp);
    if (range === "week")  return d >= new Date(now - 7  * 86400000);
    if (range === "month") return d >= new Date(now - 30 * 86400000);
    return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [transactions, range]);

  // Apply product filter
  const filtered = useMemo(() => {
    if (prodFilter === "all") return rangeFiltered;
    const prodName = products.find((p) => p.id === prodFilter)?.name;
    if (!prodName) return rangeFiltered;
    return rangeFiltered.filter((t) => t.items.some((i) => i.name === prodName));
  }, [rangeFiltered, prodFilter, products]);

  // KPI cards
  const totalRevenue  = filtered.reduce((s, t) => s + parseFloat(t.total), 0);
  const totalTxns     = filtered.length;
  const avgOrder      = totalTxns > 0 ? totalRevenue / totalTxns : 0;
  const totalDiscount = filtered.reduce((s, t) => s + parseFloat(t.discount || 0), 0);
  const totalItems    = filtered.reduce((s, t) => s + countProductItems(t.items), 0);
  const totalTips     = filtered.reduce((s, t) => s + parseFloat(t.tip || 0), 0);

  // Revenue by day (last N days)
  const dayCount = range === "week" ? 7 : range === "month" ? 30 : 14;
  const revenueByDay = useMemo(() => {
    const days = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = toDateInput(d);
      const shortLabel = d.toLocaleDateString("en-MY", { weekday: "short" }).slice(0, 2);
      const dayLabel = range === "all" ? `${d.getDate()}/${d.getMonth()+1}` : shortLabel;
      const rev = filtered
        .filter((t) => toDateInput(new Date(t.timestamp)) === key)
        .reduce((s, t) => s + parseFloat(t.total), 0);
      days.push({ label: dayLabel, value: parseFloat(rev.toFixed(2)) });
    }
    return days;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, range]);

  // Units sold per product
  const productSales = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      t.items.forEach((item) => {
        map[item.name] = (map[item.name] || 0) + item.count;
      });
    });
    return Object.entries(map)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty);
  }, [filtered]);

  // Revenue per product
  const productRevenue = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      t.items.forEach((item) => {
        map[item.name] = (map[item.name] || 0) + item.price * item.count;
      });
    });
    return Object.entries(map)
      .map(([name, rev]) => ({ name, rev: parseFloat(rev.toFixed(2)) }))
      .sort((a, b) => b.rev - a.rev);
  }, [filtered]);

  // Revenue per staff
  const staffRevenue = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      const name = t.user || t.user_name || "Unknown";
      map[name] = (map[name] || 0) + parseFloat(t.total);
    });
    return Object.entries(map)
      .map(([name, rev]) => ({ name, rev: parseFloat(rev.toFixed(2)) }))
      .sort((a, b) => b.rev - a.rev);
  }, [filtered]);

  const deliveryStats = useMemo(() => {
    const deliveryTxns = rangeFiltered.filter((t) => (t.channel || "walkin") === "delivery");
    const walkinTxns = rangeFiltered.filter((t) => (t.channel || "walkin") === "walkin");
    const deliveryCount = deliveryTxns.length;
    const walkinCount = walkinTxns.length;
    const totalDelivFees = deliveryTxns.reduce((s, t) => s + parseFloat(t.delivery_fee || 0), 0);
    const freeDelivCount = deliveryTxns.filter((t) => parseFloat(t.delivery_fee || 0) === 0).length;
    const delivRevenue = deliveryTxns.reduce((s, t) => s + parseFloat(t.total), 0);
    const totalOrders = deliveryCount + walkinCount;
    return {
      deliveryCount,
      walkinCount,
      totalDelivFees,
      freeDelivCount,
      delivRevenue,
      hasDelivery: deliveryCount > 0,
      walkinPct: totalOrders > 0 ? (walkinCount / totalOrders) * 100 : 0,
      deliveryPct: totalOrders > 0 ? (deliveryCount / totalOrders) * 100 : 0,
      avgDelivFee: deliveryCount > 0 ? totalDelivFees / deliveryCount : 0,
    };
  }, [rangeFiltered]);

  // Peak hour
  const peakHour = useMemo(() => {
    const map = {};
    filtered.forEach((t) => {
      const h = new Date(t.timestamp).getHours();
      map[h] = (map[h] || 0) + 1;
    });
    const max = Math.max(...Object.values(map), 0);
    const hour = Object.keys(map).find((k) => map[k] === max);
    if (!hour) return "—";
    const h = parseInt(hour);
    return `${h === 0 ? "12" : h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}`;
  }, [filtered]);

  const maxProdRev = productRevenue[0]?.rev || 1;
  const maxStaffRev = staffRevenue[0]?.rev || 1;
  const {
    deliveryCount,
    walkinCount,
    totalDelivFees,
    freeDelivCount,
    delivRevenue,
    hasDelivery,
    walkinPct,
    deliveryPct,
    avgDelivFee,
  } = deliveryStats;

  const kpiStyle = {
    background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
    padding: "14px 16px", flex: 1,
  };

  return (
    <div style={{ padding: 16, paddingBottom: 24 }}>
      <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 14 }}>Analytics</div>

      {/* Range tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["week","7 Days"],["month","30 Days"],["all","All Time"]].map(([k,l]) => (
          <button key={k} onClick={() => setRange(k)} style={{
            padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer",
            background: range === k ? C.green : "#F3F4F6",
            color: range === k ? C.white : C.muted,
            fontWeight: range === k ? 700 : 400, fontSize: 13, fontFamily: BASE_FONT,
            WebkitTapHighlightColor: "transparent",
          }}>{l}</button>
        ))}
      </div>

      {/* Product filter */}
      {products.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={ss.label}>Filter by Product</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setProdFilter("all")} style={{
              padding: "6px 12px", borderRadius: 20, border: `1.5px solid ${prodFilter === "all" ? C.green : C.border}`,
              background: prodFilter === "all" ? C.greenLight : C.white,
              color: prodFilter === "all" ? C.green : C.muted,
              fontWeight: prodFilter === "all" ? 700 : 400, fontSize: 12,
              cursor: "pointer", fontFamily: BASE_FONT, WebkitTapHighlightColor: "transparent",
            }}>All</button>
            {products.map((p) => (
              <button key={p.id} onClick={() => setProdFilter(p.id)} style={{
                padding: "6px 12px", borderRadius: 20,
                border: `1.5px solid ${prodFilter === p.id ? C.green : C.border}`,
                background: prodFilter === p.id ? C.greenLight : C.white,
                color: prodFilter === p.id ? C.green : C.muted,
                fontWeight: prodFilter === p.id ? 700 : 400, fontSize: 12,
                cursor: "pointer", fontFamily: BASE_FONT, WebkitTapHighlightColor: "transparent",
                whiteSpace: "nowrap",
              }}>{p.name}</button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && !hasDelivery ? (
        <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📊</div>
          <div style={{ fontWeight: 600 }}>No data for this period</div>
        </div>
      ) : (
        <>
          {/* KPI row 1 */}
          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
            <div style={kpiStyle}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 4 }}>REVENUE</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.green, lineHeight: 1 }}>{RM(totalRevenue)}</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 4 }}>ORDERS</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1 }}>{totalTxns}</div>
            </div>
          </div>

          {/* KPI row 2 */}
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <div style={kpiStyle}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 4 }}>AVG ORDER</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1 }}>{RM(avgOrder)}</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 4 }}>ITEMS SOLD</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1 }}>{totalItems}</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 4 }}>PEAK</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text, lineHeight: 1 }}>{peakHour}</div>
            </div>
          </div>
          {totalDiscount > 0 && (
            <div style={{ background: "#FFF7ED", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#92400E", fontWeight: 600 }}>Total discounts given</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#F97316" }}>− {RM(totalDiscount)}</span>
            </div>
          )}

          {totalTips > 0 && (
            <div style={{ background: C.greenLight, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>Tips collected</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: C.green }}>+ {RM(totalTips)}</span>
            </div>
          )}

          {/* Revenue over time */}
          <div style={{ ...ss.card, marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: C.text }}>📈 Revenue Over Time</div>
            <BarChart
              data={revenueByDay} height={130} color={C.green}
              labelKey="label" valueKey="value"
              formatVal={(v) => `${v.toFixed(0)}`}
            />
          </div>

          {/* Product revenue ranking */}
          {productRevenue.length > 0 && (
            <div style={{ ...ss.card, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: C.text }}>🏆 Revenue by Product</div>
              {productRevenue.map((p, i) => (
                <HBar key={p.name} label={p.name} value={p.rev} max={maxProdRev}
                  color={C.chartColors[i % C.chartColors.length]}
                  formatVal={(v) => RM(v)} rank={i + 1} />
              ))}
            </div>
          )}

          {/* Units sold */}
          {productSales.length > 0 && (
            <div style={{ ...ss.card, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: C.text }}>📦 Units Sold</div>
              <BarChart
                data={productSales.slice(0, 8).map((p) => ({ label: p.name.split(" ")[0], value: p.qty }))}
                height={110} color="#10B981"
                labelKey="label" valueKey="value"
                formatVal={(v) => `${v}`}
              />
            </div>
          )}

          {/* Staff leaderboard */}
          {staffRevenue.length > 1 && (
            <div style={{ ...ss.card, marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14, color: C.text }}>👤 Revenue by Staff</div>
              {staffRevenue.map((s, i) => (
                <HBar key={s.name} label={s.name} value={s.rev} max={maxStaffRev}
                  color={C.chartColors[(i + 2) % C.chartColors.length]}
                  formatVal={(v) => RM(v)} rank={i + 1} />
              ))}
            </div>
          )}

          {hasDelivery && (
            <div style={{ ...ss.card, marginBottom: 14, background: "#F0F9FF", borderColor: "#BAE6FD" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12, color: "#0284C7" }}>Delivery Breakdown</div>

              <div style={{ marginBottom: 14 }}>
                <div style={{
                  height: 12, borderRadius: 999, overflow: "hidden", background: "#E0F2FE",
                  display: "flex", marginBottom: 7,
                }}>
                  <div style={{ width: `${walkinPct}%`, background: C.green }} />
                  <div style={{ width: `${deliveryPct}%`, background: "#0284C7" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, fontWeight: 700 }}>
                  <span>Walk-in {walkinPct.toFixed(0)}% ({walkinCount})</span>
                  <span>Delivery {deliveryPct.toFixed(0)}% ({deliveryCount})</span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                {[
                  ["Delivery Revenue", RM(delivRevenue)],
                  ["Delivery Fees", RM(totalDelivFees)],
                  ["Free Deliveries", `${freeDelivCount} / ${deliveryCount}`],
                  ["Avg Fee per Order", RM(avgDelivFee)],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: C.white, border: "1px solid #BAE6FD", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, letterSpacing: "0.04em", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#0284C7" }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// RECORDS
// ─────────────────────────────────────────────
function Records({ transactions, products, showToast }) {
  const [filter, setFilter]     = useState("day");
  const [pickedDate, setPickedDate] = useState("");
  const [selected, setSelected] = useState(null);
  const [syncing, setSyncing]   = useState(false);

  const now = new Date();
  const filtered = transactions.filter((txn) => {
    const d = new Date(txn.timestamp);
    if (pickedDate) return toDateInput(d) === pickedDate;
    if (filter === "day")   return d.toDateString() === now.toDateString();
    if (filter === "week")  return d >= new Date(now - 7  * 86400000);
    if (filter === "month") return d >= new Date(now - 30 * 86400000);
    return true;
  });

  const totalRevenue = filtered.reduce((s, t) => s + parseFloat(t.total), 0);
  const totalItems   = filtered.reduce((s, t) => s + countProductItems(t.items), 0);
  const totalTips    = filtered.reduce((s, t) => s + parseFloat(t.tip || 0), 0);

  const handlePickDate = (e) => { setPickedDate(e.target.value); if (e.target.value) setFilter(""); };
  const handleQuickFilter = (k) => { setFilter(k); setPickedDate(""); };

  const handleSync = async () => {
    setSyncing(true);
    try { await syncToSheets(transactions, products); showToast("Synced to Google Sheets!"); }
    catch (e) { showToast(e.message.length < 60 ? e.message : "Sync failed", "error"); }
    finally { setSyncing(false); }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Sales Records</span>
        <button onClick={handleSync} disabled={syncing || transactions.length === 0} style={{
          padding: "7px 12px", background: syncing ? "#F3F4F6" : C.greenLight,
          color: syncing ? C.muted : C.green,
          border: `1.5px solid ${syncing ? C.border : C.green}`,
          borderRadius: 20, fontSize: 12, fontWeight: 700,
          cursor: syncing || transactions.length === 0 ? "default" : "pointer",
          fontFamily: BASE_FONT, display: "flex", alignItems: "center", gap: 5,
          opacity: transactions.length === 0 ? 0.5 : 1,
          WebkitTapHighlightColor: "transparent",
        }}>
          {syncing ? "⏳ Syncing…" : "📊 Sync Sheets"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {[["day","Today"],["week","7 Days"],["month","30 Days"],["all","All"]].map(([k,l]) => {
          const active = filter === k && !pickedDate;
          return (
            <button key={k} onClick={() => handleQuickFilter(k)} style={{
              padding: "7px 14px", borderRadius: 20, border: "none", cursor: "pointer",
              background: active ? C.green : "#F3F4F6", color: active ? C.white : C.muted,
              fontWeight: active ? 700 : 400, fontSize: 13, fontFamily: BASE_FONT,
              WebkitTapHighlightColor: "transparent",
            }}>{l}</button>
          );
        })}
      </div>

      {/* Date picker — visible tap target on mobile, native picker underneath */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ position: "relative" }}>
          {/* Visible styled button — always shows, tap opens native date picker */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 14px", borderRadius: 10,
            border: `1.5px solid ${pickedDate ? C.green : C.border}`,
            background: pickedDate ? C.greenLight : C.white,
            cursor: "pointer", userSelect: "none",
          }}>
            <span style={{ fontSize: 14, color: pickedDate ? C.text : C.hint, fontWeight: pickedDate ? 600 : 400 }}>
              {pickedDate
                ? new Date(pickedDate + "T00:00:00").toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" })
                : "📅  Pick a specific date"}
            </span>
            {pickedDate
              ? <button onClick={() => { setPickedDate(""); setFilter("day"); }} style={{
                  background: "none", border: "none", fontSize: 18, color: C.hint,
                  cursor: "pointer", lineHeight: 1, padding: "0 2px",
                  WebkitTapHighlightColor: "transparent",
                }}>✕</button>
              : <span style={{ fontSize: 16, color: C.hint }}>›</span>
            }
          </div>
          {/* Invisible native date input sits on top — triggers the native picker */}
          <input
            type="date"
            value={pickedDate}
            max={toDateInput(now)}
            onChange={handlePickDate}
            style={{
              position: "absolute", inset: 0, opacity: 0,
              width: "100%", height: "100%",
              cursor: "pointer", fontSize: 16,
              // keep opacity 0 but let it receive taps
              WebkitAppearance: "none",
            }}
          />
        </div>
        {pickedDate && (
          <div style={{ fontSize: 11, color: C.green, marginTop: 5, fontWeight: 600, paddingLeft: 2 }}>
            📅 {new Date(pickedDate + "T00:00:00").toLocaleDateString("en-MY", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
          </div>
        )}
      </div>

      <div style={{ background: C.green, borderRadius: 16, padding: "18px 20px", marginBottom: 16, color: C.white }}>
        <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2, letterSpacing: "0.06em" }}>TOTAL REVENUE</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{RM(totalRevenue)}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          <span>📋 {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}</span>
          <span>🧃 {totalItems} items sold</span>
          {totalTips > 0 && <span>Tips {RM(totalTips)}</span>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "50px 20px", color: C.muted }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>No transactions</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>No sales recorded for this period.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((txn) => {
            const names = txn.items.map((i) => i.name).join(", ");
            return (
              <div key={txn.id} onClick={() => setSelected(txn)}
                style={{ ...ss.card, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0, marginRight: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>
                      {names.length > 42 ? names.substring(0, 42) + "…" : names}
                    </div>
                    <div style={{ fontSize: 12, color: C.muted }}>{fmtDate(txn.timestamp)}</div>
                    <div style={{ fontSize: 12, color: C.hint, marginTop: 1 }}>
                      by {txn.user || txn.user_name} · {countProductItems(txn.items)} items
                      {parseFloat(txn.discount || 0) > 0 && <span style={{ color: "#F97316" }}> · disc {RM(txn.discount)}</span>}
                      {parseFloat(txn.tip || 0) > 0 && <span style={{ color: C.green }}> · tip {RM(txn.tip)}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, color: C.green, fontSize: 16 }}>{RM(txn.total)}</div>
                    {txn.receipt && <div style={{ fontSize: 11, color: C.hint, marginTop: 2 }}>📎 receipt</div>}
                    <div style={{ fontSize: 13, color: C.hint, marginTop: 4 }}>›</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && <TransactionDetail txn={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// BOTTOM NAV — 3 tabs now
// ─────────────────────────────────────────────
function BottomNav({ tab, setTab, cartCount }) {
  const tabs = [
    { id: "dashboard", icon: "⊞", label: "Dashboard" },
    { id: "records",   icon: "📋", label: "Records" },
    { id: "analytics", icon: "📊", label: "Analytics" },
  ];
  return (
    <nav style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 480, background: C.white,
      borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 200,
      // Safari fix: safe area bottom padding for iPhone notch
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex: 1, padding: "10px 0", background: "transparent", border: "none",
          cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
          color: tab === t.id ? C.green : C.hint,
          position: "relative", WebkitTapHighlightColor: "transparent",
          // Safari fix: explicit min-height so tap targets aren't too small
          minHeight: 56,
        }}>
          <span style={{ fontSize: 20, position: "relative" }}>
            {t.icon}
            {t.id === "dashboard" && cartCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -8,
                background: C.danger, color: C.white, borderRadius: 10,
                fontSize: 10, fontWeight: 700, padding: "1px 5px", minWidth: 16, textAlign: "center",
              }}>{cartCount}</span>
            )}
          </span>
          <span style={{ fontSize: 10, fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>
          {tab === t.id && (
            <div style={{ position: "absolute", top: 0, left: "20%", right: "20%", height: 2, background: C.green, borderRadius: "0 0 2px 2px" }} />
          )}
        </button>
      ))}
    </nav>
  );
}

// ─────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed]         = useState(false);
  const [user, setUser]             = useState("");
  const [tab, setTab]               = useState("dashboard");
  const [products, setProducts]     = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [cart, setCart]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [dbError, setDbError]       = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = useCallback((message, type = "success") => setToast({ message, type }), []);

  useEffect(() => {
    (async () => {
      try {
        const [prods, txns] = await Promise.all([db.getProducts(), db.getTransactions()]);
        setProducts(prods);
        setTransactions(txns);
      } catch (e) {
        console.error("Load error:", e);
        setDbError(true);
      } finally { setLoading(false); }
    })();
  }, []);

  const saveTransaction = useCallback(async (txn) => {
    await db.insertTransaction(txn);
    setTransactions((prev) => [txn, ...prev]);
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BASE_FONT, color: C.muted, flexDirection: "column", gap: 12, background: C.bg }}>
        <div style={{ fontSize: 44 }}>🥤</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Loading Fizzicist...</div>
      </div>
    );
  }

  if (dbError) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BASE_FONT, flexDirection: "column", gap: 12, background: C.bg, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 44 }}>⚠️</div>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Cannot reach database</div>
        <div style={{ fontSize: 13, color: C.muted, maxWidth: 300 }}>Check your Supabase environment variables and refresh.</div>
        <button onClick={() => window.location.reload()} style={{ ...ss.btnPrimary, maxWidth: 200 }}>Retry</button>
      </div>
    );
  }

  if (!authed) return <LoginPage onLogin={(u) => { setUser(u); setAuthed(true); }} />;

  const cartCount = cart.reduce((s, i) => s + i.count, 0);

  return (
    <div style={ss.app}>
      {/* Header */}
      <div style={{
        background: C.green, color: C.white, padding: "13px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, flexShrink: 0,
        // Safari fix: -webkit-sticky
        WebkitPosition: "sticky",
      }}>
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>🥤 Fizzicist</span>
        <span style={{ fontSize: 12, opacity: 0.85, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Hi, {user} 👋
        </span>
      </div>

      {/* Page */}
      <div style={{ flex: 1, paddingBottom: 70, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {tab === "dashboard" && (
          <Dashboard products={products} setProducts={setProducts} cart={cart} setCart={setCart}
            user={user} onTransaction={saveTransaction} showToast={showToast} />
        )}
        {tab === "records" && (
          <Records transactions={transactions} products={products} showToast={showToast} />
        )}
        {tab === "analytics" && (
          <Analytics transactions={transactions} products={products} />
        )}
      </div>

      <BottomNav tab={tab} setTab={setTab} cartCount={cartCount} />
      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
