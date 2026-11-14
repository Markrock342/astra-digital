// One shared live connection per tab. WebSocket (Cloudflare Durable Object) pushes
// topic names the moment data changes; if the socket can't open (local dev, proxy),
// we poll /api/live every 3s instead. Hooks refetch their own data on a signal.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export type LiveTopic = "chat" | "orders" | "catalog" | "notify" | "customers" | "team" | "content";
type Listener = (topics: LiveTopic[]) => void;

const listeners = new Set<Listener>();
let started = false;
let socket: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let versions: Record<string, number> | null = null;
let connected = false;
const statusListeners = new Set<(on: boolean) => void>();

function emit(topics: LiveTopic[]) {
  if (topics.length) for (const l of listeners) l(topics);
}
function setConnected(on: boolean) {
  connected = on;
  for (const l of statusListeners) l(on);
}

async function poll() {
  try {
    const { versions: next } = await api<{ versions: Record<string, number> }>("/live");
    if (versions) emit(Object.keys(next).filter((t) => next[t] !== versions![t]) as LiveTopic[]);
    versions = next;
  } catch {
    // offline for a moment; try again next tick
  }
}
function startPolling(ms: number) {
  if (pollTimer) clearInterval(pollTimer);
  void poll();
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") void poll();
  }, ms);
}

function connect() {
  if (typeof WebSocket === "undefined") return startPolling(3000);
  try {
    socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/live");
  } catch {
    return startPolling(3000);
  }
  let opened = false;
  socket.onopen = () => {
    opened = true;
    setConnected(true);
    // Socket carries the signals; a slow poll only covers missed messages.
    startPolling(30000);
  };
  socket.onmessage = (event) => {
    if (event.data === "pong") return;
    try {
      const { topics } = JSON.parse(event.data) as { topics: LiveTopic[] };
      emit(topics);
      void poll();
    } catch {
      // ignore malformed frames
    }
  };
  socket.onclose = () => {
    setConnected(false);
    socket = null;
    startPolling(3000);
    // Retry the socket later (deploys and idle proxies close it).
    setTimeout(connect, opened ? 2000 : 15000);
  };
}

function start() {
  if (started) return;
  started = true;
  startPolling(3000);
  connect();
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  }, 25000);
}

/** Calls `onChange` whenever one of `topics` changes anywhere in the shop. */
export function useLive(topics: LiveTopic[], onChange: () => void) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = topics.join(",");
  useEffect(() => {
    start();
    const wanted = new Set(key.split(","));
    const listener: Listener = (changed) => {
      if (changed.some((t) => wanted.has(t))) callback.current();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);
}

/** True while the push socket is open (shown as a "live" dot in the admin). */
export function useLiveStatus() {
  const [on, setOn] = useState(connected);
  useEffect(() => {
    start();
    statusListeners.add(setOn);
    return () => {
      statusListeners.delete(setOn);
    };
  }, []);
  return on;
}
