/**
 * Live updates. Mutating service calls bump a topic version and tell listeners
 * (the Durable Object broadcasts to WebSockets). Messages carry only topic names;
 * clients refetch through the normal authenticated APIs. Without WebSockets,
 * clients poll GET /api/live and compare versions.
 */
export const LIVE_TOPICS = ["chat", "orders", "catalog", "notify", "customers", "team"];

const LIVE_METHODS = {
  createOrder: ["orders", "catalog"],
  pay: ["orders", "catalog", "notify"],
  retry: ["orders"],
  topup: ["customers"],
  importCodes: ["catalog", "notify"],
  saveProduct: ["catalog"],
  bulkUpdateProducts: ["catalog"],
  duplicateProduct: ["catalog"],
  createVariant: ["catalog"],
  updateVariant: ["catalog"],
  deleteVariant: ["catalog"],
  markInventoryDefect: ["catalog"],
  deleteInventoryUnit: ["catalog"],
  deliverReservation: ["orders", "notify"],
  adminCancelOrder: ["orders"],
  adminAddOrderNote: ["orders"],
  refundOrder: ["orders", "customers", "catalog", "notify"],
  adjustCustomerCredit: ["customers", "notify"],
  replaceOrderCredential: ["orders", "catalog", "notify"],
  resendOrderCredentials: ["orders", "chat", "notify"],
  addProductImage: ["catalog"],
  reorderProductImages: ["catalog"],
  deleteProductImage: ["catalog"],
  setAvatar: ["customers"],
  removeAvatar: ["customers"],
  setLogo: ["catalog"],
  removeLogo: ["catalog"],
  openChatThread: ["chat", "notify"],
  postChatMessage: ["chat", "notify"],
  closeChatThread: ["chat"],
  assignChatThread: ["chat", "notify"],
  markNotificationRead: ["notify"],
  addReview: ["catalog"],
  register: ["customers"],
  adminUpdateCustomer: ["customers"],
  adminSetCustomerStatus: ["customers"],
  saveSettings: ["catalog"],
  saveStaff: ["team"],
  setMemberRole: ["team", "customers", "notify"],
  setStaffActive: ["team"],
};

export function ensureLiveVersions(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS live_versions(topic TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0)",
  );
}

export function withLive(service, { run, all }) {
  const listeners = new Set();
  const bump = (topics) => {
    for (const topic of topics)
      run(
        "INSERT INTO live_versions(topic,version) VALUES(?,1) ON CONFLICT(topic) DO UPDATE SET version=version+1",
        topic,
      );
    for (const listener of listeners) {
      try {
        listener(topics);
      } catch {
        // A broken socket must never fail the request that changed data.
      }
    }
  };
  const wrapped = { ...service };
  for (const [name, topics] of Object.entries(LIVE_METHODS)) {
    const original = service[name];
    if (typeof original !== "function") continue;
    wrapped[name] = (...args) => {
      const result = original(...args);
      bump(topics);
      return result;
    };
  }
  // For changes that are not a single service call (the lazy unpaid-order expiry).
  wrapped.bumpLive = (topics) => bump(topics.filter((topic) => LIVE_TOPICS.includes(topic)));
  wrapped.liveVersions = () => {
    const versions = Object.fromEntries(LIVE_TOPICS.map((t) => [t, 0]));
    for (const row of all("SELECT topic,version FROM live_versions")) versions[row.topic] = row.version;
    return versions;
  };
  wrapped.onLive = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return wrapped;
}
