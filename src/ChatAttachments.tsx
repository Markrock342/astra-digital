// Live chat attachments: images (pick, drag, or paste from the clipboard), a product card and an
// order card, on both the storefront chat and the admin inbox. Composer chips, the attach menu
// and the cards follow shadcn/ui Popover + Command + Card (MIT, https://ui.shadcn.com/docs/components):
// a paperclip trigger opening a small searchable list, white cards with a thumbnail, title and
// muted meta line. Colours come from the existing tokens, so storefront light/dark and the admin
// theme work unchanged. Admin cards link into the back office (order / product / customer) so the
// team can act on what the customer sent without searching for it.
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  ImagePlus,
  MessageCircle,
  Package,
  Paperclip,
  Receipt,
  Search,
  X,
} from "lucide-react";
import { Link, Status, useStore } from "./App";
import { api, dateTime, money } from "./api";
import { t } from "./i18n";
import { EN_STRINGS } from "./i18n-en";
import { checkSource, toWebp, uploadImage } from "./image-upload";
import { useDialog } from "./dialog";
import type { Order } from "./types";
import "./chat-attachments.css";

export type ChatProductCard = {
  id: string;
  name: string;
  active: boolean;
  price: number | null;
  imageUrl: string | null;
};
export type ChatOrderCard = {
  id: string;
  product: string;
  option: string;
  status: string;
  total: number;
  preorder: boolean;
};
export type PendingAttachment = {
  image: { blob: Blob; url: string } | null;
  product: { id: string; name: string; imageUrl: string | null } | null;
  order: { id: string; label: string } | null;
};

// English storefront strings for the chat attachments (existing entries win).
const EN_CHAT: Record<string, string> = {
  ไฟล์แนบ: "Attachments",
  "กำลังเตรียมรูป…": "Preparing image…",
  รูปที่จะส่ง: "Image to send",
  รูปภาพ: "Image",
  เอารูปออก: "Remove image",
  เอาสินค้าออก: "Remove product",
  เอาคำสั่งซื้อออก: "Remove order",
  "แนบรูป สินค้า หรือคำสั่งซื้อ": "Attach an image, product or order",
  เลือกรูปที่จะส่ง: "Choose an image to send",
  "หรือวางรูปในช่องพิมพ์ (Ctrl/⌘+V)": "or paste it into the message box (Ctrl/⌘+V)",
  สินค้า: "Product",
  คำสั่งซื้อของฉัน: "My orders",
  เลือกสินค้า: "Choose a product",
  เลือกคำสั่งซื้อ: "Choose an order",
  ค้นหาสินค้า: "Search products",
  ค้นหาสินค้าหรือเลขคำสั่งซื้อ: "Search product or order number",
  ค้นหาคำสั่งซื้อ: "Search orders",
  ปิด: "Close",
  ไม่พบสินค้า: "No products found",
  "กำลังโหลด…": "Loading…",
  ยังไม่มีคำสั่งซื้อ: "No orders yet",
  ดูรูปขนาดเต็ม: "View full image",
  รูปในแชท: "Chat image",
  เปิดในแท็บใหม่: "Open in new tab",
  ดูสินค้า: "View product",
  เริ่ม: "From",
  ปิดขายอยู่: "Not on sale",
  ดูคำสั่งซื้อ: "View order",
  สอบถามสินค้านี้ในแชท: "Ask about this product",
  สอบถามเรื่องคำสั่งซื้อนี้: "Ask about this order",
  "ข้อความยาวเกิน 1,000 ตัวอักษร": "Message is longer than 1,000 characters",
  "รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP": "Only JPG, PNG or WebP files",
  "ไฟล์ใหญ่เกิน 15MB": "File is larger than 15MB",
};
for (const [th, en] of Object.entries(EN_CHAT))
  if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

/** Opens the storefront chat with a product or order card ready to send. */
export function AskInChat({
  product,
  order,
}: {
  product?: { id: string; name: string; imageUrl?: string | null };
  order?: { id: string; name: string };
}) {
  const { user, go } = useStore();
  return (
    <button
      type="button"
      className="ask-in-chat"
      onClick={() => {
        if (!user)
          return go("/login?next=" + encodeURIComponent(location.pathname));
        dispatchEvent(
          new CustomEvent("chat-attach", {
            detail: product
              ? {
                  product: {
                    id: product.id,
                    name: product.name,
                    imageUrl: product.imageUrl ?? null,
                  },
                }
              : order
                ? {
                    order: {
                      id: order.id,
                      label: shortId(order.id) + " · " + order.name,
                    },
                  }
                : {},
          }),
        );
      }}
    >
      <MessageCircle size={15} aria-hidden="true" />
      {product ? t("สอบถามสินค้านี้ในแชท") : t("สอบถามเรื่องคำสั่งซื้อนี้")}
    </button>
  );
}

