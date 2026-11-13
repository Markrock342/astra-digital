// /admin/settings/appearance — ตั้งค่า › หน้าตาร้าน (ADMIN only).
// Edit the storefront's texts, links, home section order, brand colours, trust block, footer
// and link-preview (SEO) settings without a page builder: the layout stays the same.
// UI reference: shadcn/ui (MIT, https://ui.shadcn.com) — Card for each group, Input / Textarea,
// Switch (role="switch"), Tabs (role="tablist" / "tab" / "tabpanel") and AlertDialog for resets.
// Back-office look: white cards on the cool-grey admin background, the one admin brand colour,
// soft elevation. Live preview = the real storefront in a frame (same as ตั้งค่า › ร้าน), fed
// with the unsaved draft over postMessage; nothing reaches customers before "บันทึก".
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  ImageUp,
  LoaderCircle,
  Lock,
  Monitor,
  Plus,
  RotateCcw,
  Smartphone,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { ErrorMessage, useStore } from "./App";
import { api } from "./api";
import { useDialog } from "./dialog";
import { useUnsavedChangesGuard } from "./navigation";
import { checkSource, toImage, uploadImage } from "./image-upload";
import { TRUST_ICON_COMPONENTS } from "./Appearance";
import {
  ACCENTS,
  ALWAYS_VISIBLE_SECTIONS,
  LIMITS,
  SECTION_LABELS,
  TRUST_ICONS,
  checkColor,
  colorTokens,
  normalizeAppearanceParts,
  type Accent,
  type Appearance,
  type AppearancePart,
  type TextPair,
} from "../server/appearance-rules.mjs";
import "./admin-appearance.css";

type Data = {
  appearance: Appearance;
  defaults: Appearance;
  customized: AppearancePart[];
  updatedAt: string | null;
};

