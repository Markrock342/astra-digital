// Storefront ข่าวสารและกิจกรรม (/news, /news/:id) and เกี่ยวกับเรา (/about).
// UI reference: shadcn/ui Card + Badge (MIT, https://ui.shadcn.com/docs/components/card,
// https://ui.shadcn.com/docs/components/badge) — white cards with a soft shadow, small pill
// badges, styled only with the storefront theme tokens (brand.css) so light / dark and every
// accent work. Admin-entered text is rendered as React text nodes; the only links are the ones
// RichText builds from the safe text format in server/content-rules.mjs ("/" paths, https).
// The presentational pieces take a `lang` so the back-office editors can preview them as well.
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Megaphone,
  MessageCircle,
  Newspaper,
  Pin,
  ShieldCheck,
} from "lucide-react";
import { Empty, Link, useStore, usePageTitle } from "./App";
import { api, shopInstant } from "./api";
import { EN_STRINGS } from "./i18n-en";
import { getLang, t, type Lang } from "./i18n";
import { useLive } from "./live";
import { shopName } from "./Theme";
import { TRUST_ICON_COMPONENTS } from "./Appearance";
import { contactChannels } from "./Contact";
import {
  bangkokDate,
  eventState,
  parseRichText,
  pickText,
  type AboutContent,
  type EventState,
} from "../server/content-rules.mjs";
import "./news.css";

// English strings for this file, added to the shared table on load (existing entries win).
const EN_NEWS: Record<string, string> = {
  "ข่าวสารและกิจกรรม": "News & events",
  "ข่าวสาร": "News",
  "ข่าวสาร โปรโมชัน และกิจกรรมของร้าน": "Shop news, promotions and events",
  "ยังไม่มีข่าว": "No news yet",
  "ข่าวและกิจกรรมของร้านจะแสดงที่นี่": "Shop news and events will show up here",
  "กิจกรรม": "Event",
  "กำลังจะมา": "Upcoming",
  "กำลังจัดอยู่": "Ongoing",
  "จบแล้ว": "Ended",
  "ปักหมุด": "Pinned",
  "อ่านต่อ": "Read more",
  "ดูรายละเอียด": "Learn more",
  "ข่าวทั้งหมด": "All news",
  "ไม่พบข่าวนี้": "News not found",
  "ข่าวนี้อาจถูกลบหรือยังไม่เผยแพร่": "This post may have been removed or is not published yet",
  "เกี่ยวกับเรา": "About us",
  "รู้จักร้านและช่องทางติดต่อ": "Get to know the shop and how to reach us",
  "ช่องทางติดต่อ": "Contact",
  "ดูช่องทางติดต่อทั้งหมด": "All contact options",
  "กำลังโหลด": "Loading",
  "โหลดข้อมูลไม่สำเร็จ": "Could not load",
  "ลองใหม่": "Try again",
};
for (const [th, en] of Object.entries(EN_NEWS)) if (!(th in EN_STRINGS)) EN_STRINGS[th] = en;

/** UI string in an explicit language (the admin preview can show English). */
const tr = (th: string, lang: Lang) => (lang === "en" ? (EN_STRINGS[th] ?? th) : th);

export type NewsPost = {
  id: string;
  title: string;
  titleEn: string | null;
  summary: string | null;
  summaryEn: string | null;
  body?: string | null;
  bodyEn?: string | null;
  coverUrl: string | null;
  eventStarts: string | null;
  eventEnds: string | null;
  eventState: EventState | null;
  pinned: boolean;
  date: string;
  link: string | null;
  linkLabel: string | null;
  linkLabelEn: string | null;
};

// ------------------------------------------------------------------ text