const EMPTY: PendingAttachment = { image: null, product: null, order: null };
const shortId = (id: string) => "#" + id.slice(0, 8).toUpperCase();

/** Composer state for one message's attachments; `send()` uploads the image and returns the API fields. */
export function useChatAttachments(admin: boolean) {
  const [draft, setDraft] = useState<PendingAttachment>(EMPTY);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const tr = (s: string) => (admin ? s : t(s));
  useEffect(
    () => () => {
      if (draft.image) URL.revokeObjectURL(draft.image.url);
    },
    [draft.image],
  );
  async function addImage(file: File) {
    setError("");
    const problem = checkSource(file);
    if (problem) return setError(tr(problem));
    setPreparing(true);
    try {
      const blob = await toWebp(file, 1600);
      setDraft((d) => ({
        ...d,
        image: { blob, url: URL.createObjectURL(blob) },
      }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }
  /** Paste handler for the composer textarea: an image on the clipboard becomes the attachment. */
  function onPaste(e: ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (!file) return;
    e.preventDefault();
    void addImage(file);
  }
  function onDrop(e: DragEvent) {
    const file = Array.from(e.dataTransfer.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (!file) return;
    e.preventDefault();
    void addImage(file);
  }
  const has = !!(draft.image || draft.product || draft.order);
  async function fields(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (draft.image) {
      const { imageId } = await uploadImage<{ imageId: string }>(
        "/chat/images",
        draft.image.blob,
      );
      out.imageId = imageId;
    }
    if (draft.product) out.productId = draft.product.id;
    if (draft.order) out.attachOrderId = draft.order.id;
    return out;
  }
  return {
    draft,
    has,
    preparing,
    error,
    setError,
    addImage,
    onPaste,
    onDrop,
    fields,
    setProduct: (product: PendingAttachment["product"]) =>
      setDraft((d) => ({ ...d, product })),
    setOrder: (order: PendingAttachment["order"]) =>
      setDraft((d) => ({ ...d, order })),
    clear: () => setDraft(EMPTY),
    removeImage: () => setDraft((d) => ({ ...d, image: null })),
  };
}
export type ChatAttachmentsState = ReturnType<typeof useChatAttachments>;

/** Pending attachments above the composer, each removable. */
export function AttachmentChips({
  state,
  admin,
}: {
  state: ChatAttachmentsState;
  admin: boolean;
}) {
  const tr = (s: string) => (admin ? s : t(s));
  const { draft } = state;
  if (!state.has && !state.preparing) return null;
  return (
    <div className="chat-attach-chips" aria-label={tr("ไฟล์แนบ")}>
      {state.preparing && (
        <span className="chat-attach-chip">{tr("กำลังเตรียมรูป…")}</span>
      )}
      {draft.image && (
        <span className="chat-attach-chip has-thumb">
          <img src={draft.image.url} alt={tr("รูปที่จะส่ง")} />
          <span>{tr("รูปภาพ")}</span>
          <button
            type="button"
            aria-label={tr("เอารูปออก")}
            onClick={state.removeImage}
          >
            <X size={14} />
          </button>
        </span>
      )}
      {draft.product && (
        <span className="chat-attach-chip">
          <Package size={14} aria-hidden="true" />
          <span>{draft.product.name}</span>
          <button
            type="button"
            aria-label={tr("เอาสินค้าออก")}
            onClick={() => state.setProduct(null)}
          >
            <X size={14} />
          </button>
        </span>
      )}
      {draft.order && (
        <span className="chat-attach-chip">
          <Receipt size={14} aria-hidden="true" />
          <span>{draft.order.label}</span>
          <button
            type="button"
            aria-label={tr("เอาคำสั่งซื้อออก")}
            onClick={() => state.setOrder(null)}
          >
            <X size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

type PickOrder = {
  id: string;
  product: string;
  status: string;
  total: number;
  created_at: string;
};

/** Paperclip button → menu: image file, a product, an order (customer: own orders; team: this customer's). */
export function AttachMenu({
  state,
  admin,
  customerId,
}: {
  state: ChatAttachmentsState;
  admin: boolean;
  /** Team view: whose orders can be attached. */
  customerId?: string | null;
}) {
  const tr = (s: string) => (admin ? s : t(s));
  const { products } = useStore();
  const [open, setOpen] = useState<null | "menu" | "product" | "order">(null);
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<PickOrder[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const host = useRef<HTMLDivElement>(null);
  useDialog(open === "product" || open === "order", ".chat-attach-picker", () =>
    setOpen(null),
  );
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (host.current && !host.current.contains(e.target as Node))
        setOpen(null);
    };
    addEventListener("mousedown", away);
    return () => removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => {
    if (open !== "order") return;
    setOrders(null);
    setLoadError("");
    const load = admin
      ? customerId
        ? api<{ orders: PickOrder[] }>("/admin/customers/" + customerId).then(
            (r) => r.orders,
          )
        : Promise.resolve([])
      : api<{ orders: Order[] }>("/orders").then((r) =>
          r.orders.map((o) => ({
            id: o.id,
            product: o.name,
            status: o.status,
            total: o.total,
            created_at: o.created_at,
          })),
        );
    load.then(setOrders, (e) => setLoadError((e as Error).message));
  }, [open, admin, customerId]);
  const q = query.trim().toLowerCase();
  const productList = products
    .filter((p) => p.active && (!q || p.name.toLowerCase().includes(q)))
    .slice(0, 30);
  const orderList = (orders ?? [])
    .filter(
      (o) =>
        !q ||
        o.product.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q.replace("#", "")),
    )
    .slice(0, 30);
  return (
    <div className="chat-attach" ref={host}>
      <button
        type="button"
        className={"icon-button chat-attach-trigger" + (open ? " is-open" : "")}
        aria-label={tr("แนบรูป สินค้า หรือคำสั่งซื้อ")}
        aria-haspopup="menu"
        aria-expanded={open === "menu"}
        onClick={() => {
          setQuery("");
          setOpen(open ? null : "menu");
        }}
      >
        <Paperclip size={18} />
      </button>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        aria-label={tr("เลือกรูปที่จะส่ง")}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) void state.addImage(picked);
          e.target.value = "";
        }}
      />
      {open === "menu" && (
        <div className="chat-attach-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(null);
              file.current?.click();
            }}
          >
            <ImagePlus size={17} />
            <span>
              {tr("รูปภาพ")}
              <small>{tr("หรือวางรูปในช่องพิมพ์ (Ctrl/⌘+V)")}</small>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setOpen("product")}
          >
            <Package size={17} />
            <span>{tr("สินค้า")}</span>
          </button>
          {(!admin || customerId) && (
            <button
              type="button"
              role="menuitem"
              onClick={() => setOpen("order")}
            >
              <Receipt size={17} />
              <span>{admin ? "คำสั่งซื้อของลูกค้าคนนี้" : t("คำสั่งซื้อของฉัน")}</span>
            </button>
          )}
        </div>
      )}
      {(open === "product" || open === "order") && (
        <div
          className="chat-attach-picker"
          role="dialog"
          aria-label={open === "product" ? tr("เลือกสินค้า") : tr("เลือกคำสั่งซื้อ")}
        >
          <div className="chat-attach-search">
            <Search size={15} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                open === "product" ? tr("ค้นหาสินค้า") : tr("ค้นหาสินค้าหรือเลขคำสั่งซื้อ")
              }
              aria-label={
                open === "product" ? tr("ค้นหาสินค้า") : tr("ค้นหาคำสั่งซื้อ")
              }
            />
            <button
              type="button"
              className="icon-button"
              aria-label={tr("ปิด")}
              onClick={() => setOpen(null)}
            >
              <X size={15} />
            </button>
          </div>
          <ul>
            {open === "product" ? (
              productList.length ? (
                productList.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        state.setProduct({
                          id: p.id,
                          name: p.name,
                          imageUrl: p.imageUrl ?? null,
                        });
                        setOpen(null);
                      }}
                    >
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" />
                      ) : (
                        <span className="chat-attach-thumb">
                          <Package size={16} />
                        </span>
                      )}
                      <span>
                        {p.name}
                        <small>
                          {p.variants.length
                            ? money(Math.min(...p.variants.map((v) => v.price)))
                            : ""}
                        </small>
                      </span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="chat-attach-empty">{tr("ไม่พบสินค้า")}</li>
              )
            ) : loadError ? (
              <li className="chat-attach-empty">{loadError}</li>
            ) : !orders ? (
              <li className="chat-attach-empty">{tr("กำลังโหลด…")}</li>
            ) : orderList.length ? (
              orderList.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => {
                      state.setOrder({
                        id: o.id,
                        label: shortId(o.id) + " · " + o.product,
                      });
                      setOpen(null);
                    }}
                  >
                    <span className="chat-attach-thumb">
                      <Receipt size={16} />
                    </span>
                    <span>
                      {shortId(o.id)} · {o.product}
                      <small>
                        {money(o.total)} · {dateTime(o.created_at)}
                      </small>
                    </span>
                    <Status status={o.status} />
                  </button>
                </li>
              ))
            ) : (
              <li className="chat-attach-empty">{tr("ยังไม่มีคำสั่งซื้อ")}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Image / product / order shown inside a chat bubble. */
export function MessageAttachments({
  imageUrl,
  product,
  order,
  report,
  admin,
}: {
  imageUrl?: string | null;
  product?: ChatProductCard | null;
  order?: ChatOrderCard | null;
  /** Report messages already show their order tag. */
  report?: boolean;
  admin: boolean;
}) {
  const tr = (s: string) => (admin ? s : t(s));
  const [zoom, setZoom] = useState(false);
  useDialog(zoom, ".chat-image-viewer", () => setZoom(false));
  return (
    <>
      {imageUrl && (
        <button
          type="button"
          className="chat-image"
          onClick={() => setZoom(true)}
          aria-label={tr("ดูรูปขนาดเต็ม")}
        >
          <img src={imageUrl} alt={tr("รูปในแชท")} loading="lazy" />
        </button>
      )}
      {zoom &&
        imageUrl &&
        // Portal: the storefront chat panel clips fixed children, the viewer must cover the page.
        createPortal(
          <div
            className="modal-backdrop chat-image-backdrop"
            onClick={() => setZoom(false)}
          >
            <div
              className="chat-image-viewer"
              role="dialog"
              aria-label={tr("รูปในแชท")}
              onClick={(e) => e.stopPropagation()}
            >
              <img src={imageUrl} alt={tr("รูปในแชท")} />
              <div className="chat-image-actions">
                <a
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button secondary"
                >
                  <ExternalLink size={15} />
                  {tr("เปิดในแท็บใหม่")}
                </a>
                <button
                  type="button"
                  className="button primary"
                  onClick={() => setZoom(false)}
                >
                  {tr("ปิด")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {product && (
        <Link
          to={(admin ? "/admin/products/" : "/products/") + product.id}
          className="chat-card"
          aria-label={(admin ? "จัดการสินค้า " : t("ดูสินค้า") + " ") + product.name}
        >
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" />
          ) : (
            <span className="chat-card-icon">
              <Package size={18} />
            </span>
          )}
          <span className="chat-card-text">
            <strong>{product.name}</strong>
            <small>
              {product.price != null
                ? (admin ? "เริ่ม " : t("เริ่ม") + " ") + money(product.price)
                : ""}
              {!product.active
                ? admin
                  ? " · ปิดขายอยู่"
                  : " · " + t("ปิดขายอยู่")
                : ""}
            </small>
          </span>
          <span className="chat-card-action">
            {admin ? "จัดการสินค้า" : t("ดูสินค้า")}
          </span>
        </Link>
      )}
      {order && !report && (
        <Link
          to={(admin ? "/admin/orders/" : "/orders/") + order.id}
          className="chat-card"
          aria-label={
            (admin ? "จัดการคำสั่งซื้อ " : t("ดูคำสั่งซื้อ") + " ") + shortId(order.id)
          }
        >
          <span className="chat-card-icon">
            <Receipt size={18} />
          </span>
          <span className="chat-card-text">
            <strong>
              {shortId(order.id)} · {order.product}
            </strong>
            <small>
              {order.option} · {money(order.total)}
            </small>
            <Status status={order.status} />
          </span>
          <span className="chat-card-action">
            {admin ? "จัดการออเดอร์" : t("ดูคำสั่งซื้อ")}
          </span>
        </Link>
      )}
    </>
  );
}