const TABS: [AppearancePart, string][] = [
  ["hero", "ส่วนหัว"],
  ["marquee", "แถบข้อความเลื่อน"],
  ["sections", "ส่วนต่างๆ หน้าแรก"],
  ["colors", "สีร้าน"],
  ["trust", "หน้าเครดิตร้าน"],
  ["footer", "ส่วนท้าย"],
  ["seo", "SEO และการแชร์"],
];
const LINK_HINTS = ["/products", "/reviews", "/faq", "/support", "/orders", "/credits"];
const DEFAULT_TAGLINE = "ร้านสินค้าดิจิทัล ส่งไว ปลอดภัย ใช้งานได้ทันที";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
/** The editable part of seo (images are uploaded on their own, not saved with the draft). */
const seoText = (a: Appearance) => ({ title: a.seo.title, description: a.seo.description });
const partValue = (a: Appearance, part: AppearancePart) => (part === "seo" ? seoText(a) : a[part]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Server rules, run in the browser: "" = OK. */
function problemOf(part: AppearancePart, value: unknown) {
  try {
    normalizeAppearanceParts({ [part]: value }, (_status, message) => {
      throw new Error(message);
    });
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}
const move = <T,>(items: T[], index: number, by: number) => {
  const next = [...items];
  const target = index + by;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export function AdminAppearance() {
  const { toast, refresh, overview } = useStore();
  const [data, setData] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Appearance | null>(null);
  const [tab, setTab] = useState<AppearancePart>("hero");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState<AppearancePart | "all" | null>(null);
  async function load() {
    try {
      const next = await api<Data>("/admin/appearance");
      setData(next);
      setDraft(clone(next.appearance));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const dirty = data && draft ? TABS.map(([part]) => part).filter((p) => !same(partValue(draft, p), partValue(data.appearance, p))) : [];
  const markSaved = useUnsavedChangesGuard(dirty.length > 0);
  const update = <K extends AppearancePart>(part: K, value: Appearance[K]) =>
    setDraft((d) => (d ? { ...d, [part]: value } : d));

  async function save() {
    if (!data || !draft || !dirty.length) return;
    for (const part of dirty) {
      const problem = problemOf(part, partValue(draft, part));
      if (problem) {
        setTab(part);
        setError(problem);
        return;
      }
    }
    setBusy("save");
    setError("");
    try {
      const body = Object.fromEntries(dirty.map((p) => [p, partValue(draft, p)]));
      const next = await api<Data>("/admin/appearance", body);
      setData(next);
      setDraft(clone(next.appearance));
      markSaved();
      toast("บันทึกหน้าตาร้านแล้ว ลูกค้าเห็นทันที");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function reset(part: AppearancePart | "all") {
    setBusy("reset");
    setError("");
    try {
      const next = await api<Data>("/admin/appearance/reset", { part });
      setData(next);
      setDraft((d) => {
        const merged = clone(next.appearance);
        // Other parts' unsaved edits stay in the form.
        if (d && part !== "all")
          for (const p of dirty) if (p !== part) Object.assign(merged, { [p]: d[p] });
        return merged;
      });
      setResetting(null);
      toast(part === "all" ? "คืนค่าเดิมทั้งหมดแล้ว" : "คืนค่าเดิมแล้ว");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!data || !draft)
    return (
      <section className="appearance-admin">
        <Heading />
        <ErrorMessage message={error} />
        {!error && (
          <div className="loading-row">
            <LoaderCircle className="spin" size={18} />
            กำลังโหลด
          </div>
        )}
      </section>
    );
  const label = TABS.find(([p]) => p === tab)?.[1] ?? "";
  const currentProblem = dirty.includes(tab) ? problemOf(tab, partValue(draft, tab)) : "";
  const shopDescription = overview?.shop?.description ?? "";
  return (
    <section className="appearance-admin" aria-labelledby="appearance-title">
      <Heading>
        <button
          type="button"
          className="button ghost"
          disabled={!!busy || (!data.customized.length && !dirty.length)}
          onClick={() => setResetting("all")}
        >
          <RotateCcw size={15} />
          คืนค่าเดิมทั้งหมด
        </button>
      </Heading>
      <ErrorMessage message={error} />
      <div className="appearance-grid">
        <div className="appearance-editor">
          <div className="appearance-tabs" role="tablist" aria-label="ส่วนที่แก้ได้">
            {TABS.map(([part, name]) => (
              <button
                key={part}
                type="button"
                role="tab"
                id={"appearance-tab-" + part}
                aria-selected={tab === part}
                aria-controls="appearance-panel"
                className={tab === part ? "active" : ""}
                onClick={() => setTab(part)}
              >
                {name}
                {dirty.includes(part) ? (
                  <i className="appearance-dot unsaved" aria-label="ยังไม่ได้บันทึก" />
                ) : data.customized.includes(part) ? (
                  <i className="appearance-dot custom" aria-label="แก้จากค่าเดิมแล้ว" />
                ) : null}
              </button>
            ))}
          </div>
          <div
            className="reference-admin-card appearance-panel"
            role="tabpanel"
            id="appearance-panel"
            aria-labelledby={"appearance-tab-" + tab}
          >
            <div className="appearance-panel-head">
              <div>
                <h2>{label}</h2>
                <p>{PANEL_HELP[tab]}</p>
              </div>
              <button
                type="button"
                className="button secondary appearance-reset"
                disabled={!!busy || (!data.customized.includes(tab) && !dirty.includes(tab))}
                onClick={() => setResetting(tab)}
              >
                <RotateCcw size={15} />
                คืนค่าเดิม
              </button>
            </div>
            {tab === "hero" && (
              <HeroForm
                value={draft.hero}
                onChange={(v) => update("hero", v)}
                automatic={shopDescription || DEFAULT_TAGLINE}
              />
            )}
            {tab === "marquee" && <MarqueeForm value={draft.marquee} onChange={(v) => update("marquee", v)} />}
            {tab === "sections" && <SectionsForm value={draft.sections} onChange={(v) => update("sections", v)} />}
            {tab === "colors" && <ColorsForm value={draft.colors} onChange={(v) => update("colors", v)} />}
            {tab === "trust" && <TrustForm value={draft.trust} onChange={(v) => update("trust", v)} />}
            {tab === "footer" && (
              <FooterForm
                value={draft.footer}
                onChange={(v) => update("footer", v)}
                automatic={shopDescription || "ร้านสินค้าดิจิทัล"}
              />
            )}
            {tab === "seo" && (
              <SeoForm
                value={draft.seo}
                saved={data.appearance.seo}
                onChange={(v) => update("seo", { ...draft.seo, ...v })}
                onUploaded={(next) => {
                  setData(next);
                  setDraft((d) => (d ? { ...d, seo: { ...d.seo, ogImageUrl: next.appearance.seo.ogImageUrl, faviconUrl: next.appearance.seo.faviconUrl } } : d));
                  void refresh();
                }}
                shopName={overview?.shop?.shopName}
              />
            )}
            {currentProblem && (
              <p className="appearance-problem" role="alert">
                <TriangleAlert size={15} aria-hidden="true" />
                {currentProblem}
              </p>
            )}
          </div>
        </div>
        <AppearancePreview draft={draft} tab={tab} />
      </div>
      <div className="editor-save-bar appearance-save-bar">
        <span className={dirty.length ? "unsaved-dot" : ""}>
          {dirty.length
            ? "ยังไม่ได้บันทึก: " + dirty.map((p) => TABS.find(([x]) => x === p)?.[1]).join(", ")
            : "ตรงกับหน้าร้าน"}
        </span>
        <button
          type="button"
          className="button secondary"
          disabled={!dirty.length || !!busy}
          onClick={() => setDraft(clone({ ...data.appearance }))}
        >
          ยกเลิกการแก้ไข
        </button>
        <button type="button" className="button primary" disabled={!dirty.length || !!busy} onClick={() => void save()}>
          {busy === "save" ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}
          บันทึก
        </button>
      </div>
      {resetting && (
        <ResetDialog
          part={resetting}
          busy={busy === "reset"}
          onClose={() => setResetting(null)}
          onConfirm={() => void reset(resetting)}
        />
      )}
    </section>
  );
}

const PANEL_HELP: Record<AppearancePart, string> = {
  hero: "ข้อความใต้โลโก้และปุ่มบนหน้าแรก",
  marquee: "ข้อความที่เลื่อนผ่านใต้ส่วนหัว ได้สูงสุด " + LIMITS.marqueeMax + " ข้อความ",
  sections: "เลือกว่าจะแสดงส่วนไหนบนหน้าแรก และเรียงลำดับ",
  colors: "สีหลักและสีรองของร้าน และสีธีมที่ลูกค้าเห็นครั้งแรก ใช้ได้ทั้งโหมดสว่างและโหมดมืด",
  trust: "กล่อง “ซื้อสินค้าอย่างมั่นใจ” บนหน้าเครดิตร้าน (/credits)",
  footer: "คำอธิบายร้านและเมนูท้ายเว็บ",
  seo: "ชื่อเว็บ คำอธิบาย รูปตอนแชร์ลิงก์ และไอคอนเว็บ",
};

function Heading({ children }: { children?: ReactNode }) {
  return (
    <div className="reference-admin-heading">
      <div>
        <h1 id="appearance-title">หน้าตาร้าน</h1>
        <p>
          แก้ข้อความ ลิงก์ สี และลำดับส่วนต่างๆ ของหน้าร้าน ดูผลในกรอบตัวอย่างก่อนบันทึก
          ส่วนไหนยังไม่แก้ หน้าร้านจะเหมือนเดิม · ข้อความเกี่ยวกับเงินและสถานะคำสั่งซื้อแก้ที่นี่ไม่ได้
        </p>
      </div>
      {children}
    </div>
  );
}

/* ---------- Small form pieces (shadcn/ui Input + Label pattern) ---------- */
function PairField({
  label,
  value,
  onChange,
  max,
  multiline = false,
  required = false,
  placeholder = "",
  help,
}: {
  label: string;
  value: TextPair;
  onChange: (value: TextPair) => void;
  max: number;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
}) {
  const input = (lang: "th" | "en") => {
    const props = {
      value: value[lang],
      maxLength: max,
      "aria-label": label + (lang === "th" ? " (ไทย)" : " (อังกฤษ)"),
      placeholder: lang === "th" ? placeholder : "ว่างไว้ = ใช้ภาษาไทย",
      onChange: (e: { target: { value: string } }) => onChange({ ...value, [lang]: e.target.value }),
    };
    return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
  };
  return (
    <div className="pair-field">
      <span className="pair-label">
        {label}
        {required && <b aria-hidden="true"> *</b>}
      </span>
      <div className="pair-inputs">
        <label>
          <span className="lang-tag">ไทย</span>
          {input("th")}
        </label>
        <label>
          <span className="lang-tag">EN</span>
          {input("en")}
        </label>
      </div>
      {help && <small className="field-help">{help}</small>}
    </div>
  );
}

function LinkField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field appearance-link-field">
      {label}
      <input
        value={value}
        inputMode="url"
        maxLength={LIMITS.link}
        list="appearance-link-hints"
        placeholder="/products หรือ https://…"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="appearance-link-hints">
        {LINK_HINTS.map((h) => (
          <option value={h} key={h} />
        ))}
      </datalist>
      <small className="field-help">หน้าในร้าน (ขึ้นต้นด้วย /) หรือเว็บที่ขึ้นต้นด้วย https://</small>
    </label>
  );
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="appearance-switch"
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function RowTools({
  index,
  total,
  name,
  onMove,
  onRemove,
  min = 0,
}: {
  index: number;
  total: number;
  name: string;
  onMove: (by: number) => void;
  onRemove?: () => void;
  min?: number;
}) {
  return (
    <span className="row-tools">
      <button type="button" className="icon-button" aria-label={"เลื่อน" + name + "ขึ้น"} disabled={index === 0} onClick={() => onMove(-1)}>
        <ArrowUp size={16} />
      </button>
      <button type="button" className="icon-button" aria-label={"เลื่อน" + name + "ลง"} disabled={index === total - 1} onClick={() => onMove(1)}>
        <ArrowDown size={16} />
      </button>
      {onRemove && (
        <button type="button" className="icon-button danger-icon" aria-label={"ลบ" + name} disabled={total <= min} onClick={onRemove}>
          <Trash2 size={16} />
        </button>
      )}
    </span>
  );
}

/* ---------- Panels ---------- */
function HeroForm({ value, onChange, automatic }: { value: Appearance["hero"]; onChange: (v: Appearance["hero"]) => void; automatic: string }) {
  return (
    <div className="appearance-fields">
      <PairField
        label="ข้อความหลัก"
        value={value.headline}
        max={LIMITS.heroHeadline}
        placeholder={automatic}
        help="เว้นว่าง = ใช้คำโปรยร้านจาก ตั้งค่า › ร้าน (ถ้าไม่มี ใช้ข้อความมาตรฐาน)"
        onChange={(headline) => onChange({ ...value, headline })}
      />
      <PairField
        label="ข้อความรอง"
        value={value.subtext}
        max={LIMITS.heroSubtext}
        multiline
        help="บรรทัดเล็กใต้ข้อความหลัก เว้นว่าง = ไม่แสดง"
        onChange={(subtext) => onChange({ ...value, subtext })}
      />
      <fieldset className="appearance-group">
        <legend>ปุ่มหลัก</legend>
        <PairField
          label="ข้อความบนปุ่ม"
          required
          value={value.primary.label}
          max={LIMITS.buttonLabel}
          onChange={(label) => onChange({ ...value, primary: { ...value.primary, label } })}
        />
        <LinkField label="ลิงก์" value={value.primary.link} onChange={(link) => onChange({ ...value, primary: { ...value.primary, link } })} />
      </fieldset>
      <fieldset className="appearance-group">
        <legend>ปุ่มรอง</legend>
        <PairField
          label="ข้อความบนปุ่ม"
          value={value.secondary.label}
          max={LIMITS.buttonLabel}
          help="ลบข้อความภาษาไทยออกเพื่อซ่อนปุ่มนี้"
          onChange={(label) => onChange({ ...value, secondary: { ...value.secondary, label } })}
        />
        <LinkField label="ลิงก์" value={value.secondary.link} onChange={(link) => onChange({ ...value, secondary: { ...value.secondary, link } })} />
      </fieldset>
    </div>
  );
}

function MarqueeForm({ value, onChange }: { value: TextPair[]; onChange: (v: TextPair[]) => void }) {
  const full = value.length >= LIMITS.marqueeMax;
  return (
    <div className="appearance-fields">
      <ol className="appearance-list">
        {value.map((item, i) => (
          <li key={i} className="appearance-row">
            <span className="row-index" aria-hidden="true">{i + 1}</span>
            <PairField
              label={"ข้อความที่ " + (i + 1)}
              required
              value={item}
              max={LIMITS.marqueeItem}
              onChange={(next) => onChange(value.map((x, j) => (j === i ? next : x)))}
            />
            <RowTools
              index={i}
              total={value.length}
              name={"ข้อความที่ " + (i + 1)}
              min={1}
              onMove={(by) => onChange(move(value, i, by))}
              onRemove={() => onChange(value.filter((_, j) => j !== i))}
            />
          </li>
        ))}
      </ol>
      <div className="appearance-add">
        <button type="button" className="button secondary" disabled={full} onClick={() => onChange([...value, { th: "", en: "" }])}>
          <Plus size={15} />
          เพิ่มข้อความ
        </button>
        <span>
          {value.length}/{LIMITS.marqueeMax}
        </span>
      </div>
    </div>
  );
}

function SectionsForm({ value, onChange }: { value: Appearance["sections"]; onChange: (v: Appearance["sections"]) => void }) {
  return (
    <ol className="appearance-list sections-list">
      {value.map((section, i) => {
        const locked = ALWAYS_VISIBLE_SECTIONS.includes(section.id);
        const name = SECTION_LABELS[section.id];
        return (
          <li key={section.id} className={"appearance-row section-row" + (section.visible ? "" : " is-hidden")} data-section={section.id}>
            <span className="row-index" aria-hidden="true">{i + 1}</span>
            <span className="section-name">
              <strong>{name}</strong>
              <small>{locked ? "แสดงเสมอ (ซ่อนไม่ได้)" : section.visible ? "แสดง" : "ซ่อนอยู่"}</small>
            </span>
            <Switch
              checked={section.visible}
              disabled={locked}
              label={"แสดง" + name}
              onChange={(visible) => onChange(value.map((x, j) => (j === i ? { ...x, visible } : x)))}
            />
            <RowTools index={i} total={value.length} name={name} onMove={(by) => onChange(move(value, i, by))} />
          </li>
        );
      })}
    </ol>
  );
}

const ACCENT_NAMES: Record<Accent, string> = {
  blue: "สีหลัก",
  yellow: "สีรอง",
  duo: "สีหลัก + สีรอง",
  mono: "ขาวดำ",
};
const BUILT_IN = { primary: "#1534ff", secondary: "#ffcc00" };

function ColorField({
  label,
  builtIn,
  value,
  onChange,
}: {
  label: string;
  builtIn: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => setText(value ?? ""), [value]);
  const shown = value ?? builtIn;
  const { problem, warnings } = value ? checkColor(value, label) : { problem: "", warnings: [] as string[] };
  const textValid = /^#[0-9a-f]{6}$/i.test(text);
  const tokens = !problem && /^#[0-9a-f]{6}$/i.test(shown) ? colorTokens(shown) : null;
  return (
    <fieldset className="appearance-group color-field">
      <legend>{label}</legend>
      <div className="color-choice" role="radiogroup" aria-label={label}>
        <label>
          <input type="radio" checked={value === null} onChange={() => onChange(null)} />
          ใช้สีเดิมของร้าน
          <i className="color-chip" style={{ background: builtIn }} aria-hidden="true" />
        </label>
        <label>
          <input type="radio" checked={value !== null} onChange={() => onChange(value ?? builtIn)} />
          เลือกสีเอง
        </label>
      </div>
      {value !== null && (
        <div className="color-inputs">
          <input
            type="color"
            aria-label={label + " (จานสี)"}
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : builtIn}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
          />
          <input
            className="color-hex"
            aria-label={label + " (รหัสสี)"}
            value={text}
            maxLength={7}
            placeholder="#RRGGBB"
            onChange={(e) => {
              const next = e.target.value.trim();
              setText(next);
              if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase());
            }}
          />
          {!textValid && text && <small className="color-bad">ใช้รูปแบบ #RRGGBB</small>}
        </div>
      )}
      {problem ? (
        <p className="appearance-problem" role="alert">
          <TriangleAlert size={15} aria-hidden="true" />
          {problem}
        </p>
      ) : (
        warnings.map((w) => (
          <p className="appearance-warning" key={w}>
            <TriangleAlert size={15} aria-hidden="true" />
            {w}
          </p>
        ))
      )}
      {tokens && (
        <div className="color-samples" aria-label="ตัวอย่างสีบนหน้าร้าน">
          <div className="color-sample light">
            <span className="sample-button" style={{ background: tokens.light.fill, color: tokens.light.ink }}>
              ปุ่ม
            </span>
            <span style={{ color: tokens.light.text }}>ลิงก์ / ราคา</span>
            <small>โหมดสว่าง</small>
          </div>
          <div className="color-sample dark">
            <span className="sample-button" style={{ background: tokens.dark.fill, color: tokens.dark.ink }}>
              ปุ่ม
            </span>
            <span style={{ color: tokens.dark.text }}>ลิงก์ / ราคา</span>
            <small>โหมดมืด</small>
          </div>
        </div>
      )}
    </fieldset>
  );
}

function ColorsForm({ value, onChange }: { value: Appearance["colors"]; onChange: (v: Appearance["colors"]) => void }) {
  const primary = value.primary ?? BUILT_IN.primary;
  const secondary = value.secondary ?? BUILT_IN.secondary;
  const swatch: Record<Accent, string> = {
    blue: primary,
    yellow: secondary,
    duo: `linear-gradient(135deg, ${primary} 50%, ${secondary} 50%)`,
    mono: "linear-gradient(135deg, #0b0b0c 50%, #ffffff 50%)",
  };
  return (
    <div className="appearance-fields">
      <ColorField label="สีหลัก" builtIn={BUILT_IN.primary} value={value.primary} onChange={(primary) => onChange({ ...value, primary })} />
      <ColorField label="สีรอง" builtIn={BUILT_IN.secondary} value={value.secondary} onChange={(secondary) => onChange({ ...value, secondary })} />
      <fieldset className="appearance-group">
        <legend>สีธีมที่ลูกค้าเห็นครั้งแรก</legend>
        <p className="field-help">ลูกค้าเปลี่ยนเองได้ที่ปุ่มจานสีบนหน้าร้าน ถ้าเคยเลือกไว้แล้ว ระบบจะใช้สีที่ลูกค้าเลือก</p>
        <div className="accent-options" role="radiogroup" aria-label="สีธีมเริ่มต้น">
          {ACCENTS.map((accent) => (
            <label key={accent} className={value.defaultAccent === accent ? "selected" : ""}>
              <input
                type="radio"
                name="default-accent"
                checked={value.defaultAccent === accent}
                onChange={() => onChange({ ...value, defaultAccent: accent })}
              />
              <i className="color-chip" style={{ background: swatch[accent] }} aria-hidden="true" />
              {ACCENT_NAMES[accent]}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="field-help">
        โลโก้ ASIA X และรูปภาพเป็นรูป จึงคงสีเดิม · สีตัวหนังสือ พื้นหลัง และเส้นขอบของหน้าร้านไม่เปลี่ยนตามสีนี้
      </p>
    </div>
  );
}

function TrustForm({ value, onChange }: { value: Appearance["trust"]; onChange: (v: Appearance["trust"]) => void }) {
  const full = value.cards.length >= LIMITS.cardsMax;
  return (
    <div className="appearance-fields">
      <div className="switch-row">
        <span>
          <strong>แสดงบนหน้าเครดิตร้าน</strong>
          <small>ตอนนี้{value.show ? "แสดงอยู่" : "ปิดอยู่"} · กล่องนี้อยู่ใต้คะแนนรีวิวของร้าน</small>
        </span>
        <Switch checked={value.show} label="แสดงบนหน้าเครดิตร้าน" onChange={(show) => onChange({ ...value, show })} />
      </div>
      <PairField label="หัวข้อ" required value={value.heading} max={LIMITS.trustHeading} onChange={(heading) => onChange({ ...value, heading })} />
      <PairField label="ข้อความ" multiline value={value.text} max={LIMITS.trustText} onChange={(text) => onChange({ ...value, text })} />
      <ol className="appearance-list">
        {value.cards.map((card, i) => (
          <li key={i} className="appearance-row card-row">
            <span className="row-index" aria-hidden="true">{i + 1}</span>
            <div className="card-fields">
              <div className="icon-picker" role="radiogroup" aria-label={"ไอคอนการ์ดที่ " + (i + 1)}>
                {TRUST_ICONS.map((name) => {
                  const Icon = TRUST_ICON_COMPONENTS[name];
                  return (
                    <button
                      key={name}
                      type="button"
                      role="radio"
                      aria-checked={card.icon === name}
                      aria-label={name}
                      title={name}
                      onClick={() => onChange({ ...value, cards: value.cards.map((c, j) => (j === i ? { ...c, icon: name } : c)) })}
                    >
                      <Icon size={17} />
                    </button>
                  );
                })}
              </div>
              <PairField
                label={"หัวข้อการ์ดที่ " + (i + 1)}
                required
                value={card.title}
                max={LIMITS.cardTitle}
                onChange={(title) => onChange({ ...value, cards: value.cards.map((c, j) => (j === i ? { ...c, title } : c)) })}
              />
              <PairField
                label={"ข้อความการ์ดที่ " + (i + 1)}
                multiline
                value={card.text}
                max={LIMITS.cardText}
                onChange={(text) => onChange({ ...value, cards: value.cards.map((c, j) => (j === i ? { ...c, text } : c)) })}
              />
            </div>
            <RowTools
              index={i}
              total={value.cards.length}
              name={"การ์ดที่ " + (i + 1)}
              min={1}
              onMove={(by) => onChange({ ...value, cards: move(value.cards, i, by) })}
              onRemove={() => onChange({ ...value, cards: value.cards.filter((_, j) => j !== i) })}
            />
          </li>
        ))}
      </ol>
      <div className="appearance-add">
        <button
          type="button"
          className="button secondary"
          disabled={full}
          onClick={() => onChange({ ...value, cards: [...value.cards, { icon: "ShieldCheck", title: { th: "", en: "" }, text: { th: "", en: "" } }] })}
        >
          <Plus size={15} />
          เพิ่มการ์ด
        </button>
        <span>
          {value.cards.length}/{LIMITS.cardsMax}
        </span>
      </div>
    </div>
  );
}

function FooterForm({ value, onChange, automatic }: { value: Appearance["footer"]; onChange: (v: Appearance["footer"]) => void; automatic: string }) {
  const full = value.links.length >= LIMITS.footerLinksMax;
  return (
    <div className="appearance-fields">
      <PairField
        label="คำอธิบายร้าน"
        multiline
        value={value.description}
        max={LIMITS.footerDescription}
        placeholder={automatic}
        help="เว้นว่าง = ใช้คำโปรยร้านจาก ตั้งค่า › ร้าน"
        onChange={(description) => onChange({ ...value, description })}
      />
      <h3 className="appearance-subhead">เมนูส่วนท้าย</h3>
      <ol className="appearance-list">
        {value.links.map((item, i) => (
          <li key={i} className="appearance-row">
            <span className="row-index" aria-hidden="true">{i + 1}</span>
            <div className="card-fields">
              <PairField
                label={"ชื่อเมนูที่ " + (i + 1)}
                required
                value={item.label}
                max={LIMITS.linkLabel}
                onChange={(label) => onChange({ ...value, links: value.links.map((x, j) => (j === i ? { ...x, label } : x)) })}
              />
              <LinkField
                label="ลิงก์"
                value={item.link}
                onChange={(link) => onChange({ ...value, links: value.links.map((x, j) => (j === i ? { ...x, link } : x)) })}
              />
            </div>
            <RowTools
              index={i}
              total={value.links.length}
              name={"เมนูที่ " + (i + 1)}
              onMove={(by) => onChange({ ...value, links: move(value.links, i, by) })}
              onRemove={() => onChange({ ...value, links: value.links.filter((_, j) => j !== i) })}
            />
          </li>
        ))}
      </ol>
      <div className="appearance-add">
        <button
          type="button"
          className="button secondary"
          disabled={full}
          onClick={() => onChange({ ...value, links: [...value.links, { label: { th: "", en: "" }, link: "/" }] })}
        >
          <Plus size={15} />
          เพิ่มเมนู
        </button>
        <span>
          {value.links.length}/{LIMITS.footerLinksMax}
        </span>
      </div>
      <p className="appearance-locked">
        <Lock size={15} aria-hidden="true" />
        ข้อความ “Theme By limitcode studio” ท้ายเว็บแสดงเสมอ แก้ไขหรือซ่อนไม่ได้
      </p>
    </div>
  );
}

function SeoForm({
  value,
  saved,
  onChange,
  onUploaded,
  shopName,
}: {
  value: Appearance["seo"];
  saved: Appearance["seo"];
  onChange: (v: Partial<Appearance["seo"]>) => void;
  onUploaded: (data: Data) => void;
  shopName?: string;
}) {
  const name = shopName && shopName !== "ร้านค้า" ? shopName : "ASIA EXTRA";
  const title = value.title.th || name;
  const description = value.description.th || DEFAULT_TAGLINE;
  return (
    <div className="appearance-fields">
      <PairField
        label="ชื่อเว็บ"
        value={value.title}
        max={LIMITS.seoTitle}
        placeholder={name}
        help={"ต่อท้ายชื่อแท็บทุกหน้า เช่น “สินค้าทั้งหมด — " + title + "” เว้นว่าง = ใช้ชื่อร้าน"}
        onChange={(t) => onChange({ title: t })}
      />
      <PairField
        label="คำอธิบายเว็บ"
        multiline
        value={value.description}
        max={LIMITS.seoDescription}
        placeholder={DEFAULT_TAGLINE}
        help="แสดงใน Google และตอนแชร์ลิงก์หน้าแรก เว้นว่าง = ใช้ข้อความเดิม"
        onChange={(d) => onChange({ description: d })}
      />
      <ImageSetting
        kind="og"
        title="รูปตอนแชร์ลิงก์"
        help="แสดงเมื่อแชร์ลิงก์ร้านใน LINE / Facebook · แนะนำ 1200×630 px · JPG, PNG หรือ WebP"
        current={saved.ogImageUrl ?? null}
        fallback="/brand/og.png"
        onUploaded={onUploaded}
      />
      <ImageSetting
        kind="favicon"
        title="ไอคอนเว็บ (favicon / ไอคอนแอป)"
        help="รูปเล็กบนแท็บเบราว์เซอร์และหน้าจอโฮม · รูปสี่เหลี่ยมจัตุรัสอย่างน้อย 192×192 px"
        current={saved.faviconUrl ?? null}
        fallback="/brand/favicon-64.png"
        onUploaded={onUploaded}
      />
      <div className="share-preview" aria-label="ตัวอย่างตอนแชร์ลิงก์">
        <img src={saved.ogImageUrl || "/brand/og.png"} alt="" />
        <div>
          <small>{location.host}</small>
          <strong>{title} — สินค้าดิจิทัล</strong>
          <span>{description}</span>
        </div>
      </div>
      <p className="field-help">แอปแชทเก็บตัวอย่างลิงก์ไว้ระยะหนึ่ง ลิงก์ที่เคยแชร์แล้วอาจยังแสดงรูปเดิมสักพัก</p>
    </div>
  );
}

function ImageSetting({
  kind,
  title,
  help,
  current,
  fallback,
  onUploaded,
}: {
  kind: "og" | "favicon";
  title: string;
  help: string;
  current: string | null;
  fallback: string;
  onUploaded: (data: Data) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const path = kind === "og" ? "/admin/appearance/og-image" : "/admin/appearance/favicon";
  async function upload(file: File) {
    const problem = checkSource(file);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const blob = kind === "og" ? await toImage(file, 1200, "image/jpeg") : await toImage(file, 256, "image/png");
      onUploaded(await uploadImage<Data>(path, blob));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError("");
    try {
      onUploaded(await api<Data>(path, undefined, "DELETE"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className={"appearance-group image-setting " + kind}>
      <legend>{title}</legend>
      <div className="image-setting-row">
        <img src={current || fallback} alt={current ? title + " ที่อัปโหลด" : title + " เดิม"} />
        <div>
          <p className="field-help">{help}</p>
          <div className="image-setting-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <ImageUp size={15} />}
              {current ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
            </button>
            {current ? (
              <button type="button" className="button ghost" disabled={busy} onClick={() => void remove()}>
                <Trash2 size={15} />
                กลับไปใช้รูปเดิม
              </button>
            ) : (
              <span className="field-help">ตอนนี้ใช้รูปเดิมของร้าน</span>
            )}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept="image/jpeg,image/png,image/webp"
        aria-label={"เลือกไฟล์" + title}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <ErrorMessage message={error} />
      <small className="field-help">อัปโหลดแล้วใช้ทันที ไม่ต้องกดบันทึก</small>
    </fieldset>
  );
}

/* ---------- Reset confirmation (shadcn/ui AlertDialog anatomy) ---------- */
function ResetDialog({
  part,
  busy,
  onClose,
  onConfirm,
}: {
  part: AppearancePart | "all";
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useDialog(true, ".appearance-reset-dialog", onClose);
  const name = part === "all" ? "ทุกส่วน" : (TABS.find(([p]) => p === part)?.[1] ?? "");
  return (
    <div className="reference-modal-backdrop" onClick={onClose}>
      <section
        className="reference-import-modal appearance-reset-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="appearance-reset-title"
        aria-describedby="appearance-reset-text"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="reference-card-heading">
          <h2 id="appearance-reset-title">คืนค่าเดิม: {name}</h2>
          <button type="button" className="icon-button" aria-label="ปิด" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="appearance-reset-body">
          <p id="appearance-reset-text">
            {part === "all"
              ? "หน้าร้านทุกส่วนจะกลับเป็นแบบเดิมทันที รวมถึงรูปตอนแชร์ลิงก์และไอคอนเว็บที่อัปโหลดไว้"
              : part === "seo"
                ? "ชื่อเว็บ คำอธิบาย รูปตอนแชร์ลิงก์ และไอคอนเว็บจะกลับเป็นแบบเดิมทันที"
                : "ส่วนนี้บนหน้าร้านจะกลับเป็นแบบเดิมทันที ส่วนอื่นไม่เปลี่ยน"}
          </p>
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
              ยกเลิก
            </button>
            <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
              คืนค่าเดิม
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------- Live preview: the real storefront in a frame, fed with the draft ---------- */
function AppearancePreview({ draft, tab }: { draft: Appearance; tab: AppearancePart }) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [page, setPage] = useState<"/" | "/credits">("/");
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const focus = useRef<string>("");
  // Follow the tab: the trust block lives on /credits, the footer at the bottom.
  useEffect(() => {
    setPage(tab === "trust" ? "/credits" : "/");
  }, [tab]);
  const wanted = tab === "footer" ? "footer" : tab === "trust" || tab === "seo" ? "" : "top";
  const send = () => {
    const message: Record<string, unknown> = { type: "shop-preview", appearance: draft, path: page };
    if (focus.current !== tab + page) {
      focus.current = tab + page;
      if (wanted) message.focus = wanted;
    }
    frame.current?.contentWindow?.postMessage(message, location.origin);
  };
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin === location.origin && e.source === frame.current?.contentWindow && e.data?.type === "shop-preview-ready") {
        setReady(true);
        focus.current = "";
        send();
      }
    };
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  });
  useEffect(send, [JSON.stringify(draft), page, tab]);
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => setBox(entry.contentRect.width));
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const height = 620;
  const width = device === "desktop" ? 1280 : 390;
  const scale = device === "desktop" ? (box || 600) / width : Math.min(1, height / 800, (box || 390) / width);
  return (
    <div className="shop-preview appearance-preview" aria-label="ตัวอย่างหน้าร้าน">
      <div className="shop-preview-bar appearance-preview-bar">
        <div className="segmented" role="group" aria-label="หน้าที่ดู">
          <button type="button" aria-pressed={page === "/"} onClick={() => setPage("/")}>
            หน้าแรก
          </button>
          <button type="button" aria-pressed={page === "/credits"} onClick={() => setPage("/credits")}>
            เครดิตร้าน
          </button>
        </div>
        <div className="segmented" role="group" aria-label="ขนาดจอ">
          <button type="button" aria-pressed={device === "desktop"} aria-label="ดูแบบคอมพิวเตอร์" onClick={() => setDevice("desktop")}>
            <Monitor size={15} />
          </button>
          <button type="button" aria-pressed={device === "mobile"} aria-label="ดูแบบมือถือ" onClick={() => setDevice("mobile")}>
            <Smartphone size={15} />
          </button>
        </div>
        <a href={page} target="_blank" rel="noreferrer" aria-label="เปิดหน้าร้านในแท็บใหม่">
          <ExternalLink size={15} />
        </a>
      </div>
      <div ref={stage} className={"shop-preview-stage " + device} style={{ height }}>
        {!ready && (
          <div className="shop-preview-loading">
            <LoaderCircle className="spin" size={18} />
            กำลังโหลดหน้าร้าน
          </div>
        )}
        <iframe
          ref={frame}
          title="ตัวอย่างหน้าร้านจริง"
          src="/?shop-preview=1"
          style={{ width, height: height / scale, transform: `scale(${scale})` }}
        />
      </div>
      <p className="shop-preview-note">
        หน้าร้านจริง กดเล่นได้ · สิ่งที่ยังไม่บันทึกเห็นเฉพาะในกรอบนี้ · สลับภาษาไทย/อังกฤษได้ที่ปุ่ม TH/EN ในกรอบ
      </p>
    </div>
  );
}
