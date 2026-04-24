import { useState, useEffect, useRef } from "react";
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

// ─────────────────────────────────────────────
// Supabase DB helpers
// ─────────────────────────────────────────────
const db = {
  async getProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at");
    if (error) { console.error("getProducts:", error); return []; }
    // Normalise: rest of app uses `image` field for <img> src
    return data.map((p) => ({ ...p, image: p.image_url || null }));
  },

  async upsertProduct(product) {
    const { error } = await supabase.from("products").upsert({
      id: product.id,
      name: product.name,
      price: product.price,
      image_url: product.image_url || null,
    });
    if (error) throw error;
  },

  async deleteProduct(id) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw error;
  },

  async getTransactions() {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .order("timestamp", { ascending: false });
    if (error) { console.error("getTransactions:", error); return []; }
    // Normalise: rest of app uses `user` and `receipt` fields
    return data.map((t) => ({
      ...t,
      user: t.user_name,
      receipt: t.receipt_url || null,
    }));
  },

  async insertTransaction(txn) {
    const { error } = await supabase.from("transactions").insert({
      id: txn.id,
      items: txn.items,
      total: txn.total,
      timestamp: txn.timestamp,
      user_name: txn.user,
      receipt_url: txn.receipt_url || null,
    });
    if (error) throw error;
  },

  // Upload a base64 data URL → Supabase Storage → return public URL
  async uploadImage(bucket, dataUrl, filename) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const { error } = await supabase.storage
        .from(bucket)
        .upload(filename, blob, { contentType: blob.type, upsert: true });
      if (error) { console.error("uploadImage:", error); return null; }
      const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
      return data.publicUrl;
    } catch (e) {
      console.error("uploadImage exception:", e);
      return null;
    }
  },
};

// ─────────────────────────────────────────────
// Shared Styles
// ─────────────────────────────────────────────
const C = {
  green: "#0A6640",
  greenLight: "#E8F5EE",
  greenMid: "#D1FAE5",
  bg: "#F7F7F5",
  white: "#ffffff",
  border: "#E5E7EB",
  muted: "#6B7280",
  hint: "#9CA3AF",
  text: "#1A1A1A",
  danger: "#DC2626",
  dangerLight: "#FEF2F2",
};

const ss = {
  app: {
    minHeight: "100vh",
    background: C.bg,
    maxWidth: 480,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontSize: 14,
    color: C.text,
  },
  label: {
    fontSize: 11, fontWeight: 700, color: C.muted, display: "block",
    marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase",
  },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: `1.5px solid ${C.border}`, fontSize: 15, background: C.white,
    boxSizing: "border-box", outline: "none", fontFamily: "inherit", color: C.text,
  },
  btnPrimary: {
    width: "100%", padding: "14px", background: C.green, color: C.white,
    border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  btnDanger: {
    padding: "10px 18px", background: C.danger, color: C.white,
    border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 14,
  },
  btnGhost: {
    padding: "8px 16px", background: C.white, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 8, fontWeight: 600,
    cursor: "pointer", fontSize: 13, fontFamily: "inherit",
  },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center",
  },
  sheet: {
    background: C.white, borderRadius: "20px 20px 0 0", padding: "20px 20px 40px",
    width: "100%", maxWidth: 480, boxShadow: "0 -4px 30px rgba(0,0,0,0.12)",
    boxSizing: "border-box", maxHeight: "88vh", overflowY: "auto",
  },
  closeBtn: {
    background: "#F3F4F6", border: "none", borderRadius: 20,
    width: 32, height: 32, cursor: "pointer", fontSize: 14, color: C.muted,
    display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700,
    flexShrink: 0,
  },
  counterBtn: (sm) => ({
    width: sm ? 34 : 48, height: sm ? 34 : 48,
    borderRadius: sm ? 17 : 24,
    border: `2px solid ${C.greenMid}`, background: C.greenLight,
    color: C.green, fontSize: sm ? 18 : 22, fontWeight: 700,
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", lineHeight: 1, flexShrink: 0,
  }),
  card: {
    background: C.white, borderRadius: 12, border: `1px solid ${C.border}`,
    padding: "14px 16px",
  },
};

