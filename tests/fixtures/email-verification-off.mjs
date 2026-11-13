// Turns the shop setting "ยืนยันอีเมลก่อนสั่งซื้อ" off for tests that configure a fake email
// sender but are about something else (order emails, broadcasts, templates…). With email
// configured the setting is on by default (server/email-verification.mjs). Written straight to
// the settings row so no audit row or extra admin account appears in those tests.
export function emailVerificationOff(s) {
  s.db
    .prepare(
      `INSERT INTO runtime_flags(key,value) VALUES('shop-settings',?)
       ON CONFLICT(key) DO UPDATE SET value=json_set(value,'$.requireEmailVerification',json('false'))`,
    )
    .run(JSON.stringify({ requireEmailVerification: false }));
  return s;
}