/** In-shop path → SPA link; https → new tab. Both already checked by isSafeHref. */
function SafeLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  if (href.startsWith("/"))
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  return (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/** The safe text format: paragraphs, line breaks, bullet / numbered lists and links. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  const lineOf = (pieces: ReturnType<typeof parseRichText>[number]["lines"][number]) =>
    pieces.map((piece, k) =>
      piece.type === "link" ? (
        <SafeLink key={k} href={piece.href} className="rich-link">
          {piece.text}
        </SafeLink>
      ) : (
        <span key={k}>{piece.text}</span>
      ),
    );
  return (
    <div className={"rich-text " + className}>
      {parseRichText(text).map((block, i) =>
        block.kind === "p" ? (
          <p key={i}>
            {block.lines.map((pieces, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {lineOf(pieces)}
              </span>
            ))}
          </p>
        ) : block.kind === "ul" ? (
          <ul key={i}>
            {block.lines.map((pieces, j) => (
              <li key={j}>{lineOf(pieces)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {block.lines.map((pieces, j) => (
              <li key={j}>{lineOf(pieces)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

// ------------------------------------------------------------------ dates

const localeOf = (lang: Lang) => (lang === "en" ? "en-US" : "th-TH");
/** Posted date (UTC SQL) as a Bangkok calendar date. */
export const postDate = (value: string, lang: Lang) =>
  shopInstant(value).toLocaleDateString(localeOf(lang), {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
/** "YYYY-MM-DD" calendar date. */
const calendarDate = (value: string, lang: Lang) =>
  new Date(value + "T00:00:00Z").toLocaleDateString(localeOf(lang), {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export function eventRange(starts: string | null, ends: string | null, lang: Lang) {
  const from = starts || ends;
  const to = ends || starts;
  if (!from || !to) return "";
  return from === to ? calendarDate(from, lang) : calendarDate(from, lang) + " – " + calendarDate(to, lang);
}
const STATE_LABEL: Record<EventState, string> = { upcoming: "กำลังจะมา", ongoing: "กำลังจัดอยู่", ended: "จบแล้ว" };
/** Event state from the dates (for drafts in the editor, which have no server state yet). */
export const eventStateNow = (starts: string | null, ends: string | null) =>
  eventState(starts, ends, bangkokDate(Date.now()));

function EventBadges({ post, lang }: { post: NewsPost; lang: Lang }) {
  const state = post.eventState;
  if (!state && !post.pinned) return null;
  return (
    <span className="news-badges">
      {post.pinned && (
        <span className="news-badge is-pinned">
          <Pin size={12} aria-hidden="true" />
          {tr("ปักหมุด", lang)}
        </span>
      )}
      {state && (
        <>
          <span className="news-badge is-event">
            <CalendarDays size={12} aria-hidden="true" />
            {tr("กิจกรรม", lang)}
          </span>
          <span className={"news-badge is-" + state} data-event-state={state}>
            {tr(STATE_LABEL[state], lang)}
          </span>
        </>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ news

/** One card in the /news list (also the admin's live preview). */
export function NewsCard({ post, lang, preview = false }: { post: NewsPost; lang: Lang; preview?: boolean }) {
  const title = pickText(post.title, post.titleEn, lang);
  const summary = pickText(post.summary, post.summaryEn, lang);
  const body = (
    <>
      <span className="news-card-cover">
        {post.coverUrl ? (
          <img src={post.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="news-card-placeholder" aria-hidden="true">
            <Newspaper size={30} />
          </span>
        )}
      </span>
      <span className="news-card-body">
        <EventBadges post={post} lang={lang} />
        <strong className="news-card-title">{title}</strong>
        <span className="news-card-meta">
          {post.eventState ? (
            <>
              <CalendarDays size={14} aria-hidden="true" />
              {eventRange(post.eventStarts, post.eventEnds, lang)}
            </>
          ) : (
            <time dateTime={post.date}>{postDate(post.date, lang)}</time>
          )}
        </span>
        {summary && <span className="news-card-summary">{summary}</span>}
        <span className="news-card-more">
          {tr("อ่านต่อ", lang)}
          <ArrowRight size={15} aria-hidden="true" />
        </span>
      </span>
    </>
  );
  if (preview)
    return (
      <div className={"news-card" + (post.pinned ? " is-pinned" : "")} data-news-card={post.id}>
        {body}
      </div>
    );
  return (
    <Link to={"/news/" + post.id} className={"news-card" + (post.pinned ? " is-pinned" : "")} data-news-card={post.id}>
      {body}
    </Link>
  );
}

/** Article body of /news/:id (also previewed in the editor). */
export function NewsArticle({ post, lang }: { post: NewsPost; lang: Lang }) {
  const title = pickText(post.title, post.titleEn, lang);
  const body = pickText(post.body, post.bodyEn, lang);
  const summary = pickText(post.summary, post.summaryEn, lang);
  const label = pickText(post.linkLabel, post.linkLabelEn, lang) || tr("ดูรายละเอียด", lang);
  return (
    <article className="news-article">
      {post.coverUrl && (
        <div className="news-article-cover">
          <img src={post.coverUrl} alt="" />
        </div>
      )}
      <div className="news-article-content">
        <EventBadges post={post} lang={lang} />
        <h1>{title}</h1>
        <p className="news-article-meta">
          <time dateTime={post.date}>{postDate(post.date, lang)}</time>
          {post.eventState && (
            <span className="news-article-event">
              <CalendarDays size={15} aria-hidden="true" />
              {eventRange(post.eventStarts, post.eventEnds, lang)}
            </span>
          )}
        </p>
        {summary && <p className="news-article-lead">{summary}</p>}
        {body && <RichText text={body} />}
        {post.link && (
          <SafeLink href={post.link} className="button primary news-article-link">
            {label}
            {post.link.startsWith("/") ? <ArrowRight size={16} /> : <ArrowUpRight size={16} />}
          </SafeLink>
        )}
      </div>
    </article>
  );
}

function Loading() {
  return (
    <div className="news-loading" role="status">
      <span className="news-skeleton" />
      <span className="news-skeleton" />
      <span className="sr-only">{t("กำลังโหลด")}</span>
    </div>
  );
}

function LoadError({ retry }: { retry: () => void }) {
  return (
    <div className="news-error" role="alert">
      <p>{t("โหลดข้อมูลไม่สำเร็จ")}</p>
      <button type="button" className="button secondary" onClick={retry}>
        {t("ลองใหม่")}
      </button>
    </div>
  );
}

export function NewsListPage() {
  const lang = getLang();
  const [posts, setPosts] = useState<NewsPost[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () =>
    api<{ posts: NewsPost[] }>("/news").then(
      (r) => {
        setPosts(r.posts);
        setFailed(false);
      },
      () => setFailed(true),
    );
  useEffect(() => void load(), []);
  // Admin publishes / edits / deletes → open lists refresh.
  useLive(["content"], () => void load());
  return (
    <main className="container page-main reference-info-page news-page">
      <div className="page-heading">
        <span className="eyebrow">
          <Megaphone size={14} aria-hidden="true" />
          {t("ข่าวสาร")}
        </span>
        <h1>{t("ข่าวสาร")}</h1>
        <p>{t("ข่าวสาร โปรโมชัน และกิจกรรมของร้าน")}</p>
      </div>
      {failed && !posts ? (
        <LoadError retry={() => void load()} />
      ) : !posts ? (
        <Loading />
      ) : posts.length === 0 ? (
        <Empty icon={<Newspaper />} heading={t("ยังไม่มีข่าว")} description={t("ข่าวและกิจกรรมของร้านจะแสดงที่นี่")} />
      ) : (
        <div className="news-grid">
          {posts.map((post) => (
            <NewsCard key={post.id} post={post} lang={lang} />
          ))}
        </div>
      )}
    </main>
  );
}

export function NewsDetailPage({ id }: { id: string }) {
  const lang = getLang();
  const [post, setPost] = useState<NewsPost | null | "missing">(null);
  const [failed, setFailed] = useState(false);
  const load = () =>
    api<{ post: NewsPost }>("/news/" + encodeURIComponent(id)).then(
      (r) => {
        setPost(r.post);
        setFailed(false);
      },
      (e: Error) => (/ไม่พบ/.test(e.message) ? setPost("missing") : setFailed(true)),
    );
  useEffect(() => void load(), [id]);
  useLive(["content"], () => void load());
  const ready = post && post !== "missing" ? post : null;
  usePageTitle(
    ready ? pickText(ready.title, ready.titleEn, lang) : post === "missing" ? t("ไม่พบข่าวนี้") : t("ข่าวสาร"),
    ready ? pickText(ready.summary, ready.summaryEn, lang) : "",
  );
  // Share preview: the cover, when the post has one (usePageTitle wrote the site image first).
  useEffect(() => {
    if (!ready?.coverUrl) return;
    document.head.querySelector('meta[property="og:image"]')?.setAttribute("content", location.origin + ready.coverUrl);
  }, [ready?.coverUrl, lang]);
  return (
    <main className="container page-main narrow-main reference-info-page news-detail-page">
      <Link to="/news" className="news-back">
        <ArrowLeft size={16} aria-hidden="true" />
        {t("ข่าวทั้งหมด")}
      </Link>
      {failed && !post ? (
        <LoadError retry={() => void load()} />
      ) : post === "missing" ? (
        <Empty
          icon={<Newspaper />}
          heading={t("ไม่พบข่าวนี้")}
          description={t("ข่าวนี้อาจถูกลบหรือยังไม่เผยแพร่")}
          action={
            <Link className="button primary" to="/news">
              {t("ข่าวทั้งหมด")}
              <ArrowRight size={16} />
            </Link>
          }
        />
      ) : !post ? (
        <Loading />
      ) : (
        <NewsArticle post={post} lang={lang} />
      )}
    </main>
  );
}

// ------------------------------------------------------------------ about

type Shop = Parameters<typeof contactChannels>[0];

/** The /about page body (also the admin's live preview). */
export function AboutView({ about, lang, shop, name }: { about: AboutContent; lang: Lang; shop: Shop; name: string }) {
  const heading = pickText(about.heading.th, about.heading.en, lang);
  const body = pickText(about.body.th, about.body.en, lang);
  const channels = about.showContact ? contactChannels(shop) : [];
  return (
    <div className="about-view">
      <div className="page-heading">
        <span className="eyebrow">{name}</span>
        <h1>{heading}</h1>
      </div>
      {about.coverUrl && (
        <div className="about-cover">
          <img src={about.coverUrl} alt="" />
        </div>
      )}
      {body && (
        <section className="about-card about-body">
          <RichText text={body} />
        </section>
      )}
      {about.highlights.length > 0 && (
        <div className="about-highlights">
          {about.highlights.map((item, i) => {
            const Icon = TRUST_ICON_COMPONENTS[item.icon] ?? ShieldCheck;
            const detail = pickText(item.text.th, item.text.en, lang);
            return (
              <article className="about-card about-highlight" key={i}>
                <span className="about-highlight-icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <h2>{pickText(item.title.th, item.title.en, lang)}</h2>
                {detail && <p>{detail}</p>}
              </article>
            );
          })}
        </div>
      )}
      {about.showContact && (
        <section className="about-card about-contact" aria-labelledby="about-contact-title">
          <h2 id="about-contact-title">
            <MessageCircle size={18} aria-hidden="true" />
            {tr("ช่องทางติดต่อ", lang)}
          </h2>
          {channels.length > 0 && (
            <ul className="about-contact-list">
              {channels.map((c) => (
                <li key={c.key}>
                  <span className="about-contact-icon" aria-hidden="true">
                    {c.icon}
                  </span>
                  <span className="about-contact-text">
                    <small>{c.label}</small>
                    {c.href ? (
                      <a href={c.href} {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                        {c.value}
                      </a>
                    ) : (
                      <span>{c.value}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/support" className="button secondary about-contact-more">
            {tr("ดูช่องทางติดต่อทั้งหมด", lang)}
            <ArrowRight size={16} />
          </Link>
        </section>
      )}
    </div>
  );
}

export function AboutPage() {
  const { overview } = useStore();
  const lang = getLang();
  const [about, setAbout] = useState<AboutContent | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () =>
    api<{ about: AboutContent }>("/about").then(
      (r) => {
        setAbout(r.about);
        setFailed(false);
      },
      () => setFailed(true),
    );
  useEffect(() => void load(), []);
  // Title + description come from the Router's titles map ("/about").
  useLive(["content"], () => void load());
  return (
    <main className="container page-main narrow-main reference-info-page about-page">
      {failed && !about ? (
        <LoadError retry={() => void load()} />
      ) : !about ? (
        <Loading />
      ) : (
        <AboutView about={about} lang={lang} shop={overview?.shop} name={shopName(overview?.shop?.shopName)} />
      )}
    </main>
  );
}