// ─────────────────────────────────────────────
// Compress image helper
// ─────────────────────────────────────────────
function compressImage(file, maxDim = 800, quality = 0.78) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = img.width * ratio;
      canvas.height = img.height * ratio;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

// ─────────────────────────────────────────────
// Toast notification
// ─────────────────────────────────────────────
function Toast({ message, type = "success", onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{
      position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)",
      background: type === "success" ? C.green : C.danger,
      color: C.white, padding: "12px 22px", borderRadius: 24,
      fontWeight: 600, fontSize: 14, zIndex: 999, whiteSpace: "nowrap",
      boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
      animation: "fadeInUp 0.2s ease",
    }}>
      {type === "success" ? "✅ " : "❌ "}{message}
    </div>
  );
}

// ─────────────────────────────────────────────
// Modal wrapper (bottom sheet)
// ─────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
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
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
          <input
            style={ss.input}
            placeholder="e.g. Ali, Siti, Wei..."
            value={name}
            onChange={(e) => { setName(e.target.value); setErr(""); }}
          />
        </div>

        <label style={ss.label}>PIN</label>
        <div style={{ display: "flex", gap: 7, justifyContent: "center", margin: "10px 0 16px" }}>
          {Array(6).fill(0).map((_, i) => (
            <div key={i} style={{
              width: 38, height: 46, borderRadius: 8,
              border: `2px solid ${i < pin.length ? C.green : C.border}`,
              background: i < pin.length ? C.greenLight : "#F9FAFB",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, color: C.green, transition: "all 0.12s",
            }}>
              {i < pin.length ? "●" : ""}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 14 }}>
          {[1,2,3,4,5,6,7,8,9,"",0,"⌫"].map((k, i) =>
            k === "" ? <div key={i} /> : (
              <button
                key={i}
                onClick={() => k === "⌫" ? del() : tap(String(k))}
                style={{
                  padding: "15px 0", borderRadius: 10,
                  border: `1.5px solid ${C.border}`,
                  background: k === "⌫" ? C.dangerLight : C.white,
                  color: k === "⌫" ? C.danger : C.text,
                  fontSize: 18, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {k}
              </button>
            )
          )}
        </div>

        {err && (
          <div style={{ color: C.danger, fontSize: 13, textAlign: "center", marginBottom: 10, fontWeight: 500 }}>
            {err}
          </div>
        )}
        <button onClick={submit} style={ss.btnPrimary}>Login →</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PRODUCT CARD — long-press to delete
// ─────────────────────────────────────────────
function ProductCard({ product, onSelect, onDelete }) {
  const holdTimer = useRef(null);
  const [held, setHeld] = useState(false);

  const startHold = () => { holdTimer.current = setTimeout(() => setHeld(true), 600); };
  const endHold   = () => clearTimeout(holdTimer.current);
  const cancel    = (e) => { e.stopPropagation(); setHeld(false); };

  return (
    <div style={{ position: "relative" }}>
      <div
        onClick={() => !held && onSelect()}
        onTouchStart={startHold} onTouchEnd={endHold}
        onMouseDown={startHold} onMouseUp={endHold}
        style={{
          background: C.white, borderRadius: 14, border: `1px solid ${C.border}`,
          overflow: "hidden", cursor: "pointer",
          userSelect: "none", WebkitUserSelect: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <div style={{
          height: 100, background: C.greenLight,
          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
        }}>
          {product.image
            ? <img src={product.image} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
          position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)",
          borderRadius: 14, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 10, zIndex: 10,
        }}>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); setHeld(false); }} style={ss.btnDanger}>
            🗑 Delete
          </button>
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
  const [name, setName]   = useState("");
  const [price, setPrice] = useState("");
  const [preview, setPreview] = useState(null); // base64 for preview
  const [rawFile, setRawFile] = useState(null); // original File object
  const [err, setErr]     = useState("");
  const [saving, setSaving] = useState(false);

  const handleImg = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRawFile(file);
    const compressed = await compressImage(file, 600, 0.75);
    setPreview(compressed);
  };

  const submit = async () => {
    const trimmed = name.trim();
    const parsed  = parseFloat(price);
    if (!trimmed) { setErr("Product name is required."); return; }
    if (!price || isNaN(parsed) || parsed <= 0) { setErr("Enter a valid price."); return; }

    setSaving(true);
    try {
      const id = Date.now().toString();
      let image_url = null;

      if (preview) {
        image_url = await db.uploadImage("product-images", preview, `product_${id}.jpg`);
      }

      const product = {
        id,
        name: trimmed,
        price: parseFloat(parsed.toFixed(2)),
        image_url,
        image: image_url, // local alias used by the rest of the app
      };

      await db.upsertProduct(product);
      onAdd(product);
    } catch (e) {
      setErr("Failed to save product. Check your connection.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Product" onClose={onClose}>
      {preview && (
        <img src={preview} alt="preview" style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 10, marginBottom: 14 }} />
      )}
      <div style={{ marginBottom: 14 }}>
        <label style={ss.label}>Product Image</label>
        <input type="file" accept="image/*" capture="environment" onChange={handleImg}
          style={{ fontSize: 13, color: C.muted, width: "100%" }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <label style={ss.label}>Product Name</label>
        <input style={ss.input} placeholder="e.g. Fizzy Lemon, Grape Soda..."
          value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
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
      {product.image && (
        <img src={product.image} alt={product.name}
          style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 12, marginBottom: 16 }} />
      )}
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: C.green }}>{RM(product.price)}</div>
        {cartItem && (
          <div style={{ fontSize: 13, color: C.muted, marginTop: 4 }}>
            Already in cart: <strong>{cartItem.count}</strong>
          </div>
        )}
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
// CART SHEET
// ─────────────────────────────────────────────
function CartSheet({ cart, total, onUpdate, onClose, onConfirm }) {
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
            {cart.map((item) => (
              <div key={item.productId} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "11px 0", borderBottom: `1px solid #F3F4F6`,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.name}
                  </div>
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

            <div style={{
              display: "flex", justifyContent: "space-between", padding: "13px 0",
              borderTop: `2px solid ${C.border}`, margin: "4px 0 16px",
            }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
              <span style={{ fontWeight: 800, fontSize: 20, color: C.green }}>{RM(total)}</span>
            </div>
            <button onClick={onConfirm} style={ss.btnPrimary}>Confirm Order →</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RECEIPT UPLOAD MODAL
// ─────────────────────────────────────────────
function ReceiptModal({ total, itemCount, onConfirm, onClose }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleImg = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const compressed = await compressImage(file, 1400, 0.82);
    setPreview(compressed);
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      await onConfirm(preview || null);
    } catch {
      alert("Error saving transaction. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Upload Receipt" onClose={onClose}>
      <div style={{ textAlign: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>📸</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Proof of Payment</div>
        <div style={{ fontSize: 13, color: C.muted }}>Take a photo or upload a screenshot of the transfer receipt</div>
      </div>

      {preview ? (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <img src={preview} alt="receipt"
            style={{ width: "100%", borderRadius: 12, maxHeight: 240, objectFit: "contain", background: "#F9FAFB" }} />
          <button onClick={() => setPreview(null)} style={{
            position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)",
            color: C.white, border: "none", borderRadius: 20, padding: "4px 10px",
            cursor: "pointer", fontSize: 12, fontFamily: "inherit",
          }}>
            Retake
          </button>
        </div>
      ) : (
        <div style={{ border: `2px dashed ${C.greenMid}`, borderRadius: 12, padding: "28px 16px", textAlign: "center", marginBottom: 14 }}>
          <input type="file" accept="image/*" capture="environment" onChange={handleImg} id="receipt-img" style={{ display: "none" }} />
          <label htmlFor="receipt-img" style={{ cursor: "pointer", display: "block" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
            <div style={{ fontWeight: 600, color: C.green, fontSize: 15 }}>Take Photo / Upload</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Tap to open camera or gallery</div>
          </label>
        </div>
      )}

      <div style={{
        background: C.greenLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{ fontSize: 12, color: C.muted }}>ORDER TOTAL</div>
          <div style={{ fontWeight: 800, color: C.green, fontSize: 20 }}>{RM(total)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: C.muted }}>ITEMS</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{itemCount}</div>
        </div>
      </div>

      <button onClick={handleComplete} disabled={loading}
        style={{ ...ss.btnPrimary, opacity: loading ? 0.7 : 1 }}>
        {loading ? "Saving to database..." : preview ? "✅ Complete Transaction" : "⚡ Skip & Complete"}
      </button>
      {!preview && (
        <div style={{ fontSize: 12, color: C.hint, textAlign: "center", marginTop: 8 }}>
          Receipt upload is optional — you can skip if needed
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
function Dashboard({ products, setProducts, cart, setCart, user, onTransaction, showToast }) {
  const [showAdd, setShowAdd]       = useState(false);
  const [selProd, setSelProd]       = useState(null);
  const [showCart, setShowCart]     = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const cartTotal = cart.reduce((s, i) => s + i.price * i.count, 0);
  const cartCount = cart.reduce((s, i) => s + i.count, 0);

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
      prev.map((i) => i.productId === productId ? { ...i, count: i.count + delta } : i)
          .filter((i) => i.count > 0)
    );

  const handleConfirm = async (receiptDataUrl) => {
    const id = Date.now().toString();
    let receipt_url = null;
    if (receiptDataUrl) {
      receipt_url = await db.uploadImage("receipts", receiptDataUrl, `receipt_${id}.jpg`);
    }
    const txn = {
      id,
      items: [...cart],
      total: cartTotal,
      timestamp: new Date().toISOString(),
      user,
      receipt_url,
      receipt: receipt_url,
    };
    await onTransaction(txn);
    setCart([]);
    setShowReceipt(false);
    setShowCart(false);
    showToast("Transaction saved!");
  };

  const handleDeleteProduct = async (id) => {
    try {
      await db.deleteProduct(id);
      setProducts(products.filter((p) => p.id !== id));
      showToast("Product deleted");
    } catch {
      showToast("Delete failed", "error");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Products</span>
        <button onClick={() => setShowAdd(true)} style={{
          padding: "8px 16px", background: C.green, color: C.white,
          border: "none", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer",
        }}>
          + Add Product
        </button>
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
            <ProductCard
              key={p.id}
              product={p}
              onSelect={() => setSelProd(p)}
              onDelete={() => handleDeleteProduct(p.id)}
            />
          ))}
        </div>
      )}

      {/* Cart FAB */}
      {cartCount > 0 && (
        <button onClick={() => setShowCart(true)} style={{
          position: "fixed", bottom: 78, right: 16, zIndex: 150,
          background: C.green, color: C.white, border: "none",
          borderRadius: 50, padding: "13px 18px", fontSize: 14, fontWeight: 700,
          cursor: "pointer", boxShadow: "0 4px 20px rgba(10,102,64,0.38)",
          display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap",
          maxWidth: "calc(100vw - 32px)", WebkitTapHighlightColor: "transparent",
        }}>
          🛒 {cartCount} item{cartCount > 1 ? "s" : ""} · {RM(cartTotal)}
        </button>
      )}

      {showAdd && (
        <AddProductModal
          onAdd={(p) => { setProducts([...products, p]); setShowAdd(false); showToast(`${p.name} added!`); }}
          onClose={() => setShowAdd(false)}
        />
      )}
      {selProd && (
        <ProductModal
          product={selProd}
          cartItem={cart.find((i) => i.productId === selProd.id)}
          onAdd={addToCart}
          onClose={() => setSelProd(null)}
        />
      )}
      {showCart && (
        <CartSheet
          cart={cart} total={cartTotal} onUpdate={updateCart}
          onClose={() => setShowCart(false)}
          onConfirm={() => { setShowCart(false); setShowReceipt(true); }}
        />
      )}
      {showReceipt && (
        <ReceiptModal
          total={cartTotal}
          itemCount={cartCount}
          onConfirm={handleConfirm}
          onClose={() => { setShowReceipt(false); setShowCart(true); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TRANSACTION DETAIL
// ─────────────────────────────────────────────
function TransactionDetail({ txn, onClose }) {
  return (
    <Modal title="Transaction Details" onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          ["DATE & TIME", fmtDate(txn.timestamp)],
          ["STAFF", txn.user || txn.user_name],
          ["TRANSACTION ID", `#${txn.id.slice(-6).toUpperCase()}`],
          ["ITEMS COUNT", txn.items.reduce((s, i) => s + i.count, 0)],
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
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "9px 0", borderBottom: `1px solid #F3F4F6`,
          }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.name}</div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 1 }}>{RM(item.price)} × {item.count}</div>
            </div>
            <div style={{ fontWeight: 700, color: C.green, fontSize: 14 }}>{RM(item.price * item.count)}</div>
          </div>
        ))}
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", padding: "12px 0",
        borderTop: `2px solid ${C.border}`, marginBottom: 16,
      }}>
        <span style={{ fontWeight: 700, fontSize: 16 }}>Total</span>
        <span style={{ fontWeight: 800, fontSize: 22, color: C.green }}>{RM(txn.total)}</span>
      </div>

      {txn.receipt ? (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, letterSpacing: "0.05em" }}>RECEIPT</div>
          <img src={txn.receipt} alt="receipt"
            style={{ width: "100%", borderRadius: 10, maxHeight: 280, objectFit: "contain", background: "#F9FAFB" }} />
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: "10px 0", color: C.hint, fontSize: 13 }}>
          No receipt uploaded for this transaction.
        </div>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────────
// CSV EXPORT
// ─────────────────────────────────────────────
function exportCSV(transactions, label) {
  const rows = [
    ["Transaction ID", "Date & Time", "Staff", "Items", "Total (RM)"],
    ...transactions.map((t) => [
      `#${t.id.slice(-6).toUpperCase()}`,
      fmtDate(t.timestamp),
      t.user || t.user_name,
      t.items.map((i) => `${i.name} x${i.count}`).join(" | "),
      parseFloat(t.total).toFixed(2),
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `fizzicist-sales-${label}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// RECORDS
// ─────────────────────────────────────────────
function Records({ transactions }) {
  const [filter, setFilter]   = useState("day");
  const [selected, setSelected] = useState(null);

  const now = new Date();
  const filtered = transactions.filter((txn) => {
    const d = new Date(txn.timestamp);
    if (filter === "day")   return d.toDateString() === now.toDateString();
    if (filter === "week")  return d >= new Date(now - 7  * 86400000);
    return                         d >= new Date(now - 30 * 86400000);
  });

  const totalRevenue = filtered.reduce((s, t) => s + parseFloat(t.total), 0);
  const totalItems   = filtered.reduce((s, t) => s + t.items.reduce((a, i) => a + i.count, 0), 0);
  const filterLabel  = { day: "today", week: "7-days", month: "30-days" }[filter];

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Sales Records</span>
        {filtered.length > 0 && (
          <button
            onClick={() => exportCSV(filtered, filterLabel)}
            style={{
              padding: "7px 13px", background: C.white, color: C.green,
              border: `1.5px solid ${C.green}`, borderRadius: 20, fontSize: 12,
              fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            ⬇ Export CSV
          </button>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["day","Today"],["week","7 Days"],["month","30 Days"]].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer",
            background: filter === k ? C.green : "#F3F4F6",
            color: filter === k ? C.white : C.muted,
            fontWeight: filter === k ? 700 : 400, fontSize: 13, fontFamily: "inherit",
          }}>
            {l}
          </button>
        ))}
      </div>

      {/* Summary card */}
      <div style={{
        background: C.green, borderRadius: 16, padding: "18px 20px",
        marginBottom: 16, color: C.white,
      }}>
        <div style={{ fontSize: 11, opacity: 0.75, marginBottom: 2, letterSpacing: "0.06em" }}>TOTAL REVENUE</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.02em" }}>{RM(totalRevenue)}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          <span>📋 {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}</span>
          <span>🧃 {totalItems} items sold</span>
        </div>
      </div>

      {/* Transaction list */}
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
                      by {txn.user || txn.user_name} · {txn.items.reduce((s,i)=>s+i.count,0)} items
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
// BOTTOM NAV
// ─────────────────────────────────────────────
function BottomNav({ tab, setTab, cartCount }) {
  return (
    <nav style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 480, background: C.white,
      borderTop: `1px solid ${C.border}`, display: "flex", zIndex: 200,
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
    }}>
      {[
        { id: "dashboard", icon: "⊞", label: "Dashboard" },
        { id: "records",   icon: "📋", label: "Records" },
      ].map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{
          flex: 1, padding: "10px 0", background: "transparent", border: "none",
          cursor: "pointer", display: "flex", flexDirection: "column",
          alignItems: "center", gap: 2,
          color: tab === t.id ? C.green : C.hint,
          position: "relative", WebkitTapHighlightColor: "transparent",
        }}>
          <span style={{ fontSize: 22, position: "relative" }}>
            {t.icon}
            {t.id === "dashboard" && cartCount > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -8,
                background: C.danger, color: C.white, borderRadius: 10,
                fontSize: 10, fontWeight: 700, padding: "1px 5px",
                minWidth: 16, textAlign: "center",
              }}>
                {cartCount}
              </span>
            )}
          </span>
          <span style={{ fontSize: 11, fontWeight: tab === t.id ? 700 : 400 }}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─────────────────────────────────────────────
// ROOT APP
// ─────────────────────────────────────────────
export default function App() {
  console.log('App (root): Rendering...');
  const [authed, setAuthed]           = useState(false);
  const [user, setUser]               = useState("");
  const [tab, setTab]                 = useState("dashboard");
  const [products, setProducts]       = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [cart, setCart]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [dbError, setDbError]         = useState(false);
  const [toast, setToast]             = useState(null); // { message, type }

  const showToast = (message, type = "success") => {
    setToast({ message, type });
  };

  // Load persisted data on mount
  useEffect(() => {
    (async () => {
      try {
        const [prods, txns] = await Promise.all([
          db.getProducts(),
          db.getTransactions(),
        ]);
        setProducts(prods);
        setTransactions(txns);
      } catch (e) {
        console.error("Load error:", e);
        setDbError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveTransaction = async (txn) => {
    await db.insertTransaction(txn);
    setTransactions((prev) => [txn, ...prev]);
  };

  // ── Loading screen
  if (loading) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "sans-serif", color: C.muted, flexDirection: "column", gap: 12, background: C.bg,
      }}>
        <div style={{ fontSize: 44 }}>🥤</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Loading Fizzicist...</div>
      </div>
    );
  }

  // ── DB connection error
  if (dbError) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "sans-serif", flexDirection: "column", gap: 12, background: C.bg,
        padding: 24, textAlign: "center",
      }}>
        <div style={{ fontSize: 44 }}>⚠️</div>
        <div style={{ fontWeight: 700, fontSize: 17 }}>Cannot reach database</div>
        <div style={{ fontSize: 13, color: C.muted, maxWidth: 300 }}>
          Check your Supabase environment variables and network connection,
          then refresh the page.
        </div>
        <button onClick={() => window.location.reload()} style={{ ...ss.btnPrimary, maxWidth: 200 }}>
          Retry
        </button>
      </div>
    );
  }

  // ── Login screen
  if (!authed) {
    return <LoginPage onLogin={(u) => { setUser(u); setAuthed(true); }} />;
  }

  const cartCount = cart.reduce((s, i) => s + i.count, 0);

  return (
    <div style={ss.app}>
      {/* Global CSS for toast animation */}
      <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`}</style>

      {/* Header */}
      <div style={{
        background: C.green, color: C.white, padding: "13px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, flexShrink: 0,
      }}>
        <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>🥤 Fizzicist</span>
        <span style={{ fontSize: 12, opacity: 0.85, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Hi, {user} 👋
        </span>
      </div>

      {/* Page content */}
      <div style={{ flex: 1, paddingBottom: 70, overflowY: "auto" }}>
        {tab === "dashboard" ? (
          <Dashboard
            products={products}
            setProducts={setProducts}
            cart={cart}
            setCart={setCart}
            user={user}
            onTransaction={saveTransaction}
            showToast={showToast}
          />
        ) : (
          <Records transactions={transactions} />
        )}
      </div>

      <BottomNav tab={tab} setTab={setTab} cartCount={cartCount} />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  );
}
