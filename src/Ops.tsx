// In-web chat, notifications and buyer ranking (SOW items). API: docs/architecture/api-contract-shop.md
import { useLive, type LiveTopic } from "./live";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import {
  ArrowLeft,
  Bell,
  CheckCheck,
  CornerUpLeft,
  LoaderCircle,
  MessageCircle,
  Pin,
  PinOff,
  Receipt,
  Search,
  Send,
  ShieldAlert,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { Art, ErrorMessage, Link, useStore } from "./App";
import { preorderNoticeBody } from "./Preorder";
import { NAVIGATE_EVENT } from "./navigation";
import { api, dateTime, money, relativeTime } from "./api";
import { t } from "./i18n";
import { shopLogo } from "./AdminLogo";
import { ChatOrderTag, useReportDraft } from "./OrderExtras";
import {
  AttachMenu,
  AttachmentChips,
  MessageAttachments,
  useChatAttachments,
  type ChatOrderCard,
  type ChatProductCard,
} from "./ChatAttachments";
import {
  CannedReplyManager,
  CannedReplyPicker,
  matchCanned,
  pickerKey,
  useCannedReplies,
  type CannedReply,
} from "./CannedReplies";
import { MessageSquareText } from "lucide-react";
import "./chat-inbox.css";

export type ChatThread = {
  id: string;
  status: "OPEN" | "CLOSED";
  customer?: string;
  customer_email?: string;
  messages: number;
  lastMessageAt: string;
  unreadCount: number;
  created_at: string;
  assigned_to?: string | null;
  assignee?: string | null;
  /** Latest order reported or attached in this thread. */
  order_id?: string | null;
  /** The customer (team view links to their back-office page). */
  user_id?: string;
  /** Team view: the customer's profile photo URL, if any. */
  customer_avatar?: string | null;
  /** Shared team pin. Absent on the customer payload. */
  pinned_at?: string | null;
  /** Short snippet when a search hit came from a message. */
  matchText?: string | null;
};
/** Picture next to a chat message: a photo/logo, else the first letter of the name. */
type ChatFace = { url?: string | null; name: string };

function ChatAvatar({ face }: { face: ChatFace }) {
  return face.url ? (
    <img className="chat-avatar" src={face.url} alt="" />
  ) : (
    <span className="chat-avatar chat-avatar-letter" aria-hidden="true">
      {(face.name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
type TeamMember = { id: string; name: string; role: string; active: boolean };
export type ChatMessage = {
  id: string;
  thread_id: string;
  sender_type: "USER" | "STAFF" | "ADMIN";
  body: string;
  created_at: string;
  order_id?: string | null;
  report_reason?: string | null;
  imageUrl?: string | null;
  product?: ChatProductCard | null;
  order?: ChatOrderCard | null;
};

/** Window event: the notification bell reloads its list. */
const NOTICES_REFRESH = "notices-refresh";

/** A reply is the same text message, with the quoted line marked so both sides can show it. */
const REPLY_MARK = "\u200b↩ ";
type ChatReply = { author: string; text: string };

export function splitReply(body: string): {
  quote: ChatReply | null;
  text: string;
} {
  if (!body.startsWith(REPLY_MARK)) return { quote: null, text: body };
  const breakAt = body.indexOf("\n");
  const head = body.slice(REPLY_MARK.length, breakAt < 0 ? undefined : breakAt);
  const sep = head.indexOf(": ");
  if (sep < 1 || breakAt < 0) return { quote: null, text: body };
  return {
    quote: { author: head.slice(0, sep), text: head.slice(sep + 2) },
    text: body.slice(breakAt + 1),
  };
}

const replySnippet = (body: string) =>
  splitReply(body).text.replace(/\s+/g, " ").trim().slice(0, 80);

/** The quote travels inside the message text, so anyone could type a fake one ("ทีมงาน: คืนเงินแล้ว").
 * Only show the quote box when the quoted text is an earlier message in this thread, and take the
 * author from that real message instead of the typed name. Otherwise show the text as it was sent. */
function verifiedReply(
  messages: ChatMessage[],
  index: number,
  authorOf: (m: ChatMessage) => string,
): { quote: ChatReply | null; text: string } {
  const body = messages[index].body;
  const parsed = splitReply(body);
  if (!parsed.quote) return parsed;
  for (let j = index - 1; j >= 0; j--) {
    if (replySnippet(messages[j].body) === parsed.quote.text)
      return {
        quote: { author: authorOf(messages[j]), text: parsed.quote.text },
        text: parsed.text,
      };
  }
  return { quote: null, text: body.slice(REPLY_MARK.length) };
}

function replyTarget(message: ChatMessage, author: string): ChatReply {
  const text = replySnippet(message.body);
  return {
    author: author.replace(/[:\n]/g, "").trim().slice(0, 40) || "?",
    text,
  };
}

function withReply(body: string, reply: ChatReply | null) {
  if (!reply) return body;
  return `${REPLY_MARK}${reply.author}: ${reply.text}\n${body}`;
}
export type Notice = {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** In-app path to open (order or chat); null on older notifications. */
  link?: string | null;
  read_at: string | null;
  created_at: string;
  /** Product of the order / stock line, or the customer who wrote (server/domain.mjs noticePictures). */
  picture?:
    | { type: "product"; name: string; art: string; imageUrl: string | null }
    | { type: "person"; name: string; imageUrl: string | null }
    | { type: "photo"; imageUrl: string }
    | null;
};
const NOTICE_ICONS: Record<string, typeof Bell> = {
  credit: Wallet,
  fraud_signal: ShieldAlert,
  team: Users,
  tax_invoice: Receipt,
  chat_assigned: MessageCircle,
};
/** Picture at the left of a bell item: product cover, customer photo/letter, shop logo or an icon. */
function NoticePicture({ n, admin }: { n: Notice; admin: boolean }) {
  const { overview } = useStore();
  const p = n.picture;
  if (p?.type === "photo")
    return (
      <span className="notice-pic photo">
        <img src={p.imageUrl} alt="" loading="lazy" />
      </span>
    );
  if (p?.type === "product")
    return (
      <span className="notice-pic">
        {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <Art small type={p.art} name={p.name} />}
      </span>
    );
  if (p?.type === "person")
    return p.imageUrl ? (
      <span className="notice-pic round">
        <img src={p.imageUrl} alt="" loading="lazy" />
      </span>
    ) : (
      <span className="notice-pic round letter">{(p.name.trim()[0] ?? "?").toUpperCase()}</span>
    );
  // Customer side: everything else comes from the shop (team replies, announcements, credit).
  if (!admin || n.kind === "broadcast")
    return (
      <span className="notice-pic">
        <img src={shopLogo(overview?.shop?.logoUrl)} alt="" />
      </span>
    );
  const Icon = NOTICE_ICONS[n.kind] ?? Bell;
  return (
    <span className="notice-pic icon">
      <Icon size={18} />
    </span>
  );
}
export type Buyer = {
  rank: number;
  name: string;
  email: string;
  orders: number;
  spentSatang: number;
};

/** Runs `fn` now and every `ms` while the tab is visible. */
/** Load now, again on every live signal for `topics`, and on a slow safety interval. */
function usePoll(
  fn: () => void,
  ms: number,
  enabled = true,
  topics: LiveTopic[] = [],
) {
  const saved = useRef(fn);
  saved.current = fn;
  useLive(topics, () => {
    if (enabled) saved.current();
  });
  useEffect(() => {
    if (!enabled) return;
    saved.current();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") saved.current();
    }, ms);
    const wake = () =>
      document.visibilityState === "visible" && saved.current();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [ms, enabled]);
}

// Order page paths in a chat message (e.g. the shop's "resend" message) become links.
const ORDER_PATH = /(\/orders\/[A-Za-z0-9-]{8,80})/;

const time = (value: string) => dateTime(value).split(" ").slice(-1)[0] ?? "";

function noticeText(n: Notice) {
  const queue = n.body.match(/^คิวของคุณคือ #(\d+)$/);
  const code = n.body.match(/^คำสั่งซื้อ (\S+) ได้รับโค้ดแล้ว$/);
  // Deposit / free preorder: called, reminder, lapsed, cancelled (Preorder.tsx).
  const preorder = preorderNoticeBody(n.body);
  return {
    title: t(n.title),
    body: queue
      ? t("คิวของคุณคือ #{n}", { n: queue[1] })
      : code
        ? t("คำสั่งซื้อ {id} ได้รับโค้ดแล้ว", { id: code[1].toUpperCase() })
        : (preorder ?? t(n.body)),
  };
}

function noticeTarget(n: Notice, admin: boolean): string | null {
  // Only same-site paths; anything else falls back to the kind-based page.
  if (n.link && /^\/(?!\/)/.test(n.link)) return n.link;
  // Shop announcements (ลูกค้า › ประกาศถึงลูกค้า) may link to an https page, or nowhere.
  if (n.kind === "broadcast")
    return n.link && /^https:\/\//.test(n.link) ? n.link : null;
  if (admin)
    return (
      {
        chat: "/admin/chat",
        chat_assigned: "/admin/chat",
        order_new: "/admin/orders",
        preorder_queue_admin: "/admin/preorders",
        stock_low: "/admin/inventory",
      }[n.kind] ?? "/admin"
    );
  return n.kind === "chat" ? "#chat" : "/orders";
}

/** Bell with unread count; used in both the storefront and admin headers. */
export function NotificationBell({ admin = false }: { admin?: boolean }) {
  const { user, go } = useStore();
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try {
      setItems(
        (await api<{ notifications: Notice[] }>("/notifications"))
          .notifications,
      );
    } catch {
      /* keep the last list; the bell is not critical */
    }
  }, []);
  usePoll(load, 60000, !!user, ["notify"]);
  // Opening a chat thread clears its alerts on the server: refresh the badge right away.
  useEffect(() => {
    const again = () => void load();
    addEventListener(NOTICES_REFRESH, again);
    return () => removeEventListener(NOTICES_REFRESH, again);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !wrap.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    addEventListener("mousedown", close);
    addEventListener("keydown", close);
    return () => {
      removeEventListener("mousedown", close);
      removeEventListener("keydown", close);
    };
  }, [open]);
  if (!user) return null;
  const unread = items.filter((n) => !n.read_at);
  async function read(n: Notice) {
    setItems((list) =>
      list.map((x) =>
        x.id === n.id ? { ...x, read_at: x.read_at ?? "now" } : x,
      ),
    );
    if (!n.read_at)
      void api("/notifications/" + n.id + "/read", {}).catch(() => {});
  }
  async function readAll() {
    const ids = unread.map((n) => n.id);
    setItems((list) =>
      list.map((x) => ({ ...x, read_at: x.read_at ?? "now" })),
    );
    await Promise.all(
      ids.map((id) =>
        api("/notifications/" + id + "/read", {}).catch(() => {}),
      ),
    );
  }
  const label = admin ? "แจ้งเตือน" : t("แจ้งเตือน");
  return (
    <div className="notice-wrap" ref={wrap}>
      <button
        className="icon-button notice-button"
        aria-label={
          unread.length
            ? label +
              " " +
              (admin
                ? `ยังไม่อ่าน ${unread.length}`
                : t("ยังไม่อ่าน {n}", { n: unread.length }))
            : label
        }
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={admin ? 18 : 20} />
        {unread.length > 0 && (
          <span className="notice-count">
            {unread.length > 99 ? "99+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div className="notice-panel" role="dialog" aria-label={label}>
          <div className="notice-head">
            <strong>{label}</strong>
            {unread.length > 0 && (
              <button
                className="notice-read-all"
                onClick={() => void readAll()}
              >
                <CheckCheck size={15} />
                {admin ? "อ่านทั้งหมด" : t("อ่านทั้งหมด")}
              </button>
            )}
          </div>
          {items.length ? (
            <ul className="notice-list">
              {items.slice(0, 30).map((n) => {
                const text =
                  admin || n.kind === "broadcast"
                    ? { title: n.title, body: n.body }
                    : noticeText(n);
                return (
                  <li key={n.id}>
                    <button
                      className={
                        (n.read_at ? "notice-item" : "notice-item unread") +
                        (n.kind === "broadcast" ? " is-broadcast" : "")
                      }
                      onClick={() => {
                        void read(n);
                        const to = noticeTarget(n, admin);
                        // An announcement without a link just gets marked as read.
                        if (!to) return;
                        setOpen(false);
                        if (to === "#chat")
                          dispatchEvent(new Event("open-chat"));
                        else if (/^https:\/\//.test(to))
                          window.open(to, "_blank", "noopener,noreferrer");
                        else go(to);
                      }}
                    >
                      <span className="notice-dot" aria-hidden="true" />
                      <NoticePicture n={n} admin={admin} />
                      <span className="notice-text">
                        <strong>{text.title}</strong>
                        <small>{text.body}</small>
                        <time>{relativeTime(n.created_at)}</time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="notice-empty">
              {admin ? "ยังไม่มีแจ้งเตือน" : t("ยังไม่มีแจ้งเตือน")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageList({
  messages,
  mine,
  customerName,
  admin = false,
  onReply,
  replyLabel = "ตอบกลับ",
  faceOf,
}: {
  /** Picture per message (shown once at the end of each run from the same side). */
  faceOf?: (m: ChatMessage) => ChatFace;
  messages: ChatMessage[];
  mine: (m: ChatMessage) => boolean;
  customerName: (m: ChatMessage) => string;
  /** Team view: order links open the back-office order instead. */
  admin?: boolean;
  onReply?: (m: ChatMessage) => void;
  replyLabel?: string;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  return (
    <div className="chat-messages" aria-live="polite">
      {messages.map((m, index) => {
        const shown = verifiedReply(messages, index, customerName);
        const next = messages[index + 1];
        const lastOfRun = !next || next.sender_type !== m.sender_type;
        return (
          <div
            key={m.id}
            className={
              "chat-row" +
              (mine(m) ? " mine" : "") +
              (faceOf ? " has-face" : "")
            }
          >
            {faceOf &&
              (lastOfRun ? (
                <ChatAvatar face={faceOf(m)} />
              ) : (
                <span
                  className="chat-avatar chat-avatar-gap"
                  aria-hidden="true"
                />
              ))}
            <div className={mine(m) ? "chat-bubble mine" : "chat-bubble"}>
              <small>{customerName(m)}</small>
              {m.order_id && m.report_reason && (
                <ChatOrderTag
                  orderId={m.order_id}
                  reason={m.report_reason}
                  admin={admin}
                />
              )}
              {shown.quote && (
                <blockquote className="chat-quote">
                  <small>{shown.quote.author}</small>
                  <span>{shown.quote.text}</span>
                </blockquote>
              )}
              <MessageAttachments
                imageUrl={m.imageUrl}
                product={m.product}
                order={m.order}
                report={!!m.report_reason}
                admin={admin}
              />
              {shown.text && (
                <p>
                  {shown.text.split(ORDER_PATH).map((part, i) =>
                    i % 2 ? (
                      <Link
                        key={i}
                        to={admin ? "/admin" + part : part}
                        className="chat-order-link"
                      >
                        {part}
                      </Link>
                    ) : (
                      part
                    ),
                  )}
                </p>
              )}
              <time>{time(m.created_at)}</time>
              {onReply && (
                <button
                  type="button"
                  className="chat-reply-button"
                  onClick={() => onReply(m)}
                >
                  <CornerUpLeft size={14} />
                  {replyLabel}
                </button>
              )}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function ReplyBar({
  reply,
  clearLabel,
  onClear,
}: {
  reply: ChatReply;
  clearLabel: string;
  onClear: () => void;
}) {
  return (
    <div className="chat-reply-bar">
      <span>
        <small>{reply.author}</small>
        {reply.text}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label={clearLabel}
        onClick={onClear}
      >
        <X size={16} />
      </button>
    </div>
  );
}

/** Floating chat for customers on the storefront. */
export function CustomerChat() {
  const { user, path, overview } = useStore();
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(open);
  openRef.current = open;
  const loadUnread = useCallback(async () => {
    if (!user) {
      setUnread(0);
      return;
    }
    try {
      const { notifications } = await api<{ notifications: Notice[] }>(
        "/notifications",
      );
      const pending = notifications.filter(
        (n) =>
          n.kind === "chat" && !n.read_at && n.title === "มีข้อความใหม่จากทีมงาน",
      );
      if (openRef.current && pending.length) {
        setUnread(0);
        await Promise.all(
          pending.map((n) =>
            api("/notifications/" + n.id + "/read", {}).catch(() => {}),
          ),
        );
      } else setUnread(pending.length);
    } catch {
      /* keep the last count; the badge is not critical */
    }
  }, [user?.id]);
  useEffect(() => {
    void loadUnread();
  }, [loadUnread]);
  useLive(["notify", "chat"], () => {
    void loadUnread();
  });
  function reveal() {
    openRef.current = true;
    setOpen(true);
    void loadUnread();
  }
  // "แจ้งปัญหาบัญชีนี้" from the order page: prefilled message + reason picker.
  const report = useReportDraft({ setText, open: reveal });
  // Image / product / order attached to the next message.
  const attach = useChatAttachments(false);
  // "สอบถามสินค้านี้" / "สอบถามเรื่องคำสั่งซื้อนี้" elsewhere in the shop open the chat with a card attached.
  useEffect(() => {
    const onAttach = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          product?: { id: string; name: string; imageUrl: string | null };
          order?: { id: string; label: string };
        }>
      ).detail;
      if (detail?.product) attach.setProduct(detail.product);
      if (detail?.order) attach.setOrder(detail.order);
      reveal();
    };
    addEventListener("chat-attach", onAttach);
    return () => removeEventListener("chat-attach", onAttach);
  });
  useEffect(() => {
    addEventListener("open-chat", reveal);
    return () => removeEventListener("open-chat", reveal);
  }, [loadUnread]);
  useEffect(() => {
    if (!user) {
      setThread(null);
      setMessages([]);
      setLoaded(false);
    }
  }, [user?.id]);
  const load = useCallback(async () => {
    try {
      const { threads } = await api<{ threads: ChatThread[] }>("/chat/threads");
      const latest =
        threads.find((x) => x.status === "OPEN") ?? threads[0] ?? null;
      setThread(latest);
      setMessages(
        latest
          ? (
              await api<{ messages: ChatMessage[] }>(
                "/chat/threads/" + latest.id + "/messages",
              )
            ).messages
          : [],
      );
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);
  usePoll(load, 60000, open && !!user, ["chat"]);
  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if ((!body && !attach.has) || busy || attach.preparing) return;
    const payload = body ? withReply(body, replyTo) : "";
    if (payload.length > 1000) {
      setError(t("ข้อความยาวเกิน 1,000 ตัวอักษร"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const extra = await attach.fields();
      if (thread?.status === "OPEN") {
        setMessages(
          (
            await api<{ messages: ChatMessage[] }>(
              "/chat/threads/" + thread.id + "/messages",
              {
                body: payload,
                ...report.payload,
                ...extra,
              },
            )
          ).messages,
        );
      } else {
        const opened = await api<{
          thread: ChatThread;
          messages: ChatMessage[];
        }>("/chat/threads", {
          ...(payload ? { body: payload } : {}),
          ...report.payload,
          ...extra,
        });
        setThread(opened.thread);
        setMessages(opened.messages);
      }
      setText("");
      setReplyTo(null);
      report.clear();
      attach.clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (
    path.startsWith("/admin") ||
    path === "/stores" ||
    new URLSearchParams(location.search).has("shop-preview")
  )
    return null;
  return (
    <>
      <button
        className={open ? "chat-fab open" : "chat-fab"}
        aria-label={
          open
            ? t("ปิดแชท")
            : unread
              ? t("แชทกับร้าน") + ", " + t("ยังไม่อ่าน {n}", { n: unread })
              : t("แชทกับร้าน")
        }
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : reveal())}
      >
        {open ? <X size={22} /> : <MessageCircle size={22} />}
        {!open && unread > 0 && (
          <span className="chat-unread">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <section
          className="chat-panel"
          role="dialog"
          aria-label={t("แชทกับร้าน")}
        >
          <header className="chat-panel-head">
            <span className="chat-status-dot" aria-hidden="true" />
            <div>
              <strong>{t("แชทกับร้าน")}</strong>
              <small>{t("ทีมงานจะตอบกลับในเว็บนี้")}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t("ปิดแชท")}
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          {!user ? (
            <div className="chat-login">
              <MessageCircle size={28} />
              <p>{t("เข้าสู่ระบบเพื่อแชทกับร้าน ข้อความจะถูกเก็บไว้ในบัญชีของคุณ")}</p>
              <Link
                to={"/login?next=" + encodeURIComponent(path)}
                className="button primary"
              >
                {t("เข้าสู่ระบบ")}
              </Link>
            </div>
          ) : !loaded ? (
            <div className="chat-login">
              <LoaderCircle className="spin" size={22} />
            </div>
          ) : (
            <>
              {messages.length ? (
                <MessageList
                  messages={messages}
                  faceOf={(m) =>
                    m.sender_type === "USER"
                      ? { url: user.avatarUrl, name: user.name }
                      : {
                          url: shopLogo(overview?.shop?.logoUrl),
                          name: overview?.shop?.shopName || "ASIA EXTRA",
                        }
                  }
                  mine={(m) => m.sender_type === "USER"}
                  customerName={(m) =>
                    m.sender_type === "USER" ? t("คุณ") : t("ทีมงาน")
                  }
                  onReply={(m) =>
                    setReplyTo(
                      replyTarget(
                        m,
                        m.sender_type === "USER" ? t("คุณ") : t("ทีมงาน"),
                      ),
                    )
                  }
                  replyLabel={t("ตอบกลับ")}
                />
              ) : (
                <div className="chat-login">
                  <p>
                    {t("สอบถามเรื่องสินค้าหรือคำสั่งซื้อได้เลย กรุณาอย่าส่งรหัสผ่านในแชท")}
                  </p>
                </div>
              )}
              {thread?.status === "CLOSED" && (
                <p className="chat-closed-note">
                  {t("แชทก่อนหน้าปิดแล้ว ส่งข้อความเพื่อเริ่มแชทใหม่")}
                </p>
              )}
              <ErrorMessage message={error || attach.error} />
              {report.bar}
              <AttachmentChips state={attach} admin={false} />
              <form
                className="chat-composer"
                onSubmit={send}
                onDragOver={(e) =>
                  e.dataTransfer.types.includes("Files") && e.preventDefault()
                }
                onDrop={attach.onDrop}
              >
                {replyTo && (
                  <ReplyBar
                    reply={replyTo}
                    clearLabel={t("ยกเลิกการตอบกลับ")}
                    onClear={() => setReplyTo(null)}
                  />
                )}
                <AttachMenu state={attach} admin={false} />
                <textarea
                  onPaste={attach.onPaste}
                  aria-label={t("ข้อความ")}
                  placeholder={t("พิมพ์ข้อความ…")}
                  value={text}
                  maxLength={1000}
                  rows={report.report ? 6 : 1}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void send(e);
                    }
                  }}
                />
                <button
                  className="button primary"
                  disabled={
                    busy || attach.preparing || (!text.trim() && !attach.has)
                  }
                  aria-label={t("ส่ง")}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Send size={17} />
                  )}
                </button>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}

/** Wrap each case-insensitive hit in a real <mark>. Never inject HTML. */
function highlightQuery(text: string, query: string) {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const want = needle.toLowerCase();
  const out: Array<string | ReactElement> = [];
  let from = 0;
  let n = 0;
  while (from < text.length) {
    const at = lower.indexOf(want, from);
    if (at < 0) {
      out.push(text.slice(from));
      break;
    }
    if (at > from) out.push(text.slice(from, at));
    out.push(<mark key={n++} className="chat-hit">{text.slice(at, at + want.length)}</mark>);
    from = at + want.length;
  }
  return out;
}

/** /admin/chat — every customer thread, pinned first, then newest message. */
export function AdminChat() {
  const { toast, user, overview } = useStore();
  const [team, setTeam] = useState<TeamMember[]>([]);
  useEffect(() => {
    api<{ team: TeamMember[] }>("/admin/team")
      .then((r) => setTeam(r.team.filter((m) => m.active)))
      .catch(() => {});
  }, []);
  const [threads, setThreads] = useState<ChatThread[] | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ChatReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"OPEN" | "MINE" | "ALL">("OPEN");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  // ข้อความสำเร็จรูป: picker opened by the button or by "/" at the start of the composer.
  const isAdmin = user?.role === "ADMIN";
  const [picker, setPicker] = useState<null | "slash" | "button">(null);
  const [pickQuery, setPickQuery] = useState("");
  const [pickActive, setPickActive] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const [managing, setManaging] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const canned = useCannedReplies(current, picker !== null);
  const attach = useChatAttachments(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const closePicker = () => {
    if (picker === "slash") setSlashOff(true);
    setPicker(null);
    setPickQuery("");
    setPickActive(0);
  };
  function insertCanned(r: CannedReply) {
    const fill = r.text ?? r.body;
    const el = textRef.current;
    let next = fill;
    let caret = fill.length;
    if (picker !== "slash") {
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      next = text.slice(0, start) + fill + text.slice(end);
      caret = start + fill.length;
    }
    setText(next);
    setMissing(r.missing ?? []);
    setPicker(null);
    setPickQuery("");
    setPickActive(0);
    setSlashOff(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  }
  useEffect(() => {
    if (!picker) return;
    const away = (e: MouseEvent) => {
      if (
        composerRef.current &&
        !composerRef.current.contains(e.target as Node)
      )
        closePicker();
    };
    addEventListener("mousedown", away);
    return () => removeEventListener("mousedown", away);
  });
  useEffect(() => {
    setReplyTo(null);
    setPicker(null);
    setMissing([]);
    attach.clear();
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  // Deep link from a notification: /admin/chat?thread=<id> opens that thread,
  // also when the bell is used while this page is already open.
  useEffect(() => {
    const pick = () => {
      const id = new URLSearchParams(location.search).get("thread");
      if (!id) return;
      setMessages([]);
      setCurrent(id);
    };
    pick();
    addEventListener(NAVIGATE_EVENT, pick);
    return () => removeEventListener(NAVIGATE_EVENT, pick);
  }, []);
  const loadThreads = useCallback(async () => {
    try {
      const path = debounced ? "/chat/threads?q=" + encodeURIComponent(debounced) : "/chat/threads";
      setThreads((await api<{ threads: ChatThread[] }>(path)).threads);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [debounced]);
  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);
  const loadMessages = useCallback(async () => {
    if (!current) return;
    try {
      setMessages(
        (
          await api<{ messages: ChatMessage[] }>(
            "/chat/threads/" + current + "/messages",
          )
        ).messages,
      );
      // Opening a thread marks it read on the server (and clears its bell alerts).
      setThreads(
        (list) =>
          list?.map((x) => (x.id === current ? { ...x, unreadCount: 0 } : x)) ??
          list,
      );
      dispatchEvent(new Event(NOTICES_REFRESH));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [current]);
  usePoll(loadThreads, 60000, true, ["chat"]);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);
  usePoll(loadMessages, 60000, !!current, ["chat"]);
  const thread = threads?.find((x) => x.id === current);
  const shown = (threads ?? []).filter((x) =>
    filter === "ALL"
      ? true
      : filter === "MINE"
        ? x.assigned_to === user?.id && x.status === "OPEN"
        : x.status === "OPEN",
  );
  async function assign(assigneeId: string) {
    if (!current) return;
    try {
      await api("/chat/threads/" + current + "/assign", {
        assigneeId: assigneeId || null,
      });
      toast(assigneeId ? "มอบหมายแชทแล้ว" : "ยกเลิกการมอบหมายแล้ว");
      await loadThreads();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function reply(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!current || (!body && !attach.has) || busy || attach.preparing) return;
    const payload = body ? withReply(body, replyTo) : "";
    if (payload.length > 1000) {
      setError("ข้อความยาวเกิน 1,000 ตัวอักษร");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const extra = await attach.fields();
      setMessages(
        (
          await api<{ messages: ChatMessage[] }>(
            "/chat/threads/" + current + "/messages",
            {
              body: payload,
              ...extra,
            },
          )
        ).messages,
      );
      setText("");
      setReplyTo(null);
      setMissing([]);
      attach.clear();
      void loadThreads();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!current) return;
    setBusy(true);
    try {
      await api("/chat/threads/" + current + "/close", {});
      toast("ปิดแชทแล้ว");
      await loadThreads();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function togglePin() {
    if (!current || !thread) return;
    setBusy(true);
    try {
      await api("/chat/threads/" + current + "/pin", { pinned: !thread.pinned_at });
      toast(thread.pinned_at ? "เลิกปักหมุดแล้ว" : "ปักหมุดแล้ว");
      await loadThreads();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const unreadTotal = (threads ?? []).reduce((n, x) => n + x.unreadCount, 0);
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>แชท</h1>
          <p>
            ข้อความจากลูกค้าในเว็บ
            {unreadTotal > 0 ? ` · ยังไม่อ่าน ${unreadTotal} ข้อความ` : ""}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            className="button secondary"
            onClick={() => setManaging(true)}
          >
            <MessageSquareText size={15} />
            ข้อความสำเร็จรูป
          </button>
        )}
      </div>
      {managing && (
        <CannedReplyManager
          onClose={() => {
            setManaging(false);
            canned.reload();
          }}
        />
      )}
      <ErrorMessage message={error} />
      <div className={current ? "admin-chat has-thread" : "admin-chat"}>
        <aside className="admin-chat-list" aria-label="รายการแชท">
          <form className="chat-inbox-search" role="search" onSubmit={(e) => e.preventDefault()}>
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="ค้นหาแชท"
              placeholder="ค้นหาชื่อ อีเมล ข้อความ หรือเลขออเดอร์"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
            {query && (
              <button type="button" className="icon-button" aria-label="ล้างการค้นหา" onClick={() => setQuery("")}>
                <X size={16} />
              </button>
            )}
          </form>
          <div className="reference-status-tabs">
            {(
              [
                ["OPEN", "เปิดอยู่"],
                ["MINE", "ของฉัน"],
                ["ALL", "ทั้งหมด"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={filter === key ? "active" : ""}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
          {!threads ? (
            <p className="reference-empty-text">กำลังโหลดแชท…</p>
          ) : !shown.length ? (
            <p className="reference-empty-text">
              {debounced
                ? `ไม่พบแชทที่ตรงกับ “${debounced}”`
                : filter === "OPEN"
                  ? "ไม่มีแชทที่เปิดอยู่"
                  : filter === "MINE"
                    ? "ไม่มีแชทที่มอบหมายให้คุณ"
                    : "ยังไม่มีลูกค้าทักแชท"}
            </p>
          ) : (
            shown.map((x) => (
              <button
                key={x.id}
                className={
                  x.id === current
                    ? "admin-chat-thread active"
                    : "admin-chat-thread"
                }
                onClick={() => {
                  setCurrent(x.id);
                  setMessages([]);
                }}
              >
                {x.customer_avatar ? (
                  <img
                    className="avatar avatar-photo"
                    src={x.customer_avatar}
                    alt=""
                  />
                ) : (
                  <span className="avatar">
                    {(x.customer ?? "?").slice(0, 2)}
                  </span>
                )}
                <span className="admin-chat-thread-text">
                  <strong>
                    {x.pinned_at && <Pin className="chat-pin-mark" size={14} aria-label="ปักหมุด" />}
                    {highlightQuery(x.customer ?? "ลูกค้า", debounced)}
                  </strong>
                  <small>
                    {x.status === "CLOSED" ? "ปิดแล้ว · " : ""}
                    {relativeTime(x.lastMessageAt)}
                    {x.assignee ? " · ดูแลโดย " + x.assignee : ""}
                  </small>
                  {x.matchText && <small className="chat-match-snippet">{highlightQuery(x.matchText, debounced)}</small>}
                  {x.order_id && (
                    <small className="chat-thread-order">
                      ออเดอร์ #{highlightQuery(x.order_id.slice(0, 8).toUpperCase(), debounced.replace(/#/g, ""))}
                    </small>
                  )}
                </span>
                {x.unreadCount > 0 && (
                  <b className="admin-chat-unread">{x.unreadCount}</b>
                )}
              </button>
            ))
          )}
        </aside>
        <section className="admin-chat-room" aria-label="ข้อความ">
          {!thread ? (
            <p className="reference-empty-text admin-chat-placeholder">
              เลือกแชททางซ้ายเพื่ออ่านและตอบ
            </p>
          ) : (
            <>
              <header className="admin-chat-room-head">
                <button
                  className="icon-button admin-chat-back"
                  aria-label="กลับไปรายการแชท"
                  onClick={() => setCurrent(null)}
                >
                  <ArrowLeft size={17} />
                </button>
                <div>
                  <strong>{thread.customer ?? "ลูกค้า"}</strong>
                  <small>
                    {thread.customer_email?.endsWith(".local")
                      ? ""
                      : thread.customer_email}
                    {" · เปิดเมื่อ "}
                    {dateTime(thread.created_at)}
                  </small>
                  {thread.user_id && (
                    <span className="admin-chat-links">
                      <Link to={"/admin/customers/" + thread.user_id}>
                        ข้อมูลลูกค้า
                      </Link>
                      {thread.order_id && (
                        <Link to={"/admin/orders/" + thread.order_id}>
                          ออเดอร์ล่าสุด #
                          {thread.order_id.slice(0, 8).toUpperCase()}
                        </Link>
                      )}
                    </span>
                  )}
                </div>
                {thread.status === "OPEN" && (
                  <label className="admin-chat-assign">
                    <span className="sr-only">ผู้ดูแลแชทนี้</span>
                    <select
                      aria-label="ผู้ดูแลแชทนี้"
                      value={thread.assigned_to ?? ""}
                      onChange={(e) => void assign(e.target.value)}
                    >
                      <option value="">ยังไม่มอบหมาย</option>
                      {team.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.id === user?.id ? m.name + " (ฉัน)" : m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className="button secondary chat-pin-button"
                  disabled={busy}
                  onClick={() => void togglePin()}
                >
                  {thread.pinned_at ? <PinOff size={15} /> : <Pin size={15} />}
                  {thread.pinned_at ? "เลิกปักหมุด" : "ปักหมุด"}
                </button>
                {thread.status === "OPEN" ? (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void close()}
                  >
                    ปิดแชท
                  </button>
                ) : (
                  <span className="status">ปิดแล้ว</span>
                )}
              </header>
              <MessageList
                admin
                messages={messages}
                faceOf={(m) =>
                  m.sender_type === "USER"
                    ? {
                        url: thread.customer_avatar,
                        name: thread.customer ?? "ลูกค้า",
                      }
                    : {
                        url: shopLogo(overview?.shop?.logoUrl),
                        name: overview?.shop?.shopName || "แอดมิน",
                      }
                }
                mine={(m) => m.sender_type !== "USER"}
                customerName={(m) =>
                  m.sender_type === "USER"
                    ? (thread.customer ?? "ลูกค้า")
                    : m.sender_type === "ADMIN"
                      ? "แอดมิน"
                      : "ทีมงาน"
                }
                onReply={
                  thread.status === "OPEN"
                    ? (m) =>
                        setReplyTo(
                          replyTarget(
                            m,
                            m.sender_type === "USER"
                              ? (thread.customer ?? "ลูกค้า")
                              : m.sender_type === "ADMIN"
                                ? "แอดมิน"
                                : "ทีมงาน",
                          ),
                        )
                    : undefined
                }
              />
              {thread.status === "OPEN" ? (
                <>
                  <ErrorMessage message={attach.error} />
                  <AttachmentChips state={attach} admin />
                  <form
                    className="chat-composer canned-host"
                    onSubmit={reply}
                    ref={composerRef}
                    onDragOver={(e) =>
                      e.dataTransfer.types.includes("Files") &&
                      e.preventDefault()
                    }
                    onDrop={attach.onDrop}
                  >
                    {replyTo && (
                      <ReplyBar
                        reply={replyTo}
                        clearLabel="ยกเลิกการตอบกลับ"
                        onClear={() => setReplyTo(null)}
                      />
                    )}
                    {picker && (
                      <CannedReplyPicker
                        mode={picker}
                        query={pickQuery}
                        onQuery={setPickQuery}
                        replies={canned.replies}
                        error={canned.error}
                        active={pickActive}
                        onActive={setPickActive}
                        onPick={insertCanned}
                        onClose={() => {
                          closePicker();
                          textRef.current?.focus();
                        }}
                        onManage={
                          isAdmin
                            ? () => {
                                closePicker();
                                setManaging(true);
                              }
                            : undefined
                        }
                      />
                    )}
                    {missing.some((token) => text.includes(token)) && (
                      <p className="canned-missing" role="status">
                        ยังไม่มีข้อมูล{" "}
                        {missing
                          .filter((token) => text.includes(token))
                          .join(" ")}{" "}
                        กรุณาแก้ข้อความก่อนส่ง
                      </p>
                    )}
                    <button
                      type="button"
                      className={
                        "icon-button canned-trigger" +
                        (picker === "button" ? " is-open" : "")
                      }
                      aria-label="ข้อความสำเร็จรูป"
                      aria-haspopup="dialog"
                      aria-expanded={picker === "button"}
                      title="ข้อความสำเร็จรูป (พิมพ์ / ที่ต้นข้อความ)"
                      onClick={() => {
                        if (picker === "button") closePicker();
                        else {
                          setPickQuery("");
                          setPickActive(0);
                          setPicker("button");
                        }
                      }}
                    >
                      <MessageSquareText size={18} />
                    </button>
                    <AttachMenu
                      state={attach}
                      admin
                      customerId={thread.user_id}
                    />
                    <textarea
                      ref={textRef}
                      onPaste={attach.onPaste}
                      aria-label="ข้อความตอบกลับ"
                      placeholder="พิมพ์ข้อความตอบลูกค้า… (พิมพ์ / เพื่อใช้ข้อความสำเร็จรูป)"
                      value={text}
                      maxLength={1000}
                      rows={2}
                      onChange={(e) => {
                        const value = e.target.value;
                        setText(value);
                        const slash = /^\/[^\n]{0,40}$/.test(value);
                        if (!slash) {
                          setSlashOff(false);
                          if (picker === "slash") setPicker(null);
                        } else if (!slashOff && picker !== "button") {
                          if (
                            picker !== "slash" ||
                            pickQuery !== value.slice(1)
                          )
                            setPickActive(0);
                          setPickQuery(value.slice(1));
                          setPicker("slash");
                        }
                      }}
                      onKeyDown={(e) => {
                        if (
                          picker === "slash" &&
                          pickerKey(
                            e,
                            matchCanned(canned.replies ?? [], pickQuery),
                            pickActive,
                            setPickActive,
                            insertCanned,
                            closePicker,
                          )
                        ) {
                          e.preventDefault();
                          return;
                        }
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          void reply(e);
                        }
                      }}
                    />
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        attach.preparing ||
                        (!text.trim() && !attach.has)
                      }
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Send size={16} />
                      )}
                      ส่ง
                    </button>
                  </form>
                </>
              ) : (
                <p className="chat-closed-note">
                  แชทนี้ปิดแล้ว ลูกค้าส่งข้อความใหม่จะเปิดเป็นแชทใหม่
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}

const PERIODS = [
  ["day", "วันนี้"],
  ["week", "สัปดาห์นี้"],
  ["month", "เดือนนี้"],
  ["all", "ทั้งหมด"],
] as const;
type Period = (typeof PERIODS)[number][0];

function useRanking(period: Period, limit: number) {
  const [buyers, setBuyers] = useState<Buyer[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setBuyers(null);
    api<{ buyers: Buyer[] }>(`/rankings/buyers?period=${period}&limit=${limit}`)
      .then((r) => live && setBuyers(r.buyers))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [period, limit]);
  return { buyers, error };
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="reference-status-tabs" role="tablist" aria-label="ช่วงเวลา">
      {PERIODS.map(([key, label]) => (
        <button
          key={key}
          role="tab"
          aria-selected={value === key}
          className={value === key ? "active" : ""}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** /admin/rankings — buyers ranked by paid spend (Asia/Bangkok periods). */
export function BuyerRanking() {
  const [period, setPeriod] = useState<Period>("month");
  const { buyers, error } = useRanking(period, 50);
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>อันดับผู้ซื้อ</h1>
          <p>
            เรียงตามยอดซื้อที่ชำระแล้ว (รวมพรีออเดอร์ที่จ่ายแล้ว) ตัดรอบตามเวลาไทย
            สัปดาห์เริ่มวันจันทร์
          </p>
        </div>
      </div>
      <PeriodTabs value={period} onChange={setPeriod} />
      <ErrorMessage message={error} />
      <div className="table-scroll reference-table">
        <table>
          <thead>
            <tr>
              <th>อันดับ</th>
              <th>ลูกค้า</th>
              <th>ออเดอร์</th>
              <th>ยอดซื้อ</th>
            </tr>
          </thead>
          <tbody>
            {(buyers ?? []).map((b) => (
              <tr key={b.rank + b.email}>
                <td>
                  <span className={"rank-badge rank-" + Math.min(b.rank, 4)}>
                    {b.rank}
                  </span>
                </td>
                <td>
                  {b.name}
                  <small>{b.email.endsWith(".local") ? "" : b.email}</small>
                </td>
                <td>{b.orders}</td>
                <td>
                  <strong>{money(b.spentSatang)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!buyers && !error && (
          <p className="reference-empty-text">กำลังโหลดอันดับ…</p>
        )}
        {buyers && !buyers.length && (
          <p className="reference-empty-text">ยังไม่มียอดซื้อในช่วงนี้</p>
        )}
      </div>
    </>
  );
}

/** Dashboard card: top five buyers for the chosen period. */
export function BuyerRankingCard() {
  const [period, setPeriod] = useState<Period>("month");
  const { buyers } = useRanking(period, 5);
  return (
    <section className="reference-admin-card ranking-card">
      <div className="reference-card-heading">
        <h2>
          <Trophy size={17} /> อันดับผู้ซื้อ
        </h2>
        <Link to="/admin/rankings">ดูทั้งหมด</Link>
      </div>
      <PeriodTabs value={period} onChange={setPeriod} />
      {!buyers ? (
        <p className="reference-empty-text">กำลังโหลด…</p>
      ) : buyers.length ? (
        <ol className="ranking-list">
          {buyers.map((b) => (
            <li key={b.rank + b.email}>
              <span className={"rank-badge rank-" + Math.min(b.rank, 4)}>
                {b.rank}
              </span>
              <span className="ranking-name">
                {b.name}
                <small>{b.orders} ออเดอร์</small>
              </span>
              <strong>{money(b.spentSatang)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p className="reference-empty-text">ยังไม่มียอดซื้อในช่วงนี้</p>
      )}
    </section>
  );
}

type Channel = {
  provider: string;
  active: boolean;
  note: string;
  sandboxOnly: boolean;
};

/** Settings › รับเงิน — the single payment channel (provider not chosen yet). */
export function PaymentChannelSettings() {
  const { toast } = useStore();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ channel: Channel }>("/payment-channel")
      .then((r) => setChannel(r.channel))
      .catch((e: Error) => setError(e.message));
  }, []);
  // Changing the payment channel is sensitive: the admin re-enters their password inline.
  const [confirming, setConfirming] = useState(false);
  async function toggle(currentPassword: string) {
    if (!channel) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<{ channel: Channel }>("/admin/payment-channel", {
        provider: "sandbox",
        active: !(channel.provider === "sandbox" && channel.active),
        currentPassword,
      });
      setChannel(next.channel);
      setConfirming(false);
      toast("บันทึกช่องทางรับเงินแล้ว");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const name =
    {
      unset: "ยังไม่เลือกผู้ให้บริการ",
      sandbox: "ทดสอบ (ไม่ใช่เงินจริง)",
      slipok: "ตรวจสลิปอัตโนมัติ",
      gateway: "เกตเวย์ชำระเงิน",
    }[channel?.provider ?? "unset"] ?? channel?.provider;
  return (
    <>
      <div className="reference-admin-heading">
        <div>
          <h1>รับเงิน</h1>
          <p>ร้านรับเงินได้หนึ่งช่องทาง ผู้ให้บริการจริงจะเปิดหลังลูกค้าเลือกและยืนยัน</p>
        </div>
      </div>
      <ErrorMessage message={error} />
      <section className="reference-admin-card editor-panel payment-channel-card">
        {!channel ? (
          <p className="reference-empty-text">กำลังโหลด…</p>
        ) : (
          <>
            <div className="settings-row">
              <span>ผู้ให้บริการ</span>
              <strong>{name}</strong>
            </div>
            <div className="settings-row">
              <span>สถานะ</span>
              <span
                className={
                  channel.active ? "status status-delivered" : "status"
                }
              >
                {channel.active ? "เปิดใช้งาน" : "ปิดอยู่"}
              </span>
            </div>
            <p className="muted">{channel.note}</p>
            {channel.sandboxOnly &&
              (confirming ? (
                <form
                  className="admin-inline-confirm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void toggle(
                      String(
                        new FormData(e.currentTarget).get("currentPassword") ??
                          "",
                      ),
                    );
                  }}
                >
                  <input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    aria-label="รหัสผ่านของคุณเพื่อยืนยัน"
                    placeholder="รหัสผ่านของคุณ"
                    required
                    maxLength={128}
                    autoFocus
                  />
                  <button className="button primary" disabled={busy}>
                    {busy && <LoaderCircle className="spin" size={15} />}
                    {channel.provider === "sandbox" && channel.active
                      ? "ยืนยันปิดช่องทาง"
                      : "ยืนยันเปิดช่องทาง"}
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => {
                      setConfirming(false);
                      setError("");
                    }}
                  >
                    ยกเลิก
                  </button>
                </form>
              ) : (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  {channel.provider === "sandbox" && channel.active
                    ? "ปิดช่องทางทดสอบ"
                    : "เปิดช่องทางทดสอบ"}
                </button>
              ))}
          </>
        )}
      </section>
    </>
  );
}
